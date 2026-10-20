"""Optional Supabase snapshots. Failures leave the current in-memory state usable."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

import httpx
from supabase import AsyncClient, AsyncClientOptions, acreate_client

from .config import Settings
from .models import AssignmentModel, CourseModel, SubTaskNode, TerminalState

logger = logging.getLogger(__name__)


def subtask_patch_params(
    course: CourseModel,
    assignment: AssignmentModel,
    node: SubTaskNode,
    minutes_delta: int,
) -> dict[str, Any]:
    """Arguments for `apex_record_subtask_patch` in sql/schema.sql."""
    rows: list[dict[str, Any]] = []

    def flatten(nodes: list[SubTaskNode], parent_id: str | None) -> None:
        for position, child in enumerate(nodes):
            rows.append(
                {
                    "id": child.id,
                    "parent_id": parent_id,
                    "title": child.title,
                    "estimated_minutes": child.estimated_minutes,
                    "actual_minutes": child.actual_minutes,
                    "is_completed": child.is_completed,
                    "is_study_recommendation": child.is_study_recommendation,
                    "position": position,
                }
            )
            flatten(child.children, child.id)

    flatten(assignment.subtasks, None)
    return {
        "p_course": course.model_dump(
            mode="json", include={"id", "course_code", "name", "current_score", "target_score"}
        ),
        "p_assignment": assignment.model_dump(
            mode="json",
            include={
                "id",
                "course_id",
                "title",
                "due_at",
                "points_possible",
                "weight",
                "description",
                "status",
                "graded",
                "priority_score",
            },
        ),
        "p_subtasks": rows,
        "p_time_log": {
            "subtask_id": node.id,
            "minutes_delta": minutes_delta,
            "actual_minutes": node.actual_minutes,
            "is_completed": node.is_completed,
        },
    }


class RestoreUnavailable(Exception):
    """A failed read must not be treated as an empty remote workspace."""


class SupabaseStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.enabled = bool(settings.supabase_url and settings.supabase_key.get_secret_value())
        self._client: AsyncClient | None = None
        self._http = httpx.AsyncClient(timeout=5)

    async def close(self) -> None:
        await self._http.aclose()

    async def _get_client(self) -> AsyncClient:
        if self._client is None:
            self._client = await acreate_client(
                self.settings.supabase_url,
                self.settings.supabase_key.get_secret_value(),
                options=AsyncClientOptions(
                    auto_refresh_token=False,
                    persist_session=False,
                    postgrest_client_timeout=5,
                    httpx_client=self._http,
                ),
            )
        return self._client

    def _key(self, demo_mode: bool) -> str:
        source = "sandbox" if demo_mode else f"canvas:{self.settings.canvas_api_url}"
        return f"{self.settings.apex_workspace_id}:{source}"

    async def load(self, demo_mode: bool) -> TerminalState | None:
        if not self.enabled:
            return None
        try:
            client = await self._get_client()
            result = (
                await client.table("apex_terminal_state")
                .select("payload")
                .eq(
                    "id",
                    self._key(demo_mode),
                )
                .limit(1)
                .execute()
            )
            if not result.data:
                return None
            state = TerminalState.model_validate_json(json.dumps(result.data[0]["payload"]))
            if state.metrics.demo_mode != demo_mode:
                raise ValueError("Stored source does not match requested source")
            return state
        except Exception as exc:
            # Third-party SDK failures must never stop a demo; log types, never credentials.
            logger.warning("Supabase restore failed (%s)", type(exc).__name__)
            raise RestoreUnavailable from None

    async def save(self, state: TerminalState) -> bool:
        if not self.enabled:
            return False
        try:
            client = await self._get_client()
            await (
                client.table("apex_terminal_state")
                .upsert(
                    {
                        "id": self._key(state.metrics.demo_mode),
                        "payload": state.model_dump(mode="json", round_trip=True),
                        "updated_at": datetime.now(UTC).isoformat(),
                    },
                    on_conflict="id",
                )
                .execute()
            )
            return True
        except Exception as exc:
            logger.warning("Supabase save failed (%s)", type(exc).__name__)
            return False

    async def record_subtask_patch(
        self,
        course: CourseModel,
        assignment: AssignmentModel,
        node: SubTaskNode,
        minutes_delta: int,
    ) -> bool:
        """Mirrors the assignment's tree into the relational tables and logs the change."""
        if not self.enabled:
            return False
        try:
            client = await self._get_client()
            await client.rpc(
                "apex_record_subtask_patch",
                subtask_patch_params(course, assignment, node, minutes_delta),
            ).execute()
            return True
        except Exception as exc:
            logger.warning("Supabase subtask write failed (%s)", type(exc).__name__)
            return False
