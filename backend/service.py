"""Serialize state changes and preserve progress across cache refreshes."""

import asyncio
from datetime import UTC, datetime
from statistics import pstdev

from openai import AsyncOpenAI

from .ai_engine import deconstruct_assignment, generate_study_recommendation
from .canvas_client import CanvasClient, CanvasSnapshot
from .config import Settings
from .models import AssignmentModel, SubTaskNode, SubTaskUpdate, TerminalMetrics, TerminalState
from .persistence import RestoreUnavailable, SupabaseStore
from .tasks import find, patch_tree, set_completed, walk


class TerminalService:
    def __init__(
        self,
        settings: Settings,
        canvas: CanvasClient,
        store: SupabaseStore,
        llm: AsyncOpenAI,
    ) -> None:
        self.settings = settings
        self.canvas = canvas
        self.store = store
        self.llm = llm
        self._lock = asyncio.Lock()
        self._states: dict[bool, TerminalState] = {}
        self._loaded: set[bool] = set()
        self._dirty: dict[bool, set[str]] = {True: set(), False: set()}
        self._state: TerminalState | None = None

    async def state(self, *, force: bool = False) -> TerminalState:
        async with self._lock:
            await self._sync(force=force)
            assert self._state is not None
            self._recalculate(self._state)
            return self._state.model_copy(deep=True)

    async def _sync(self, *, force: bool = False) -> None:
        snapshot = await self.canvas.sync(force=force)
        if (
            self._state is not None
            and not force
            and self._state.metrics.last_synced_at == snapshot.synced_at.isoformat()
            and self._state.metrics.demo_mode == snapshot.demo_mode
        ):
            return
        if snapshot.demo_mode not in self._loaded:
            try:
                previous = await self.store.load(snapshot.demo_mode)
            except RestoreUnavailable:
                # Retry on the next forced sync or TTL refresh; prohibit writes meanwhile.
                pass
            else:
                if previous:
                    local = self._states.get(snapshot.demo_mode)
                    if local:
                        dirty = self._dirty[snapshot.demo_mode]
                        local_assignments = {a.id: a for a in local.assignments if a.id in dirty}
                        restored = {a.id: a for a in previous.assignments}
                        restored.update(local_assignments)
                        previous.assignments = list(restored.values())
                        restored_nodes = {n.id: n for n in previous.study_recommendations}
                        restored_nodes.update(
                            {n.id: n for n in local.study_recommendations if n.id in dirty}
                        )
                        previous.study_recommendations = list(restored_nodes.values())
                    self._states[snapshot.demo_mode] = previous
                self._loaded.add(snapshot.demo_mode)
        self._state = self._merge(snapshot, self._states.get(snapshot.demo_mode))
        self._states[snapshot.demo_mode] = self._state
        self._recalculate(self._state)
        await self._persist()

    def _merge(self, snapshot: CanvasSnapshot, previous: TerminalState | None) -> TerminalState:
        old_assignments = {a.id: a for a in previous.assignments} if previous else {}
        old_courses = {c.id: c for c in previous.courses} if previous else {}
        for course in snapshot.courses:
            if course.id in old_courses:
                course.target_score = old_courses[course.id].target_score
        for assignment in snapshot.assignments:
            old = old_assignments.get(assignment.id)
            if old:
                assignment.subtasks = old.model_copy(deep=True).subtasks
            if assignment.status == "completed":
                for node in assignment.subtasks:
                    set_completed(node, True)
            elif assignment.subtasks:
                self._update_status(assignment)
        previous_recommendations = (
            {node.id: node for node in previous.study_recommendations} if previous else {}
        )
        recommendations = []
        for course in snapshot.courses:
            assignments = [a for a in snapshot.assignments if a.course_id == course.id]
            if any(a.status != "completed" for a in assignments):
                continue
            node = generate_study_recommendation(course, assignments)
            old_node = previous_recommendations.get(node.id)
            if old_node:
                node.is_completed = old_node.is_completed
                node.actual_minutes = old_node.actual_minutes
            recommendations.append(node)
        return TerminalState(
            courses=snapshot.courses,
            assignments=snapshot.assignments,
            study_recommendations=recommendations,
            upcoming_events=snapshot.upcoming_events,
            metrics=TerminalMetrics(
                completion_velocity=0.0,
                assignment_volatility=0.0,
                total_budgeted_minutes=0,
                total_actual_minutes=0,
                last_synced_at=snapshot.synced_at.isoformat(),
                demo_mode=snapshot.demo_mode,
            ),
        )

    @staticmethod
    def _update_status(assignment: AssignmentModel) -> None:
        if not assignment.subtasks:
            return
        if all(node.is_completed for node in assignment.subtasks):
            assignment.status = "completed"
        elif any(node.is_completed or node.actual_minutes for node in walk(assignment.subtasks)):
            assignment.status = "in_progress"
        else:
            assignment.status = "pending"

    @staticmethod
    def _recalculate(state: TerminalState) -> None:
        now = datetime.now(UTC)
        courses = {course.id: course for course in state.courses}
        for assignment in state.assignments:
            if assignment.status == "completed":
                assignment.priority_score = 0.0
                continue
            days = (assignment.due_at - now).total_seconds() / 86400 if assignment.due_at else None
            urgency = 5.0 if days is None else (50.0 if days <= 0 else 40 / (1 + days))
            margin = courses[assignment.course_id].portfolio_margin
            risk = max(0.0, -(margin or 0.0))
            assignment.priority_score = round(min(100, urgency + 0.3 * assignment.weight + risk), 2)
        state.assignments.sort(key=lambda assignment: (-assignment.priority_score, assignment.id))
        roots = [node for assignment in state.assignments for node in assignment.subtasks]
        nodes = list(walk([*roots, *state.study_recommendations]))
        leaves = [node for node in nodes if not node.children]
        budget = sum(node.estimated_minutes for node in leaves)
        completed = sum(node.estimated_minutes for node in leaves if node.is_completed)
        scores = [a.priority_score for a in state.assignments if a.status != "completed"]
        state.metrics.completion_velocity = round(100 * completed / budget, 2) if budget else 0.0
        state.metrics.assignment_volatility = round(pstdev(scores), 2) if scores else 0.0
        state.metrics.total_budgeted_minutes = budget
        state.metrics.total_actual_minutes = sum(node.actual_minutes for node in nodes)

    async def _persist(self) -> None:
        assert self._state is not None
        if not self.store.enabled:
            self._state.persistence_status = "disabled"
            return
        source = self._state.metrics.demo_mode
        if source not in self._loaded:
            self._state.persistence_status = "unavailable"
            return
        self._state.persistence_status = "connected"
        if not await self.store.save(self._state):
            self._state.persistence_status = "unavailable"
        else:
            self._dirty[source].clear()

    async def triage(self, assignment_id: str) -> list[SubTaskNode]:
        async with self._lock:
            await self._sync()
            assert self._state is not None
            assignment = next((a for a in self._state.assignments if a.id == assignment_id), None)
            if assignment is None:
                raise KeyError(assignment_id)
            # Repeated requests must not discard a plan on which work has already been recorded.
            if any(node.is_completed or node.actual_minutes for node in walk(assignment.subtasks)):
                return [node.model_copy(deep=True) for node in assignment.subtasks]
            source = self._state.metrics.demo_mode
            material = (assignment.title, assignment.description)
            request_assignment = assignment.model_copy(deep=True)
        nodes = await deconstruct_assignment(
            request_assignment, settings=self.settings, client=self.llm
        )
        async with self._lock:
            assert self._state is not None
            assignment = next((a for a in self._state.assignments if a.id == assignment_id), None)
            if (
                assignment is None
                or self._state.metrics.demo_mode != source
                or (assignment.title, assignment.description) != material
            ):
                raise RuntimeError("Assignment changed during triage; retry with current state")
            if any(node.is_completed or node.actual_minutes for node in walk(assignment.subtasks)):
                return [node.model_copy(deep=True) for node in assignment.subtasks]
            assignment.subtasks = nodes
            if assignment.status == "completed":
                for node in nodes:
                    set_completed(node, True)
            self._update_status(assignment)
            self._dirty[source].add(assignment.id)
            self._recalculate(self._state)
            await self._persist()
            return [node.model_copy(deep=True) for node in nodes]

    async def patch(self, identifier: str, patch: SubTaskUpdate) -> TerminalState:
        async with self._lock:
            await self._sync()
            assert self._state is not None
            source = self._state.metrics.demo_mode
            owner, node = next(
                (
                    (assignment, found)
                    for assignment in self._state.assignments
                    if (found := find(assignment.subtasks, identifier))
                ),
                (None, None),
            )
            # Compare the whole tree: unchecking a partly done parent changes only its children.
            before = self._progress(owner.subtasks) if owner else None
            minutes = node.actual_minutes if node else 0
            if owner is not None:
                patch_tree(owner.subtasks, identifier, patch)
                self._update_status(owner)
                self._dirty[source].add(owner.id)
            elif patch_tree(self._state.study_recommendations, identifier, patch):
                self._dirty[source].add(identifier)
            else:
                raise KeyError(identifier)
            self._recalculate(self._state)
            writes = [self._persist()]
            # Study recommendations have no assignment row, so only the snapshot keeps them.
            if owner and node and self._progress(owner.subtasks) != before:
                writes.append(self._record(owner, node, node.actual_minutes - minutes))
            # Concurrent, so a slow Supabase costs one request timeout rather than two.
            _, *mirrored = await asyncio.gather(*writes)
            if mirrored and not mirrored[0]:
                self._state.persistence_status = "unavailable"
            return self._state.model_copy(deep=True)

    @staticmethod
    def _progress(nodes: list[SubTaskNode]) -> list[tuple[str, int, bool]]:
        return [(node.id, node.actual_minutes, node.is_completed) for node in walk(nodes)]

    async def _record(self, assignment: AssignmentModel, node: SubTaskNode, delta: int) -> bool:
        """Mirrors the tree and appends a time log; False only when the write failed."""
        assert self._state is not None
        # Same guard as snapshots: never overwrite remote rows before a restore succeeds.
        if not self.store.enabled or self._state.metrics.demo_mode not in self._loaded:
            return True
        course = next(c for c in self._state.courses if c.id == assignment.course_id)
        return await self.store.record_subtask_patch(course, assignment, node, delta)
