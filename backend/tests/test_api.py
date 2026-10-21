import asyncio

import httpx
import pytest

from backend.main import create_app
from backend.models import InferenceTelemetry, SubTaskUpdate
from backend.tasks import walk

from .conftest import MemoryStore, service_context, settings


def node_ids(nodes):
    for node in nodes:
        yield node["id"]
        yield from node_ids(node["children"])


@pytest.fixture
async def api(terminal):
    app = create_app(service=terminal)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            yield client


async def test_default_state_is_rich_sorted_and_cached(api, terminal):
    response = await api.get("/api/state")
    assert response.status_code == 200
    state = response.json()
    assert len(state["courses"]) == 4
    assert len(state["assignments"]) == 12
    assert len(state["upcoming_events"]) == 3
    assert state["courses"][0]["portfolio_margin"] == 2.4
    assert len(state["courses"][0]["grade_history"]) == 10
    assert state["metrics"]["demo_mode"] is True
    # Every course has open work, so the zero-empty-state rule stays dormant.
    assert state["study_recommendations"] == []
    assert state["metrics"]["total_actual_minutes"] > 0
    scores = [a["priority_score"] for a in state["assignments"]]
    assert scores == sorted(scores, reverse=True)
    assert response.headers["cache-control"] == "no-store"
    assert (await api.get("/api/state")).json()["metrics"]["last_synced_at"] == (
        state["metrics"]["last_synced_at"]
    )
    assert terminal.store.saves == 1


@pytest.mark.parametrize("path", ["/api/sync", "/api/canvas/sync"])
async def test_sync_accepts_canvas_token_body_and_keeps_credentials_private(path):
    calls = []

    def canvas_handler(request):
        calls.append(request)
        assert request.url.host == "canvas.example.edu"
        assert request.headers["Authorization"] == "Bearer fixture-canvas-token"
        return httpx.Response(200, json=[])

    async with service_context(canvas_handler=canvas_handler) as service:
        app = create_app(service=service)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client,
        ):
            assert (await client.get("/api/state")).json()["metrics"]["demo_mode"] is True
            response = await client.post(
                path,
                json={
                    "canvas_api_token": "fixture-canvas-token",
                    "canvas_api_url": "https://canvas.example.edu/",
                },
            )
            assert response.status_code == 200
            assert response.json()["metrics"]["demo_mode"] is False
            assert "fixture-canvas-token" not in response.text
            assert calls
            calls.clear()
            # Later syncs use the credentials without needing them in the body again.
            assert (await client.post(path, json={})).json()["metrics"]["demo_mode"] is False
            assert calls


@pytest.mark.parametrize(
    "payload",
    [
        {"canvas_api_token": ""},
        {"canvas_api_token": 123},
        {"canvas_api_token": "fixture-canvas-token", "canvas_api_url": "http://canvas.example"},
        {
            "canvas_api_token": "fixture-canvas-token",
            "canvas_api_url": "https://u:p@canvas.example",
        },
    ],
)
async def test_sync_rejects_invalid_credentials_without_echoing_tokens(api, payload):
    response = await api.post("/api/canvas/sync", json=payload)
    assert response.status_code == 422
    assert "fixture-canvas-token" not in response.text


async def test_canvas_sync_accepts_short_token_alias_and_environment_sync(api):
    assert (await api.post("/api/canvas/sync")).status_code == 200
    response = await api.post("/api/canvas/sync", json={"token": "fixture-canvas-token"})
    assert response.status_code == 200


async def test_decompose_returns_telemetry_and_preserves_triage_contract(api):
    response = await api.post("/decompose", json={"assignment_id": "math4102-queue"})
    assert response.status_code == 200
    result = response.json()
    assert result["subtasks"]
    assert result["source"] == "local"
    assert set(result["telemetry"]) == {
        "model_used",
        "latency_ms",
        "prompt_tokens",
        "completion_tokens",
        "tokens_per_sec",
    }
    assert result["telemetry"]["model_used"] == "local-starter-plan"
    trace = result["agent_reasoning_trace"]
    assert [(step["step"], step["title"]) for step in trace] == [
        (1, "INGEST & AUDIT"),
        (2, "CAPACITY CHECK"),
        (3, "CRITICAL PATH"),
        (4, "VERIFICATION"),
    ]
    assert trace[2]["engine"] == "local-starter-plan"
    assert (await api.post("/api/triage/math4102-queue")).json() == result["subtasks"]
    missing = await api.post("/api/decompose", json={"assignment_id": "missing"})
    assert missing.status_code == 404
    assert "telemetry" in missing.json()
    invalid = await api.post("/decompose", json={})
    assert invalid.status_code == 422
    assert invalid.json()["telemetry"]["model_used"] == "none"
    engine = (await api.get("/api/engine")).json()
    assert engine == {"provider": "llama", "model": "llama3", "auditor": "rubric-parser"}


async def test_parent_child_completion_reopen_and_metrics(api):
    state = (await api.get("/api/state")).json()
    baseline = state["metrics"]
    assignment = next(a for a in state["assignments"] if a["id"] == "math4102-exam")
    root = assignment["subtasks"][0]
    response = await api.patch(
        f"/api/subtasks/{root['id']}",
        json={"is_completed": True, "actual_minutes": 9},
    )
    assert response.status_code == 200
    state = response.json()
    assignment = next(a for a in state["assignments"] if a["id"] == "math4102-exam")
    assert assignment["status"] == "in_progress"
    assert all(child["is_completed"] for child in assignment["subtasks"][0]["children"])
    assert state["metrics"]["total_actual_minutes"] == baseline["total_actual_minutes"] + 9
    assert state["metrics"]["completion_velocity"] > baseline["completion_velocity"]
    assert state["metrics"]["total_budgeted_minutes"] == baseline["total_budgeted_minutes"]
    child = root["children"][0]
    state = (
        await api.patch(
            f"/api/subtasks/{child['id']}",
            json={"is_completed": False},
        )
    ).json()
    root = next(a for a in state["assignments"] if a["id"] == "math4102-exam")["subtasks"][0]
    assert root["is_completed"] is False
    assert root["children"][1]["is_completed"] is True
    state = (
        await api.patch(
            f"/api/subtasks/{child['id']}",
            json={"is_completed": True},
        )
    ).json()
    assert (
        next(a for a in state["assignments"] if a["id"] == "math4102-exam")["subtasks"][0][
            "is_completed"
        ]
        is True
    )


async def test_finishing_all_roots_completes_assignment(api):
    state = (await api.get("/api/state")).json()
    assignment = next(a for a in state["assignments"] if a["id"] == "cs3801-raft")
    for node in assignment["subtasks"]:
        state = (
            await api.patch(
                f"/api/subtasks/{node['id']}",
                json={"is_completed": True},
            )
        ).json()
    assignment = next(a for a in state["assignments"] if a["id"] == "cs3801-raft")
    assert assignment["status"] == "completed"
    assert assignment["priority_score"] == 0


async def test_sync_and_triage_preserve_recorded_progress(api):
    response = await api.post("/api/triage/math4102-queue")
    assert response.status_code == 200
    nodes = response.json()
    leaf = nodes[0]["children"][0]
    await api.patch(
        f"/api/subtasks/{leaf['id']}",
        json={"is_completed": True, "actual_minutes": 17},
    )
    state = (await api.post("/api/sync")).json()
    assignment = next(a for a in state["assignments"] if a["id"] == "math4102-queue")
    assert assignment["subtasks"][0]["children"][0]["actual_minutes"] == 17
    assert assignment["subtasks"][0]["children"][0]["is_completed"] is True
    assert (await api.post("/api/triage/math4102-queue")).json() == assignment["subtasks"]


async def test_concurrent_patches_do_not_lose_updates(api):
    nodes = (await api.post("/api/triage/math4102-queue")).json()
    responses = await asyncio.gather(
        *[
            api.patch(f"/api/subtasks/{child['id']}", json={"is_completed": True})
            for child in nodes[0]["children"]
        ]
    )
    assert all(response.status_code == 200 for response in responses)
    state = (await api.get("/api/state")).json()
    assert (
        next(a for a in state["assignments"] if a["id"] == "math4102-queue")["subtasks"][0][
            "is_completed"
        ]
        is True
    )


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"is_completed": None},
        {"actual_minutes": None},
        {"is_completed": "true"},
        {"is_completed": 1},
        {"actual_minutes": -1},
        {"actual_minutes": 1.5},
        {"actual_minutes": True},
        {"actual_minutes": "30"},
        {"actual_minutes": 100_001},
        {"title": "unexpected"},
    ],
)
async def test_patch_rejects_invalid_input(api, payload):
    node = (await api.post("/api/triage/math4102-queue")).json()[0]
    response = await api.patch(f"/api/subtasks/{node['id']}", json=payload)
    assert response.status_code == 422


async def test_missing_resources_are_404(api):
    assert (await api.post("/api/triage/missing")).status_code == 404
    assert (await api.patch("/api/subtasks/missing", json={"actual_minutes": 0})).status_code == 404


async def test_v1_patch_mirrors_tree_and_logs_each_change(api, terminal):
    state = (await api.get("/api/state")).json()
    assignment = next(a for a in state["assignments"] if a["id"] == "cs3801-raft")
    parent = assignment["subtasks"][1]
    leaf = parent["children"][1]
    logged = leaf["actual_minutes"]

    response = await api.patch(
        f"/api/v1/subtasks/{leaf['id']}", json={"actual_minutes": logged + 15}
    )
    assert response.status_code == 200
    assert response.json()["persistence_status"] == "connected"
    [record] = terminal.store.records
    assert record["p_time_log"] == {
        "subtask_id": leaf["id"],
        "minutes_delta": 15,
        "actual_minutes": logged + 15,
        "is_completed": False,
    }
    rows = {row["id"]: row for row in record["p_subtasks"]}
    assert set(rows) == set(node_ids(assignment["subtasks"]))
    assert rows[leaf["id"]] | {"actual_minutes": logged} == {
        "id": leaf["id"],
        "parent_id": parent["id"],
        "title": leaf["title"],
        "estimated_minutes": leaf["estimated_minutes"],
        "actual_minutes": logged,
        "is_completed": False,
        "is_study_recommendation": False,
        "position": 1,
    }
    assert rows[parent["id"]]["parent_id"] is None
    assert record["p_assignment"]["id"] == "cs3801-raft"
    assert record["p_assignment"]["status"] == "in_progress"
    assert set(record["p_course"]) == {
        "id",
        "course_code",
        "name",
        "current_score",
        "target_score",
    }

    # A correction is logged as a negative delta, not dropped.
    await api.patch(f"/api/subtasks/{leaf['id']}", json={"actual_minutes": logged})
    assert terminal.store.records[-1]["p_time_log"]["minutes_delta"] == -15

    # Checking a parent mirrors the cascade into every child row.
    await api.patch(f"/api/v1/subtasks/{parent['id']}", json={"is_completed": True})
    record = terminal.store.records[-1]
    assert record["p_time_log"]["subtask_id"] == parent["id"]
    assert record["p_time_log"]["minutes_delta"] == 0
    assert record["p_time_log"]["is_completed"] is True
    children = [row for row in record["p_subtasks"] if row["parent_id"] == parent["id"]]
    assert len(children) == 3 and all(row["is_completed"] for row in children)

    # Replaying the same value (e.g. a queued offline edit) logs nothing.
    await api.patch(f"/api/v1/subtasks/{parent['id']}", json={"is_completed": True})
    assert len(terminal.store.records) == 3


async def test_failed_relational_write_is_reported_but_state_still_updates(api, terminal):
    terminal.store.record_ok = False
    state = (await api.get("/api/state")).json()
    root = next(a for a in state["assignments"] if a["id"] == "math4102-exam")["subtasks"][0]
    body = (await api.patch(f"/api/v1/subtasks/{root['id']}", json={"actual_minutes": 5})).json()
    assert body["persistence_status"] == "unavailable"
    assert body["metrics"]["total_actual_minutes"] == state["metrics"]["total_actual_minutes"] + 5


async def test_study_recommendation_is_patchable(api, terminal):
    # Finishing every ENG 2001 deliverable leaves the course empty, which triggers §4.4.
    await api.post("/api/triage/eng2001-proposal")
    state = (await api.get("/api/state")).json()
    for assignment in state["assignments"]:
        if assignment["course_id"] == "eng2001":
            for node in assignment["subtasks"]:
                await api.patch(f"/api/subtasks/{node['id']}", json={"is_completed": True})
    state = (await api.post("/api/sync")).json()
    [node] = state["study_recommendations"]
    assert node["is_study_recommendation"] is True
    assert "ENG 2001" in node["title"]
    state = (
        await api.patch(
            f"/api/subtasks/{node['id']}",
            json={"is_completed": True, "actual_minutes": 20},
        )
    ).json()
    assert state["study_recommendations"][0]["is_completed"] is True
    # No assignment row to hang it on, so the snapshot alone keeps it.
    assert all(r["p_time_log"]["subtask_id"] != node["id"] for r in terminal.store.records)
    state = (await api.post("/api/sync")).json()
    assert state["study_recommendations"][0]["actual_minutes"] == 20


async def test_cors_and_openapi(api, terminal):
    for origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
        response = await api.options(
            "/api/v1/subtasks/example",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
    assert (
        "access-control-allow-origin"
        not in (
            await api.get(
                "/api/state",
                headers={"Origin": "https://unknown.example"},
            )
        ).headers
    )
    deployed = create_app(settings(cors_origins="https://apex-os.vercel.app"), service=terminal)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=deployed), base_url="http://test"
    ) as client:
        for origin in ("https://apex-os.vercel.app", "http://localhost:3000"):
            response = await client.options(
                "/api/state",
                headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
            )
            assert response.status_code == 200
            assert response.headers["access-control-allow-origin"] == origin
    paths = (await api.get("/openapi.json")).json()["paths"]
    assert set(paths) == {
        "/decompose",
        "/api/decompose",
        "/api/engine",
        "/api/state",
        "/api/sync",
        "/api/canvas/sync",
        "/api/triage/{assignment_id}",
        "/api/v1/subtasks/{subtask_id}",
        "/api/v1/triage/study",
        "/api/v1/triage/study/insert",
        "/api/v1/triage/{assignment_id}/stream",
        "/api/v1/syllabus/ingest",
        "/api/v1/syllabus/presets",
        "/api/v1/syllabus/presets/{preset_id}/load",
        "/api/v1/ingest/syllabus",
        "/api/subtasks/{subtask_id}",
    }
    assert paths["/api/subtasks/{subtask_id}"]["patch"]["deprecated"] is True


async def test_state_returns_independent_snapshot(terminal):
    state = await terminal.state()
    baseline = state.metrics.total_actual_minutes
    next(walk(state.assignments[0].subtasks)).actual_minutes = 999
    assert (await terminal.state()).metrics.total_actual_minutes == baseline


async def test_triage_keeps_progress_recorded_while_model_is_running():
    started = asyncio.Event()
    release = asyncio.Event()

    async def handler(request):
        started.set()
        await release.wait()
        return httpx.Response(503)

    async with service_context(llm_handler=handler) as service:
        state = await service.state()
        baseline = state.metrics.total_actual_minutes
        assignment = next(a for a in state.assignments if a.id == "math4102-exam")
        telemetry, trace = InferenceTelemetry(), []
        pending = asyncio.create_task(
            service.triage(assignment.id, telemetry=telemetry, trace=trace)
        )
        await asyncio.wait_for(started.wait(), timeout=1)
        try:
            await service.patch(assignment.subtasks[0].id, SubTaskUpdate(actual_minutes=7))
        finally:
            release.set()
        result = await pending
        assert result[0].actual_minutes == 7
        assert (await service.state()).metrics.total_actual_minutes == baseline + 7
        # The saved plan came back, so the trace and telemetry describe it, not the discarded one.
        assert telemetry.model_used == "cached-plan"
        assert trace[2].engine == "cached-plan"
        assert "SAVED PLAN work is already logged on it, so it was kept" in trace[2].evidence
        kept_leaves = [node for node in walk(result) if not node.children]
        assert trace[2].summary.startswith(f"{len(kept_leaves)} atomic tasks sequenced")


async def test_unchecking_partly_done_parent_mirrors_the_cascade(api, terminal):
    state = (await api.get("/api/state")).json()
    parent = next(a for a in state["assignments"] if a["id"] == "cs3801-raft")["subtasks"][1]
    assert parent["is_completed"] is False
    assert parent["children"][0]["is_completed"] is True
    await api.patch(f"/api/v1/subtasks/{parent['id']}", json={"is_completed": False})
    [record] = terminal.store.records
    rows = {row["id"]: row for row in record["p_subtasks"]}
    assert rows[parent["children"][0]["id"]]["is_completed"] is False
    assert record["p_time_log"]["minutes_delta"] == 0


async def test_snapshot_and_mirror_writes_run_concurrently():
    saving, recording = asyncio.Event(), asyncio.Event()

    class RendezvousStore(MemoryStore):
        armed = False

        async def save(self, state):
            if self.armed:
                saving.set()
                await recording.wait()
            return await super().save(state)

        async def record_subtask_patch(self, *args):
            recording.set()
            await saving.wait()
            return await super().record_subtask_patch(*args)

    store = RendezvousStore()
    async with service_context(store=store) as service:
        state = await service.state()
        node = next(a for a in state.assignments if a.id == "cs3801-raft").subtasks[0]
        store.armed = True
        # Each write waits for the other to start, so running them in sequence deadlocks.
        state = await asyncio.wait_for(
            service.patch(node.children[0].id, SubTaskUpdate(actual_minutes=1)), timeout=2
        )
        assert state.persistence_status == "connected"
        assert len(store.records) == 1
