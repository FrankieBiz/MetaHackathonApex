"""Strict domain models shared by Canvas, the planner, storage, and HTTP routes."""

from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    model_validator,
)

Identifier = Annotated[str, Field(min_length=1, max_length=200)]
Title = Annotated[str, Field(min_length=1, max_length=500)]
Minutes = Annotated[int, Field(ge=0, le=100_000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)


class SubTaskNode(StrictModel):
    id: Identifier
    assignment_id: Identifier | None
    course_id: Identifier | None = None
    parent_id: Identifier | None = None
    title: Title
    estimated_minutes: Annotated[int, Field(ge=1, le=100_000)]
    actual_minutes: Minutes = 0
    is_completed: bool = False
    is_study_recommendation: bool = False
    children: list["SubTaskNode"] = Field(default_factory=list)


class AssignmentModel(StrictModel):
    id: Identifier
    course_id: Identifier
    course_code: Title
    title: Title
    due_at: AwareDatetime | None = None
    points_possible: Annotated[float, Field(ge=0)] = 0.0
    weight: Annotated[float, Field(ge=0, le=100)] = 0.0
    description: Annotated[str, Field(max_length=100_000)] = ""
    status: Literal["pending", "in_progress", "completed"] = "pending"
    # Scored or excused by Canvas, so already settled in current_score. A submission
    # awaiting a grade is completed but not graded.
    graded: bool = False
    score: Annotated[float, Field(ge=0)] | None = None
    priority_score: Annotated[float, Field(ge=0, le=100)] = 0.0
    subtasks: list[SubTaskNode] = Field(default_factory=list)


class GradePoint(StrictModel):
    at: AwareDatetime
    score: Annotated[float, Field(ge=0)]


class CourseModel(StrictModel):
    id: Identifier
    course_code: Title
    name: Title
    current_score: Annotated[float, Field(ge=0)] | None = None
    target_score: Annotated[float, Field(ge=0, le=100)] = 90.0
    syllabus: Annotated[str, Field(max_length=100_000)] = ""
    # Canvas has no grade history; only the simulation fixtures supply one.
    grade_history: list[GradePoint] = Field(default_factory=list)

    @computed_field
    @property
    def portfolio_margin(self) -> float | None:
        if self.current_score is None:
            return None
        return round(self.current_score - self.target_score, 2)


class TerminalMetrics(StrictModel):
    completion_velocity: float
    assignment_volatility: float
    total_budgeted_minutes: int
    total_actual_minutes: int
    last_synced_at: str
    demo_mode: bool


class UpcomingEvent(StrictModel):
    id: Identifier
    title: Title
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    course_id: Identifier | None = None


class TerminalState(StrictModel):
    courses: list[CourseModel]
    assignments: list[AssignmentModel]
    study_recommendations: list[SubTaskNode]
    upcoming_events: list[UpcomingEvent]
    metrics: TerminalMetrics
    persistence_status: Literal["disabled", "connected", "unavailable"] = "disabled"


class SubTaskUpdate(StrictModel):
    is_completed: bool | None = None
    actual_minutes: Minutes | None = None

    @model_validator(mode="after")
    def nonempty_patch(self) -> "SubTaskUpdate":
        if not self.model_fields_set or any(
            getattr(self, name) is None for name in self.model_fields_set
        ):
            raise ValueError("Provide is_completed or actual_minutes with a non-null value")
        return self


class InferenceTelemetry(StrictModel):
    model_used: str = "cached-plan"
    latency_ms: Annotated[int, Field(ge=0)] = 0
    prompt_tokens: Annotated[int, Field(ge=0)] | None = 0
    completion_tokens: Annotated[int, Field(ge=0)] | None = 0
    tokens_per_sec: Annotated[float, Field(ge=0)] | None = 0.0


class DecomposeRequest(StrictModel):
    assignment_id: Identifier


TraceLine = Annotated[str, Field(min_length=1, max_length=300)]


class AgentReasoningStep(StrictModel):
    """One stage of the triage agent, with the evidence it computed."""

    step: Annotated[int, Field(ge=1, le=4)]
    title: Literal["INGEST & AUDIT", "CAPACITY CHECK", "CRITICAL PATH", "VERIFICATION"]
    # pass: inside every threshold · watch: one is close · risk: the grade buffer is exposed.
    status: Literal["pass", "watch", "risk"]
    summary: TraceLine
    evidence: Annotated[list[TraceLine], Field(max_length=6)]
    # The model, or deterministic engine, that produced this step.
    engine: Annotated[str, Field(min_length=1, max_length=120)]
    latency_ms: Annotated[int, Field(ge=0)]


class DecomposeResponse(StrictModel):
    subtasks: list[SubTaskNode]
    telemetry: InferenceTelemetry
    source: Literal["ai", "local", "cached"]
    agent_reasoning_trace: Annotated[list[AgentReasoningStep], Field(min_length=4, max_length=4)]


class RecentStudyAssignment(StrictModel):
    title: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    description: Annotated[str, Field(max_length=20_000)] = ""
    score: Annotated[float, Field(ge=0)] | None = None
    points_possible: Annotated[float, Field(ge=0)] = 0.0
    weight: Annotated[float, Field(ge=0, le=100)] = 0.0
    # HTTP JSON carries ISO strings; retain timezone validation without coercing other fields.
    due_at: Annotated[AwareDatetime, Field(strict=False)] | None = None
    status: Literal["pending", "in_progress", "completed"] = "pending"


class StudyTriageRequest(StrictModel):
    course_id: Identifier
    course_name: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    recent_assignments: Annotated[list[RecentStudyAssignment], Field(max_length=50)] = Field(
        default_factory=list
    )
    syllabus_text: Annotated[str, Field(max_length=100_000)] = ""


class StudyBlock(StrictModel):
    title: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    estimated_minutes: Literal[25] = 25


StudyBlocks = Annotated[list[StudyBlock], Field(min_length=2, max_length=3)]
FocusTopics = Annotated[
    list[Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]],
    Field(min_length=3, max_length=3),
]


class StudyTriagePlan(StrictModel):
    course_id: Identifier
    detected_triggers: list[str]
    focus_topics: FocusTopics
    recommended_blocks: StudyBlocks
    inference_telemetry: InferenceTelemetry
    source: Literal["ai", "local"]


class StudyInsertRequest(StrictModel):
    course_id: Identifier
    recommended_blocks: StudyBlocks
