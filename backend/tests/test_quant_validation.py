"""Validate the mathematical output contracts used by the active quant engines."""

import math

import pytest
from pydantic import BaseModel, ValidationError

from backend.efficient_frontier import calculate_efficient_frontier
from backend.models import (
    AssignmentModel,
    CourseModel,
    EfficientFrontierRequest,
    EfficientFrontierResponse,
    FrontierCourseAllocation,
    FrontierPoint,
)
from backend.service import (
    AssignmentSensitivity,
    CourseSimulation,
    MonteCarloRequest,
    MonteCarloResponse,
    ScorePercentiles,
    TerminalService,
    _simulate_course,
)


@pytest.mark.parametrize(
    "model, payload",
    [
        (ScorePercentiles, dict(p10=90.0, p25=80.0, p50=70.0, p75=60.0, p90=50.0)),
        (ScorePercentiles, dict(p10=-1.0, p25=25.0, p50=50.0, p75=75.0, p90=90.0)),
        (ScorePercentiles, dict(p10=10.0, p25=25.0, p50=50.0, p75=75.0, p90=101.0)),
        (AssignmentSensitivity, dict(assignment_id="a", weight=25.0, marginal_impact=1.1)),
        (MonteCarloResponse, dict(iterations=0, courses=[])),
        *[
            (
                CourseSimulation,
                dict(
                    course_id="c",
                    target_score=90.0,
                    percentiles=None,
                    var_90=var,
                    probability_of_target=probability,
                    sensitivity_matrix=[],
                ),
            )
            for var, probability in [(-1.0, 0.5), (0.0, -0.1), (0.0, 1.1)]
        ],
        (
            FrontierPoint,
            dict(
                total_hours=20.0,
                portfolio_gpa=4.1,
                portfolio_score=90.0,
                portfolio_volatility=0.0,
                sharpe_ratio=0.0,
                course_allocations=[],
            ),
        ),
        (
            EfficientFrontierResponse,
            dict(
                weekly_hours=20.0,
                strategy="balanced",
                current_portfolio_gpa=3.0,
                projected_portfolio_gpa=3.0,
                gpa_delta=0.0,
                portfolio_volatility=-0.1,
                sharpe_ratio=0.0,
                frontier_curve=[],
                optimal_allocation=[],
            ),
        ),
        (
            FrontierCourseAllocation,
            dict(
                course_id="c",
                course_code="TEST",
                course_name="Test",
                current_score=80.0,
                target_score=90.0,
                allocated_minutes=-1,
                allocated_hours=0.0,
                projected_score=80.0,
                score_delta=0.0,
                marginal_gpa_yield=0.0,
                efficiency_rank=1,
                status="drawdown",
            ),
        ),
    ],
)
def test_quant_outputs_reject_invalid_domains(
    model: type[BaseModel], payload: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        model(**payload)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), "50", True])
def test_percentiles_reject_nonfinite_or_coerced_scores(value: object) -> None:
    with pytest.raises(ValidationError):
        ScorePercentiles(p10=value, p25=50.0, p50=50.0, p75=50.0, p90=50.0)


def test_percentiles_allow_deterministic_zero_variance() -> None:
    assert ScorePercentiles(p10=80.0, p25=80.0, p50=80.0, p75=80.0, p90=80.0).p50 == 80.0


def test_full_shocks_remove_floating_point_boundary_drift() -> None:
    course = CourseModel(id="c", course_code="TEST", name="Test", current_score=100.0)
    weights = [59.601137977349126, 47.68205680477281, 38.464293293576716]
    assignments = [
        AssignmentModel(id=str(i), course_id="c", course_code="TEST", title="Test", weight=w)
        for i, w in enumerate(weights)
    ]
    result = _simulate_course(
        course,
        assignments,
        MonteCarloRequest(shock_overrides={a.id: 100.0 for a in assignments}),
    )
    assert result.percentiles is not None
    assert set(result.percentiles.model_dump().values()) == {100.0}
    assert result.var_90 == 0.0
    assert result.probability_of_target == 1.0


async def test_identical_course_scores_have_finite_frontier(terminal: TerminalService) -> None:
    state = await terminal.state()
    for course in state.courses:
        course.current_score = 100.0
    result = calculate_efficient_frontier(state, EfficientFrontierRequest())
    assert result.portfolio_volatility == 0.0
    assert math.isfinite(result.sharpe_ratio)
    assert all(point.portfolio_volatility == 0.0 for point in result.frontier_curve)
    assert EfficientFrontierResponse.model_validate_json(result.model_dump_json()) == result
