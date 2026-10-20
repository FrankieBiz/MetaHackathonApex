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
