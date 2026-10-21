from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.main import create_app
from backend.models import AssignmentModel, CourseModel, GradePoint

ENDPOINT = "/api/v1/simulate/monte-carlo"


def assignment(identifier="open", *, weight=100.0, **overrides):
    return AssignmentModel(
        id=identifier,
        course_id="course",
        course_code="TEST 101",
        title=identifier,
        weight=weight,
        **overrides,
    )


def history(*scores):
    now = datetime.now(UTC)
    return [GradePoint(at=now + timedelta(days=i), score=s) for i, s in enumerate(scores)]


@pytest.fixture
async def simulation(terminal, monkeypatch):
    state = await terminal.state()
    state.courses = [
        CourseModel(
            id="course", course_code="TEST 101", name="Test", current_score=80, target_score=85
        )
    ]
    state.assignments = [assignment()]
    monkeypatch.setattr(terminal, "state", AsyncMock(return_value=state))
    app = create_app(service=terminal)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client, state


async def test_default_iterations_and_reproducible_ordered_percentiles(simulation):
    client, _ = simulation
    response = await client.post(ENDPOINT, json={})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["iterations"] == 1000
    course = data["courses"][0]
    quantiles = course["percentiles"]
    values = [quantiles[f"p{p}"] for p in (10, 25, 50, 75, 90)]
    assert values == sorted(values)
    assert all(0 <= value <= 100 for value in values)
    assert course["var_90"] > 0
    assert 0 < course["probability_of_target"] < 1
    assert (await client.post(ENDPOINT, json={})).json() == data


async def test_endpoint_uses_live_service_snapshot_without_persisting_forecasts(terminal):
    before = await terminal.state()
    saves = terminal.store.saves
    app = create_app(service=terminal)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        response = await client.post(ENDPOINT, json={})
    assert response.status_code == 200
    assert {row["course_id"] for row in response.json()["courses"]} == {
        course.id for course in before.courses
    }
    assert terminal.store.saves == saves
    assert (await terminal.state()).model_dump() == before.model_dump()


async def test_historical_variance_and_var_match_normal_reference(simulation):
    client, state = simulation
    state.courses[0].grade_history = history(70, 90)
    course = (await client.post(ENDPOINT, json={"iterations": 10_000})).json()["courses"][0]
    assert 65 < course["percentiles"]["p10"] < 70
    assert 79 < course["percentiles"]["p50"] < 81
    assert 91 < course["percentiles"]["p90"] < 94
    assert 11 < course["var_90"] < 15
    assert 0.28 < course["probability_of_target"] < 0.34


async def test_remaining_weight_scales_variance_and_sensitivity(simulation):
    client, state = simulation
    state.courses[0].grade_history = history(70, 90)
    full = (await client.post(ENDPOINT, json={})).json()["courses"][0]
    state.assignments[0].weight = 25
    partial = (await client.post(ENDPOINT, json={})).json()["courses"][0]
    for key in ("p10", "p25", "p50", "p75", "p90"):
        assert partial["percentiles"][key] == pytest.approx(60 + full["percentiles"][key] / 4)
    assert partial["var_90"] == pytest.approx(full["var_90"] / 4)
    assert partial["sensitivity_matrix"] == [
        {"assignment_id": "open", "weight": 25, "marginal_impact": 0.25}
    ]


async def test_sensitivity_holds_when_other_assignments_are_random(simulation):
    client, state = simulation
    state.assignments = [assignment("a", weight=25), assignment("b", weight=25)]
    baseline = (await client.post(ENDPOINT, json={"shock_overrides": {"a": 80}})).json()["courses"][
        0
    ]
    bumped = (await client.post(ENDPOINT, json={"shock_overrides": {"a": 81}})).json()["courses"][0]
    assert bumped["percentiles"]["p50"] - baseline["percentiles"]["p50"] == pytest.approx(0.25)
    assert bumped["var_90"] == pytest.approx(baseline["var_90"])


async def test_shocks_fix_scores_and_preserve_state(simulation):
    client, state = simulation
    state.assignments = [assignment("a", weight=25), assignment("b", weight=25)]
    before = state.model_dump(mode="json")
    data = (await client.post(ENDPOINT, json={"shock_overrides": {"a": 100, "b": 80}})).json()[
        "courses"
    ][0]
    assert set(data["percentiles"].values()) == {85}
    assert data["var_90"] == 0
    assert data["probability_of_target"] == 1
    # One percentage point on a 25% assignment moves the final grade by 0.25.
    changed = (await client.post(ENDPOINT, json={"shock_overrides": {"a": 99, "b": 80}})).json()[
        "courses"
    ][0]
    assert data["percentiles"]["p50"] - changed["percentiles"]["p50"] == pytest.approx(0.25)
    assert changed["probability_of_target"] == 0
    assert state.model_dump(mode="json") == before


async def test_graded_excluded_and_completed_ungraded_still_simulated(simulation):
    client, state = simulation
    state.assignments = [
        assignment("graded", weight=25, graded=True, score=0, points_possible=100),
        assignment("submitted", weight=25, status="completed"),
        assignment("zero", weight=0),
    ]
    result = (await client.post(ENDPOINT, json={"shock_overrides": {"submitted": 100}})).json()[
        "courses"
    ][0]
    assert set(result["percentiles"].values()) == {85}
    assert [row["assignment_id"] for row in result["sensitivity_matrix"]] == ["submitted"]


@pytest.mark.parametrize("scores", [(80, 80), (0, 0)])
async def test_zero_historical_variance_is_deterministic(simulation, scores):
    client, state = simulation
    state.courses[0].grade_history = history(*scores)
    result = (await client.post(ENDPOINT, json={})).json()["courses"][0]
    assert set(result["percentiles"].values()) == {80}
    assert result["var_90"] == 0


async def test_posted_grades_use_percentage_units_for_historical_variance(simulation):
    client, state = simulation
    state.assignments.extend(
        [
            assignment("old-a", weight=0, graded=True, score=35, points_possible=50),
            assignment("old-b", weight=0, graded=True, score=180, points_possible=200),
        ]
    )
    from_grades = (await client.post(ENDPOINT, json={})).json()
    state.courses[0].grade_history = history(70, 90)
    assert (await client.post(ENDPOINT, json={})).json() == from_grades


async def test_no_remaining_work_is_fixed_at_current_grade(simulation):
    client, state = simulation
    state.assignments = []
    result = (await client.post(ENDPOINT, json={})).json()["courses"][0]
    assert set(result["percentiles"].values()) == {80}
    assert result["var_90"] == 0
    assert result["probability_of_target"] == 0
    assert result["sensitivity_matrix"] == []


async def test_excess_remaining_weights_are_normalized(simulation):
    client, state = simulation
    state.assignments = [assignment("a"), assignment("b")]
    result = (await client.post(ENDPOINT, json={"shock_overrides": {"a": 0, "b": 100}})).json()[
        "courses"
    ][0]
    assert set(result["percentiles"].values()) == {50}
    assert [row["marginal_impact"] for row in result["sensitivity_matrix"]] == [0.5, 0.5]


async def test_course_filter_and_missing_course(simulation):
    client, state = simulation
    state.courses.append(
        CourseModel(id="other", course_code="TEST 102", name="Other", current_score=95)
    )
    all_courses = (await client.post(ENDPOINT, json={})).json()["courses"]
    selected = (await client.post(ENDPOINT, json={"course_id": "other"})).json()["courses"]
    assert len(all_courses) == 2
    assert selected == [all_courses[1]]
    assert (await client.post(ENDPOINT, json={"course_id": "missing"})).status_code == 404


async def test_no_observed_grade_is_explicitly_unavailable(simulation):
    client, state = simulation
    state.courses[0].current_score = None
    result = (await client.post(ENDPOINT, json={})).json()["courses"][0]
    assert result["percentiles"] is None
    assert result["var_90"] is None
    assert result["probability_of_target"] is None
    # Complete shocks can determine an entirely ungraded course.
    result = (await client.post(ENDPOINT, json={"shock_overrides": {"open": 95}})).json()[
        "courses"
    ][0]
    assert set(result["percentiles"].values()) == {95}


async def test_grade_history_can_supply_missing_current_score(simulation):
    client, state = simulation
    state.courses[0].current_score = None
    state.courses[0].grade_history = history(80, 80)
    result = (await client.post(ENDPOINT, json={})).json()["courses"][0]
    assert set(result["percentiles"].values()) == {80}


@pytest.mark.parametrize("score", [0, 100])
async def test_shock_boundaries_and_short_alias(simulation, score):
    client, _ = simulation
    response = await client.post(ENDPOINT, json={"iterations": 100, "shocks": {"open": score}})
    assert response.status_code == 200
    assert response.json()["iterations"] == 100
    assert set(response.json()["courses"][0]["percentiles"].values()) == {score}


@pytest.mark.parametrize(
    "body",
    [
        {"iterations": 99},
        {"iterations": 10_001},
        {"iterations": True},
        {"iterations": "1000"},
        {"iterations": 100.5},
        {"course_id": ""},
        {"course_id": 1},
        {"shock_overrides": {"open": -1}},
        {"shock_overrides": {"open": 101}},
        {"shock_overrides": {"open": "90"}},
        {"shock_overrides": {"open": True}},
        {"shock_overrides": {"open": None}},
        {"shock_overrides": {"missing": 90}},
        {"surprise": 1},
    ],
)
async def test_invalid_requests_are_rejected(simulation, body):
    client, _ = simulation
    assert (await client.post(ENDPOINT, json=body)).status_code == 422


async def test_shocks_cannot_target_graded_or_other_course_assignments(simulation):
    client, state = simulation
    state.assignments[0].graded = True
    assert (await client.post(ENDPOINT, json={"shock_overrides": {"open": 90}})).status_code == 422
    state.assignments[0].graded = False
    state.courses.append(CourseModel(id="other", course_code="OTHER", name="Other"))
    assert (
        await client.post(ENDPOINT, json={"course_id": "other", "shock_overrides": {"open": 90}})
    ).status_code == 422
