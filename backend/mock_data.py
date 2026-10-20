"""Deterministic Canvas fixtures for the isolated simulation desk.

Served whenever live Canvas is unavailable (demo mode, a request slower than
the Canvas deadline, or any non-200 answer). Mirrors
``frontend/src/lib/mockData.ts`` field for field, with the same IDs, scores,
deadlines, and task trees, so the backend sandbox and the browser's local
simulation render identically. Only timestamps move: every date is an offset
from the sync time, which keeps countdowns live while IDs stay stable.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from .models import AssignmentModel, CourseModel, GradePoint, SubTaskNode, UpcomingEvent
from .tasks import walk


@dataclass(frozen=True)
class Task:
    title: str
    est: int = 30
    act: int = 0
    done: bool = False
    study: bool = False
    children: tuple["Task", ...] = ()


@dataclass(frozen=True)
class CourseFixture:
    id: str
    course_code: str
    name: str
    current_score: float
    target_score: float
    syllabus: str
    trend: tuple[float, ...]


@dataclass(frozen=True)
class AssignmentFixture:
    id: str
    course_id: str
    title: str
    due_in_hours: float
    points: float
    weight: float
    description: str
    tasks: tuple[Task, ...] = ()


COURSES = (
    CourseFixture(
        id="cs3801",
        course_code="CS 3801",
        name="Distributed Systems",
        current_score=92.4,
        target_score=90.0,
        syllabus=(
            "Consensus (Raft, Paxos), replication, clocks and causality, and fault tolerance. "
            "Midterm Study Guide PDF posted in week 7."
        ),
        trend=(88.0, 88.9, 89.6, 90.4, 90.1, 91.2, 91.8, 92.0, 91.7, 92.4),
    ),
    CourseFixture(
        id="math4102",
        course_code="MATH 4102",
        name="Stochastic Modeling",
        current_score=86.1,
        target_score=90.0,
        syllabus=(
            "Discrete- and continuous-time Markov chains, Poisson processes, renewal theory, "
            "and queueing models. Exam 2 review packet (PDF)."
        ),
        trend=(90.8, 90.2, 89.5, 88.9, 89.3, 88.0, 87.4, 86.9, 87.2, 86.1),
    ),
    CourseFixture(
        id="eng2001",
        course_code="ENG 2001",
        name="Technical Writing",
        current_score=95.3,
        target_score=93.0,
        syllabus=(
            "Audience analysis, memos, proposals, and user documentation. "
            "The Course Style Guide PDF governs all submissions."
        ),
        trend=(91.0, 91.8, 92.5, 93.1, 93.8, 94.0, 94.6, 94.9, 95.1, 95.3),
    ),
    CourseFixture(
        id="fin3100",
        course_code="FIN 3100",
        name="Quantitative Analysis",
        current_score=88.7,
        target_score=90.0,
        syllabus=(
            "Return distributions, risk measures (VaR, CVaR), factor models, and mean-variance "
            "optimization. Lecture slides are posted as PDFs."
        ),
        trend=(85.2, 86.0, 86.9, 87.3, 86.8, 87.9, 88.4, 88.1, 88.9, 88.7),
    ),
)

# Twelve deliverables due 4 hours to 8 days out. Three are left without a task
# tree so the live Llama-3 deconstruction still has something to do on stage.
ASSIGNMENTS = (
    AssignmentFixture(
        id="cs3801-raft",
        course_id="cs3801",
        title="Lab 3: Raft Leader Election & Log Replication",
        due_in_hours=26,
        points=150,
        weight=25,
        description=(
            "Implement leader election, log replication, and persistence in the provided Go "
            "skeleton. Rubric: test harness 60% (TestInitialElection3A, TestBasicAgree3B, "
            "TestPersist3C), design doc 30%, code quality 10%."
        ),
        tasks=(
            Task(
                "Leader election",
                children=(
                    Task("RequestVote RPC handler", 30, 35, done=True),
                    Task("Randomized election timeouts (150–300 ms)", 25, 20, done=True),
                    Task("Pass TestInitialElection3A and TestReElection3A", 30, 30, done=True),
                ),
            ),
            Task(
                "Log replication",
                children=(
                    Task("AppendEntries consistency check", 45, 50, done=True),
                    Task("Advance commitIndex on majority match", 30, 15),
                    Task("Pass TestBasicAgree3B and TestFailAgree3B", 40),
                ),
            ),
            Task(
                "Persistence and design doc",
                children=(
                    Task("Persist currentTerm, votedFor, and log[]", 25),
                    Task(
                        "Design doc: safety argument",
                        children=(
                            Task("Outline the leader-completeness proof", 20),
                            Task("Draw term/index timeline figures", 15),
                        ),
                    ),
                ),
            ),
        ),
    ),
    AssignmentFixture(
        id="cs3801-paxos",
        course_id="cs3801",
        title="Problem Set 4: Paxos Safety Proofs",
        due_in_hours=75,
        points=60,
        weight=10,
        description=(
            "Prove that single-decree Paxos chooses at most one value, then construct a "
            "liveness counterexample with dueling proposers. Typeset in LaTeX."
        ),
        tasks=(
            Task("Re-read “Paxos Made Simple” (PDF, 14 pp)", 30, study=True),
            Task(
                "Proofs",
                children=(
                    Task("Show invariant P2c implies safety", 40),
                    Task("Dueling-proposers liveness counterexample", 30),
                ),
            ),
            Task("Typeset in LaTeX and submit", 20),
        ),
    ),
    AssignmentFixture(
        id="cs3801-midterm",
        course_id="cs3801",
        title="Midterm Exam: Consensus & Replication",
        due_in_hours=150,
        points=200,
        weight=30,
        description=(
            "In person, closed book. Covers lectures 1–9: clocks, consensus, replication, and "
            "CAP. One handwritten formula sheet allowed. Midterm Study Guide PDF on Canvas."
        ),
        tasks=(
            Task(
                "Midterm Study Guide (PDF, 38 MB · 112 slides)",
                study=True,
                children=(
                    Task("Skim lectures 1–9 and flag weak topics", 45, 40, done=True, study=True),
                    Task("One-page summary: FLP impossibility and CAP", 30, study=True),
                ),
            ),
            Task(
                "Practice",
                children=(
                    Task("Timed run: Fall 2025 midterm", 60),
                    Task("Vector clock and causal-ordering drills", 30),
                ),
            ),
            Task("Bring Raft vs. Paxos questions to office hours", 20),
        ),
    ),
    AssignmentFixture(
        id="math4102-hw7",
        course_id="math4102",
        title="Homework 7: Continuous-Time Markov Chains",
        due_in_hours=4,
        points=50,
        weight=10,
        description=(
            "Problems 1–5 from chapter 6: generator matrices, stationary distributions, and "
            "Kolmogorov equations. Show all work; scanned submissions accepted."
        ),
        tasks=(
            Task(
                "Problems 1–3: generator matrices",
                children=(
                    Task("Build Q for the birth–death chain", 25, 30, done=True),
                    Task("Solve πQ = 0 for the stationary distribution", 30, 40, done=True),
                ),
            ),
            Task(
                "Problems 4–5: transient behavior",
                children=(
                    Task("Kolmogorov forward equations for P(t)", 40, 25),
                    Task("Check P(t) numerically with a matrix exponential", 20),
                ),
            ),
            Task("Scan and upload to Canvas", 10),
        ),
    ),
    AssignmentFixture(
        id="math4102-queue",
        course_id="math4102",
        title="Project: M/M/c Queue Simulation Study",
        due_in_hours=98,
        points=120,
        weight=20,
        description=(
            "Simulate an M/M/c queue for c = 1–4 servers, compare simulated waiting times "
            "against Erlang C, and report 95% confidence intervals in a four-page write-up."
        ),
    ),
    AssignmentFixture(
        id="math4102-exam",
        course_id="math4102",
        title="Exam 2: Poisson Processes & Renewal Theory",
        due_in_hours=190,
        points=200,
        weight=30,
        description=(
            "Covers chapters 5 and 7: Poisson processes, thinning, compound processes, and "
            "renewal-reward. Exam 2 Study Guide PDF and a practice exam are posted."
        ),
        tasks=(
            Task(
                "Exam 2 Study Guide (PDF, 24 MB)",
                study=True,
                children=(
                    Task("Rework thinning and superposition examples", 40, study=True),
                    Task("Derive the renewal-reward theorem from memory", 35, study=True),
                ),
            ),
            Task("Timed practice exam (Spring 2025)", 60),
            Task("Build the formula sheet", 20),
        ),
    ),
    AssignmentFixture(
        id="eng2001-memo",
        course_id="eng2001",
        title="Technical Memo: Incident Postmortem",
        due_in_hours=9,
        points=50,
        weight=10,
        description=(
            "Write a blameless postmortem memo (two pages maximum) for the case-packet outage: "
            "timeline, root cause, contributing factors, and corrective actions with owners."
        ),
        tasks=(
            Task("Extract the incident timeline from the case packet", 20, 25, done=True),
            Task(
                "Draft",
                children=(
                    Task("Root cause and contributing factors", 35, 20),
                    Task("Corrective actions with owners and dates", 25),
                ),
            ),
            Task("Peer edit against the Course Style Guide (PDF)", 20, study=True),
        ),
    ),
    AssignmentFixture(
        id="eng2001-proposal",
        course_id="eng2001",
        title="Grant Proposal Draft for Peer Review",
        due_in_hours=60,
        points=100,
        weight=20,
        description=(
            "Draft a 1,500-word proposal for a campus technology grant: problem statement, "
            "objectives, methods, budget table, and evaluation plan."
        ),
    ),
    AssignmentFixture(
        id="eng2001-manual",
        course_id="eng2001",
        title="User Manual: API Onboarding Guide",
        due_in_hours=122,
        points=150,
        weight=25,
        description=(
            "Produce a task-based onboarding guide for a public REST API. Rubric: accuracy 30%, "
            "task orientation 30%, visual design 20%, usability-test findings 20%."
        ),
        tasks=(
            Task("Audience and task analysis", 30),
            Task(
                "Draft sections",
                children=(
                    Task("Quickstart: authentication and first request", 45),
                    Task("Error-reference table", 30),
                    Task("Annotated screenshots", 25),
                ),
            ),
            Task("Usability test with two classmates", 40),
            Task("Final pass against the Course Style Guide (PDF, 9 MB)", 15, study=True),
        ),
    ),
    AssignmentFixture(
        id="fin3100-var",
        course_id="fin3100",
        title="Case 3: Value-at-Risk Backtest",
        due_in_hours=18,
        points=100,
        weight=20,
        description=(
            "Estimate one-day 99% VaR for the 10-asset case portfolio using historical "
            "simulation and variance-covariance methods, then backtest with Kupiec's POF "
            "test. Submit the notebook and a two-page memo."
        ),
        tasks=(
            Task(
                "Data",
                children=(
                    Task("Pull 5 years of daily returns for the 10-asset book", 20, 25, done=True),
                    Task("Adjust for splits and fill missing prices", 25, 35, done=True),
                ),
            ),
            Task(
                "Models",
                children=(
                    Task("Historical-simulation 99% VaR", 30, 30, done=True),
                    Task("Variance-covariance VaR", 30, 15),
                    Task("Kupiec POF backtest", 40),
                ),
            ),
            Task("Two-page memo with exception plot", 30),
        ),
    ),
    AssignmentFixture(
        id="fin3100-quiz",
        course_id="fin3100",
        title="Quiz 4: Mean-Variance Optimization",
        due_in_hours=34,
        points=50,
        weight=10,
        description=(
            "Timed 40-minute quiz on efficient frontiers, the tangency portfolio, and "
            "short-sale constraints. Review the lecture 6 slides."
        ),
    ),
    AssignmentFixture(
        id="fin3100-factor",
        course_id="fin3100",
        title="Problem Set 5: Fama-French Factor Regressions",
        due_in_hours=47,
        points=80,
        weight=15,
        description=(
            "Regress the 25 size/value portfolios on the three Fama-French factors with "
            "Newey-West standard errors, run the GRS test, and interpret the alphas."
        ),
        tasks=(
            Task("Review lecture 8 slides (PDF, 52 MB)", 20, study=True),
            Task("Download factor data from the Ken French library", 15),
            Task(
                "Regressions",
                children=(
                    Task("OLS for 25 portfolios with Newey-West SEs", 45),
                    Task("GRS test of joint alphas", 30),
                ),
            ),
            Task("Interpret alphas and size/value patterns", 25),
        ),
    ),
)

# (id, title, starts in hours, length in hours, course id)
EVENTS = (
    ("cs3801-office-hours", "CS 3801: Raft lab office hours", 5, 1, "cs3801"),
    ("eng2001-conference", "ENG 2001: Memo peer-review conference", 7, 0.5, "eng2001"),
    ("math4102-review", "MATH 4102: Exam 2 review session", 144, 1.5, "math4102"),
)


def build_tree(
    assignment_id: str, tasks: tuple[Task, ...], parent_id: str | None = None, path: str = ""
) -> list[SubTaskNode]:
    """Parents roll up their children's estimates and completion; IDs encode tree position."""
    nodes = []
    for index, task in enumerate(tasks, start=1):
        node_id = f"{assignment_id}-{path}{index}"
        children = build_tree(assignment_id, task.children, node_id, f"{path}{index}.")
        nodes.append(
            SubTaskNode(
                id=node_id,
                assignment_id=assignment_id,
                parent_id=parent_id,
                title=task.title,
                estimated_minutes=(
                    sum(child.estimated_minutes for child in children) if children else task.est
                ),
                actual_minutes=0 if children else task.act,
                is_completed=(
                    all(child.is_completed for child in children) if children else task.done
                ),
                is_study_recommendation=task.study,
                children=children,
            )
        )
    return nodes


def build_mock_dataset(
    now: datetime,
) -> tuple[list[CourseModel], list[AssignmentModel], list[UpcomingEvent]]:
    courses = [
        CourseModel(
            id=course.id,
            course_code=course.course_code,
            name=course.name,
            current_score=course.current_score,
            target_score=course.target_score,
            syllabus=course.syllabus,
            grade_history=[
                GradePoint(at=now - timedelta(weeks=len(course.trend) - 1 - index), score=score)
                for index, score in enumerate(course.trend)
            ],
        )
        for course in COURSES
    ]
    codes = {course.id: course.course_code for course in COURSES}
    assignments = []
    for fixture in ASSIGNMENTS:
        subtasks = build_tree(fixture.id, fixture.tasks)
        started = any(node.is_completed or node.actual_minutes for node in walk(subtasks))
        assignments.append(
            AssignmentModel(
                id=fixture.id,
                course_id=fixture.course_id,
                course_code=codes[fixture.course_id],
                title=fixture.title,
                due_at=now + timedelta(hours=fixture.due_in_hours),
                points_possible=fixture.points,
                weight=fixture.weight,
                description=fixture.description,
                status="in_progress" if started else "pending",
                subtasks=subtasks,
            )
        )
    events = [
        UpcomingEvent(
            id=event_id,
            title=title,
            start_at=now + timedelta(hours=starts),
            end_at=now + timedelta(hours=starts + length),
            course_id=course_id,
        )
        for event_id, title, starts, length, course_id in EVENTS
    ]
    return courses, assignments, events
