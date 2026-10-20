import json

import httpx
import pytest
from pydantic import ValidationError

from backend.config import Settings
from backend.persistence import SupabaseStore

from .conftest import service_context, settings


def test_demo_mode_inference_and_explicit_override(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    assert settings(demo_mode=None).demo_mode is True
    assert settings(demo_mode=None, canvas_api_token="fake").demo_mode is False
    assert settings(demo_mode=True, canvas_api_token="fake").demo_mode is True
    assert settings(demo_mode=False).demo_mode is False
    assert "fake-secret" not in repr(settings(canvas_api_token="fake-secret"))


def test_environment_configuration(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setenv("LLM_MODEL", "llama3:8b")
    monkeypatch.setenv("CANVAS_API_TOKEN", "fake")
    config = Settings()
    assert config.demo_mode is False
    assert config.llm_model == "llama3:8b"


@pytest.mark.parametrize(
    "origin",
    [
        "http://school.instructure.com",
        "https://user:pass@school.instructure.com",
        "https://school.instructure.com/api/v1",
        "https://school.instructure.com?token=bad",
    ],
)
def test_invalid_canvas_origins_are_rejected(origin):
    with pytest.raises(ValidationError):
        settings(canvas_api_url=origin)


def test_cors_origins_parse_from_a_comma_separated_environment(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", " https://Apex-OS.vercel.app/, ,http://localhost:4000")
    assert Settings().cors_origins == ("https://apex-os.vercel.app", "http://localhost:4000")
    monkeypatch.delenv("CORS_ORIGINS")
    assert Settings().cors_origins == ()


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://*.vercel.app",
        "apex-os.vercel.app",
        "https://apex-os.vercel.app/app",
        "ftp://apex.example",
    ],
)
def test_invalid_cors_origins_are_rejected(origin):
    with pytest.raises(ValidationError):
        settings(cors_origins=origin)


async def test_supabase_http_upsert_and_restore(terminal):
    state = await terminal.state()
    stored = {}

    def handler(request):
        assert request.headers["authorization"] == "Bearer fake-service-key"
        assert request.url.path == "/rest/v1/apex_terminal_state"
        if request.method == "POST":
            payload = json.loads(request.content)
            assert payload["id"].endswith(":sandbox")
            assert "portfolio_margin" not in payload["payload"]["courses"][0]
            stored.update(payload)
            return httpx.Response(201, json=[payload])
        return httpx.Response(200, json=[{"payload": stored["payload"]}])

    store = SupabaseStore(
        settings(
            supabase_url="https://test.supabase.co",
            supabase_key="fake-service-key",
        )
    )
    await store._http.aclose()
    store._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        assert await store.save(state) is True
        restored = await store.load(True)
        assert restored == state
        assert store._key(True) != store._key(False)
    finally:
        await store.close()


async def test_supabase_unavailable_does_not_prevent_updates():
    store = SupabaseStore(
        settings(
            supabase_url="https://test.supabase.co",
            supabase_key="fake-service-key",
        )
    )
    await store._http.aclose()
    store._http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(503, json={"message": "offline"})
        )
    )
    try:
        async with service_context(store=store) as service:
            state = await service.state()
            assert len(state.courses) == 4
            assert state.persistence_status == "unavailable"
            baseline = state.metrics.total_actual_minutes
            nodes = await service.triage("math4102-queue")
            from backend.models import SubTaskUpdate

            state = await service.patch(nodes[0].id, SubTaskUpdate(actual_minutes=10))
            assert state.metrics.total_actual_minutes == baseline + 10
    finally:
        await store.close()


async def test_disabled_persistence_is_explicit():
    store = SupabaseStore(settings())
    try:
        async with service_context(store=store) as service:
            assert (await service.state()).persistence_status == "disabled"
    finally:
        await store.close()


async def test_failed_restore_blocks_writes_and_recovery_merges_local_work(terminal):
    from backend.models import SubTaskUpdate

    saved = await terminal.state()
    baseline = saved.metrics.total_actual_minutes
    remote = next(a for a in saved.assignments if a.id == "math4102-exam")
    remote.subtasks[0].actual_minutes = 19
    unavailable = True
    writes = []

    def handler(request):
        if request.method == "GET":
            if unavailable:
                return httpx.Response(403, json={"message": "restore denied"})
            return httpx.Response(
                200,
                json=[
                    {
                        "payload": saved.model_dump(
                            mode="json",
                            round_trip=True,
                        )
                    }
                ],
            )
        writes.append(json.loads(request.content))
        return httpx.Response(201, json=[])

    store = SupabaseStore(
        settings(
            supabase_url="https://test.supabase.co",
            supabase_key="fake-service-key",
        )
    )
    await store._http.aclose()
    store._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        async with service_context(store=store) as service:
            state = await service.state()
            assert state.persistence_status == "unavailable"
            assert writes == []
            local = next(a for a in state.assignments if a.id == "eng2001-manual")
            await service.patch(local.subtasks[0].id, SubTaskUpdate(actual_minutes=11))
            assert writes == []
            unavailable = False
            state = await service.state(force=True)
            assert state.persistence_status == "connected"
            assert state.metrics.total_actual_minutes == baseline + 30
            assert len(writes) == 1
    finally:
        await store.close()


async def test_supabase_rpc_records_subtask_patch(terminal):
    state = await terminal.state()
    assignment = next(a for a in state.assignments if a.id == "cs3801-raft")
    course = next(c for c in state.courses if c.id == assignment.course_id)
    node = assignment.subtasks[1].children[1]
    bodies = []
    status = 204

    def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/rest/v1/rpc/apex_record_subtask_patch"
        assert request.headers["authorization"] == "Bearer fake-service-key"
        bodies.append(json.loads(request.content))
        if status == 404:
            return httpx.Response(404, json={"code": "PGRST202", "message": "missing function"})
        return httpx.Response(status)

    store = SupabaseStore(
        settings(
            supabase_url="https://test.supabase.co",
            supabase_key="fake-service-key",
        )
    )
    await store._http.aclose()
    store._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        assert await store.record_subtask_patch(course, assignment, node, 15) is True
        [body] = bodies
        assert set(body) == {"p_course", "p_assignment", "p_subtasks", "p_time_log"}
        assert body["p_time_log"]["minutes_delta"] == 15
        assert body["p_assignment"]["due_at"] == assignment.due_at.isoformat().replace(
            "+00:00", "Z"
        )
        assert len(body["p_subtasks"]) == 13
        # A schema that was never applied must not break the request.
        status = 404
        assert await store.record_subtask_patch(course, assignment, node, 15) is False
    finally:
        await store.close()
