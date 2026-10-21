import asyncio
import base64
import json
from contextlib import asynccontextmanager

import httpx
import pytest
from openai import AsyncOpenAI

from backend.ai_engine import SyllabusExtractionUnavailable, extract_syllabus
from backend.config import Settings
from backend.main import create_app
from backend.models import SubTaskUpdate, SyllabusIngestRequest
from backend.persistence import RestoreUnavailable

from .conftest import MemoryStore, service_context, settings
from .test_ai_and_tasks import completion

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTz8AAAAASUVORK5CYII="
SYLLABUS = {
    "course": {
        "course_code": "BIO-101",
        "name": "Biology",
        "category_weights": [{"name": "Labs", "weight": 40.0}, {"name": "Exams", "weight": 60.0}],
    },
    "deliverables": [
        {
            "title": "Cell lab",
            "category": "Labs",
            "description": "Compare plant and animal cells.",
            "due_at": "2026-11-15T17:00:00-05:00",
            "points_possible": 100.0,
            "weight": 20.0,
            "rubric_criteria": [
                {"name": "Evidence", "description": "Include two diagrams.", "points": 60.0},
                {"name": "Analysis", "description": "Explain the differences.", "points": 40.0},
            ],
        },
        {"title": "Final exam", "category": "Exams", "weight": 60.0},
    ],
}


def syllabus_completion(material=None, reason="stop"):
    return completion(json.dumps(SYLLABUS if material is None else material), reason)


@asynccontextmanager
async def api_context(**kwargs):
    async with service_context(**kwargs) as service:
        app = create_app(service=service)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as api,
        ):
            yield api, service


@pytest.mark.parametrize("path", ["/api/v1/syllabus/ingest", "/api/v1/ingest/syllabus"])
@pytest.mark.parametrize("field", ["raw_text", "syllabus_text"])
async def test_text_ingest_merges_validated_course_and_deliverables(path, field):
    def handler(request):
        body = json.loads(request.content)
        assert body["model"] == "muse-spark-1.3"
        assert body["response_format"] == {"type": "json_object"}
        assert body["messages"][1]["content"] == "BIO-101 syllabus"
        assert "untrusted data" in body["messages"][0]["content"]
        return syllabus_completion()

    async with api_context(
        config=settings(meta_api_key="fixture-meta-key"), llm_handler=handler
    ) as (api, service):
        before = (await api.get("/api/state")).json()
        response = await api.post(path, json={field: "BIO-101 syllabus"})
        assert response.status_code == 200
        state = response.json()
        assert len(state["courses"]) == len(before["courses"]) + 1
        assert len(state["assignments"]) == len(before["assignments"]) + 2
        course = next(c for c in state["courses"] if c["course_code"] == "BIO-101")
        assert course["category_weights"] == SYLLABUS["course"]["category_weights"]
        assert course["current_score"] is None
        assert course["syllabus"] == "BIO-101 syllabus"
        lab = next(a for a in state["assignments"] if a["title"] == "Cell lab")
        assert lab["course_id"] == course["id"]
        assert lab["rubric_criteria"] == SYLLABUS["deliverables"][0]["rubric_criteria"]
        assert "Evidence (60 points): Include two diagrams." in lab["description"]
        assert lab["weight"] == 20
        assert lab["category"] == "Labs"
        assert lab["subtasks"]
        assert lab["status"] == "pending" and lab["graded"] is False
        assert (
            state["metrics"]["total_budgeted_minutes"] > before["metrics"]["total_budgeted_minutes"]
        )
        scores = [a["priority_score"] for a in state["assignments"]]
        assert scores == sorted(scores, reverse=True)
        assert state == (await api.get("/api/state")).json()
        assert service.store.states[True].courses[-1].id == course["id"]


@pytest.mark.parametrize("use_file", [False, True])
async def test_image_ingest_sends_vision_parts_without_persisting_base64(use_file):
    def handler(request):
        parts = json.loads(request.content)["messages"][1]["content"]
        assert parts[1] == {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{PNG}"},
        }
        return syllabus_completion()

    payload = (
        {"file": {"name": "syllabus.png", "mime_type": "image/png", "data_base64": PNG}}
        if use_file
        else {"image_base64": PNG}
    )
    async with api_context(llm_handler=handler) as (api, service):
        response = await api.post("/api/v1/syllabus/ingest", json=payload)
        assert response.status_code == 200
        assert PNG not in response.text
        assert PNG not in service.store.states[True].model_dump_json()
        course = next(c for c in response.json()["courses"] if c["course_code"] == "BIO-101")
        assert "Labs: 40%" in course["syllabus"]


async def test_text_file_is_decoded_and_pdf_is_sent_as_meta_file_part():
    text = "BIO-101 syllabus"
    pdf = base64.b64encode(b"%PDF-1.4\nfixture").decode()

    def handler(request):
        parts = json.loads(request.content)["messages"][1]["content"]
        if parts[1]["type"] == "text":
            assert parts[1]["text"] == text
        else:
            assert parts[1] == {
                "type": "file",
                "file": {
                    "filename": "syllabus.pdf",
                    "file_data": f"data:application/pdf;base64,{pdf}",
                },
            }
        return syllabus_completion()

    async with api_context(config=settings(meta_api_key="fixture-meta"), llm_handler=handler) as (
        api,
        _,
    ):
        for name, mime, data in (
            ("syllabus.txt", "text/plain", base64.b64encode(text.encode()).decode()),
            ("syllabus.pdf", "application/pdf", pdf),
        ):
            response = await api.post(
                "/api/v1/syllabus/ingest",
                json={"file": {"name": name, "mime_type": mime, "data_base64": data}},
            )
            assert response.status_code == 200


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"raw_text": " "},
        {"syllabus_text": 42},
        {"raw_text": "x" * 100_001},
        {"image_base64": "https://example.com/syllabus.png"},
        {"image_base64": "not base64!"},
        {"image_base64": base64.b64encode(b"not an image").decode()},
        {"image_base64": f"data:image/jpeg;base64,{PNG}"},
        {"image_base64": base64.b64encode(b"%PDF-1.4").decode()},
        {"file": {"name": "bad.pdf", "mime_type": "application/pdf", "data_base64": PNG}},
        {"file": {"name": "bad.txt", "mime_type": "text/plain", "data_base64": "/w=="}},
        {"file": {"name": "empty.txt", "mime_type": "text/plain", "data_base64": "IA=="}},
        {"raw_text": "syllabus", "unknown": True},
    ],
)
async def test_invalid_input_is_rejected_without_echoing_uploads(payload):
    calls = []

    def handler(request):
        calls.append(request)
        return syllabus_completion()

    async with api_context(llm_handler=handler) as (api, _):
        response = await api.post("/api/v1/syllabus/ingest", json=payload)
        assert response.status_code == 422
        assert response.json() == {"detail": "Invalid syllabus input."}
        assert not calls


@pytest.mark.parametrize("mode", ["http_error", "invalid_json", "timeout", "truncated"])
async def test_meta_failure_uses_deepseek_for_text_and_images(mode):
    primary_calls, fallback_calls = [], []

    async def primary(request):
        primary_calls.append(json.loads(request.content))
        if mode == "http_error":
            return httpx.Response(503)
        if mode == "timeout":
            await asyncio.Event().wait()
        if mode == "truncated":
            return syllabus_completion(reason="length")
        return completion("not JSON")

    def fallback(request):
        body = json.loads(request.content)
        fallback_calls.append(body)
        assert body["model"] == "deepseek-flash"
        assert body["messages"][1]["content"][1]["image_url"]["url"].endswith(PNG)
        return syllabus_completion()

    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(primary)) as primary_http,
        httpx.AsyncClient(transport=httpx.MockTransport(fallback)) as fallback_http,
        AsyncOpenAI(api_key="test", http_client=primary_http, max_retries=0) as client,
        AsyncOpenAI(api_key="test", http_client=fallback_http, max_retries=0) as auditor,
    ):
        extracted = await extract_syllabus(
            SyllabusIngestRequest(raw_text="BIO-101 syllabus", image_base64=PNG),
            settings=settings(meta_api_key="meta", llm_timeout_seconds=0.05),
            client=client,
            auditor=auditor,
        )
        assert extracted.course.course_code == "BIO-101"
        assert len(primary_calls) == len(fallback_calls) == 1


@pytest.mark.parametrize(
    "material",
    [
        {},
        {"course": {"course_code": " ", "name": "Biology"}, "deliverables": []},
        {"course": {**SYLLABUS["course"], "id": "injected"}, "deliverables": []},
        {
            "course": {
                **SYLLABUS["course"],
                "category_weights": [{"name": "A", "weight": 80}, {"name": "B", "weight": 80}],
            },
            "deliverables": [],
        },
        {
            "course": SYLLABUS["course"],
            "deliverables": [{"title": "Exam", "due_at": "2026-11-15T17:00:00"}],
        },
        {"course": SYLLABUS["course"], "deliverables": [{"title": "Exam", "weight": -1}]},
        {"course": SYLLABUS["course"], "deliverables": [{"title": "Exam", "weight": "50"}]},
        {"course": SYLLABUS["course"], "deliverables": [{"title": "Exam"}] * 2},
    ],
)
async def test_invalid_extraction_does_not_mutate_state(material):
    async with api_context(llm_handler=lambda request: syllabus_completion(material)) as (api, _):
        before = (await api.get("/api/state")).json()
        response = await api.post("/api/v1/syllabus/ingest", json={"raw_text": "syllabus"})
        assert response.status_code == 503
        assert (await api.get("/api/state")).json() == before


async def test_unavailable_providers_return_safe_error():
    async with api_context() as (api, _):
        response = await api.post("/api/v1/syllabus/ingest", json={"raw_text": "syllabus"})
        assert response.status_code == 503
        assert response.json() == {"detail": "Syllabus extraction is unavailable; retry shortly"}


async def test_reingest_refresh_and_restore_preserve_course_and_progress():
    store = MemoryStore()
    async with api_context(store=store, llm_handler=lambda request: syllabus_completion()) as (
        api,
        service,
    ):
        state = (
            await api.post("/api/v1/syllabus/ingest", json={"raw_text": "BIO-101 syllabus"})
        ).json()
        imported = next(a for a in state["assignments"] if a["title"] == "Cell lab")
        node = imported["subtasks"][0]["children"][0]
        await api.patch(
            f"/api/v1/subtasks/{node['id']}", json={"actual_minutes": 17, "is_completed": True}
        )
        # Replays are idempotent and a forced Canvas refresh cannot remove manual imports.
        await api.post("/api/v1/syllabus/ingest", json={"raw_text": "BIO-101 syllabus"})
        refreshed = (await api.post("/api/sync")).json()
        assert len(refreshed["courses"]) == len(state["courses"])
        assert len(refreshed["assignments"]) == len(state["assignments"])
        assignment = next(a for a in refreshed["assignments"] if a["id"] == imported["id"])
        assert assignment["subtasks"][0]["children"][0]["actual_minutes"] == 17
        assert assignment["subtasks"][0]["children"][0]["is_completed"] is True
        assert service._dirty[True] == set()
    async with service_context(store=store) as restarted:
        restored = await restarted.state()
        assignment = next(a for a in restored.assignments if a.id == imported["id"])
        assert assignment.subtasks[0].children[0].actual_minutes == 17
        assert next(c for c in restored.courses if c.course_code == "BIO-101").category_weights


async def test_matching_canvas_course_retains_grade_and_syllabus_on_refresh():
    material = {**SYLLABUS, "course": {**SYLLABUS["course"], "course_code": "BIO-101"}}
    async with api_context(llm_handler=lambda request: syllabus_completion(material)) as (api, _):
        before = (await api.get("/api/state")).json()
        original = before["courses"][0]
        material["course"]["course_code"] = original["course_code"].lower()
        state = (
            await api.post("/api/v1/syllabus/ingest", json={"raw_text": "new syllabus"})
        ).json()
        assert len(state["courses"]) == len(before["courses"])
        refreshed = (await api.post("/api/sync")).json()
        course = next(c for c in refreshed["courses"] if c["id"] == original["id"])
        assert course["current_score"] == original["current_score"]
        # Demo refreshes roll fixture timestamps forward while preserving the grade values.
        assert [p["score"] for p in course["grade_history"]] == [
            p["score"] for p in original["grade_history"]
        ]
        assert course["syllabus"] == "new syllabus"
        assert course["category_weights"] == material["course"]["category_weights"]


async def test_extraction_does_not_block_subtask_progress():
    started, release = asyncio.Event(), asyncio.Event()

    async def handler(request):
        started.set()
        await release.wait()
        return syllabus_completion()

    async with api_context(llm_handler=handler) as (api, service):
        state = await service.state()
        node = state.assignments[0].subtasks[0]
        pending = asyncio.create_task(
            api.post("/api/v1/syllabus/ingest", json={"raw_text": "syllabus"})
        )
        await asyncio.wait_for(started.wait(), timeout=1)
        try:
            changed = await asyncio.wait_for(
                service.patch(node.id, SubTaskUpdate(actual_minutes=9)), timeout=1
            )
            assert changed.metrics.total_actual_minutes > 0
        finally:
            release.set()
        assert (await pending).status_code == 200
        saved = next(
            a for a in (await service.state()).assignments if a.id == state.assignments[0].id
        )
        assert saved.subtasks[0].actual_minutes == 9


async def test_source_change_during_extraction_returns_conflict():
    started, release = asyncio.Event(), asyncio.Event()

    async def handler(request):
        started.set()
        await release.wait()
        return syllabus_completion()

    async with api_context(
        llm_handler=handler, canvas_handler=lambda request: httpx.Response(200, json=[])
    ) as (api, service):
        pending = asyncio.create_task(
            api.post("/api/v1/syllabus/ingest", json={"raw_text": "syllabus"})
        )
        await asyncio.wait_for(started.wait(), timeout=1)
        await service.state(canvas_settings=settings(demo_mode=False))
        release.set()
        assert (await pending).status_code == 409
        assert not (await service.state()).courses


async def test_ingest_survives_deferred_restore_without_overwriting_remote_state():
    class DeferredStore(MemoryStore):
        ready = False

        async def load(self, demo_mode):
            if not self.ready:
                raise RestoreUnavailable()
            return await super().load(demo_mode)

    store = DeferredStore()
    async with service_context() as original:
        store.states[True] = await original.state()
    async with service_context(
        store=store, llm_handler=lambda request: syllabus_completion()
    ) as service:
        state = await service.ingest_syllabus(SyllabusIngestRequest(raw_text="syllabus"))
        assert state.persistence_status == "unavailable"
        assert store.saves == 0
        store.ready = True
        restored = await service.state(force=True)
        assert restored.persistence_status == "connected"
        assert any(c.course_code == "BIO-101" for c in restored.courses)
        assert any(a.title == "Cell lab" for a in restored.assignments)


def test_deepseek_environment_aliases_preserve_existing_auditor_settings(monkeypatch):
    for name in ("AUDITOR_API_KEY", "AUDITOR_BASE_URL", "AUDITOR_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fixture-deepseek-key")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://deepseek.example/v1")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-v4.1-flash")
    config = Settings()
    assert config.auditor_enabled
    assert config.auditor_api_key.get_secret_value() == "fixture-deepseek-key"
    assert config.auditor_base_url == "https://deepseek.example/v1"
    assert config.auditor_model == "deepseek-v4.1-flash"
    assert "fixture-deepseek-key" not in repr(config)
    monkeypatch.setenv("AUDITOR_MODEL", "explicit-auditor")
    assert Settings().auditor_model == "explicit-auditor"
    assert settings(auditor_model="injected-model").auditor_model == "injected-model"


async def test_engine_closes_owned_clients_on_failure(monkeypatch):
    closed = []

    class UnavailableClient:
        @property
        def chat(self):
            raise ValueError("unavailable")

        async def close(self):
            closed.append(True)

    monkeypatch.setattr("backend.ai_engine.AsyncOpenAI", lambda **kwargs: UnavailableClient())
    with pytest.raises(SyllabusExtractionUnavailable):
        await extract_syllabus(
            SyllabusIngestRequest(raw_text="syllabus"),
            settings=settings(auditor_api_key="fixture-deepseek"),
        )
    assert len(closed) == 2
