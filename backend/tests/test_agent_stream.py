import asyncio
import json
from contextlib import asynccontextmanager

import httpx
import pytest

from backend.ai_engine import (
    TriageContext,
    audit_rubric_constraints,
    calculate_grade_floor,
    check_capacity,
    fallback_tree,
    get_portfolio_state,
    stream_triage,
)
from backend.main import create_app
from backend.models import DecomposeResponse, SubTaskUpdate
from backend.tasks import walk

from .conftest import service_context, settings
from .test_agent_trace import NOW, PLAN, assignment_of, completion, mock_llm, mock_state


def stream_response(content=None, *, finish="stop", usage=True):
    content = json.dumps(PLAN) if content is None else content
    chunks = []
    for index in range(0, len(content), 25):
        chunks.append(
            {
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": content[index : index + 25]},
                        "finish_reason": None,
                    }
                ],
            }
        )
    chunks.append({"choices": [{"index": 0, "delta": {}, "finish_reason": finish}]})
    if usage:
        chunks.append(
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 300,
                    "completion_tokens": 120,
                    "total_tokens": 420,
                },
            }
        )
    body = "".join(
        "data: "
        + json.dumps(
            {
                "id": "fixture",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "fixture-model",
                **chunk,
            }
        )
        + "\n\n"
        for chunk in chunks
    )
    return httpx.Response(
        200, text=body + "data: [DONE]\n\n", headers={"content-type": "text/event-stream"}
    )


def parse_events(response):
    events = []
    for frame in response.text.strip().split("\n\n"):
        name, payload = frame.split("\n", 1)
        events.append(
            {
                "event": name.removeprefix("event: "),
                "data": json.loads(payload.removeprefix("data: ")),
            }
        )
    return events


@asynccontextmanager
async def stream_api(handler=None):
    async with service_context(llm_handler=handler) as service:
        await service.state()
        # This assignment has no recorded work, so the primary model can run.
        assignment = assignment_of(service._state, "math4102-queue")
        assignment.subtasks = []
        app = create_app(service=service)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client,
        ):
            yield client, service, assignment


async def test_tools_compute_grounded_results_and_missing_grade():
    assignment = assignment_of(mock_state(), "cs3801-raft")
    context = TriageContext(
        now=NOW, current_score=92.4, target_score=90, queued_minutes=120, open_budget_minutes=300
    )
    assert get_portfolio_state(context)["current_score"] == 92.4
    assert calculate_grade_floor(assignment, context) == {
        "grade_floor_percent": 82.8,
        "risk_tier": "medium",
    }
    assert calculate_grade_floor(assignment, TriageContext(now=NOW))["grade_floor_percent"] is None
    audit = await audit_rubric_constraints(assignment, context, settings=settings())
    assert audit["rubric_constraints"][0].startswith("test harness 60%")
    capacity = check_capacity(assignment, context)
    assert capacity["queued_minutes"] == 120
    assert capacity["step"]["step"] == 2


async def test_stream_emits_tools_steps_real_tokens_and_persisted_complete():
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return stream_response()

    async with stream_api(handler) as (client, service, assignment):
        response = await client.get(f"/api/v1/triage/{assignment.id}/stream")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-accel-buffering"] == "no"
        events = parse_events(response)
        assert [e["data"]["name"] for e in events if e["event"] == "tool_call"] == [
            "get_portfolio_state",
            "calculate_grade_floor",
            "audit_rubric_constraints",
            "check_capacity",
        ]
        assert [e["data"]["step"] for e in events if e["event"] == "step"] == [1, 2, 3, 4]
        assert (
            json.loads("".join(e["data"]["text"] for e in events if e["event"] == "token")) == PLAN
        )
        assert events[-1]["event"] == "complete"
        result = DecomposeResponse.model_validate(events[-1]["data"])
        assert result.source == "ai"
        assert result.telemetry.completion_tokens == 120
        assert result.telemetry.tokens_per_sec > 0
        assert result.telemetry.model_used == "fixture-model"
        assert assignment.subtasks == result.subtasks
        stored = assignment_of(service.store.states[True], assignment.id)
        assert stored.subtasks == result.subtasks
        assert requests[0]["stream"] is True
        brief = json.loads(requests[0]["messages"][1]["content"])["agent_brief"]
        assert "grade_floor_percent" in brief and brief["capacity"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503),
        stream_response("not JSON"),
        stream_response(finish="length"),
        stream_response(json.dumps({"subtasks": []})),
        stream_response("x" * 64_001),
    ],
)
async def test_provider_failure_or_invalid_output_uses_validated_local_plan(response):
    async with stream_api(lambda request: response) as (client, _, assignment):
        result = parse_events(await client.get(f"/api/v1/triage/{assignment.id}/stream"))[-1]
        assert result["event"] == "complete"
        plan = DecomposeResponse.model_validate(result["data"])
        assert plan.source == "local"
        assert plan.telemetry.model_used == "local-starter-plan"
        assert plan.subtasks


async def test_missing_assignment_is_404_before_stream_headers():
    async with stream_api() as (client, _, _):
        response = await client.get("/api/v1/triage/missing/stream")
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/json")


async def test_cached_stream_keeps_logged_work_and_does_not_call_provider():
    def handler(request):
        pytest.fail("Saved work must bypass inference")

    async with stream_api(handler) as (client, service, _):
        before = assignment_of(await service.state(), "cs3801-raft").subtasks
        events = parse_events(await client.get("/api/v1/triage/cs3801-raft/stream"))
        assert events[-1]["data"]["source"] == "cached"
        result = DecomposeResponse.model_validate(events[-1]["data"])
        assert result.subtasks == before
        assert not any(e["event"] == "token" for e in events)


async def test_stream_has_progress_before_provider_finishes_and_closes_on_cancel():
    entered, release = asyncio.Event(), asyncio.Event()

    async def handler(request):
        entered.set()
        await release.wait()
        return stream_response()

    assignment = assignment_of(mock_state(), "math4102-queue").model_copy(update={"subtasks": []})
    http, client = mock_llm(handler)
    async with http, client:
        events = stream_triage(
            assignment, TriageContext(now=NOW), settings=settings(), client=client
        )
        for _ in range(6):
            assert (await anext(events))["event"] in ("step", "tool_call")
        assert not entered.is_set()
        pending = asyncio.create_task(anext(events))
        await entered.wait()
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        await events.aclose()


async def test_assignment_changes_midstream_emit_error_and_do_not_save():
    async def handler(request):
        assignment.description += " changed"
        return stream_response()

    async with stream_api(handler) as (client, service, assignment):
        events = parse_events(await client.get(f"/api/v1/triage/{assignment.id}/stream"))
        assert events[-1]["event"] == "error"
        assert events[-1]["data"]["status"] == 409
        assert not any(e["event"] == "complete" for e in events)
        assert assignment.subtasks == []


async def test_work_logged_during_stream_wins_over_generated_plan():
    async def handler(request):
        await service.patch(leaf.id, SubTaskUpdate(actual_minutes=5))
        return stream_response()

    async with stream_api(handler) as (client, service, assignment):
        saved = fallback_tree(assignment)
        assignment.subtasks = saved
        # Keep all leaves free of progress until the model starts.
        for node in walk(saved):
            node.is_completed, node.actual_minutes = False, 0
        leaf = next(node for node in walk(saved) if not node.children)

        events = parse_events(await client.get(f"/api/v1/triage/{assignment.id}/stream"))
        result = DecomposeResponse.model_validate(events[-1]["data"])
        assert result.source == "cached"
        assert result.subtasks == assignment.subtasks
        assert result.agent_reasoning_trace[2].engine == "cached-plan"


async def test_legacy_endpoints_keep_their_response_shapes():
    async with stream_api(lambda request: completion(PLAN)) as (client, _, assignment):
        result = await client.post("/decompose", json={"assignment_id": assignment.id})
        assert result.status_code == 200
        assert DecomposeResponse.model_validate(result.json()).source == "ai"
        result = await client.post(f"/api/triage/{assignment.id}")
        assert result.status_code == 200
        assert isinstance(result.json(), list)


async def test_closing_live_stream_closes_provider_without_saving_partial_plan():
    class LiveStream(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            # Deliver one token, then leave the model response unfinished.
            yield stream_response().content.split(b"\n\n", 1)[0] + b"\n\n"
            await asyncio.Event().wait()

        async def aclose(self):
            self.closed = True

    live = LiveStream()
    async with stream_api(
        lambda request: httpx.Response(
            200, stream=live, headers={"content-type": "text/event-stream"}
        )
    ) as (_, service, assignment):
        saves = service.store.saves
        events = service.stream_triage(assignment.id)
        while (await anext(events))["event"] != "token":
            pass
        await events.aclose()
        assert live.closed
        assert service.store.saves == saves
        assert assignment.subtasks == []


async def test_stream_without_usage_does_not_invent_token_counts():
    async with stream_api(lambda request: stream_response(usage=False)) as (client, _, assignment):
        result = parse_events(await client.get(f"/api/v1/triage/{assignment.id}/stream"))[-1]
        assert result["data"]["telemetry"]["prompt_tokens"] is None
        assert result["data"]["telemetry"]["completion_tokens"] is None
        assert result["data"]["telemetry"]["tokens_per_sec"] is None
