import json
from datetime import UTC, datetime, timedelta

import httpx
from openai import AsyncOpenAI

from backend.ai_engine import (
    TriageContext,
    capacity_step,
    grade_floor,
    risk_tier,
    rubric_lines,
    run_triage_agent,
    triage_context,
)
from backend.canvas_client import get_mock_sandbox_data
from backend.config import Settings
from backend.models import DecomposeResponse, InferenceTelemetry, TerminalMetrics, TerminalState
from backend.tasks import walk

from .conftest import service_context, settings

NOW = datetime(2026, 10, 20, 12, tzinfo=UTC)


def mock_state(now=NOW) -> TerminalState:
    snapshot = get_mock_sandbox_data(now)
    return TerminalState(
        courses=snapshot.courses,
        assignments=snapshot.assignments,
        study_recommendations=[],
        upcoming_events=snapshot.upcoming_events,
        metrics=TerminalMetrics(
            completion_velocity=0,
            assignment_volatility=0,
            total_budgeted_minutes=0,
            total_actual_minutes=0,
            last_synced_at=now.isoformat(),
            demo_mode=True,
        ),
    )


def assignment_of(state, assignment_id):
    return next(a for a in state.assignments if a.id == assignment_id)


def completion(payload, model="Llama-3.3-70B-Instruct"):
    return httpx.Response(
        200,
        json={
            "id": "fixture",
            "object": "chat.completion",
            "created": 1,
            "model": model,
            "usage": {"prompt_tokens": 300, "completion_tokens": 120, "total_tokens": 420},
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": json.dumps(payload)},
                }
            ],
        },
    )


PLAN = {
    "sequencing_rationale": "Secure the 60% test harness before the design doc.",
    "subtasks": [
        {
            "title": "Pass the election tests",
            "estimated_minutes": 45,
            "children": [
                {"title": "Wire RequestVote", "estimated_minutes": 30, "children": []},
                {"title": "Run TestInitialElection3A", "estimated_minutes": 20, "children": []},
            ],
        },
        {"title": "Draft the design doc", "estimated_minutes": 40, "children": []},
    ],
}


def mock_llm(handler):
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return http, AsyncOpenAI(
        api_key="fixture", base_url="http://local/v1", http_client=http, max_retries=0
    )


def test_rubric_floor_and_risk_match_the_terminal():
    raft = assignment_of(mock_state(), "cs3801-raft")
    assert rubric_lines(raft.description) == [
        ("test harness", 60.0),
        ("design doc", 30.0),
        ("code quality", 10.0),
    ]
    # "95% confidence intervals" is not a rubric line.
    assert rubric_lines(assignment_of(mock_state(), "math4102-queue").description) == []
    # CS 3801 holds 92.4 against a 90 target; a 25% lab can drop to 82.8 and stay on target.
    assert round(grade_floor(25, 92.4, 90), 1) == 82.8
    assert risk_tier(25, grade_floor(25, 92.4, 90)) == "medium"
    # MATH 4102 sits 3.9 below target: a 20% project alone would need 105.6%.
    assert round(grade_floor(20, 86.1, 90), 1) == 105.6
    assert risk_tier(20, grade_floor(20, 86.1, 90)) == "high"
    assert grade_floor(0, 90, 90) is None
    assert risk_tier(25, None) == "high"
    assert risk_tier(5, None) == "low"


def test_text_and_numbers_render_like_the_terminal():
    # JavaScript's \w is ASCII: the terminal reads these criteria the same truncated way.
    assert rubric_lines("Rubric: Análisis de datos 40%, Präsentation 60%.") == [
        ("lisis de datos", 40.0),
        ("sentation", 60.0),
    ]
    assert rubric_lines("Rubric: essay ٦٠%.") == []
    # Exact halves round up like toFixed, not to even: a 92.25 grade is +2.3 on both screens.
    context = TriageContext(now=NOW, current_score=92.25, target_score=90.0)
    project = assignment_of(mock_state(), "math4102-queue")
    assert capacity_step(project, context).evidence[0] == "MARGIN +2.3 pts vs the 90.0 target"
    eighth = TriageContext(now=NOW, queued_minutes=60, current_score=92.25, target_score=90.0)
    window = project.model_copy(update={"due_at": NOW + timedelta(hours=8)})
    assert capacity_step(window, eighth).evidence[-1].startswith("LOAD 13% of the")


def test_context_books_unlogged_fills_at_estimate_and_queues_earlier_deadlines():
    state = mock_state()
    raft = assignment_of(state, "cs3801-raft")
    leaf = raft.subtasks[1].children[1]
    leaf.is_completed, leaf.actual_minutes = True, 0
    context = triage_context(state, assignment_of(state, "math4102-queue"), NOW)
    completed = [
        node
        for a in state.assignments
        for node in walk(a.subtasks)
        if not node.children and node.is_completed
    ]
    assert context.velocity_fills == len(completed)
    assert context.velocity_actual == sum(
        n.actual_minutes or n.estimated_minutes for n in completed
    )
    assert context.current_score == 86.1 and context.target_score == 90.0
    queue_due = assignment_of(state, "math4102-queue").due_at
    later = [
        a
        for a in state.assignments
        if a.status != "completed" and a.due_at > queue_due and a.subtasks
    ]
    assert later, "fixture needs open work due after the project"
    assert context.queued_minutes < context.open_budget_minutes


async def test_agent_briefs_the_model_and_traces_four_grounded_steps():
    state = mock_state()
    raft = assignment_of(state, "cs3801-raft").model_copy(update={"subtasks": []})
    context = triage_context(state, raft, NOW)
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return completion(PLAN)

    telemetry = InferenceTelemetry()
    http, client = mock_llm(handler)
    async with http, client:
        nodes, trace = await run_triage_agent(
            raft, context, settings=settings(), client=client, telemetry=telemetry
        )

    brief = json.loads(requests[0]["messages"][1]["content"])["agent_brief"]
    assert brief["rubric_constraints"][0] == (
        "test harness 60% (90 pts): TestInitialElection3A, TestBasicAgree3B, TestPersist3C"
    )
    assert brief["grade_floor_percent"] == 82.8
    assert brief["capacity"] == trace[1].summary
    assert [step.title for step in trace] == [
        "INGEST & AUDIT",
        "CAPACITY CHECK",
        "CRITICAL PATH",
        "VERIFICATION",
    ]
    ingest, capacity, critical, verify = trace
    assert ingest.status == "watch" and ingest.engine == "rubric-parser"
    assert "MEDIUM risk weight" in ingest.summary
    assert "FLOOR score ≥ 82.8% holds the 90.0 target (margin +2.4)" in ingest.evidence
    assert capacity.engine == "capacity-engine"
    assert capacity.evidence[0] == "MARGIN +2.4 pts vs the 90.0 target"
    assert critical.engine == "Llama-3.3-70B-Instruct"
    assert critical.latency_ms == telemetry.latency_ms
    assert critical.summary == "3 atomic tasks sequenced · 1h 30m open"
    assert "MODEL NOTE Secure the 60% test harness before the design doc." in critical.evidence
    assert "START Wire RequestVote (30m)" in critical.evidence
    assert verify.engine == "velocity-auditor"
    velocity = context.velocity
    assert verify.evidence[0].startswith(f"VELOCITY {velocity:.0f}% over ")
    assert nodes[0].title == "Pass the election tests"
    DecomposeResponse(subtasks=nodes, telemetry=telemetry, source="ai", agent_reasoning_trace=trace)


async def test_canvas_point_rubric_details_survive_in_constraint_brief():
    assignment = assignment_of(mock_state(), "cs3801-raft").model_copy(
        update={
            "subtasks": [],
            "description": "Analyze a system.\nRubric:\n"
            "Design & evidence (30.5 points): Explain the tradeoffs. Cite two sources.\n"
            "Correctness (69.5 points): Pass all tests.\nInclude boundary cases.",
        }
    )
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return completion(PLAN)

    http, client = mock_llm(handler)
    async with http, client:
        await run_triage_agent(
            assignment, TriageContext(now=NOW), settings=settings(), client=client
        )
    brief = json.loads(requests[0]["messages"][1]["content"])["agent_brief"]
    assert brief["rubric_constraints"] == [
        "Correctness (69.5 points): Pass all tests. Include boundary cases.",
        "Design & evidence (30.5 points): Explain the tradeoffs. Cite two sources.",
    ]


async def test_auditor_prefilter_constraints_lead_the_brief_and_fall_back_when_down():
    state = mock_state()
    raft = assignment_of(state, "cs3801-raft").model_copy(update={"subtasks": []})
    context = triage_context(state, raft, NOW)
    config = settings(auditor_api_key="fixture", auditor_model="deepseek-flash")
    assert config.auditor_enabled and not settings().auditor_enabled
    primary_bodies = []

    def auditor_handler(request):
        assert json.loads(request.content)["model"] == "deepseek-flash"
        return completion(
            {"constraints": ["Tests: all three suites pass", "Design doc: two pages"]},
            model="deepseek-flash",
        )

    def primary(request):
        primary_bodies.append(json.loads(request.content))
        return completion(PLAN)

    audit_http, auditor = mock_llm(auditor_handler)
    http, client = mock_llm(primary)
    async with audit_http, auditor, http, client:
        _, trace = await run_triage_agent(
            raft, context, settings=config, client=client, auditor=auditor
        )
    brief = json.loads(primary_bodies[0]["messages"][1]["content"])["agent_brief"]
    assert brief["rubric_constraints"] == ["Tests: all three suites pass", "Design doc: two pages"]
    assert trace[0].engine == "deepseek-flash"
    assert trace[0].evidence[0] == "RUBRIC Tests: all three suites pass"
    assert any(line.startswith("PRE-FILTER deepseek-flash · ") for line in trace[0].evidence)

    down_http, down = mock_llm(lambda request: httpx.Response(503))
    http, client = mock_llm(lambda request: completion(PLAN))
    async with down_http, down, http, client:
        _, trace = await run_triage_agent(
            raft, context, settings=config, client=client, auditor=down
        )
    assert trace[0].engine == "rubric-parser"
    assert trace[0].evidence[0] == (
        "RUBRIC test harness 60% (90 pts): TestInitialElection3A, TestBasicAgree3B, TestPersist3C"
    )
    assert trace[0].evidence[-1].endswith("unavailable, rubric parser used")


async def test_overdue_or_below_target_work_is_flagged_in_capacity_and_verification():
    state = mock_state()
    project = assignment_of(state, "math4102-queue")
    overdue = project.model_copy(update={"due_at": NOW - timedelta(hours=3)})
    context = triage_context(state, overdue, NOW)
    http, client = mock_llm(lambda request: httpx.Response(503))
    async with http, client:
        _, trace = await run_triage_agent(overdue, context, settings=settings(), client=client)
    ingest, capacity, critical, verify = trace
    assert ingest.status == "risk"
    assert "105.6% needed: the 90.0 target is out of reach" in ingest.evidence[-1]
    assert capacity.status == "risk"
    assert "WINDOW deadline passed 3h 00m ago" in capacity.evidence
    assert critical.engine == "local-starter-plan" and critical.status == "pass"
    assert verify.status == "risk"

    # Below target with an easy deadline still earns a watch, never a pass.
    calm = TriageContext(now=NOW, current_score=86.1, target_score=90.0)
    http, client = mock_llm(lambda request: httpx.Response(503))
    async with http, client:
        _, trace = await run_triage_agent(project, calm, settings=settings(), client=client)
    assert trace[1].status == "watch"
    assert trace[3].evidence[0] == (
        "VELOCITY no completed tasks yet · estimates taken at face value"
    )


async def test_saved_plan_trace_runs_no_model_and_says_why():
    calls = []

    def llm(request):
        calls.append(request)
        return httpx.Response(503)

    async with service_context(llm_handler=llm) as terminal:
        trace = []
        telemetry = InferenceTelemetry()
        nodes = await terminal.triage("cs3801-raft", telemetry=telemetry, trace=trace)
    assert nodes and not calls
    assert telemetry.model_used == "cached-plan"
    assert trace[2].engine == "cached-plan" and trace[2].latency_ms == 0
    assert "SAVED PLAN work is already logged on it, so it was kept" in trace[2].evidence
    assert len(trace) == 4


def test_meta_model_ids_pass_through_for_the_primary_agent():
    for model in ("muse-spark", "Llama-4-Maverick-17B-128E-Instruct-FP8"):
        config = Settings(meta_api_key="fixture", meta_model=model)
        assert config.inference_model == model
