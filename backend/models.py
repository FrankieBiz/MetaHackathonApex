"""Strict domain models shared by Canvas, the planner, storage, and HTTP routes."""

import base64
import binascii
from typing import Annotated, Literal

from pydantic import (
    AliasChoices,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
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


class CategoryWeight(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    weight: Annotated[float, Field(ge=0, le=100)]


class RubricCriterion(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    description: Annotated[str, Field(max_length=2000)] = ""
    points: Annotated[float, Field(ge=0)] | None = None


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
    category: Title | None = None
    rubric_criteria: list[RubricCriterion] = Field(default_factory=list)


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
    category_weights: list[CategoryWeight] = Field(default_factory=list)
    syllabus_ingested: bool = False

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


_MAX_UPLOAD_BYTES = 6 * 1024 * 1024
_MAX_UPLOAD_BASE64 = 4 * ((_MAX_UPLOAD_BYTES + 2) // 3) + 100
SyllabusMime = Literal[
    "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain"
]


def _syllabus_data(value: str, mime_type: str | None = None) -> tuple[str, bytes]:
    """Validate inline bytes without fetching URLs or retaining uploads in state."""
    if value.startswith("data:"):
        header, separator, value = value.partition(",")
        if not separator or not header.endswith(";base64"):
            raise ValueError("Provide base64 file data")
        declared = header[5:-7]
        if mime_type is not None and declared != mime_type:
            raise ValueError("File MIME type does not match its data URL")
        mime_type = declared
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("Provide valid base64 file data") from None
    if not data or len(data) > _MAX_UPLOAD_BYTES:
        raise ValueError("Syllabus files must contain 1 byte to 6 MiB")
    detected = None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        detected = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        detected = "image/jpeg"
    elif data.startswith((b"GIF87a", b"GIF89a")):
        detected = "image/gif"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        detected = "image/webp"
    elif data.startswith(b"%PDF-"):
        detected = "application/pdf"
    if mime_type == "text/plain":
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("Text syllabi must use UTF-8") from None
        if not text.strip() or len(text) > 100_000:
            raise ValueError("Text syllabi must contain 1 to 100000 characters")
    elif detected is None or (mime_type is not None and mime_type != detected):
        raise ValueError("Provide a PNG, JPEG, GIF, WebP, PDF, or UTF-8 text syllabus")
    return mime_type or detected, data


class SyllabusFile(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=200, pattern=r"\S")]
    mime_type: SyllabusMime
    data_base64: Annotated[str, Field(min_length=1, max_length=_MAX_UPLOAD_BASE64)]

    @model_validator(mode="after")
    def validate_file(self) -> "SyllabusFile":
        _syllabus_data(self.data_base64, self.mime_type)
        return self


class SyllabusIngestRequest(StrictModel):
    raw_text: Annotated[str, Field(min_length=1, max_length=100_000, pattern=r"\S")] | None = Field(
        default=None, validation_alias=AliasChoices("raw_text", "syllabus_text")
    )
    image_base64: Annotated[str, Field(min_length=1, max_length=_MAX_UPLOAD_BASE64)] | None = None
    file: SyllabusFile | None = None

    @field_validator("image_base64")
    @classmethod
    def validate_image(cls, value: str | None) -> str | None:
        if value is not None:
            mime_type, data = _syllabus_data(value)
            if not mime_type.startswith("image/"):
                raise ValueError("image_base64 must contain an image")
            return f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}"
        return value

    @model_validator(mode="after")
    def require_material(self) -> "SyllabusIngestRequest":
        if self.raw_text is None and self.image_base64 is None and self.file is None:
            raise ValueError("Provide syllabus_text, raw_text, image_base64, or file")
        return self


class SyllabusCourse(StrictModel):
    course_code: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    name: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    category_weights: Annotated[list[CategoryWeight], Field(max_length=50)] = Field(
        default_factory=list
    )

    @model_validator(mode="after")
    def validate_weights(self) -> "SyllabusCourse":
        names = [category.name.strip().casefold() for category in self.category_weights]
        if len(set(names)) != len(names) or sum(c.weight for c in self.category_weights) > 100.01:
            raise ValueError("Category weights must be unique and total at most 100 percent")
        return self


class SyllabusDeliverable(StrictModel):
    title: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    description: Annotated[str, Field(max_length=20_000)] = ""
    category: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")] | None = None
    due_at: AwareDatetime | None = None
    points_possible: Annotated[float, Field(ge=0)] = 0.0
    weight: Annotated[float, Field(ge=0, le=100)] = 0.0
    rubric_criteria: Annotated[list[RubricCriterion], Field(max_length=50)] = Field(
        default_factory=list
    )

    @property
    def assignment_description(self) -> str:
        if not self.rubric_criteria:
            return self.description
        criteria = [
            criterion.name
            + (f" ({criterion.points:g} points)" if criterion.points is not None else "")
            + f": {criterion.description}"
            for criterion in self.rubric_criteria
        ]
        return self.description + "\n\nRubric:\n" + "\n".join(criteria)

    @model_validator(mode="after")
    def bounded_description(self) -> "SyllabusDeliverable":
        if len(self.assignment_description) > 100_000:
            raise ValueError("Assignment and rubric exceed the description limit")
        return self


class SyllabusExtraction(StrictModel):
    course: SyllabusCourse
    deliverables: Annotated[list[SyllabusDeliverable], Field(max_length=200)]

    @model_validator(mode="after")
    def unique_deliverables(self) -> "SyllabusExtraction":
        keys = [
            (" ".join(item.title.split()).casefold(), item.due_at) for item in self.deliverables
        ]
        if len(set(keys)) != len(keys):
            raise ValueError("Duplicate syllabus deliverables")
        return self


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


CircuitBreakerLevel = Literal["NORMAL", "LEVEL_1_CAUTION", "LEVEL_2_RESTRICTION", "LEVEL_3_HALT"]


class CircuitBreakerStatus(StrictModel):
    level: CircuitBreakerLevel
    triggered: bool
    halted_course_ids: list[Identifier]
    protected_assignment_ids: list[Identifier]
    # Proposed remaining study time to move; the evaluator never edits saved plans.
    reallocated_minutes: Annotated[int, Field(ge=0)]
    reason: Annotated[str, Field(min_length=1, max_length=2000)]
    recommendations: list[str]


PetitionType = Literal["extension", "regrade", "office_hours_script"]


class NegotiationPetitionRequest(StrictModel):
    petition_type: PetitionType
    student_reason: Annotated[str, Field(min_length=1, max_length=4000, pattern=r"\S")] | None = (
        None
    )


class NegotiationPetition(StrictModel):
    assignment_id: Identifier
    petition_type: PetitionType
    instructor_name: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    email_subject: Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
    email_body: Annotated[str, Field(min_length=1, max_length=12000, pattern=r"\S")]
    office_hours_pitch_60s: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=1500, pattern=r"\S")]],
        Field(min_length=1, max_length=6),
    ]
    syllabus_clauses_cited: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=2000, pattern=r"\S")]],
        Field(max_length=10),
    ]
    source: Literal["ai", "local"]
    telemetry: InferenceTelemetry


class DefenseCouncilMember(StrictModel):
    role: Literal["Professor", "Student", "Arbitrator"]
    position: Annotated[str, Field(min_length=1, max_length=1500, pattern=r"\S")]
    priorities: Annotated[list[Title], Field(min_length=1, max_length=6)]


class DefenseCouncilDeliberation(StrictModel):
    assignment_id: Identifier
    members: Annotated[list[DefenseCouncilMember], Field(min_length=3, max_length=3)]
    verdict: Annotated[str, Field(min_length=1, max_length=1500, pattern=r"\S")]
    subtasks: list[SubTaskNode]
    source: Literal["ai", "local"]
    telemetry: InferenceTelemetry

    @model_validator(mode="after")
    def ordered_roles(self) -> "DefenseCouncilDeliberation":
        if [member.role for member in self.members] != ["Professor", "Student", "Arbitrator"]:
            raise ValueError("Council requires Professor, Student, and Arbitrator in order")
        return self


class CongestionCluster(StrictModel):
    id: Identifier
    start_at: AwareDatetime
    end_at: AwareDatetime
    course_ids: Annotated[list[Identifier], Field(min_length=2)]
    assignment_ids: Annotated[list[Identifier], Field(min_length=2)]
    congestion_score: Annotated[float, Field(ge=0, le=1)]
    # Multiplier of variance, so simulated standard deviation uses its square root.
    variance_inflation: Annotated[float, Field(ge=1, le=2)]


class MarginCallCourse(StrictModel):
    course_id: Identifier
    course_code: Title
    current_score: Annotated[float, Field(ge=0)]
    target_score: Annotated[float, Field(ge=0, le=100)]
    deficit: Annotated[float, Field(ge=0)]


class MarginRestorationAction(StrictModel):
    assignment_id: Identifier
    course_id: Identifier
    title: Title
    due_at: AwareDatetime | None
    marginal_impact: Annotated[float, Field(ge=0, le=1)]
    required_score: Annotated[float, Field(ge=0)] | None


class MarginCallWebhookPayload(StrictModel):
    """Ready to hand to a messaging adapter; this does not dispatch a message."""

    messaging_product: Literal["whatsapp"] = "whatsapp"
    type: Literal["text"] = "text"
    text: dict[Literal["body"], str]


class MarginCallReport(StrictModel):
    triggered: bool
    academic_stance: Literal[
        "MAXIMAL_AGGRESSION", "ACTIVE_PROTECTION", "MAINTAIN_FLOOR", "CRITICAL_INTERVENTION"
    ]
    # Mean shortfall below target, in course percentage points; unknown grades excluded.
    liquidation_deficit: Annotated[float, Field(ge=0)]
    breached_courses: list[MarginCallCourse]
    restoration_order: list[MarginRestorationAction]
    webhook_payload: MarginCallWebhookPayload | None


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


class CalendarExportRequest(StrictModel):
    include_study_blocks: bool = True
    include_alarms: bool = True
    include_completed: bool = False
    course_id: Identifier | None = None


class FrontierCourseAllocation(StrictModel):
    course_id: Identifier
    course_code: Title
    course_name: Title
    current_score: float
    target_score: float
    credit_hours: float = 3.0
    allocated_minutes: int
    allocated_hours: float
    projected_score: float
    score_delta: float
    marginal_gpa_yield: float
    efficiency_rank: int
    status: Literal["healthy", "drawdown", "critical"]


class FrontierPoint(StrictModel):
    total_hours: float
    portfolio_gpa: float
    portfolio_score: float
    portfolio_volatility: float
    sharpe_ratio: float
    course_allocations: list[FrontierCourseAllocation]


class EfficientFrontierRequest(StrictModel):
    weekly_hours: Annotated[float, Field(ge=1.0, le=80.0)] = 20.0
    strategy: Literal["magna_cum_laude", "balanced", "drawdown_defense"] = "balanced"


class EfficientFrontierResponse(StrictModel):
    weekly_hours: float
    strategy: Literal["magna_cum_laude", "balanced", "drawdown_defense"]
    current_portfolio_gpa: float
    projected_portfolio_gpa: float
    gpa_delta: float
    portfolio_volatility: float
    sharpe_ratio: float
    frontier_curve: list[FrontierPoint]
    optimal_allocation: list[FrontierCourseAllocation]
