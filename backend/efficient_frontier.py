"""Academic Efficient Frontier (Markowitz Analog & Pareto Study Optimizer)."""

from __future__ import annotations

import math
from statistics import pstdev

from .models import (
    CourseModel,
    EfficientFrontierRequest,
    EfficientFrontierResponse,
    FrontierCourseAllocation,
    FrontierPoint,
    TerminalState,
)


def score_to_gpa(score: float) -> float:
    """Map percentage score to 4.0 academic scale."""
    if score >= 93.0:
        return 4.0
    if score >= 90.0:
        return 3.7
    if score >= 87.0:
        return 3.3
    if score >= 83.0:
        return 3.0
    if score >= 80.0:
        return 2.7
    if score >= 77.0:
        return 2.3
    if score >= 73.0:
        return 2.0
    if score >= 70.0:
        return 1.7
    if score >= 67.0:
        return 1.3
    if score >= 65.0:
        return 1.0
    return max(0.0, round(score / 65.0, 2))


def _course_remaining_weight(course_id: str, state: TerminalState) -> float:
    """Calculate the remaining open/ungraded assignment weight fraction (0.0 to 1.0)."""
    own_assignments = [a for a in state.assignments if a.course_id == course_id]
    if not own_assignments:
        return 0.35
    open_weight = sum(a.weight for a in own_assignments if not a.graded)
    total_weight = sum(a.weight for a in own_assignments)
    if total_weight <= 0:
        return 0.35
    return max(0.1, min(1.0, open_weight / total_weight))


def _score_delta(minutes: float, base_score: float, rem_weight: float, urgency: float) -> float:
    """Diminishing returns production function for study minutes."""
    # Delta(m) = max(0, 100 - s) * (1 - exp(-u*m/tau)), tau = max(180, 900*r).
    # For m >= 0 and u > 0, Delta'(m) >= 0 and Delta''(m) <= 0 before rounding.
    capacity = max(0.0, 100.0 - base_score)
    tau = max(180.0, rem_weight * 900.0)
    exponent = -(urgency * minutes) / tau
    return round(capacity * (1.0 - math.exp(exponent)), 2)


def _optimize_allocation(
    courses: list[CourseModel],
    state: TerminalState,
    total_minutes: int,
    strategy: str,
) -> list[FrontierCourseAllocation]:
    """Solve the constrained study allocation problem via discrete marginal gradient steps."""
    # Greedily approximate max sum_i(c_i * GPA(s_i + Delta_i(m_i))) / sum_i(c_i)
    # with m_i >= 0 and sum_i(m_i) = total_minutes, using 15-minute increments.
    # The stepwise GPA map makes this objective nonconcave despite concave Delta_i;
    # these are heuristic allocations, without a global Pareto-optimality guarantee.
    # No covariance matrix, matrix inverse, or SLSQP solver is used in this allocator.
    if not courses:
        return []

    # Course parameter vectors
    n = len(courses)
    course_data = []
    for c in courses:
        curr_score = c.current_score if c.current_score is not None else 82.0
        rem_weight = _course_remaining_weight(c.id, state)

        # Baseline credit hours (default 3.0)
        credits = 3.0
        margin = curr_score - c.target_score

        # Strategy urgency multiplier
        if strategy == "magna_cum_laude":
            # Extra urgency for courses close to 4.0 threshold (90-93)
            urgency = 1.3 if curr_score >= 87.0 else 0.9
        elif strategy == "drawdown_defense":
            # High urgency for negative margin courses
            urgency = 1.6 if margin < 0 else 0.8
        else:  # balanced
            urgency = 1.1 if margin < 0 else 1.0

        course_data.append(
            {
                "course": c,
                "current_score": curr_score,
                "target_score": c.target_score,
                "credits": credits,
                "rem_weight": rem_weight,
                "urgency": urgency,
                "allocated_minutes": 0,
            }
        )

    # Minimum maintenance allocation: 30 minutes per course
    min_alloc = 30
    if total_minutes >= min_alloc * n:
        for cd in course_data:
            cd["allocated_minutes"] = min_alloc
        remaining_minutes = total_minutes - (min_alloc * n)
    else:
        even_share = total_minutes // n
        for cd in course_data:
            cd["allocated_minutes"] = even_share
        remaining_minutes = total_minutes % n

    # Step size for marginal gradient allocation
    step = 15
    while remaining_minutes >= step:
        best_idx = 0
        best_marginal_gain = -1.0

        for idx, cd in enumerate(course_data):
            m_curr = cd["allocated_minutes"]
            s_curr = cd["current_score"] + _score_delta(
                m_curr, cd["current_score"], cd["rem_weight"], cd["urgency"]
            )
            s_next = cd["current_score"] + _score_delta(
                m_curr + step, cd["current_score"], cd["rem_weight"], cd["urgency"]
            )

            gpa_curr = score_to_gpa(s_curr)
            gpa_next = score_to_gpa(s_next)
            credit_weighted_delta = (gpa_next - gpa_curr) * cd["credits"]

            # Add tie-breaking continuous score delta
            marginal = credit_weighted_delta + (s_next - s_curr) * 0.01

            if marginal > best_marginal_gain:
                best_marginal_gain = marginal
                best_idx = idx

        course_data[best_idx]["allocated_minutes"] += step
        remaining_minutes -= step

    # If any remainder minutes, give to best course
    if remaining_minutes > 0:
        course_data[0]["allocated_minutes"] += remaining_minutes

    total_credits = sum(cd["credits"] for cd in course_data) or 1.0

    allocations: list[FrontierCourseAllocation] = []
    for cd in course_data:
        c = cd["course"]
        m = cd["allocated_minutes"]
        score_gain = _score_delta(m, cd["current_score"], cd["rem_weight"], cd["urgency"])
        proj_score = min(100.0, cd["current_score"] + score_gain)

        # Marginal return of 1 additional hour (60 min)
        score_gain_plus_60 = _score_delta(
            m + 60, cd["current_score"], cd["rem_weight"], cd["urgency"]
        )
        proj_score_plus_60 = min(100.0, cd["current_score"] + score_gain_plus_60)
        marginal_gpa_yield = round(
            (score_to_gpa(proj_score_plus_60) - score_to_gpa(proj_score))
            * (cd["credits"] / total_credits),
            3,
        )

        margin = proj_score - c.target_score
        status = "healthy" if margin >= 0 else ("drawdown" if proj_score >= 65.0 else "critical")

        allocations.append(
            FrontierCourseAllocation(
                course_id=c.id,
                course_code=c.course_code,
                course_name=c.name,
                current_score=round(cd["current_score"], 1),
                target_score=round(c.target_score, 1),
                credit_hours=cd["credits"],
                allocated_minutes=m,
                allocated_hours=round(m / 60.0, 1),
                projected_score=round(proj_score, 1),
                score_delta=round(score_gain, 1),
                marginal_gpa_yield=marginal_gpa_yield,
                efficiency_rank=1,  # Computed below
                status=status,
            )
        )

    # Sort allocations by marginal yield descending to assign efficiency ranks
    allocations.sort(key=lambda a: (a.marginal_gpa_yield, a.score_delta), reverse=True)
    for rank, alloc in enumerate(allocations, start=1):
        alloc.efficiency_rank = rank

    return allocations


def calculate_efficient_frontier(
    state: TerminalState,
    request: EfficientFrontierRequest,
) -> EfficientFrontierResponse:
    """Calculate the Pareto-optimal study distribution and efficient frontier curve."""
    courses = state.courses
    if not courses:
        return EfficientFrontierResponse(
            weekly_hours=request.weekly_hours,
            strategy=request.strategy,
            current_portfolio_gpa=0.0,
            projected_portfolio_gpa=0.0,
            gpa_delta=0.0,
            portfolio_volatility=0.0,
            sharpe_ratio=0.0,
            frontier_curve=[],
            optimal_allocation=[],
        )

    total_credits = sum(3.0 for _ in courses)
    current_gpas = [
        score_to_gpa(c.current_score if c.current_score is not None else 82.0) for c in courses
    ]
    curr_portfolio_gpa = round(sum(g * 3.0 for g in current_gpas) / total_credits, 2)

    # Compute optimal allocation for the requested budget
    total_minutes = int(request.weekly_hours * 60)
    optimal_allocations = _optimize_allocation(courses, state, total_minutes, request.strategy)

    proj_gpas = [score_to_gpa(a.projected_score) for a in optimal_allocations]
    proj_portfolio_gpa = round(
        sum(g * a.credit_hours for g, a in zip(proj_gpas, optimal_allocations, strict=True))
        / total_credits,
        2,
    )
    gpa_delta = round(proj_portfolio_gpa - curr_portfolio_gpa, 2)

    # Calculate portfolio volatility
    # Academic risk proxy: population standard deviation of projected course scores
    # divided by 100, rather than time-series portfolio risk sqrt(w^T * Sigma * w).
    # Sharpe-style proxy = (projected GPA - 2.0) / max(0.01, score dispersion).
    # GPA and normalized score dispersion have different units; this is not a
    # financial Sharpe estimate. The 0.01 floor bounds the zero-dispersion case.
    scores = [a.projected_score for a in optimal_allocations]
    volatility = round(pstdev(scores) / 100.0, 3) if len(scores) > 1 else 0.05
    sharpe = round((proj_portfolio_gpa - 2.0) / max(0.01, volatility), 2)

    # Generate benchmark points along the efficient frontier curve (5h to 40h)
    benchmark_hours = [5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0]
    curve_points: list[FrontierPoint] = []

    for bh in benchmark_hours:
        b_minutes = int(bh * 60)
        b_allocs = _optimize_allocation(courses, state, b_minutes, request.strategy)
        b_gpas = [score_to_gpa(a.projected_score) for a in b_allocs]
        b_pt_gpa = round(
            sum(g * a.credit_hours for g, a in zip(b_gpas, b_allocs, strict=True)) / total_credits,
            2,
        )
        b_pt_score = round(sum(a.projected_score for a in b_allocs) / len(b_allocs), 1)
        b_scores = [a.projected_score for a in b_allocs]
        b_vol = round(pstdev(b_scores) / 100.0, 3) if len(b_scores) > 1 else 0.05
        b_sharpe = round((b_pt_gpa - 2.0) / max(0.01, b_vol), 2)

        curve_points.append(
            FrontierPoint(
                total_hours=bh,
                portfolio_gpa=b_pt_gpa,
                portfolio_score=b_pt_score,
                portfolio_volatility=b_vol,
                sharpe_ratio=b_sharpe,
                course_allocations=b_allocs,
            )
        )

    return EfficientFrontierResponse(
        weekly_hours=request.weekly_hours,
        strategy=request.strategy,
        current_portfolio_gpa=curr_portfolio_gpa,
        projected_portfolio_gpa=proj_portfolio_gpa,
        gpa_delta=gpa_delta,
        portfolio_volatility=volatility,
        sharpe_ratio=sharpe,
        frontier_curve=curve_points,
        optimal_allocation=optimal_allocations,
    )
