"""Regression coverage for untrusted Canvas data, calendar text, and frontier edges."""

import json
import math
from datetime import UTC, datetime

import httpx
import pytest

from backend import efficient_frontier
from backend.calendar_export import escape_ics_text, generate_ics_calendar
from backend.canvas_client import CanvasClient, parse_date
from backend.efficient_frontier import calculate_efficient_frontier
from backend.models import (
    CourseModel,
    EfficientFrontierRequest,
    EfficientFrontierResponse,
    FrontierCourseAllocation,
    SubTaskNode,
    TerminalMetrics,
    TerminalState,
    UpcomingEvent,
)

from .conftest import settings


def _state(scores: tuple[float, ...] = (82.0,)) -> TerminalState:
    return TerminalState(
        courses=[
            CourseModel(id=str(i), course_code=f"CS-{i}", name="Systems", current_score=score)
            for i, score in enumerate(scores)
        ],
        assignments=[],
        study_recommendations=[],
        upcoming_events=[],
        metrics=TerminalMetrics(
            completion_velocity=0.0,
            assignment_volatility=0.0,
            total_budgeted_minutes=0,
            total_actual_minutes=0,
            last_synced_at="2026-10-23T12:00:00Z",
            demo_mode=True,
        ),
    )


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        " ",
        "not-a-date",
        "2026-02-30T12:00:00Z",
        "2026-13-01T12:00:00Z",
        "2026-10-23T25:00:00Z",
        "2026-10-23T12:00:00+25:00",
        "2026-10-23",
        "2026-10-23T12:00:00",
        "10000-01-01T00:00:00Z",
        "0001-01-01T00:00:00+14:00",
        "9999-12-31T23:59:59-14:00",
    ],
)
def test_malformed_canvas_dates_return_none(value: str | None) -> None:
    assert parse_date(value) is None


@pytest.mark.parametrize("error", [ValueError, TypeError, OverflowError])
def test_canvas_date_parser_failures_return_none(
    monkeypatch: pytest.MonkeyPatch, error: type[Exception]
) -> None:
    class InvalidDatetime(datetime):
        @classmethod
        def fromisoformat(cls, date_string: str, /) -> datetime:
            raise error("Malformed Canvas timestamp")

    monkeypatch.setattr("backend.canvas_client.datetime", InvalidDatetime)
    assert parse_date("2026-10-23T12:00:00Z") is None


@pytest.mark.parametrize(
    "value",
    ["2026-10-23T12:00:00Z", "2026-10-23T08:00:00-04:00", "2026-10-23T14:00:00+02:00"],
)
def test_valid_canvas_dates_are_normalized_to_utc(value: str) -> None:
    assert parse_date(value) == datetime(2026, 10, 23, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("points", "expected"),
    [(-100.0, 0.0), (-0.01, 0.0), ("-25", 0.0), (None, 0.0), (0.0, 0.0), ("25.5", 25.5)],
)
def test_canvas_assignment_clamps_negative_points(
    points: float | str | None, expected: float
) -> None:
    assignment = CanvasClient._assignment(
        {"id": 1, "name": "HW1", "points_possible": points}, _state().courses[0]
    )
    assert assignment.points_possible == expected


async def test_malformed_canvas_rows_preserve_live_sync() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/courses":
            return httpx.Response(200, json=[{"id": "0", "name": "Systems"}])
        if request.url.path.endswith("/assignments"):
            return httpx.Response(
                200,
                json=[
                    {"id": 1, "name": "HW1", "due_at": "bad-date", "points_possible": -10},
                    {"id": 2, "name": "HW2", "points_possible": 100},
                ],
            )
        return httpx.Response(
            200,
            json=[
                {
                    "id": "event-1",
                    "title": "Office Hours",
                    "context_code": "course_0",
                    "start_at": "9999-12-31T23:59:59-14:00",
                    "end_at": "invalid",
                }
            ],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = CanvasClient(settings(demo_mode=False, canvas_api_token="fake"), http)
        snapshot = await client.sync()

    assert snapshot.demo_mode is False
    assert snapshot.assignments[0].due_at is None
    assert snapshot.assignments[0].points_possible == 0.0
    assert [a.weight for a in snapshot.assignments] == [0.0, 100.0]
    assert snapshot.upcoming_events[0].start_at is None
    assert snapshot.upcoming_events[0].end_at is None


@pytest.mark.parametrize("line_break", ["\n", "\r", "\r\n", "\n\r", "\r\n\r\n"])
def test_calendar_text_neutralizes_crlf_injection(line_break: str) -> None:
    payload = f"HW1{line_break}ATTENDEE:evil@x.com"
    escaped = escape_ics_text(payload)
    expected_breaks = line_break.replace("\r\n", "\n").replace("\r", "\n").count("\n")
    assert escaped == "HW1" + r"\n" * expected_breaks + "ATTENDEE:evil@x.com"
    assert "\r" not in escaped
    assert "\n" not in escaped


def test_calendar_text_preserves_literal_escapes_and_punctuation() -> None:
    assert escape_ics_text("HW1\\n;review,\r\nNext") == r"HW1\\n\;review\,\nNext"


@pytest.mark.parametrize("line_break", ["\n", "\r", "\r\n"])
def test_calendar_export_keeps_injection_inside_text_properties(line_break: str) -> None:
    state = _state()
    payload = f"HW1{line_break}ATTENDEE:evil@x.com{line_break}BEGIN:VEVENT"
    state.courses[0].name = payload
    assignment = CanvasClient._assignment({"id": 1, "name": payload}, state.courses[0])
    assignment.subtasks = [
        SubTaskNode(id="task-1", assignment_id="1", title=payload, estimated_minutes=30)
    ]
    state.assignments = [assignment]
    state.upcoming_events = [UpcomingEvent(id="event-1", title=payload, course_id="0")]

    calendar = generate_ics_calendar(state, now=datetime(2026, 10, 23, 12, 0, tzinfo=UTC))
    # Unfold legitimate RFC 5545 continuation lines before checking content properties.
    unfolded = calendar.replace("\r\n ", "")
    lines = unfolded.split("\r\n")
    assert "\r" not in calendar.replace("\r\n", "")
    assert "\n" not in calendar.replace("\r\n", "")
    assert not any(line.startswith("ATTENDEE:") for line in lines)
    assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 3
    assert sum(line.startswith("BEGIN:VALARM") for line in lines) == 3
    assert escape_ics_text(payload) in unfolded


def _assert_finite_floats(value: object) -> None:
    if isinstance(value, float):
        assert math.isfinite(value)
    elif isinstance(value, dict):
        for nested in value.values():
            _assert_finite_floats(nested)
    elif isinstance(value, list):
        for nested in value:
            _assert_finite_floats(nested)


@pytest.mark.parametrize(
    "scores", [(), (82.0,), (100.0,), (100.0, 100.0, 100.0), (0.0, 50.0, 100.0)]
)
@pytest.mark.parametrize("weekly_hours", [1.0, 20.0, 80.0])
@pytest.mark.parametrize("strategy", ["balanced", "magna_cum_laude", "drawdown_defense"])
def test_frontier_edge_portfolios_return_only_finite_floats(
    scores: tuple[float, ...], weekly_hours: float, strategy: str
) -> None:
    request = EfficientFrontierRequest.model_validate(
        {"weekly_hours": weekly_hours, "strategy": strategy}
    )
    result = calculate_efficient_frontier(_state(scores), request)
    payload = result.model_dump()
    _assert_finite_floats(payload)
    json.dumps(payload, allow_nan=False)
    assert EfficientFrontierResponse.model_validate_json(result.model_dump_json()) == result
    assert len(result.frontier_curve) == (8 if scores else 0)
    if scores:
        assert sum(a.allocated_minutes for a in result.optimal_allocation) == int(weekly_hours * 60)
        for point in result.frontier_curve:
            assert sum(a.allocated_minutes for a in point.course_allocations) == int(
                point.total_hours * 60
            )
    if scores and all(score == 100.0 for score in scores):
        assert result.current_portfolio_gpa == result.projected_portfolio_gpa == 4.0
        assert result.gpa_delta == 0.0
        assert all(a.score_delta == 0.0 for a in result.optimal_allocation)
        assert all(p.portfolio_score == 100.0 for p in result.frontier_curve)
        if len(scores) > 1:
            assert result.portfolio_volatility == 0.0
            assert all(p.portfolio_volatility == 0.0 for p in result.frontier_curve)


def test_frontier_empty_allocations_do_not_divide_by_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_allocations(
        courses: list[CourseModel], state: TerminalState, total_minutes: int, strategy: str
    ) -> list[FrontierCourseAllocation]:
        return []

    monkeypatch.setattr(efficient_frontier, "_optimize_allocation", no_allocations)
    result = calculate_efficient_frontier(_state(), EfficientFrontierRequest())
    assert all(point.portfolio_score == 0.0 for point in result.frontier_curve)
    _assert_finite_floats(result.model_dump())


@pytest.mark.parametrize("invalid", [math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("failure_call", [1, 2])
def test_frontier_rejects_nonfinite_calculations_before_returning(
    monkeypatch: pytest.MonkeyPatch, invalid: float, failure_call: int
) -> None:
    original_pstdev = efficient_frontier.pstdev
    calls = 0

    def invalid_dispersion(scores: list[float]) -> float:
        nonlocal calls
        calls += 1
        return invalid if calls == failure_call else original_pstdev(scores)

    monkeypatch.setattr(efficient_frontier, "pstdev", invalid_dispersion)
    with pytest.raises(ValueError, match="non-finite"):
        calculate_efficient_frontier(_state((82.0, 100.0)), EfficientFrontierRequest())
