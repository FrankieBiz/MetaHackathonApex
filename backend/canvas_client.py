"""Bounded, paginated Canvas reads with a ten-minute sandbox-aware cache."""

import asyncio
import copy
import logging
import math
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any

import httpx

from .config import Settings
from .mock_data import build_mock_dataset
from .models import AssignmentModel, CourseModel, UpcomingEvent

logger = logging.getLogger(__name__)
CACHE_TTL_SECONDS = 600


class _PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("br", "p", "div", "li") and not self.hidden:
            self.parts.append("\n")
        if tag == "a" and not self.hidden:
            href = dict(attrs).get("href", "") or ""
            if ".pdf" in href.lower():
                self.parts.append(f" {href} ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def plain_text(value: str | None) -> str:
    parser = _PlainText()
    parser.feed(value or "")
    return "".join(parser.parts).strip()[:100_000]


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Canvas returned a timestamp without a timezone")
    return parsed.astimezone(UTC)


@dataclass
class CanvasSnapshot:
    courses: list[CourseModel]
    assignments: list[AssignmentModel]
    upcoming_events: list[UpcomingEvent]
    demo_mode: bool
    synced_at: datetime


def get_mock_sandbox_data(now: datetime | None = None) -> CanvasSnapshot:
    """Dates roll forward at refresh; IDs remain stable so progress survives sync."""
    now = now or datetime.now(UTC)
    courses, assignments, events = build_mock_dataset(now)
    return CanvasSnapshot(courses, assignments, events, True, now)


class CanvasClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client or httpx.AsyncClient(timeout=10, follow_redirects=False)
        self._owns_client = client is None
        self._cache: CanvasSnapshot | None = None
        self._cached_at = 0.0
        self._lock = asyncio.Lock()
        self.last_sync_timestamp: datetime | None = None

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def sync(self, *, force: bool = False) -> CanvasSnapshot:
        async with self._lock:
            if self._cache and not force and time.monotonic() - self._cached_at < CACHE_TTL_SECONDS:
                return copy.deepcopy(self._cache)
            if self.settings.demo_mode:
                snapshot = get_mock_sandbox_data()
            else:
                try:
                    async with asyncio.timeout(25):
                        snapshot = await self._fetch_live()
                except (
                    httpx.HTTPError,
                    ValueError,
                    KeyError,
                    TypeError,
                    AttributeError,
                    TimeoutError,
                ) as exc:
                    # Exception messages can contain token-bearing pagination URLs.
                    logger.warning("Canvas sync failed (%s); using sandbox", type(exc).__name__)
                    snapshot = get_mock_sandbox_data()
            self._cache = snapshot
            self._cached_at = time.monotonic()
            self.last_sync_timestamp = snapshot.synced_at
            return copy.deepcopy(snapshot)

    async def _pages(self, path: str) -> list[dict[str, Any]]:
        origin = httpx.URL(self.settings.canvas_api_url)
        url = origin.join(path)
        items = []
        visited = set()
        for _ in range(20):
            if (
                (url.scheme, url.host, url.port) != (origin.scheme, origin.host, origin.port)
                or url.username
                or url.password
                or not url.path.startswith("/api/v1/")
                or str(url) in visited
            ):
                raise ValueError("Invalid Canvas pagination target")
            visited.add(str(url))
            # A slow page fails the whole sync over to the simulation desk.
            async with asyncio.timeout(self.settings.canvas_timeout_seconds):
                response = await self.client.get(
                    url,
                    headers={
                        # IDs as strings: 64-bit Canvas IDs lose precision as JS numbers.
                        "Accept": "application/json+canvas-string-ids",
                        "Authorization": (
                            f"Bearer {self.settings.canvas_api_token.get_secret_value()}"
                        ),
                    },
                )
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError(f"Canvas answered HTTP {response.status_code}")
            data = response.json()
            if not isinstance(data, list) or any(not isinstance(item, dict) for item in data):
                raise ValueError("Invalid Canvas page")
            items.extend(data)
            if len(items) > 10_000:
                raise ValueError("Canvas item limit exceeded")
            next_url = response.links.get("next", {}).get("url")
            if not next_url:
                return items
            url = url.join(next_url)
        raise ValueError("Canvas page limit exceeded")

    async def _fetch_live(self) -> CanvasSnapshot:
        raw_courses = await self._pages(
            "/api/v1/courses?enrollment_state=active&include[]=total_scores"
            "&include[]=syllabus_body&per_page=100"
        )
        if len(raw_courses) > 100:
            raise ValueError("Too many active courses")
        courses = []
        for raw in raw_courses:
            if raw.get("access_restricted_by_date") or not raw.get("name"):
                continue
            score = next(
                (
                    enrollment.get("computed_current_score")
                    for enrollment in (raw.get("enrollments") or [])
                    if enrollment.get("type") in ("student", "StudentEnrollment")
                    and enrollment.get("computed_current_score") is not None
                ),
                None,
            )
            courses.append(
                CourseModel(
                    id=str(raw["id"]),
                    course_code=raw.get("course_code") or raw["name"],
                    name=raw["name"],
                    current_score=float(score) if score is not None else None,
                    syllabus=plain_text(raw.get("syllabus_body")),
                )
            )
        semaphore = asyncio.Semaphore(4)

        async def course_assignments(course: CourseModel) -> list[AssignmentModel]:
            async with semaphore:
                rows = await self._pages(
                    f"/api/v1/courses/{course.id}/assignments?include[]=submission&per_page=100"
                )
            return [
                self._assignment(row, course) for row in rows if row.get("published") is not False
            ]

        batches, upcoming = await asyncio.gather(
            asyncio.gather(*(course_assignments(course) for course in courses)),
            self._pages("/api/v1/users/self/upcoming_events?per_page=100"),
        )
        assignments = {assignment.id: assignment for batch in batches for assignment in batch}
        by_course = {course.id: course for course in courses}
        events = []
        for raw in upcoming:
            course_id = str(raw.get("context_code", "")).removeprefix("course_")
            if raw.get("assignment") and course_id in by_course:
                row = raw["assignment"]
                if row.get("published") is not False:
                    assignment = self._assignment(row, by_course[course_id])
                    assignments.setdefault(assignment.id, assignment)
            else:
                events.append(
                    UpcomingEvent(
                        id=str(raw["id"]),
                        title=raw["title"],
                        start_at=parse_date(raw.get("start_at")),
                        end_at=parse_date(raw.get("end_at")),
                        course_id=course_id if course_id in by_course else None,
                    )
                )
        # Point share is an explicitly approximate weight; Canvas group weighting is not fetched.
        for course in courses:
            group = [a for a in assignments.values() if a.course_id == course.id]
            total = math.fsum(a.points_possible for a in group)
            for assignment in group:
                assignment.weight = (
                    round(100 * assignment.points_possible / total, 2) if total else 0.0
                )
        return CanvasSnapshot(courses, list(assignments.values()), events, False, datetime.now(UTC))

    @staticmethod
    def _assignment(raw: dict, course: CourseModel) -> AssignmentModel:
        submission = raw.get("submission") or {}
        completed = bool(submission.get("submitted_at")) or submission.get("workflow_state") in (
            "submitted",
            "graded",
            "pending_review",
        )
        graded = (
            submission.get("workflow_state") == "graded"
            or submission.get("score") is not None
            or bool(submission.get("excused"))
        )
        rubric = "\n".join(
            f"{criterion.get('description', '')} ({criterion.get('points', 0)} points): "
            f"{criterion.get('long_description', '')}"
            for criterion in (raw.get("rubric") or [])
        )
        description = plain_text(raw.get("description"))
        if rubric:
            description = f"{description}\nRubric:\n{plain_text(rubric)}"[:100_000]
        return AssignmentModel(
            id=str(raw["id"]),
            course_id=course.id,
            course_code=course.course_code,
            title=raw["name"],
            due_at=parse_date(raw.get("due_at")),
            points_possible=float(raw.get("points_possible") or 0),
            description=description,
            status="completed" if completed or graded else "pending",
            graded=graded,
            score=max(0.0, float(submission["score"]))
            if submission.get("score") is not None and not submission.get("excused")
            else None,
        )
