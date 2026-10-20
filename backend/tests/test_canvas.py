import asyncio
import json

import httpx
import pytest

from backend.canvas_client import CACHE_TTL_SECONDS, CanvasClient, plain_text
from backend.models import CourseModel

from .conftest import MemoryStore, service_context, settings


def live_handler(request):
    assert request.headers["authorization"] == "Bearer fake-canvas-token"
    assert request.headers["accept"] == "application/json+canvas-string-ids"
    if request.url.path == "/api/v1/courses":
        assert request.url.params["enrollment_state"] == "active"
        assert "total_scores" in request.url.params.get_list("include[]")
        return httpx.Response(
            200,
            json=[
                {
                    "id": 401,
                    "name": "Distributed Systems",
                    "course_code": "CS-401",
                    "enrollments": [{"type": "student", "computed_current_score": 87.4}],
                    "syllabus_body": "<p>Review consensus</p>",
                }
            ],
        )
    if request.url.path.endswith("/assignments"):
        if request.url.params.get("page") == "2":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 2,
                        "name": "Past quiz",
                        "due_at": None,
                        "points_possible": 20,
                        "submission": {"workflow_state": "graded"},
                    }
                ],
            )
        return httpx.Response(
            200,
            json=[
                {
                    "id": 1,
                    "name": "Raft project",
                    "due_at": "2026-10-22T18:00:00Z",
                    "points_possible": 100,
                    "description": "<p>Build &amp; test</p>",
                    "rubric": [{"description": "Correctness", "points": 50}],
                },
                {"id": 99, "published": False},
            ],
            headers={
                "Link": "<https://canvas.instructure.com/api/v1/courses/401/assignments?page=2>; "
                'rel="next"',
            },
        )
    if request.url.path.endswith("/upcoming_events"):
        return httpx.Response(
            200,
            json=[
                {
                    "id": "event_1",
                    "title": "Office hours",
                    "context_code": "course_401",
                    "start_at": "2026-10-21T12:00:00Z",
                },
                {
                    "id": "assignment_1",
                    "context_code": "course_401",
                    "assignment": {"id": 1, "name": "Raft project"},
                },
            ],
        )
    raise AssertionError(f"Unexpected path: {request.url.path}")


async def test_live_pagination_normalization_and_ttl_cache():
    calls = []

    def handler(request):
        calls.append(request.url)
        return live_handler(request)

    config = settings(demo_mode=False, canvas_api_token="fake-canvas-token")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        canvas = CanvasClient(config, http)
        first, second = await asyncio.gather(canvas.sync(), canvas.sync())
        assert first == second
        assert first.demo_mode is False
        assert len(calls) == 4
        assert len(first.assignments) == 2
        assert "Correctness (50 points)" in first.assignments[0].description
        assert first.assignments[0].weight == 83.33
        assert first.assignments[1].status == "completed"
        assert first.assignments[0].graded is False
        assert first.assignments[1].graded is True
        assert first.courses[0].portfolio_margin == -2.6
        assert first.upcoming_events[0].course_id == "401"
        first.assignments[0].title = "Changed copy"
        assert (await canvas.sync()).assignments[0].title == "Raft project"
        canvas._cached_at -= CACHE_TTL_SECONDS + 1
        await canvas.sync()
        assert len(calls) == 8
        await canvas.sync(force=True)
        assert len(calls) == 12


async def test_string_ids_beyond_js_safe_integers_stay_exact():
    # With the string-ids Accept header Canvas sends IDs as strings; these exceed 2**53.
    course_id, assignment_id = "53000000000012345", "53000000000098765"

    def handler(request):
        assert request.headers["accept"] == "application/json+canvas-string-ids"
        if request.url.path == "/api/v1/courses":
            return httpx.Response(200, json=[{"id": course_id, "name": "Big IDs"}])
        if request.url.path == f"/api/v1/courses/{course_id}/assignments":
            return httpx.Response(200, json=[{"id": assignment_id, "name": "Essay"}])
        return httpx.Response(200, json=[])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        snapshot = await CanvasClient(
            settings(demo_mode=False, canvas_api_token="fake"), http
        ).sync()
    assert snapshot.demo_mode is False
    assert snapshot.courses[0].id == course_id
    assert snapshot.assignments[0].id == assignment_id
    assert snapshot.assignments[0].course_id == course_id


@pytest.mark.parametrize(
    "failure",
    ["unauthorized", "rate_limit", "offline", "malformed", "bad_json", "slow", "non_200"],
)
async def test_canvas_failures_automatically_cache_sandbox(failure):
    calls = 0

    async def handler(request):
        nonlocal calls
        calls += 1
        if failure == "offline":
            raise httpx.ConnectError("offline", request=request)
        if failure == "slow":
            await asyncio.sleep(5)
        if failure == "non_200":
            return httpx.Response(202, json=[])
        if failure == "malformed":
            return httpx.Response(200, json={"unexpected": "object"})
        if failure == "bad_json":
            return httpx.Response(200, text="not-json")
        return httpx.Response(401 if failure == "unauthorized" else 429)

    config = settings(demo_mode=False, canvas_api_token="fake", canvas_timeout_seconds=0.05)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        canvas = CanvasClient(config, http)
        snapshot = await asyncio.wait_for(canvas.sync(), timeout=1)
        assert snapshot.demo_mode is True
        assert len(snapshot.courses) == 4
        assert len(snapshot.assignments) == 12
        assert (await canvas.sync()).synced_at == snapshot.synced_at
        assert calls == 1


async def test_sync_route_serves_simulation_when_canvas_stalls():
    async def stalled(request):
        await asyncio.sleep(5)

    from backend.main import create_app

    config = settings(demo_mode=False, canvas_api_token="fake", canvas_timeout_seconds=0.05)
    async with service_context(config=config, canvas_handler=stalled) as service:
        app = create_app(service=service)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as api,
        ):
            response = await asyncio.wait_for(api.post("/api/sync"), timeout=1)
    assert response.status_code == 200
    state = response.json()
    assert state["metrics"]["demo_mode"] is True
    assert [c["course_code"] for c in state["courses"]] == [
        "CS 3801",
        "MATH 4102",
        "ENG 2001",
        "FIN 3100",
    ]


@pytest.mark.parametrize(
    "next_url",
    [
        "https://attacker.example/api/v1/courses",
        "http://canvas.instructure.com/api/v1/courses",
        "https://user:pass@canvas.instructure.com/api/v1/courses",
        "https://canvas.instructure.com/not-an-api",
    ],
)
async def test_pagination_never_sends_credentials_outside_canvas(next_url):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, json=[], headers={"Link": f'<{next_url}>; rel="next"'})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        canvas = CanvasClient(settings(demo_mode=False, canvas_api_token="fake"), http)
        assert (await canvas.sync()).demo_mode is True
        assert len(calls) == 1


async def test_live_and_sandbox_progress_are_isolated_during_recovery():
    failing = False

    def handler(request):
        return httpx.Response(503) if failing else live_handler(request)

    store = MemoryStore()
    async with service_context(
        config=settings(demo_mode=False, canvas_api_token="fake-canvas-token"),
        canvas_handler=handler,
        store=store,
    ) as service:
        live = await service.state()
        nodes = await service.triage("1")
        from backend.models import SubTaskUpdate

        await service.patch(nodes[0].id, SubTaskUpdate(actual_minutes=12))
        failing = True
        assert (await service.state(force=True)).metrics.demo_mode is True
        failing = False
        restored = await service.state(force=True)
        assert restored.metrics.demo_mode is False
        assert restored.metrics.total_actual_minutes == 12
        assert len(restored.assignments) == len(live.assignments)
        assert set(store.states) == {True, False}


async def test_supabase_progress_restores_after_service_restart():
    from backend.models import SubTaskUpdate

    store = MemoryStore()
    async with service_context(store=store) as service:
        baseline = (await service.state()).metrics.total_actual_minutes
        nodes = await service.triage("math4102-queue")
        await service.patch(nodes[0].id, SubTaskUpdate(actual_minutes=22))
    async with service_context(store=store) as service:
        assert (await service.state()).metrics.total_actual_minutes == baseline + 22


def test_plain_text_excludes_executable_content():
    assert plain_text("<style>hide</style><p>A &amp; B</p><script>bad()</script>") == "A & B"


def test_snapshot_round_trip_excludes_derived_fields():
    from backend.canvas_client import get_mock_sandbox_data

    course = get_mock_sandbox_data().courses[0]
    assert "portfolio_margin" not in json.loads(course.model_dump_json(round_trip=True))


async def test_missing_grades_nullable_material_and_empty_live_courses():
    def handler(request):
        if request.url.path == "/api/v1/courses":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 1,
                        "name": "Ungraded course",
                        "enrollments": None,
                        "syllabus_body": None,
                    }
                ],
            )
        if request.url.path.endswith("/assignments"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 1,
                        "name": "Ungraded assignment",
                        "rubric": None,
                        "description": None,
                    }
                ],
            )
        return httpx.Response(200, json=[])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        canvas = CanvasClient(settings(demo_mode=False, canvas_api_token="fake"), http)
        snapshot = await canvas.sync()
        assert snapshot.demo_mode is False
        assert snapshot.courses[0].current_score is None
        assert snapshot.courses[0].portfolio_margin is None
        assert snapshot.assignments[0].due_at is None
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[]))
    ) as http:
        snapshot = await CanvasClient(
            settings(demo_mode=False, canvas_api_token="fake"),
            http,
        ).sync()
        assert snapshot.demo_mode is False
        assert snapshot.courses == []


@pytest.mark.parametrize(
    ("submission", "status", "graded"),
    [
        ({}, "pending", False),
        (
            {"workflow_state": "submitted", "submitted_at": "2026-10-18T10:00:00Z"},
            "completed",
            False,
        ),
        ({"workflow_state": "graded", "score": 88}, "completed", True),
        ({"workflow_state": "unsubmitted", "score": 0}, "completed", True),
        ({"workflow_state": "unsubmitted", "excused": True}, "completed", True),
    ],
)
def test_submission_state_separates_submitted_from_graded(submission, status, graded):
    course = CourseModel(id="401", course_code="CS-401", name="Distributed Systems")
    assignment = CanvasClient._assignment(
        {"id": 1, "name": "Raft project", "points_possible": 100, "submission": submission},
        course,
    )
    assert (assignment.status, assignment.graded) == (status, graded)
