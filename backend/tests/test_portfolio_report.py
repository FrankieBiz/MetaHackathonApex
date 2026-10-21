import asyncio
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.main import create_app
from backend.models import AssignmentModel, CourseModel
from backend.service import _grade_points

from .conftest import service_context, settings

ENDPOINT = "/api/v1/portfolio/report"


def course(identifier="course", *, score=95, target=90, **changes):
    return CourseModel(
        id=identifier,
        course_code=identifier.upper(),
        name=f"Course {identifier}",
        current_score=score,
        target_score=target,
        **changes,
    )


def assignment(identifier="open", *, course_id="course", weight=25, **changes):
    return AssignmentModel(
        id=identifier,
        course_id=course_id,
        course_code=course_id.upper(),
        title=f"Deliverable {identifier}",
        weight=weight,
        **changes,
    )


def completion(content=None, *, finish="stop", usage=None, model="muse-spark-1.3"):
    return httpx.Response(
        200,
        json={
            "id": "test",
            "object": "chat.completion",
            "created": 1,
            "model": model,
            "usage": usage,
            "choices": [
                {
                    "index": 0,
                    "finish_reason": finish,
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(
                            {"executive_summary": "## Portfolio\n\nProtect the course target."}
                            if content is None
                            else content
                        ),
                    },
                }
            ],
        },
    )


@pytest.fixture
async def report_api(terminal, monkeypatch):
    snapshot = await terminal.state()
    snapshot.courses = [course()]
    snapshot.assignments = []
    monkeypatch.setattr(terminal, "state", AsyncMock(return_value=snapshot))
    app = create_app(service=terminal)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client, snapshot, terminal


async def test_report_default_body_aggregates_standing_and_uses_honest_fallback(report_api):
    client, state, terminal = report_api
    state.courses = [course("a", score=95, target=90), course("b", score=85, target=80)]
    response = await client.post(ENDPOINT)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    result = response.json()
    assert datetime.fromisoformat(result["generated_at"]).tzinfo is not None
    assert result["portfolio_score"] == 90
    assert result["target_score"] == 85
    assert result["margin"] == 5
    assert result["projected_gpa"] == 3.5
    assert result["academic_stance"] == "MAXIMAL_AGGRESSION"
    assert result["downside_var_90"] == 0
    assert result["high_leverage_actions"] == []
    assert [row["status"] for row in result["course_breakdown"]] == ["AHEAD", "AHEAD"]
    assert "deterministic local template" in result["executive_summary"]
    assert "not an official GPA" in result["executive_summary"]
    assert result["telemetry"]["model_used"] == "local-portfolio-report"
    assert result["telemetry"]["completion_tokens"] is None
    assert result["telemetry"]["tokens_per_sec"] is None
    assert terminal.state.await_count == 1


@pytest.mark.parametrize("body", [{}, {"format": "markdown"}, {"format": "json"}, {"format": None}])
async def test_markdown_body_variants(report_api, body):
    client, _, _ = report_api
    assert (await client.post(ENDPOINT, json=body)).status_code == 200


@pytest.mark.parametrize("body", [{"format": "pdf"}, {"format": 1}, {"extra": True}, []])
async def test_invalid_body_rejected_before_state_or_inference(report_api, body):
    client, _, terminal = report_api
    assert (await client.post(ENDPOINT, json=body)).status_code == 422
    terminal.state.assert_not_awaited()


@pytest.mark.parametrize(
    "score,status,stance",
    [
        (96, "AHEAD", "MAXIMAL_AGGRESSION"),
        (92, "AHEAD", "MAINTAIN_FLOOR"),
        (90, "AT_TARGET", "MAINTAIN_FLOOR"),
        (84, "AT_RISK", "CRITICAL_INTERVENTION"),
        (None, "AT_RISK", "MAINTAIN_FLOOR"),
    ],
)
async def test_course_status_and_portfolio_stance_boundaries(report_api, score, status, stance):
    client, state, _ = report_api
    state.courses = [course(score=score)]
    result = (await client.post(ENDPOINT, json={})).json()
    assert result["academic_stance"] == stance
    assert result["course_breakdown"][0]["status"] == status


async def test_behind_course_triggers_active_protection_even_when_mean_above_target(report_api):
    client, state, _ = report_api
    state.courses = [course(score=89), course("healthy", score=99)]
    state.assignments = [assignment(weight=100)]
    result = (await client.post(ENDPOINT, json={})).json()
    assert result["margin"] == 4
    assert result["course_breakdown"][0]["status"] == "BEHIND"
    assert result["academic_stance"] == "ACTIVE_PROTECTION"


async def test_low_probability_overrides_small_negative_margin(report_api):
    client, state, _ = report_api
    state.courses = [course(score=89)]
    result = (await client.post(ENDPOINT, json={})).json()
    assert result["course_breakdown"][0]["probability_of_target"] == 0
    assert result["academic_stance"] == "CRITICAL_INTERVENTION"


async def test_missing_grades_are_excluded_from_mean_and_block_aggressive_stance(report_api):
    client, state, _ = report_api
    state.courses.append(course("ungraded", score=None))
    state.assignments = [assignment(course_id="ungraded")]
    result = (await client.post(ENDPOINT, json={})).json()
    assert result["portfolio_score"] == 95
    assert result["target_score"] == 90
    assert result["academic_stance"] == "MAINTAIN_FLOOR"
    assert result["course_breakdown"][1]["current_score"] is None
    assert result["course_breakdown"][1]["var_90"] is None
    assert result["course_breakdown"][1]["probability_of_target"] is None


async def test_empty_portfolio_uses_no_inference_and_explains_placeholders(report_api):
    client, state, terminal = report_api
    state.courses = []
    terminal.llm = None
    result = (await client.post(ENDPOINT, json={})).json()
    assert result["portfolio_score"] == result["target_score"] == result["margin"] == 0
    assert result["projected_gpa"] == result["downside_var_90"] == 0
    assert result["course_breakdown"] == result["high_leverage_actions"] == []
    assert "No posted course grades" in result["executive_summary"]
    assert result["telemetry"]["latency_ms"] == 0


async def test_leverage_order_and_top_ten_include_only_remaining_weighted_assignments(report_api):
    client, state, _ = report_api
    state.assignments = [assignment(f"a{i:02d}", weight=i) for i in range(1, 13)]
    state.assignments.extend(
        [
            assignment("graded", weight=100, graded=True),
            assignment("zero", weight=0),
        ]
    )
    before = state.model_dump()
    result = (await client.post(ENDPOINT, json={})).json()
    actions = result["high_leverage_actions"]
    assert len(actions) == 10
    assert [row["assignment_id"] for row in actions] == [f"a{i:02d}" for i in range(12, 2, -1)]
    assert actions[0]["marginal_impact"] == 0.12
    assert actions[0]["due_at"] is None
    assert result["course_breakdown"][0]["remaining_weight"] == 78
    assert "Prioritize" in result["executive_summary"]
    assert state.model_dump() == before


async def test_leverage_normalizes_excess_weight_and_breaks_ties_by_priority(report_api):
    client, state, _ = report_api
    due = datetime(2026, 12, 1, tzinfo=UTC)
    state.assignments = [
        assignment("a", weight=100, priority_score=1),
        assignment("b", weight=100, priority_score=2, due_at=due),
    ]
    actions = (await client.post(ENDPOINT, json={})).json()["high_leverage_actions"]
    assert [a["assignment_id"] for a in actions] == ["b", "a"]
    assert actions[0]["marginal_impact"] == 0.5
    assert datetime.fromisoformat(actions[0]["due_at"]) == due


async def test_portfolio_var_diversifies_independent_course_paths(report_api):
    client, state, _ = report_api
    state.courses = [course("a", score=80, target=75), course("b", score=80, target=75)]
    state.assignments = [
        assignment("a-open", course_id="a", weight=100),
        assignment("b-open", course_id="b", weight=100),
    ]
    result = (await client.post(ENDPOINT, json={})).json()
    individual_mean_var = sum(c["var_90"] for c in result["course_breakdown"]) / 2
    assert 0 < result["downside_var_90"] < individual_mean_var


@pytest.mark.parametrize(
    "score,expected",
    [
        (100, 4),
        (93, 4),
        (90, 3.7),
        (87, 3.3),
        (83, 3),
        (80, 2.7),
        (77, 2.3),
        (73, 2),
        (70, 1.7),
        (67, 1.3),
        (63, 1),
        (60, 0.7),
        (59.9, 0),
    ],
)
def test_gpa_band_boundaries(score, expected):
    assert _grade_points(score) == expected


async def test_meta_memo_uses_server_facts_and_measured_telemetry(monkeypatch):
    seen = []

    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        assert payload["model"] == "muse-spark-1.3"
        assert "untrusted" in payload["messages"][0]["content"]
        context = json.loads(payload["messages"][1]["content"])
        assert context["course_breakdown"]
        assert "telemetry" not in context
        assert "meta_api_key" not in json.dumps(context)
        return completion(
            usage={"prompt_tokens": 200, "completion_tokens": 100, "total_tokens": 300}
        )

    async with service_context(
        config=settings(meta_api_key="fixture"), llm_handler=handler
    ) as terminal:
        before = await terminal.state()
        saves = terminal.store.saves
        ticks = iter([1.0, 1.5])
        monkeypatch.setattr("backend.service.perf_counter", lambda: next(ticks))
        result = await terminal.portfolio_report()
        assert result.executive_summary == "## Portfolio\n\nProtect the course target."
        assert result.telemetry.model_dump() == {
            "model_used": "muse-spark-1.3",
            "latency_ms": 500,
            "prompt_tokens": 200,
            "completion_tokens": 100,
            "tokens_per_sec": 200,
            "model": "muse-spark-1.3",
            "provider": "meta",
            "tokens_per_second": 200,
        }
        assert terminal.store.saves == saves
        assert (await terminal.state()).model_dump() == before.model_dump()
    assert len(seen) == 1


@pytest.mark.parametrize(
    "reply",
    [
        lambda: httpx.Response(503),
        lambda: completion({"executive_summary": ""}),
        lambda: completion({"executive_summary": " "}),
        lambda: completion({"executive_summary": "x" * 12_001}),
        lambda: completion({"executive_summary": "x" * 21_000}),
        lambda: completion({"executive_summary": 123}),
        lambda: completion({"wrong_field": "memo"}),
        lambda: completion({"executive_summary": "memo", "portfolio_score": 100}),
        lambda: completion(finish="length"),
        lambda: httpx.Response(200, json={"choices": []}),
    ],
)
async def test_bad_or_unavailable_inference_keeps_deterministic_memo(reply):
    async with service_context(llm_handler=lambda request: reply()) as terminal:
        result = await terminal.portfolio_report()
    assert "deterministic local template" in result.executive_summary
    assert result.telemetry.model_used == "local-portfolio-report"
    assert result.telemetry.prompt_tokens is None
    assert result.telemetry.completion_tokens is None
    assert result.telemetry.tokens_per_sec is None


async def test_provider_timeout_is_bounded_and_falls_back():
    async def slow(request):
        await asyncio.sleep(0.1)
        return completion()

    async with service_context(
        config=settings(llm_timeout_seconds=0.001), llm_handler=slow
    ) as terminal:
        report = await terminal.portfolio_report()
    assert report.telemetry.model_used == "local-portfolio-report"


async def test_missing_client_falls_back(report_api):
    _, _, terminal = report_api
    terminal.llm = None
    report = await terminal.portfolio_report()
    assert "local template" in report.executive_summary


@pytest.mark.parametrize("usage", [None, {"prompt_tokens": -1, "completion_tokens": -2}])
async def test_unreported_or_invalid_usage_stays_unmeasured(usage, monkeypatch):
    async with service_context(
        llm_handler=lambda request: completion(usage=usage, model="")
    ) as terminal:
        monkeypatch.setattr("backend.service.perf_counter", lambda: 1)
        report = await terminal.portfolio_report()
    assert report.telemetry.model_used == "llama3"
    assert report.telemetry.prompt_tokens is None
    assert report.telemetry.completion_tokens is None
    assert report.telemetry.tokens_per_sec is None


async def test_model_context_caps_course_details_at_100(monkeypatch):
    seen = []

    def handler(request):
        context = json.loads(json.loads(request.content)["messages"][1]["content"])
        seen.append(len(context["course_breakdown"]))
        return completion()

    async with service_context(llm_handler=handler) as terminal:
        state = await terminal.state()
        state.courses = [course(str(i), score=None) for i in range(101)]
        state.assignments = []
        monkeypatch.setattr(terminal, "state", AsyncMock(return_value=state))
        report = await terminal.portfolio_report()
    assert len(report.course_breakdown) == 101
    assert seen == [100]
