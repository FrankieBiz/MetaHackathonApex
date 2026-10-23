"""RFC 5545 iCalendar generation for academic deliverables, study blocks, and office hours."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from .models import AssignmentModel, CourseModel, TerminalState


def format_ics_datetime(dt: datetime) -> str:
    """Format a datetime in RFC 5545 UTC compact format: YYYYMMDDTHHMMSSZ."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def parse_datetime_safe(value: str | datetime | None, default: datetime | None = None) -> datetime:
    """Parse an ISO datetime or return default."""
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value.strip():
        clean = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(clean)
            return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
        except (ValueError, TypeError):
            pass
    return default or datetime.now(UTC)


def escape_ics_text(text: str) -> str:
    """Escape backslashes, semicolons, commas, and newlines per RFC 5545 Section 3.3.11."""
    if not text:
        return ""
    # Backslashes first
    escaped = text.replace("\\", "\\\\")
    escaped = escaped.replace(";", r"\;")
    escaped = escaped.replace(",", r"\,")
    # Normalize CRLF and bare CR before escaping; text must never create content lines.
    escaped = escaped.replace("\r\n", "\n").replace("\r", "\n")
    escaped = escaped.replace("\n", r"\n")
    return escaped


def fold_ics_line(line: str, max_bytes: int = 75) -> str:
    """Fold lines longer than 75 octets per RFC 5545 Section 3.1.

    Continuation lines begin with a single whitespace character (space).
    """
    encoded = line.encode("utf-8")
    if len(encoded) <= max_bytes:
        return line

    chunks: list[str] = []
    current_line = ""
    current_bytes = 0
    limit = max_bytes

    for char in line:
        char_bytes = len(char.encode("utf-8"))
        if current_bytes + char_bytes > limit:
            chunks.append(current_line)
            current_line = " " + char
            current_bytes = 1 + char_bytes
            limit = max_bytes
        else:
            current_line += char
            current_bytes += char_bytes

    if current_line:
        chunks.append(current_line)

    return "\r\n".join(chunks)


def _rfc_priority(priority_rank: int, max_rank: int = 10) -> int:
    """Map Apex priority rank (1 to N) to RFC 5545 integer priority (1=highest, 9=lowest)."""
    if priority_rank <= 1:
        return 1
    if priority_rank <= 2:
        return 2
    if priority_rank <= 4:
        return 3
    if priority_rank <= 6:
        return 5
    if priority_rank <= 8:
        return 7
    return 9


def generate_ics_calendar(
    state: TerminalState,
    *,
    include_study_blocks: bool = True,
    include_alarms: bool = True,
    include_completed: bool = False,
    course_id: str | None = None,
    now: datetime | None = None,
) -> str:
    """Generate RFC 5545 compliant iCalendar string for the academic portfolio."""
    ref_now = now or datetime.now(UTC)
    dtstamp = format_ics_datetime(ref_now)

    course_lookup: dict[str, CourseModel] = {c.id: c for c in state.courses}

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Apex OS//Academic Terminal RFC5545//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Apex OS Academic Schedule",
        "X-WR-TIMEZONE:UTC",
    ]

    assignments = state.assignments
    if course_id is not None:
        assignments = [a for a in assignments if a.course_id == course_id]

    if not include_completed:
        assignments = [a for a in assignments if not a.graded]

    # Sort assignments by due date
    def sort_key(a: AssignmentModel) -> str:
        return a.due_at.isoformat() if a.due_at else "9999-12-31"

    sorted_assignments = sorted(assignments, key=sort_key)

    for rank_idx, assignment in enumerate(sorted_assignments, start=1):
        course = course_lookup.get(assignment.course_id)
        course_code = course.course_code if course else assignment.course_code
        course_name = course.name if course else course_code

        due_dt = parse_datetime_safe(assignment.due_at, ref_now + timedelta(days=7))
        # End 30 minutes after due or milestone
        start_dt = due_dt
        end_dt = due_dt + timedelta(minutes=30)

        dtstart = format_ics_datetime(start_dt)
        dtend = format_ics_datetime(end_dt)
        uid = f"apex-deadline-{assignment.id}@apex.terminal"

        priority = _rfc_priority(rank_idx)

        # Build detailed description
        score_desc = (
            f"{assignment.score:.1f}"
            if assignment.graded and assignment.score is not None
            else "Pending"
        )
        desc_parts = [
            f"Course: {course_code} - {course_name}",
            f"Weight: {assignment.weight}%",
            f"Points: {score_desc} / {assignment.points_possible}",
            f"Status: {assignment.status.upper()}",
            f"Priority Rank: #{rank_idx}",
        ]
        if course and course.portfolio_margin is not None and course.current_score is not None:
            desc_parts.append(
                f"Course Margin: {course.portfolio_margin:+.1f}% "
                f"(Current: {course.current_score:.1f}%, Target: {course.target_score:.1f}%)"
            )

        if assignment.subtasks:
            desc_parts.append("\nRubric Subtasks:")
            for st in assignment.subtasks:
                marker = "[x]" if st.is_completed else "[ ]"
                desc_parts.append(f"  {marker} {st.title} ({st.estimated_minutes}m)")

        desc_text = escape_ics_text("\n".join(desc_parts))
        summary = escape_ics_text(f"[{course_code}] {assignment.title} ({assignment.weight}%)")

        event_lines = [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART:{dtstart}",
            f"DTEND:{dtend}",
            f"SUMMARY:{summary}",
            f"DESCRIPTION:{desc_text}",
            f"CATEGORIES:ACADEMIC,DEADLINE,{course_code}",
            f"PRIORITY:{priority}",
            "STATUS:CONFIRMED",
        ]

        if include_alarms:
            # 24 hour alarm
            clean_title = escape_ics_text(assignment.title)
            event_lines.extend(
                [
                    "BEGIN:VALARM",
                    "TRIGGER:-P1D",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:Apex 24h Warning: [{course_code}] {clean_title}",
                    "END:VALARM",
                    "BEGIN:VALARM",
                    "TRIGGER:-PT2H",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:Apex 2h Urgent Warning: [{course_code}] {clean_title}",
                    "END:VALARM",
                ]
            )

        event_lines.append("END:VEVENT")
        lines.extend(event_lines)

        # Intelligent Focus Study Blocks
        if include_study_blocks and not assignment.graded and assignment.subtasks:
            incomplete_tasks = [st for st in assignment.subtasks if not st.is_completed]
            if incomplete_tasks:
                # Distribute study sessions on the days leading up to due_dt
                for task_idx, subtask in enumerate(incomplete_tasks, start=1):
                    # Spread blocks backward from deadline: 1-3 days prior, 18:00 UTC
                    days_prior = min(3, max(1, len(incomplete_tasks) - task_idx + 1))
                    study_start = (due_dt - timedelta(days=days_prior)).replace(
                        hour=18, minute=0, second=0, microsecond=0
                    )
                    # If study_start is in the past, bump to tomorrow 18:00 or now + 1h
                    if study_start < ref_now:
                        study_start = (ref_now + timedelta(days=1)).replace(
                            hour=18, minute=0, second=0, microsecond=0
                        )
                    # Offset subsequent tasks by index
                    study_start += timedelta(minutes=(task_idx - 1) * 45)
                    duration_min = max(25, subtask.estimated_minutes)
                    study_end = study_start + timedelta(minutes=duration_min)

                    s_uid = f"apex-focus-{assignment.id}-{subtask.id}@apex.terminal"
                    s_summary = escape_ics_text(f"[FOCUS] {course_code}: {subtask.title}")
                    s_desc = escape_ics_text(
                        f"Targeted study block for {assignment.title}\n"
                        f"Estimated: {subtask.estimated_minutes}m\n"
                        f"Course: {course_name}"
                    )

                    study_lines = [
                        "BEGIN:VEVENT",
                        f"UID:{s_uid}",
                        f"DTSTAMP:{dtstamp}",
                        f"DTSTART:{format_ics_datetime(study_start)}",
                        f"DTEND:{format_ics_datetime(study_end)}",
                        f"SUMMARY:{s_summary}",
                        f"DESCRIPTION:{s_desc}",
                        f"CATEGORIES:STUDY,FOCUS,{course_code}",
                        "PRIORITY:3",
                        "STATUS:CONFIRMED",
                    ]

                    if include_alarms:
                        study_lines.extend(
                            [
                                "BEGIN:VALARM",
                                "TRIGGER:-PT15M",
                                "ACTION:DISPLAY",
                                f"DESCRIPTION:Study Focus Session Starting: {s_summary}",
                                "END:VALARM",
                            ]
                        )

                    study_lines.append("END:VEVENT")
                    lines.extend(study_lines)

    # Include Upcoming Events (Office hours, exams, etc.)
    events = state.upcoming_events
    if course_id is not None:
        events = [e for e in events if e.course_id == course_id]

    for ev in events:
        course = course_lookup.get(ev.course_id or "")
        code = course.course_code if course else "CAMPUS"
        start_ev = parse_datetime_safe(ev.start_at, ref_now + timedelta(days=2))
        end_ev = parse_datetime_safe(ev.end_at, start_ev + timedelta(hours=1))

        ev_uid = f"apex-event-{ev.id}@apex.terminal"
        ev_summary = escape_ics_text(f"[{code}] {ev.title}")
        ev_desc = escape_ics_text(f"Event: {ev.title}\nCourse: {code}")

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{ev_uid}",
                f"DTSTAMP:{dtstamp}",
                f"DTSTART:{format_ics_datetime(start_ev)}",
                f"DTEND:{format_ics_datetime(end_ev)}",
                f"SUMMARY:{ev_summary}",
                f"DESCRIPTION:{ev_desc}",
                f"CATEGORIES:EVENT,{code}",
                "PRIORITY:5",
                "STATUS:CONFIRMED",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")

    # Apply RFC 5545 line folding and CRLF joining
    folded_lines = [fold_ics_line(line) for line in lines]
    return "\r\n".join(folded_lines) + "\r\n"
