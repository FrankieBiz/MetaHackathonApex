"""Test RFC 5545 iCalendar generation and portfolio calendar API endpoints."""

from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from backend.calendar_export import (
    escape_ics_text,
    fold_ics_line,
    format_ics_datetime,
    generate_ics_calendar,
)
from backend.main import create_app
from backend.models import (
    AssignmentModel,
    CourseModel,
    SubTaskNode,
    TerminalMetrics,
    TerminalState,
    UpcomingEvent,
)


def _sample_terminal_state() -> TerminalState:
    course_a = CourseModel(
        id="c-algo",
        course_code="CS-101",
        name="Algorithms & Data Structures",
        current_score=88.5,
        target_score=90.0,
    )
    course_b = CourseModel(
        id="c-sys",
        course_code="EE-200",
        name="Computer Systems Architecture",
        current_score=94.0,
        target_score=85.0,
    )

    assign_1 = AssignmentModel(
        id="a-graph",
        course_id="c-algo",
        course_code="CS-101",
        title="Dijkstra Shortest Path Lab",
        due_at=datetime(2026, 11, 15, 23, 59, tzinfo=UTC),
        points_possible=100.0,
        weight=15.0,
        status="in_progress",
        graded=False,
        subtasks=[
            SubTaskNode(
                id="st-1",
                assignment_id="a-graph",
                title="Implement Fibonacci Heap",
                estimated_minutes=35,
                is_completed=False,
            ),
            SubTaskNode(
                id="st-2",
                assignment_id="a-graph",
                title="Run Benchmark Suite",
                estimated_minutes=25,
                is_completed=True,
            ),
        ],
    )
    assign_2 = AssignmentModel(
        id="a-cache",
        course_id="c-sys",
        course_code="EE-200",
        title="Cache Coherence Simulator",
        due_at=datetime(2026, 11, 20, 20, 0, tzinfo=UTC),
        points_possible=50.0,
        weight=10.0,
        status="completed",
        score=48.0,
        graded=True,
        subtasks=[],
    )

    event_1 = UpcomingEvent(
        id="ev-midterm",
        title="Algorithms Midterm Review Session",
        course_id="c-algo",
        start_at=datetime(2026, 11, 14, 16, 0, tzinfo=UTC),
        end_at=datetime(2026, 11, 14, 18, 0, tzinfo=UTC),
    )

    metrics = TerminalMetrics(
        completion_velocity=1.2,
        assignment_volatility=0.8,
        total_budgeted_minutes=60,
        total_actual_minutes=25,
        last_synced_at="2026-10-22T10:00:00Z",
        demo_mode=True,
    )

    return TerminalState(
        courses=[course_a, course_b],
        assignments=[assign_1, assign_2],
        study_recommendations=[],
        metrics=metrics,
        upcoming_events=[event_1],
    )


def test_format_ics_datetime():
    dt = datetime(2026, 10, 22, 14, 30, 45, tzinfo=UTC)
    assert format_ics_datetime(dt) == "20261022T143045Z"

    # Naive assumed UTC
    naive = datetime(2026, 5, 1, 9, 0, 0)
    assert format_ics_datetime(naive) == "20260501T090000Z"


def test_escape_ics_text():
    raw = r"Note: High, priority; review \ chapters & next line" + "\nSecond line"
    escaped = escape_ics_text(raw)
    assert r"\," in escaped
    assert r"\;" in escaped
    assert r"\\" in escaped
    assert r"\n" in escaped
    assert "\n" not in escaped


def test_fold_ics_line():
    short = "SUMMARY:Short subject"
    assert fold_ics_line(short) == short

    long_line = "DESCRIPTION:" + "X" * 150
    folded = fold_ics_line(long_line)
    lines = folded.split("\r\n")
    assert len(lines) >= 3
    for continuation in lines[1:]:
        assert continuation.startswith(" ")


def test_generate_ics_calendar_structure():
    state = _sample_terminal_state()
    ref_time = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)
    ics = generate_ics_calendar(state, now=ref_time)

    assert ics.startswith("BEGIN:VCALENDAR\r\n")
    assert ics.endswith("END:VCALENDAR\r\n")
    assert "VERSION:2.0" in ics
    assert "PRODID:-//Apex OS//Academic Terminal RFC5545//EN" in ics
    assert "CALSCALE:GREGORIAN" in ics
    assert "METHOD:PUBLISH" in ics
    assert "X-WR-CALNAME:Apex OS Academic Schedule" in ics


def test_generate_ics_deadlines_and_alarms():
    state = _sample_terminal_state()
    ics = generate_ics_calendar(state, include_alarms=True, include_completed=False)

    # a-graph is open and should be in the output
    assert "UID:apex-deadline-a-graph@apex.terminal" in ics
    assert "[CS-101] Dijkstra Shortest Path Lab (15.0%)" in ics
    assert "CATEGORIES:ACADEMIC,DEADLINE,CS-101" in ics
    assert "STATUS:CONFIRMED" in ics

    # 24h and 2h alarms present
    assert "TRIGGER:-P1D" in ics
    assert "TRIGGER:-PT2H" in ics
    assert "ACTION:DISPLAY" in ics

    # Completed assignment a-cache excluded by default
    assert "UID:apex-deadline-a-cache@apex.terminal" not in ics


def test_generate_ics_include_completed():
    state = _sample_terminal_state()
    ics = generate_ics_calendar(state, include_completed=True)
    assert "UID:apex-deadline-a-cache@apex.terminal" in ics
    assert "[EE-200] Cache Coherence Simulator (10.0%)" in ics


def test_generate_ics_study_blocks():
    state = _sample_terminal_state()
    ics = generate_ics_calendar(state, include_study_blocks=True)

    # Incomplete subtask st-1 should generate a focus block
    assert "UID:apex-focus-a-graph-st-1@apex.terminal" in ics
    assert "[FOCUS] CS-101: Implement Fibonacci Heap" in ics
    assert "CATEGORIES:STUDY,FOCUS,CS-101" in ics

    # Completed subtask st-2 should not generate a focus block
    assert "apex-focus-a-graph-st-2" not in ics

    # When disabled
    ics_no_study = generate_ics_calendar(state, include_study_blocks=False)
    assert "[FOCUS]" not in ics_no_study


def test_generate_ics_course_filter():
    state = _sample_terminal_state()
    # Filter only EE-200
    ics = generate_ics_calendar(state, course_id="c-sys", include_completed=True)
    assert "EE-200" in ics
    assert "CS-101" not in ics


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
async def test_get_calendar_ics_endpoint(api_client):
    resp = await api_client.get("/api/v1/portfolio/calendar.ics")
    assert resp.status_code == 200
    assert "text/calendar" in resp.headers["content-type"]
    assert 'filename="apex-academic-schedule.ics"' in resp.headers["content-disposition"]
    assert "BEGIN:VCALENDAR" in resp.text
    assert "END:VCALENDAR" in resp.text


@pytest.mark.asyncio
async def test_post_calendar_ics_endpoint(api_client):
    resp = await api_client.post(
        "/api/v1/portfolio/calendar.ics",
        json={
            "include_study_blocks": True,
            "include_alarms": True,
            "include_completed": True,
            "course_id": None,
        },
    )
    assert resp.status_code == 200
    assert "text/calendar" in resp.headers["content-type"]
    assert "BEGIN:VCALENDAR" in resp.text
    assert "END:VCALENDAR" in resp.text
