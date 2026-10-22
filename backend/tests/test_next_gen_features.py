import asyncio
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.ai_engine import TriageContext, generate_defense_council
from backend.main import create_app
from backend.models import (
    AssignmentModel,
    CourseModel,
    DefenseCouncilDeliberation,
    SubTaskNode,
)
from backend.service import (
    MonteCarloRequest,
    _congestion_factors,
    _simulate_course,
    detect_deadline_congestion,
    generate_margin_call,
)

from .conftest import service_context, settings
from .test_agent_stream import parse_events, stream_api, stream_response

NOW = datetime(2040, 1, 1, tzinfo=UTC)


def assignment(identifier="a", *, course_id="one", hours=12, weight=25.0, **changes):
    return AssignmentModel(
        id=identifier,
        course_id=course_id,
        course_code=course_id.upper(),
        title=f"Deliverable {identifier}",
        due_at=NOW + timedelta(hours=hours) if hours is not None else None,
        weight=weight,
        **changes,
    )


def course(identifier="one", score=80.0, target=90.0):
    return CourseModel(
        id=identifier,
        course_code=identifier.upper(),
        name=identifier,
        current_score=score,
        target_score=target,
    )


def council_plan():
    return {
        "members": [
            {"role": role, "position": f"{role} evidence", "priorities": ["Verify the rubric"]}
            for role in ("Professor", "Student", "Arbitrator")
        ],
        "verdict": "Secure the rubric evidence first.",
        "subtasks": [{"title": "Verify evidence", "estimated_minutes": 30, "children": []}],
    }


def completion(plan=None, *, finish="stop", usage=None):
    return httpx.Response(
        200,
        json={
            "id": "council",
            "object": "chat.completion",
            "created": 1,
            "model": "fixture-council",
            "usage": usage,
            "choices": [
                {
                    "index": 0,
                    "finish_reason": finish,
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(council_plan() if plan is None else plan),
                    },
                }
            ],
        },
    )


@pytest.fixture
async def feature_api(terminal, monkeypatch):
    state = await terminal.state()
    state.courses = [course(), course("two", score=95)]
    state.assignments = [assignment(), assignment("b", course_id="two", hours=24)]
    monkeypatch.setattr(terminal, "state", AsyncMock(return_value=state))
    app = create_app(service=terminal)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client, state, terminal


async def test_council_meta_uses_computed_facts_and_measured_usage():
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        return completion(usage={"prompt_tokens": 40, "completion_tokens": 20, "total_tokens": 60})

    async with service_context(
        config=settings(meta_api_key="fixture"), llm_handler=handler
    ) as service:
        result = await generate_defense_council(
            assignment(),
            TriageContext(now=NOW, current_score=80, target_score=90),
            settings=service.settings,
            client=service.llm,
        )
    assert result.source == "ai"
    assert [m.role for m in result.members] == ["Professor", "Student", "Arbitrator"]
    assert result.subtasks[0].estimated_minutes == 30
    assert result.telemetry.model_used == "fixture-council"
    assert result.telemetry.completion_tokens == 20
    assert result.telemetry.tokens_per_sec > 0
    assert calls[0]["model"] == "muse-spark-1.3"
    assert "untrusted" in calls[0]["messages"][0]["content"]
    facts = json.loads(calls[0]["messages"][1]["content"])
    assert facts["grade_floor"]["grade_floor_percent"] == 120


@pytest.mark.parametrize(
    "reply",
    [
        lambda: httpx.Response(503),
        lambda: completion({}),
        lambda: completion(finish="length"),
        lambda: completion({**council_plan(), "members": council_plan()["members"][::-1]}),
        lambda: completion({**council_plan(), "verdict": " "}),
        lambda: completion({**council_plan(), "subtasks": []}),
        lambda: completion({**council_plan(), "extra": True}),
    ],
)
async def test_council_invalid_provider_output_falls_back_honestly(reply):
    async with service_context(llm_handler=lambda request: reply()) as service:
        result = await generate_defense_council(
            assignment(), TriageContext(now=NOW), settings=service.settings, client=service.llm
        )
    assert result.source == "local"
    assert "unknown" in result.verdict
    assert result.subtasks
    assert result.telemetry.model_used == "local-defense-council"
    assert result.telemetry.completion_tokens is None
    assert result.telemetry.tokens_per_sec is None


async def test_council_timeout_is_bounded():
    async def slow(request):
        await asyncio.sleep(0.1)
        return completion()

    async with service_context(
        config=settings(llm_timeout_seconds=0.001), llm_handler=slow
    ) as service:
        result = await generate_defense_council(
            assignment(), TriageContext(now=NOW), settings=service.settings, client=service.llm
        )
    assert result.source == "local"


async def test_council_does_not_replace_recorded_work():
    work = SubTaskNode(
        id="work",
        assignment_id="a",
        title="Existing work",
        estimated_minutes=30,
        actual_minutes=5,
    )
    item = assignment(subtasks=[work])
    async with service_context(llm_handler=lambda request: completion()) as service:
        result = await generate_defense_council(
            item, TriageContext(now=NOW), settings=service.settings, client=service.llm
        )
    assert result.source == "ai"
    assert result.subtasks == [work]
    assert result.subtasks[0] is not work


async def test_council_endpoint_snapshot_is_read_only_and_unknown_assignment_404(feature_api):
    client, state, terminal = feature_api
    before, saves = state.model_dump(), terminal.store.saves
    response = await client.post("/api/v1/triage/a/council")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert DefenseCouncilDeliberation.model_validate(response.json()).assignment_id == "a"
    assert terminal.store.saves == saves
    assert state.model_dump() == before
    assert (await client.post("/api/v1/triage/missing/council")).status_code == 404
    alias = await client.post("/api/v1/defense-council", json={"assignment_id": "a"})
    assert alias.status_code == 200
    assert DefenseCouncilDeliberation.model_validate(alias.json()).assignment_id == "a"
    assert (await client.post("/api/v1/defense-council", json={})).status_code == 422


async def test_stream_emits_three_ordered_council_turns_and_validated_complete():
    def handler(request):
        return stream_response() if json.loads(request.content).get("stream") else completion()

    async with stream_api(handler) as (client, _, item):
        events = parse_events(await client.get(f"/api/v1/triage/{item.id}/stream"))
    turns = [event["data"] for event in events if event["event"] == "council_turn"]
    assert [turn["role"] for turn in turns] == ["Professor", "Student", "Arbitrator"]
    assert all(turn["source"] == "ai" for turn in turns)
    assert events[-1]["event"] == "complete"
    assert events[-1]["data"]["subtasks"]


def test_congestion_inclusive_72_hour_boundary_and_stable_order():
    work = [assignment(hours=0), assignment("b", course_id="two", hours=72)]
    clusters = detect_deadline_congestion(work, now=NOW)
    assert len(clusters) == 1
    assert clusters[0].course_ids == ["one", "two"]
    assert clusters[0].assignment_ids == ["a", "b"]
    assert clusters[0].congestion_score == 0.25
    assert clusters[0].variance_inflation == 1.25
    assert detect_deadline_congestion(work[::-1], now=NOW) == clusters
    work[1].due_at += timedelta(microseconds=1)
    assert detect_deadline_congestion(work, now=NOW) == []


def test_congestion_uses_rolling_windows_without_chaining_or_duplicate_subsets():
    work = [assignment(str(i), course_id=str(i % 2), hours=i * 48) for i in range(3)]
    clusters = detect_deadline_congestion(work, now=NOW)
    assert [c.assignment_ids for c in clusters] == [["0", "1"], ["1", "2"]]
    assert _congestion_factors(clusters)["1"] == 1.25
    work[2].due_at = NOW + timedelta(hours=60)
    assert len(detect_deadline_congestion(work, now=NOW)) == 1


def test_congestion_excludes_settled_undated_overdue_and_single_course_work():
    work = [
        assignment(),
        assignment("same"),
        assignment("completed", course_id="two", status="completed"),
        assignment("graded", course_id="two", graded=True),
        assignment("undated", course_id="two", hours=None),
        assignment("overdue", course_id="two", hours=-1),
    ]
    assert detect_deadline_congestion(work, now=NOW) == []


def test_congestion_is_bounded_for_dense_workload():
    work = [assignment(str(i), course_id=str(i % 2)) for i in range(30)]
    clusters = detect_deadline_congestion(work, now=NOW)
    assert len(clusters) == 1
    assert clusters[0].congestion_score == 1
    assert clusters[0].variance_inflation == 2


def test_variance_inflation_scales_standard_deviation_and_preserves_shocks():
    item = assignment(weight=100)
    baseline = _simulate_course(course(score=50), [item], MonteCarloRequest())
    inflated = _simulate_course(
        course(score=50), [item], MonteCarloRequest(), variance_inflation={"a": 2}
    )
    assert inflated.var_90 > baseline.var_90
    assert inflated.percentiles.p10 < baseline.percentiles.p10
    assert inflated.percentiles.p90 > baseline.percentiles.p90
    shock = MonteCarloRequest(shock_overrides={"a": 80.0})
    assert _simulate_course(course(), [item], shock) == _simulate_course(
        course(), [item], shock, variance_inflation={"a": 2}
    )


async def test_monte_carlo_integration_exposes_cluster_and_preserves_filter(feature_api):
    client, state, _ = feature_api
    full = (await client.post("/api/v1/simulate/monte-carlo", json={})).json()
    selected = (await client.post("/api/v1/simulate/monte-carlo", json={"course_id": "one"})).json()
    assert full["congestion_matrix"] == selected["congestion_matrix"]
    assert len(full["congestion_matrix"]) == 1
    assert selected["courses"] == [full["courses"][0]]
    state.assignments[1].due_at += timedelta(days=10)
    separate = (await client.post("/api/v1/simulate/monte-carlo", json={})).json()
    assert separate["congestion_matrix"] == []
    assert full["courses"][0]["var_90"] > separate["courses"][0]["var_90"]


async def test_margin_call_endpoint_reports_breaches_and_unsent_whatsapp_payload(feature_api):
    client, state, terminal = feature_api
    state.courses[1].current_score = 82
    before, saves = state.model_dump(), terminal.store.saves
    response = await client.post("/api/v1/portfolio/margin-call")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    report = response.json()
    assert report["triggered"] is True
    assert report["academic_stance"] == "CRITICAL_INTERVENTION"
    assert report["liquidation_deficit"] == 9
    assert [c["course_id"] for c in report["breached_courses"]] == ["one", "two"]
    assert report["restoration_order"][0]["assignment_id"] == "a"
    assert report["restoration_order"][0]["required_score"] == 120
    assert report["webhook_payload"]["messaging_product"] == "whatsapp"
    assert "alone cannot restore" in report["webhook_payload"]["text"]["body"]
    assert state.model_dump() == before
    assert terminal.store.saves == saves


def test_margin_call_critical_stance_can_trigger_with_positive_aggregate_margin(feature_api):
    # A healthy course must not hide a breached course.
    _, state, _ = feature_api
    state.courses = [course(score=80), course("two", score=110)]
    report = generate_margin_call(state)
    assert report.triggered
    assert report.liquidation_deficit == 0
    assert [c.course_id for c in report.breached_courses] == ["one"]


def test_margin_call_handles_empty_unknown_and_healthy_portfolios(feature_api):
    _, state, _ = feature_api
    for courses in ([], [course(score=None)], [course(score=99)]):
        state.courses, state.assignments = courses, []
        report = generate_margin_call(state)
        assert not report.triggered
        assert report.breached_courses == []
        assert report.restoration_order == []
        assert report.webhook_payload is None


def test_margin_call_restoration_excludes_submitted_and_graded_work_and_normalizes_weight(
    feature_api,
):
    _, state, _ = feature_api
    state.courses = [course()]
    state.assignments = [
        assignment("large", weight=100),
        assignment("other", weight=100),
        assignment("graded", graded=True),
        assignment("submitted", status="completed"),
        assignment("zero", weight=0),
    ]
    report = generate_margin_call(state)
    assert [a.assignment_id for a in report.restoration_order] == ["large", "other"]
    assert report.restoration_order[0].marginal_impact == pytest.approx(100 / 225)


def test_margin_call_without_remaining_work_explains_manual_recovery(feature_api):
    _, state, _ = feature_api
    state.assignments = []
    report = generate_margin_call(state)
    assert report.triggered
    assert report.restoration_order == []
    assert "instructor" in report.webhook_payload.text["body"]
