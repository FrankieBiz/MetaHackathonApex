"""Serialize state changes and preserve progress across cache refreshes."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from statistics import pstdev
from uuid import NAMESPACE_URL, uuid5

from openai import AsyncOpenAI

from .ai_engine import (
    extract_syllabus,
    fallback_tree,
    generate_study_recommendation,
    run_triage_agent,
    saved_plan_trace,
    stream_triage,
    task_id,
    triage_context,
)
from .canvas_client import CanvasClient, CanvasSnapshot
from .config import Settings
from .models import (
    AgentReasoningStep,
    AssignmentModel,
    CourseModel,
    DecomposeResponse,
    InferenceTelemetry,
    StudyInsertRequest,
    SubTaskNode,
    SubTaskUpdate,
    SyllabusIngestRequest,
    TerminalMetrics,
    TerminalState,
    _syllabus_data,
)
from .persistence import RestoreUnavailable, SupabaseStore
from .tasks import find, patch_tree, set_completed, walk


class TerminalService:
    def __init__(
        self,
        settings: Settings,
        canvas: CanvasClient,
        store: SupabaseStore,
        llm: AsyncOpenAI,
        auditor: AsyncOpenAI | None = None,
    ) -> None:
        self.settings = settings
        self.canvas = canvas
        self.store = store
        self.llm = llm
        # Optional pre-filter model; without one the agent parses the rubric itself.
        self.auditor = auditor
        self._lock = asyncio.Lock()
        self._states: dict[bool, TerminalState] = {}
        self._loaded: set[bool] = set()
        self._dirty: dict[bool, set[str]] = {True: set(), False: set()}
        self._state: TerminalState | None = None

    async def state(
        self, *, force: bool = False, canvas_settings: Settings | None = None
    ) -> TerminalState:
        async with self._lock:
            if canvas_settings is not None:
                self.canvas.settings = canvas_settings
                force = True
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
                        restored_courses = {c.id: c for c in previous.courses}
                        restored_courses.update({c.id: c for c in local.courses if c.id in dirty})
                        previous.courses = list(restored_courses.values())
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
                old = old_courses[course.id]
                course.target_score = old.target_score
                if old.syllabus_ingested:
                    course.syllabus = old.syllabus
                    course.category_weights = old.model_copy(deep=True).category_weights
                    course.syllabus_ingested = True
        # Canvas only owns its own records; syllabus imports survive TTL/forced refreshes.
        course_ids = {c.id for c in snapshot.courses}
        snapshot.courses.extend(
            c.model_copy(deep=True)
            for c in old_courses.values()
            if c.id.startswith("syllabus:") and c.id not in course_ids
        )
        course_ids = {c.id for c in snapshot.courses}
        assignment_ids = {a.id for a in snapshot.assignments}
        snapshot.assignments.extend(
            a.model_copy(deep=True)
            for a in old_assignments.values()
            if a.id.startswith("syllabus:")
            and a.id not in assignment_ids
            and a.course_id in course_ids
        )
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
        course_ids = {c.id for c in snapshot.courses}
        recommendations = [
            node.model_copy(deep=True)
            for node in previous_recommendations.values()
            if node.course_id in course_ids and node.id != task_id(node.course_id, "rapid-study")
        ]
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

    async def triage(
        self,
        assignment_id: str,
        *,
        telemetry: InferenceTelemetry | None = None,
        trace: list[AgentReasoningStep] | None = None,
    ) -> list[SubTaskNode]:
        """Runs the triage agent; `telemetry` and `trace` are filled in when supplied."""
        async with self._lock:
            await self._sync()
            assert self._state is not None
            assignment = next((a for a in self._state.assignments if a.id == assignment_id), None)
            if assignment is None:
                raise KeyError(assignment_id)
            context = triage_context(self._state, assignment, datetime.now(UTC))
            # Repeated requests must not discard a plan on which work has already been recorded.
            if any(node.is_completed or node.actual_minutes for node in walk(assignment.subtasks)):
                if telemetry is not None:
                    telemetry.model_used = "cached-plan"
                kept = [node.model_copy(deep=True) for node in assignment.subtasks]
                if trace is not None:
                    trace[:] = saved_plan_trace(assignment, context, kept)
                return kept
            source = self._state.metrics.demo_mode
            material = (assignment.title, assignment.description)
            request_assignment = assignment.model_copy(deep=True)
        nodes, steps = await run_triage_agent(
            request_assignment,
            context,
            settings=self.settings,
            client=self.llm,
            auditor=self.auditor,
            telemetry=telemetry,
        )
        if trace is not None:
            trace[:] = steps
        return await self._commit_triage(
            assignment_id, source, material, nodes, telemetry=telemetry, trace=trace
        )

    async def stream_triage(self, assignment_id: str) -> AsyncIterator[dict]:
        """Emit progress outside the lock; save and resolve races before complete."""
        async with self._lock:
            await self._sync()
            assert self._state is not None
            assignment = next((a for a in self._state.assignments if a.id == assignment_id), None)
            if assignment is None:
                raise KeyError(assignment_id)
            context = triage_context(self._state, assignment, datetime.now(UTC))
            source = self._state.metrics.demo_mode
            material = (assignment.title, assignment.description)
            request_assignment = assignment.model_copy(deep=True)
        events = stream_triage(
            request_assignment,
            context,
            settings=self.settings,
            client=self.llm,
            auditor=self.auditor,
        )
        try:
            async for event in events:
                if event["event"] == "complete":
                    result = DecomposeResponse.model_validate(event["data"])
                    result.subtasks = await self._commit_triage(
                        assignment_id,
                        source,
                        material,
                        result.subtasks,
                        telemetry=result.telemetry,
                        trace=result.agent_reasoning_trace,
                    )
                    if result.telemetry.model_used == "cached-plan":
                        result.source = "cached"
                    event = {"event": "complete", "data": result.model_dump(mode="json")}
                yield event
        finally:
            await events.aclose()

    async def _commit_triage(
        self,
        assignment_id: str,
        source: bool,
        material: tuple[str, str],
        nodes: list[SubTaskNode],
        *,
        telemetry: InferenceTelemetry | None,
        trace: list[AgentReasoningStep] | None,
    ) -> list[SubTaskNode]:
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
                # Work landed while the model ran: the saved plan wins, and so does its trace.
                kept = [node.model_copy(deep=True) for node in assignment.subtasks]
                if telemetry is not None:
                    telemetry.model_used = "cached-plan"
                if trace is not None:
                    now = datetime.now(UTC)
                    trace[:] = saved_plan_trace(
                        assignment, triage_context(self._state, assignment, now), kept
                    )
                return kept
            assignment.subtasks = nodes
            if assignment.status == "completed":
                for node in nodes:
                    set_completed(node, True)
            self._update_status(assignment)
            self._dirty[source].add(assignment.id)
            self._recalculate(self._state)
            await self._persist()
            return [node.model_copy(deep=True) for node in nodes]

    async def insert_study(self, request: StudyInsertRequest) -> TerminalState:
        async with self._lock:
            await self._sync()
            assert self._state is not None
            if not any(c.id == request.course_id for c in self._state.courses):
                raise KeyError(request.course_id)
            existing = {n.id for n in self._state.study_recommendations}
            for block in request.recommended_blocks:
                title = " ".join(block.title.split())
                identifier = task_id(request.course_id, f"study-sprint:{title.casefold()}")
                if identifier in existing:
                    continue
                self._state.study_recommendations.append(
                    SubTaskNode(
                        id=identifier,
                        assignment_id=None,
                        course_id=request.course_id,
                        title=title,
                        estimated_minutes=25,
                        is_study_recommendation=True,
                    )
                )
                existing.add(identifier)
                self._dirty[self._state.metrics.demo_mode].add(identifier)
            self._recalculate(self._state)
            await self._persist()
            return self._state.model_copy(deep=True)

    async def ingest_syllabus(self, request: SyllabusIngestRequest) -> TerminalState:
        async with self._lock:
            await self._sync()
            assert self._state is not None
            source = self._state.metrics.demo_mode
        extracted = await extract_syllabus(
            request, settings=self.settings, client=self.llm, auditor=self.auditor
        )
        async with self._lock:
            await self._sync()
            assert self._state is not None
            if self._state.metrics.demo_mode != source:
                raise RuntimeError("Workspace changed during ingestion; retry with current state")
            code = " ".join(extracted.course.course_code.split())
            course = next(
                (c for c in self._state.courses if c.course_code.casefold() == code.casefold()),
                None,
            )
            if course is None:
                course = CourseModel(
                    id=f"syllabus:{uuid5(NAMESPACE_URL, f'apex:course:{code.casefold()}')}",
                    course_code=code,
                    name=extracted.course.name.strip(),
                )
                self._state.courses.append(course)
            course.category_weights = extracted.course.category_weights
            course.syllabus_ingested = True
            # Keep readable text for study recommendations; never store the uploaded base64.
            syllabus = request.raw_text or ""
            if request.file and request.file.mime_type == "text/plain":
                _, data = _syllabus_data(request.file.data_base64, "text/plain")
                syllabus = (syllabus + "\n" + data.decode("utf-8")).strip()[:100_000]
            if not syllabus:
                syllabus = "\n".join(
                    [
                        f"{course.course_code}: {course.name}",
                        *(f"{c.name}: {c.weight:g}%" for c in course.category_weights),
                        *(f"{a.title}: {a.description}" for a in extracted.deliverables),
                    ]
                )[:100_000]
            course.syllabus = syllabus
            self._dirty[source].add(course.id)
            existing = {assignment.id: assignment for assignment in self._state.assignments}
            for item in extracted.deliverables:
                title = " ".join(item.title.split())
                due = item.due_at.astimezone(UTC).isoformat() if item.due_at else "undated"
                identifier = f"syllabus:{task_id(course.id, f'{title.casefold()}:{due}')}"
                # Replays and reuploads preserve completion, grades, and logged time.
                if identifier in existing:
                    continue
                assignment = AssignmentModel(
                    id=identifier,
                    course_id=course.id,
                    course_code=course.course_code,
                    title=title,
                    due_at=item.due_at,
                    points_possible=item.points_possible,
                    weight=item.weight,
                    category=item.category,
                    rubric_criteria=item.rubric_criteria,
                    description=item.assignment_description,
                )
                assignment.subtasks = fallback_tree(assignment)
                self._state.assignments.append(assignment)
                existing[identifier] = assignment
                self._dirty[source].add(identifier)
            if any(
                a.course_id == course.id and a.status != "completed"
                for a in self._state.assignments
            ):
                self._state.study_recommendations = [
                    n
                    for n in self._state.study_recommendations
                    if n.id != task_id(course.id, "rapid-study")
                ]
            self._recalculate(self._state)
            await self._persist()
            return self._state.model_copy(deep=True)

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
