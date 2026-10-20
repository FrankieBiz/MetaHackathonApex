import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from backend.ai_engine import generate_study_triage, scan_study_triggers
from backend.canvas_client import CanvasClient, plain_text
from backend.main import create_app
from backend.models import CourseModel, StudyTriageRequest

from .conftest import service_context, settings

PLAN = {
    "focus_topics": ["Raft leader election", "Quorum intersection", "Log replication"],
    "recommended_blocks": [
        {"title": "Trace one failed Raft election", "estimated_minutes": 25},
        {"title": "Prove quorum intersection for five nodes", "estimated_minutes": 25},
    ],
}


def completion(plan=PLAN, *, finish="stop"):
    return httpx.Response(
        200,
        json={
            "id": "study-fixture",
            "object": "chat.completion",
            "created": 1,
            "model": "Llama-3.3-70B-Instruct",
            "usage": {"prompt_tokens": 240, "completion_tokens": 100, "total_tokens": 340},
            "choices": [
                {
                    "index": 0,
                    "finish_reason": finish,
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(plan),
                    },
                }
            ],
        },
    )


def study_request(**overrides):
    return StudyTriageRequest.model_validate(
        {
            "course_id": "cs3801",
            "course_name": "Distributed Systems",
            "syllabus_text": "Study Guide: Distributed_Systems_Midterm_Guide.pdf (4.2MB). Rubric.",
            "recent_assignments": [
                {
                    "title": "Raft leader election",
                    "score": 12.0,
                    "points_possible": 20.0,
                    "status": "completed",
                }
            ],
            **overrides,
        }
    )


@pytest.fixture
async def api(terminal):
    app = create_app(service=terminal)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client,
    ):
        yield client


def test_scanner_flags_materials_weak_scores_and_empty_due_date_window():
    triggers = scan_study_triggers(study_request())
    assert "Keyword: 'Study Guide'" in triggers
    assert "Keyword: 'Midterm'" in triggers
    assert "Keyword: 'Rubric'" in triggers
    assert "PDF: Distributed_Systems_Midterm_Guide.pdf (4.2MB) — large PDF" in triggers
    assert "Low score: Raft leader election (60.0%)" in triggers
    assert "No immediate due dates (next 7 days)" in triggers


def test_scanner_upcoming_weighted_exam_and_zero_point_grade():
    now = datetime(2026, 10, 20, tzinfo=UTC)
    body = study_request(
        syllabus_text="Final exams",
        recent_assignments=[
            {
                "title": "Final Exam",
                "due_at": now + timedelta(days=2),
                "weight": 40.0,
                "score": 0.0,
                "points_possible": 0.0,
            }
        ],
    )
    triggers = scan_study_triggers(body, now=now)
    assert "Upcoming exam: Final Exam" in triggers
    assert "High weight: Final Exam (40%)" in triggers
    assert not any(t.startswith(("No immediate", "Low score")) for t in triggers)
    assert "Keyword: 'Final'" in triggers
    assert "Keyword: 'Exam'" in triggers


def test_canvas_preserves_pdf_reference_and_actual_score():
    text = plain_text('<a href="/files/Study_Guide.pdf">Download</a> (4.2MB)')
    assert "Study_Guide.pdf" in text
    course = CourseModel(id="c", course_code="CS", name="Systems")
    assignment = CanvasClient._assignment(
        {
            "id": "a",
            "name": "Consensus",
            "points_possible": 20,
            "submission": {"workflow_state": "graded", "score": 9},
        },
        course,
    )
    assert assignment.score == 9.0
    assert assignment.graded is True


async def test_endpoint_calls_meta_with_context_returns_valid_plan_and_real_telemetry(monkeypatch):
    def handler(request):
        payload = json.loads(request.content)
        assert payload["model"] == "Llama-3.3-70B-Instruct"
        assert "untrusted" in payload["messages"][0]["content"]
        context = json.loads(payload["messages"][1]["content"])
        assert context["recent_assignments"][0]["score"] == 12
        assert "Keyword: 'Study Guide'" in context["detected_triggers"]
        return completion()

    async with service_context(
        config=settings(meta_api_key="fixture"),
        llm_handler=handler,
    ) as terminal:
        app = create_app(service=terminal)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client,
        ):
            ticks = iter([1.0, 1.5])
            monkeypatch.setattr("backend.ai_engine.perf_counter", lambda: next(ticks))
            response = await client.post(
                "/api/v1/triage/study", json=study_request().model_dump(mode="json")
            )
        assert response.status_code == 200
        result = response.json()
        assert result["source"] == "ai"
        assert result["focus_topics"] == PLAN["focus_topics"]
        assert result["recommended_blocks"] == PLAN["recommended_blocks"]
        assert result["inference_telemetry"] == {
            "model_used": "Llama-3.3-70B-Instruct",
            "latency_ms": 500,
            "prompt_tokens": 240,
            "completion_tokens": 100,
            "tokens_per_sec": 200.0,
        }
        # Preview does not insert tasks or mutate server state.
        assert terminal._state is None


@pytest.mark.parametrize(
    "reply",
    [
        lambda: httpx.Response(503),
        lambda: completion({"focus_topics": ["Only one"], "recommended_blocks": []}),
        lambda: completion({**PLAN, "focus_topics": ["same", "same", "same"]}),
        lambda: completion(
            {**PLAN, "recommended_blocks": [{"title": "Read", "estimated_minutes": 90}] * 2}
        ),
        lambda: completion({**PLAN, "recommended_blocks": PLAN["recommended_blocks"] * 3}),
        lambda: completion(finish="length"),
    ],
)
async def test_unavailable_or_invalid_model_uses_honest_atomic_fallback(reply):
    async with service_context(llm_handler=lambda request: reply()) as terminal:
        plan = await generate_study_triage(
            study_request(), settings=terminal.settings, client=terminal.llm
        )
    assert plan.source == "local"
    assert plan.inference_telemetry.model_used == "local-starter-plan"
    assert plan.inference_telemetry.tokens_per_sec is None
    assert plan.inference_telemetry.completion_tokens is None
    assert plan.inference_telemetry.latency_ms >= 0
    assert len(plan.focus_topics) == 3
    assert plan.focus_topics[0] == "Raft leader election"
    assert 2 <= len(plan.recommended_blocks) <= 3
    assert all(block.estimated_minutes == 25 for block in plan.recommended_blocks)


@pytest.mark.parametrize(
    "change",
    [
        {"course_id": ""},
        {"course_name": " "},
        {"syllabus_text": "x" * 100_001},
        {"recent_assignments": [{"title": "Bad score", "score": -1}]},
        {"recent_assignments": [{"title": "Naive date", "due_at": "2026-10-20T12:00:00"}]},
        {"recent_assignments": [{"title": "Too many"}] * 51},
    ],
)
async def test_endpoint_rejects_invalid_input(api, change):
    body = study_request().model_dump(mode="json") | change
    assert (await api.post("/api/v1/triage/study", json=body)).status_code == 422


async def test_insert_is_idempotent_patchable_and_survives_sync_and_restore(api, terminal):
    before = (await api.get("/api/state")).json()
    body = {"course_id": "cs3801", "recommended_blocks": PLAN["recommended_blocks"]}
    inserted = await api.post("/api/v1/triage/study/insert", json=body)
    assert inserted.status_code == 200
    state = inserted.json()
    assert len(state["study_recommendations"]) == 2
    assert state["assignments"] == before["assignments"]
    assert (
        state["metrics"]["total_budgeted_minutes"]
        == before["metrics"]["total_budgeted_minutes"] + 50
    )
    node = state["study_recommendations"][0]
    assert node["course_id"] == "cs3801" and node["assignment_id"] is None
    assert node["children"] == [] and node["is_study_recommendation"] is True
    assert (
        await api.patch(
            f"/api/v1/subtasks/{node['id']}",
            json={
                "is_completed": True,
                "actual_minutes": 25,
            },
        )
    ).status_code == 200
    again = (await api.post("/api/v1/triage/study/insert", json=body)).json()
    assert len(again["study_recommendations"]) == 2
    assert again["study_recommendations"][0]["is_completed"] is True
    synced = (await api.post("/api/sync")).json()
    assert synced["study_recommendations"][0]["actual_minutes"] == 25
    async with service_context(store=terminal.store) as restarted:
        restored = await restarted.state()
        assert restored.study_recommendations[0].actual_minutes == 25
        assert restored.study_recommendations[0].is_completed is True
    assert (
        await api.post("/api/v1/triage/study/insert", json=body | {"course_id": "missing"})
    ).status_code == 404


async def test_empty_course_still_generates_a_plan(api):
    response = await api.post(
        "/api/v1/triage/study",
        json={
            "course_id": "empty",
            "course_name": "New course",
            "recent_assignments": [],
            "syllabus_text": "",
        },
    )
    assert response.status_code == 200
    assert response.json()["detected_triggers"] == ["No immediate due dates (next 7 days)"]


async def test_endpoint_accepts_browser_iso_dates_and_flags_upcoming_exam(api):
    response = await api.post(
        "/api/v1/triage/study",
        json={
            "course_id": "cs3801",
            "course_name": "Systems",
            "recent_assignments": [
                {
                    "title": "Final Exam",
                    "due_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
                    "weight": 40,
                }
            ],
        },
    )
    assert response.status_code == 200
    assert "Upcoming exam: Final Exam" in response.json()["detected_triggers"]


async def test_timeout_returns_a_local_plan_with_null_model_usage():
    async def slow_model(request):
        await asyncio.sleep(1)
        return completion()

    async with service_context(
        config=settings(llm_timeout_seconds=0.01), llm_handler=slow_model
    ) as terminal:
        plan = await generate_study_triage(
            study_request(), settings=terminal.settings, client=terminal.llm
        )
    assert plan.source == "local"
    assert plan.inference_telemetry.tokens_per_sec is None
    assert len(plan.recommended_blocks) == 3
