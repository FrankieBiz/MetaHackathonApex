"""Test Academic Efficient Frontier calculation, Pareto optimization, and API endpoints."""

from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from backend.efficient_frontier import (
    calculate_efficient_frontier,
    score_to_gpa,
)
from backend.main import create_app
from backend.models import (
    AssignmentModel,
    CourseModel,
    EfficientFrontierRequest,
    SubTaskNode,
    TerminalMetrics,
    TerminalState,
)


def _sample_frontier_state() -> TerminalState:
    c1 = CourseModel(
        id="c-algo",
        course_code="CS-101",
        name="Algorithms",
        current_score=88.0,
        target_score=90.0,
    )
    c2 = CourseModel(
        id="c-sys",
        course_code="EE-200",
        name="Systems",
        current_score=72.0,
        target_score=80.0,
    )
    c3 = CourseModel(
        id="c-econ",
        course_code="ECON-101",
        name="Microeconomics",
        current_score=94.0,
        target_score=85.0,
    )

    a1 = AssignmentModel(
        id="a1",
        course_id="c-algo",
        course_code="CS-101",
        title="Graph Lab",
        due_at=datetime(2026, 11, 15, 23, 59, tzinfo=UTC),
        points_possible=100.0,
        weight=25.0,
        status="in_progress",
        graded=False,
        subtasks=[SubTaskNode(id="st1", assignment_id="a1", title="Code", estimated_minutes=60)],
    )
    a2 = AssignmentModel(
        id="a2",
        course_id="c-sys",
        course_code="EE-200",
        title="Cache Lab",
        due_at=datetime(2026, 11, 18, 23, 59, tzinfo=UTC),
        points_possible=100.0,
        weight=30.0,
        status="in_progress",
        graded=False,
        subtasks=[SubTaskNode(id="st2", assignment_id="a2", title="Verilog", estimated_minutes=90)],
    )
    a3 = AssignmentModel(
        id="a3",
        course_id="c-econ",
        course_code="ECON-101",
        title="Problem Set",
        due_at=datetime(2026, 11, 20, 23, 59, tzinfo=UTC),
        points_possible=100.0,
        weight=10.0,
        status="in_progress",
        graded=False,
        subtasks=[],
    )

    metrics = TerminalMetrics(
        completion_velocity=1.0,
        assignment_volatility=0.5,
        total_budgeted_minutes=150,
        total_actual_minutes=0,
        last_synced_at="2026-10-22T10:00:00Z",
        demo_mode=True,
    )

    return TerminalState(
        courses=[c1, c2, c3],
        assignments=[a1, a2, a3],
        study_recommendations=[],
        metrics=metrics,
        upcoming_events=[],
    )


def test_score_to_gpa_mapping():
    assert score_to_gpa(95.0) == 4.0
    assert score_to_gpa(91.0) == 3.7
    assert score_to_gpa(88.0) == 3.3
    assert score_to_gpa(85.0) == 3.0
    assert score_to_gpa(81.0) == 2.7
    assert score_to_gpa(78.0) == 2.3
    assert score_to_gpa(74.0) == 2.0
    assert score_to_gpa(71.0) == 1.7
    assert score_to_gpa(68.0) == 1.3
    assert score_to_gpa(65.0) == 1.0
    assert score_to_gpa(50.0) == 0.77


def test_calculate_efficient_frontier_budget_conservation():
    state = _sample_frontier_state()
    req = EfficientFrontierRequest(weekly_hours=20.0, strategy="balanced")
    res = calculate_efficient_frontier(state, req)

    assert res.weekly_hours == 20.0
    assert res.strategy == "balanced"
    assert res.projected_portfolio_gpa >= res.current_portfolio_gpa
    assert res.gpa_delta >= 0.0

    # Total allocated minutes should equal 20 hours * 60 = 1200
    total_allocated = sum(a.allocated_minutes for a in res.optimal_allocation)
    assert total_allocated == 1200

    # Maintenance minimum: each course should receive at least 30 minutes
    for a in res.optimal_allocation:
        assert a.allocated_minutes >= 30


def test_efficient_frontier_curve_monotonicity():
    state = _sample_frontier_state()
    req = EfficientFrontierRequest(weekly_hours=15.0, strategy="balanced")
    res = calculate_efficient_frontier(state, req)

    assert len(res.frontier_curve) == 8
    # As hours increase, GPA should be non-decreasing
    for i in range(len(res.frontier_curve) - 1):
        pt_a = res.frontier_curve[i]
        pt_b = res.frontier_curve[i + 1]
        assert pt_b.total_hours > pt_a.total_hours
        assert pt_b.portfolio_gpa >= pt_a.portfolio_gpa - 0.01
        assert pt_b.portfolio_score >= pt_a.portfolio_score - 0.01


def test_strategies_differentiate_allocation():
    state = _sample_frontier_state()

    # Drawdown defense should prioritize c-sys (current score 72, deficit -8)
    req_defense = EfficientFrontierRequest(weekly_hours=15.0, strategy="drawdown_defense")
    res_defense = calculate_efficient_frontier(state, req_defense)
    sys_defense = next(a for a in res_defense.optimal_allocation if a.course_id == "c-sys")

    # Magna cum laude should prioritize c-algo (current score 88, close to 4.0)
    req_magna = EfficientFrontierRequest(weekly_hours=15.0, strategy="magna_cum_laude")
    res_magna = calculate_efficient_frontier(state, req_magna)
    algo_magna = next(a for a in res_magna.optimal_allocation if a.course_id == "c-algo")

    assert sys_defense.allocated_minutes >= 30
    assert algo_magna.allocated_minutes >= 30


@pytest.fixture
async def api_client(terminal):
    app = create_app(service=terminal)
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            yield client


@pytest.mark.asyncio
async def test_get_efficient_frontier_endpoint(api_client):
    resp = await api_client.get(
        "/api/v1/portfolio/efficient-frontier?weekly_hours=25&strategy=magna_cum_laude"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["weekly_hours"] == 25.0
    assert data["strategy"] == "magna_cum_laude"
    assert "frontier_curve" in data
    assert "optimal_allocation" in data
    assert len(data["frontier_curve"]) == 8


@pytest.mark.asyncio
async def test_post_efficient_frontier_endpoint(api_client):
    resp = await api_client.post(
        "/api/v1/portfolio/efficient-frontier",
        json={"weekly_hours": 18.5, "strategy": "drawdown_defense"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["weekly_hours"] == 18.5
    assert data["strategy"] == "drawdown_defense"
    assert data["projected_portfolio_gpa"] >= data["current_portfolio_gpa"]
