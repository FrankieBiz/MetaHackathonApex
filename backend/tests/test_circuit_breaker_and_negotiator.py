import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError

from backend.ai_engine import generate_negotiation_petition
from backend.main import create_app
from backend.models import (
    AssignmentModel,
    CourseModel,
    NegotiationPetition,
    NegotiationPetitionRequest,
    SubTaskNode,
    TerminalMetrics,
    TerminalState,
)
from backend.service import evaluate_circuit_breaker

from .conftest import service_context, settings


def course(identifier="critical", score=80.0, target=90.0, syllabus=""):
    return CourseModel(
        id=identifier,
        course_code=identifier.upper(),
        name=f"Course {identifier}",
        current_score=score,
        target_score=target,
        syllabus=syllabus,
    )


def assignment(identifier="a", course_id="critical", **changes):
    return AssignmentModel(
        id=identifier,
        course_id=course_id,
        course_code=course_id.upper(),
        title=f"Assignment {identifier}",
        weight=changes.pop("weight", 20.0),
        **changes,
    )


def snapshot(courses=None, assignments=None):
    return TerminalState(
        courses=courses or [],
        assignments=assignments or [],
        study_recommendations=[],
        upcoming_events=[],
        metrics=TerminalMetrics(
            completion_velocity=0.0,
            assignment_volatility=0.0,
            total_budgeted_minutes=0,
            total_actual_minutes=0,
            last_synced_at="2040-01-01T00:00:00Z",
            demo_mode=True,
        ),
    )


@pytest.mark.parametrize(
    ("courses", "level"),
    [
        ([], "NORMAL"),
        ([course(score=None)], "NORMAL"),
        ([course(score=95)], "NORMAL"),
        ([course(score=90)], "NORMAL"),
        ([course(score=85)], "NORMAL"),
        ([course(score=84.999)], "LEVEL_1_CAUTION"),
        ([course(score=65, target=70)], "NORMAL"),
        ([course(score=64.999, target=70)], "LEVEL_2_RESTRICTION"),
        ([course(score=55, target=60)], "LEVEL_2_RESTRICTION"),
        ([course(score=54.999, target=60)], "LEVEL_3_HALT"),
        ([course(score=70)], "LEVEL_3_HALT"),
        ([course(score=70.001)], "LEVEL_1_CAUTION"),
        ([course(score=89), course("two", score=89)], "LEVEL_2_RESTRICTION"),
        ([course(score=80), course("two", score=100)], "LEVEL_1_CAUTION"),
        ([course(score=54), course("two", score=150)], "LEVEL_3_HALT"),
        ([course(score=54, target=0)], "LEVEL_3_HALT"),
    ],
)
def test_circuit_breaker_thresholds_and_precedence(courses, level):
    report = evaluate_circuit_breaker(snapshot(courses))
    assert report.level == level
    assert report.triggered == (level != "NORMAL")
    assert report.reallocated_minutes == 0


def test_restriction_preserves_unknown_courses_and_only_counts_remaining_leaves():
    leaf = SubTaskNode(
        id="leaf",
        assignment_id="elective",
        title="Practice",
        estimated_minutes=40,
        actual_minutes=10,
    )
    completed = leaf.model_copy(update={"id": "completed", "is_completed": True})
    overrun = leaf.model_copy(update={"id": "overrun", "actual_minutes": 60})
    parent = leaf.model_copy(
        update={"id": "parent", "estimated_minutes": 200, "children": [leaf, completed, overrun]}
    )
    state = snapshot(
        [course(score=64), course("healthy", score=95), course("unknown", score=None)],
        [
            assignment(),
            assignment("elective", "healthy", subtasks=[parent]),
            assignment("unknown", "unknown"),
            assignment("graded", "healthy", graded=True, subtasks=[leaf]),
            assignment("submitted", "healthy", status="completed", subtasks=[leaf]),
        ],
    )
    before = state.model_dump()
    report = evaluate_circuit_breaker(state)
    assert report.level == "LEVEL_2_RESTRICTION"
    assert report.halted_course_ids == ["healthy"]
    assert report.protected_assignment_ids == ["a", "unknown"]
    assert report.reallocated_minutes == 30
    assert any("missing course grades" in item for item in report.recommendations)
    assert state.model_dump() == before
    assert evaluate_circuit_breaker(state) == report


def test_caution_flags_zero_weight_work_without_halting_or_reallocating():
    state = snapshot([course()], [assignment(), assignment("optional", weight=0)])
    result = evaluate_circuit_breaker(state)
    assert result.level == "LEVEL_1_CAUTION"
    assert result.protected_assignment_ids == ["a"]
    assert result.halted_course_ids == []
    assert result.reallocated_minutes == 0
    assert any("optional" in item and "low-yield" in item for item in result.recommendations)


def test_halt_defers_zero_weight_work_without_halting_protected_course():
    optional = assignment("optional", weight=0)
    optional.subtasks = [
        SubTaskNode(id="x", assignment_id="optional", title="Polish", estimated_minutes=25)
    ]
    result = evaluate_circuit_breaker(snapshot([course(score=50)], [assignment(), optional]))
    assert result.level == "LEVEL_3_HALT"
    assert result.halted_course_ids == []
    assert result.protected_assignment_ids == ["a"]
    assert result.reallocated_minutes == 25


def test_restriction_does_not_free_time_without_a_protected_destination():
    result = evaluate_circuit_breaker(
        snapshot([course(score=60), course("healthy", score=95)], [assignment("b", "healthy")])
    )
    assert result.level == "LEVEL_2_RESTRICTION"
    assert result.halted_course_ids == []
    assert result.reallocated_minutes == 0


def draft(**changes):
    return {
        "instructor_name": "Instructor",
        "email_subject": "Request to discuss Assignment a",
        "email_body": "Could we discuss the applicable policy and next steps?",
        "office_hours_pitch_60s": ["Thank you for meeting.", "Could we discuss my questions?"],
        "syllabus_clauses_cited": [],
        **changes,
    }


def completion(payload=None, *, finish="stop", usage=None):
    return httpx.Response(
        200,
        json={
            "id": "petition",
            "object": "chat.completion",
            "created": 1,
            "model": "fixture-negotiator",
            "usage": usage,
            "choices": [
                {
                    "index": 0,
                    "finish_reason": finish,
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(draft() if payload is None else payload),
                    },
                }
            ],
        },
    )


@pytest.mark.parametrize("petition_type", ["extension", "regrade", "office_hours_script"])
async def test_meta_negotiation_uses_grounded_context_and_measured_telemetry(petition_type):
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        return completion(
            draft(instructor_name="Ada Example", syllabus_clauses_cited=["Late work loses 10%."]),
            usage={"prompt_tokens": 60, "completion_tokens": 30, "total_tokens": 90},
        )

    async with service_context(
        config=settings(meta_api_key="fixture"), llm_handler=handler
    ) as terminal:
        result = await generate_negotiation_petition(
            assignment(),
            course(syllabus="Instructor: Ada Example. Late work loses 10%."),
            NegotiationPetitionRequest(petition_type=petition_type, student_reason="Need clarity"),
            settings=terminal.settings,
            client=terminal.llm,
        )
    assert result.source == "ai"
    assert result.petition_type == petition_type
    assert result.assignment_id == "a"
    assert result.instructor_name == "Ada Example"
    assert result.telemetry.model_used == "fixture-negotiator"
    assert result.telemetry.prompt_tokens == 60
    assert result.telemetry.completion_tokens == 30
    assert result.telemetry.tokens_per_sec > 0
    assert calls[0]["model"] == "muse-spark-1.3"
    assert "untrusted" in calls[0]["messages"][0]["content"]
    facts = json.loads(calls[0]["messages"][1]["content"])
    assert facts["current_score"] == 80
    assert facts["student_reason"] == "Need clarity"
    assert facts["petition_type"] == petition_type


@pytest.mark.parametrize(
    "response",
    [
        lambda: httpx.Response(503),
        lambda: completion({}, finish="stop"),
        lambda: completion(draft(), finish="length"),
        lambda: completion(draft(email_body=" ")),
        lambda: completion(draft(email_body="x" * 25000)),
        lambda: completion(draft(syllabus_clauses_cited=["Extensions are always approved."])),
        lambda: completion(draft(instructor_name="Imaginary Instructor")),
        lambda: completion(draft(office_hours_pitch_60s=[])),
        lambda: completion(draft(extra="ignore schema")),
        lambda: completion(draft(email_subject="Subject\nBcc: other@example.org")),
    ],
)
async def test_invalid_or_failed_inference_returns_honest_local_draft(response):
    async with service_context(llm_handler=lambda request: response()) as terminal:
        result = await generate_negotiation_petition(
            assignment(),
            course(),
            NegotiationPetitionRequest(petition_type="extension", student_reason="Work conflict"),
            settings=terminal.settings,
            client=terminal.llm,
        )
    assert result.source == "local"
    assert result.instructor_name == "Instructor"
    assert result.syllabus_clauses_cited == []
    assert "Work conflict" in result.email_body
    assert "please confirm" in result.email_body
    assert "whether an extension is possible" in result.email_body
    assert result.telemetry.model_used == "local-negotiation-template"
    assert result.telemetry.completion_tokens is None
    assert result.telemetry.tokens_per_sec is None
    assert result.telemetry.latency_ms >= 0


@pytest.mark.parametrize("petition_type", ["regrade", "office_hours_script"])
async def test_local_drafts_fit_the_requested_petition(petition_type):
    async with service_context() as terminal:
        result = await generate_negotiation_petition(
            assignment(),
            course(),
            NegotiationPetitionRequest(petition_type=petition_type),
            settings=terminal.settings,
            client=terminal.llm,
        )
    assert "extension" not in result.email_body
    assert ("rubric" if petition_type == "regrade" else "office hours") in result.email_body


async def test_timeout_falls_back_without_closing_borrowed_client(monkeypatch):
    async def slow(**kwargs):
        await asyncio.sleep(1)

    async with service_context(config=settings(llm_timeout_seconds=0.01)) as terminal:
        monkeypatch.setattr(terminal.llm.chat.completions, "create", slow)
        result = await generate_negotiation_petition(
            assignment(),
            course(),
            NegotiationPetitionRequest(petition_type="regrade"),
            settings=terminal.settings,
            client=terminal.llm,
        )
        assert not terminal.llm.is_closed()
    assert result.source == "local"


async def test_no_usage_remains_unknown_and_context_is_bounded():
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        return completion()

    async with service_context(llm_handler=handler) as terminal:
        result = await generate_negotiation_petition(
            assignment(description="x" * 30000),
            course(syllabus="y" * 30000),
            NegotiationPetitionRequest(petition_type="extension"),
            settings=terminal.settings,
            client=terminal.llm,
        )
    facts = json.loads(calls[0]["messages"][1]["content"])
    assert len(facts["syllabus"]) == 16000
    assert len(facts["description_and_rubric"]) == 12000
    assert result.source == "ai"
    assert result.telemetry.prompt_tokens is None
    assert result.telemetry.tokens_per_sec is None


async def test_owned_meta_client_is_configured_and_closed_after_invalid_response(monkeypatch):
    provider = AsyncMock()
    provider.chat.completions.create.return_value.choices = []
    configurations = []

    def create_provider(**kwargs):
        configurations.append(kwargs)
        return provider

    monkeypatch.setattr("backend.ai_engine.AsyncOpenAI", create_provider)
    result = await generate_negotiation_petition(
        assignment(),
        course(),
        NegotiationPetitionRequest(petition_type="extension"),
        settings=settings(meta_api_key="fixture"),
    )
    assert result.source == "local"
    assert configurations[0]["base_url"] == "https://api.meta.ai/v1"
    assert configurations[0]["max_retries"] == 0
    provider.close.assert_awaited_once()


async def test_cancellation_propagates_and_closes_owned_client(monkeypatch):
    provider = AsyncMock()
    provider.chat.completions.create.side_effect = asyncio.CancelledError()
    monkeypatch.setattr("backend.ai_engine.AsyncOpenAI", lambda **kwargs: provider)
    with pytest.raises(asyncio.CancelledError):
        await generate_negotiation_petition(
            assignment(),
            course(),
            NegotiationPetitionRequest(petition_type="extension"),
            settings=settings(),
        )
    provider.close.assert_awaited_once()


async def test_local_subject_normalizes_untrusted_title_line_breaks():
    item = assignment()
    item.title = "Project\r\nBcc: someone@example.org"
    async with service_context() as terminal:
        result = await generate_negotiation_petition(
            item,
            course(),
            NegotiationPetitionRequest(petition_type="extension"),
            settings=terminal.settings,
            client=terminal.llm,
        )
    assert "\r" not in result.email_subject
    assert "\n" not in result.email_subject


@pytest.fixture
async def api(terminal, monkeypatch):
    state = snapshot(
        [course(score=64), course("healthy", score=95)],
        [assignment(), assignment("b", "healthy")],
    )
    monkeypatch.setattr(terminal, "state", AsyncMock(return_value=state))
    app = create_app(service=terminal)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client, state, terminal


async def test_endpoints_do_not_mutate_state_or_persist_drafts(api):
    client, state, terminal = api
    before = state.model_dump()
    saves = terminal.store.saves
    response = await client.post("/api/v1/portfolio/circuit-breaker")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["level"] == "LEVEL_2_RESTRICTION"
    response = await client.post(
        "/api/v1/triage/a/negotiate", json={"petition_type": "office_hours_script"}
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert NegotiationPetition.model_validate(response.json()).source == "local"
    assert state.model_dump() == before
    assert terminal.store.saves == saves


async def test_missing_assignment_or_course_is_404(api):
    client, state, _ = api
    response = await client.post(
        "/api/v1/triage/missing/negotiate", json={"petition_type": "regrade"}
    )
    assert response.status_code == 404
    state.courses = []
    response = await client.post("/api/v1/triage/a/negotiate", json={"petition_type": "regrade"})
    assert response.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"petition_type": "grade_boost"},
        {"petition_type": "extension", "student_reason": 4},
        {"petition_type": "extension", "student_reason": " "},
        {"petition_type": "extension", "student_reason": "x" * 4001},
        {"petition_type": "extension", "send": True},
    ],
)
async def test_petition_http_validation(api, body):
    client, _, _ = api
    assert (await client.post("/api/v1/triage/a/negotiate", json=body)).status_code == 422


def test_petition_request_forbids_unknown_fields_and_accepts_null_reason():
    assert NegotiationPetitionRequest(petition_type="extension").student_reason is None
    with pytest.raises(ValidationError):
        NegotiationPetitionRequest(petition_type="extension", assignment_id="other")
