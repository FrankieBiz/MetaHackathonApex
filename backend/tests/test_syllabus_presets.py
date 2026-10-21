import asyncio
from collections import defaultdict

import httpx
import pytest

from backend.main import create_app
from backend.syllabus_presets import get_preset, list_presets

from .conftest import MemoryStore, service_context, settings

PRESET_IDS = ["mit-6-033", "stanford-cs229", "harvard-stat110", "columbia-bio-c2005"]


async def test_catalog_describes_four_presets_without_loading_or_using_providers():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503)

    async with service_context(canvas_handler=handler, llm_handler=handler) as service:
        app = create_app(service=service)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as api,
        ):
            response = await api.get("/api/v1/syllabus/presets")
            assert response.status_code == 200
            descriptors = response.json()
            assert [p["id"] for p in descriptors] == PRESET_IDS
            assert [p["course_code"] for p in descriptors] == [
                "6.033",
                "CS229",
                "STAT 110",
                "BIO C2005",
            ]
            assert all(p["assignment_count"] >= 9 for p in descriptors)
            assert all(p["source_urls"] and p["adaptation_notes"] for p in descriptors)
            assert [p["university"] for p in descriptors] == [
                "MIT",
                "Stanford",
                "Harvard",
                "Columbia",
            ]
            assert all(p["summary"] == p["description"] for p in descriptors)
            assert response.headers["cache-control"] == "no-store"
            assert not calls
            assert service._state is None


@pytest.mark.parametrize("preset_id", PRESET_IDS)
def test_presets_have_complete_consistent_grading_dates_and_rubrics(preset_id):
    preset = get_preset(preset_id)
    extraction = preset.extraction
    assert preset.descriptor.assignment_count == len(extraction.deliverables)
    assert preset.descriptor.category_weights == extraction.course.category_weights
    assert sum(c.weight for c in extraction.course.category_weights) == pytest.approx(100)
    assert sum(a.weight for a in extraction.deliverables) == pytest.approx(100)
    category_totals = defaultdict(float)
    for assignment in extraction.deliverables:
        assert assignment.category is not None
        category_totals[assignment.category] += assignment.weight
        assert assignment.description.strip()
        assert assignment.due_at is not None and assignment.due_at.utcoffset() is not None
        assert assignment.due_at.year == 2026
        assert assignment.points_possible > 0
        assert len(assignment.rubric_criteria) >= 3
        assert all(c.description and c.points > 0 for c in assignment.rubric_criteria)
        assert sum(c.points for c in assignment.rubric_criteria) == assignment.points_possible
        assert assignment.title in preset.syllabus_text
        assert assignment.due_at.isoformat() in preset.syllabus_text
    assert dict(category_totals) == {
        c.name: pytest.approx(c.weight) for c in extraction.course.category_weights
    }
    assert "Grading policy:" in preset.syllabus_text
    assert "late" in preset.syllabus_text.lower()
    assert "independent" in preset.syllabus_text.lower() or "own answers" in preset.syllabus_text
    assert "demo adaptations" in preset.syllabus_text
    assert all(url in preset.syllabus_text for url in preset.descriptor.source_urls)


@pytest.mark.parametrize("preset_id", PRESET_IDS)
async def test_load_preset_merges_persists_and_preserves_progress_on_replay(preset_id):
    llm_calls = []

    def llm_handler(request):
        llm_calls.append(request)
        return httpx.Response(503)

    store = MemoryStore()
    async with service_context(store=store, llm_handler=llm_handler) as service:
        app = create_app(service=service)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as api,
        ):
            before = (await api.get("/api/state")).json()
            preset = get_preset(preset_id)
            response = await api.post(f"/api/v1/syllabus/presets/{preset_id}/load")
            assert response.status_code == 200
            state = response.json()
            assert len(state["courses"]) == len(before["courses"]) + 1
            assert len(state["assignments"]) == (
                len(before["assignments"]) + preset.descriptor.assignment_count
            )
            course = next(
                c for c in state["courses"] if c["course_code"] == preset.descriptor.course_code
            )
            assert course["syllabus_ingested"]
            assert course["syllabus"] == preset.syllabus_text
            assert course["category_weights"] == [
                c.model_dump() for c in preset.extraction.course.category_weights
            ]
            assignments = [a for a in state["assignments"] if a["course_id"] == course["id"]]
            assert all(a["due_at"] and a["rubric_criteria"] and a["subtasks"] for a in assignments)
            assert all("Rubric:" in a["description"] and not a["graded"] for a in assignments)
            assert (
                state["metrics"]["total_budgeted_minutes"]
                > before["metrics"]["total_budgeted_minutes"]
            )
            assert {a["id"] for a in before["assignments"]} <= {
                a["id"] for a in state["assignments"]
            }
            assignment_id = assignments[0]["id"]
            node = assignments[0]["subtasks"][0]["children"][0]
            changed = await api.patch(
                f"/api/v1/subtasks/{node['id']}",
                json={"actual_minutes": 17, "is_completed": True},
            )
            assert changed.status_code == 200
            replay = await api.post(f"/api/v1/syllabus/presets/{preset_id}/load")
            assert replay.status_code == 200
            assert len(replay.json()["assignments"]) == len(state["assignments"])
            refreshed = (await api.post("/api/sync")).json()
            assert len(refreshed["assignments"]) == len(state["assignments"])
            imported = next(a for a in refreshed["assignments"] if a["id"] == assignment_id)
            assert imported["subtasks"][0]["children"][0]["actual_minutes"] == 17
            assert imported["subtasks"][0]["children"][0]["is_completed"]
            assert refreshed == (await api.get("/api/state")).json()
            assert store.states[True].model_dump(mode="json") == refreshed
            assert not llm_calls
    async with service_context(store=store) as restarted:
        restored = await restarted.state()
        assignment = next(a for a in restored.assignments if a.id == assignment_id)
        assert assignment.subtasks[0].children[0].actual_minutes == 17
        assert (
            next(c for c in restored.courses if c.id == course["id"]).syllabus
            == preset.syllabus_text
        )


async def test_unknown_preset_is_404_without_initializing_state():
    async with service_context() as service:
        app = create_app(service=service)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as api,
        ):
            response = await api.post("/api/v1/syllabus/presets/unknown/load")
            assert response.status_code == 404
            assert response.json() == {"detail": "Syllabus preset not found"}
            assert service._state is None
            assert service.store.saves == 0


async def test_all_presets_can_load_concurrently_without_duplicates():
    async with service_context() as service:
        await asyncio.gather(*(service.load_syllabus_preset(p) for p in PRESET_IDS * 2))
        state = await service.state()
        assert len({a.id for a in state.assignments}) == len(state.assignments)
        for descriptor in list_presets():
            course = next(c for c in state.courses if c.course_code == descriptor.course_code)
            assert (
                len([a for a in state.assignments if a.course_id == course.id])
                == descriptor.assignment_count
            )


async def test_presets_load_into_live_source_and_survive_live_refresh():
    store = MemoryStore()
    async with service_context(
        config=settings(demo_mode=False, canvas_api_token="fixture"),
        canvas_handler=lambda request: httpx.Response(200, json=[]),
        store=store,
    ) as service:
        loaded = await service.load_syllabus_preset(PRESET_IDS[0])
        assert not loaded.metrics.demo_mode
        assert len(loaded.courses) == 1
        assert False in store.states and True not in store.states
        refreshed = await service.state(force=True)
        assert [a.id for a in refreshed.assignments] == [a.id for a in loaded.assignments]
        assert refreshed.courses == loaded.courses


def test_catalog_copies_do_not_leak_mutations_into_future_loads():
    descriptors = list_presets()
    descriptors[0].source_urls.clear()
    descriptors[0].category_weights[0].weight = 0
    preset = get_preset(PRESET_IDS[0])
    preset.extraction.deliverables[0].rubric_criteria.clear()
    preset.extraction.course.category_weights[0].weight = 0
    fresh = get_preset(PRESET_IDS[0])
    assert fresh.descriptor.source_urls
    assert fresh.extraction.deliverables[0].rubric_criteria
    assert sum(c.weight for c in fresh.extraction.course.category_weights) == 100
