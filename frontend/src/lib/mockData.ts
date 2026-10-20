// Deterministic fixtures for the isolated simulation desk. Served whenever the
// Canvas feed is slow (>2.5s), answers non-200, or is unreachable, and when the
// desk is pinned with Ctrl+Shift+D. Mirrors backend/mock_data.py field for
// field (same IDs, scores, deadlines, and task trees), so the backend sandbox
// and this local fallback render identically. Only timestamps move: every date
// is an offset from `now`, which keeps countdowns live while IDs stay stable.

import { DAY, HOUR } from "@/lib/engine";
import type { Assignment, Course, SubTaskNode, TerminalState } from "@/types";

interface Task {
  title: string;
  /** Leaf estimate; parents roll up their children. */
  est?: number;
  act?: number;
  done?: boolean;
  /** Study-material work: a study guide or a large PDF to get through. */
  study?: boolean;
  children?: Task[];
}

interface CourseFixture {
  id: string;
  course_code: string;
  name: string;
  current_score: number;
  target_score: number;
  syllabus: string;
  /** Weekly grade snapshots, oldest first; the last equals current_score. */
  trend: number[];
}

interface AssignmentFixture {
  id: string;
  course_id: string;
  title: string;
  dueInHours: number;
  points: number;
  /** Percent of the final grade. */
  weight: number;
  description: string;
  /** Three deliverables ship without a tree so live triage has work to do. */
  tasks?: Task[];
}

export const MOCK_COURSES: CourseFixture[] = [
  {
    id: "cs3801",
    course_code: "CS 3801",
    name: "Distributed Systems",
    current_score: 92.4,
    target_score: 90,
    syllabus:
      "Consensus (Raft, Paxos), replication, clocks and causality, and fault tolerance. Midterm Study Guide PDF posted in week 7.",
    trend: [88, 88.9, 89.6, 90.4, 90.1, 91.2, 91.8, 92, 91.7, 92.4],
  },
  {
    id: "math4102",
    course_code: "MATH 4102",
    name: "Stochastic Modeling",
    current_score: 86.1,
    target_score: 90,
    syllabus:
      "Discrete- and continuous-time Markov chains, Poisson processes, renewal theory, and queueing models. Exam 2 review packet (PDF).",
    trend: [90.8, 90.2, 89.5, 88.9, 89.3, 88, 87.4, 86.9, 87.2, 86.1],
  },
  {
    id: "eng2001",
    course_code: "ENG 2001",
    name: "Technical Writing",
    current_score: 95.3,
    target_score: 93,
    syllabus:
      "Audience analysis, memos, proposals, and user documentation. The Course Style Guide PDF governs all submissions.",
    trend: [91, 91.8, 92.5, 93.1, 93.8, 94, 94.6, 94.9, 95.1, 95.3],
  },
  {
    id: "fin3100",
    course_code: "FIN 3100",
    name: "Quantitative Analysis",
    current_score: 88.7,
    target_score: 90,
    syllabus:
      "Return distributions, risk measures (VaR, CVaR), factor models, and mean-variance optimization. Lecture slides are posted as PDFs.",
    trend: [85.2, 86, 86.9, 87.3, 86.8, 87.9, 88.4, 88.1, 88.9, 88.7],
  },
];

export const MOCK_ASSIGNMENTS: AssignmentFixture[] = [
  {
    id: "cs3801-raft",
    course_id: "cs3801",
    title: "Lab 3: Raft Leader Election & Log Replication",
    dueInHours: 26,
    points: 150,
    weight: 25,
    description:
      "Implement leader election, log replication, and persistence in the provided Go skeleton. Rubric: test harness 60% (TestInitialElection3A, TestBasicAgree3B, TestPersist3C), design doc 30%, code quality 10%.",
    tasks: [
      {
        title: "Leader election",
        children: [
          { title: "RequestVote RPC handler", est: 30, act: 35, done: true },
          {
            title: "Randomized election timeouts (150–300 ms)",
            est: 25,
            act: 20,
            done: true,
          },
          {
            title: "Pass TestInitialElection3A and TestReElection3A",
            est: 30,
            act: 30,
            done: true,
          },
        ],
      },
      {
        title: "Log replication",
        children: [
          {
            title: "AppendEntries consistency check",
            est: 45,
            act: 50,
            done: true,
          },
          { title: "Advance commitIndex on majority match", est: 30, act: 15 },
          { title: "Pass TestBasicAgree3B and TestFailAgree3B", est: 40 },
        ],
      },
      {
        title: "Persistence and design doc",
        children: [
          { title: "Persist currentTerm, votedFor, and log[]", est: 25 },
          {
            title: "Design doc: safety argument",
            children: [
              { title: "Outline the leader-completeness proof", est: 20 },
              { title: "Draw term/index timeline figures", est: 15 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "cs3801-paxos",
    course_id: "cs3801",
    title: "Problem Set 4: Paxos Safety Proofs",
    dueInHours: 75,
    points: 60,
    weight: 10,
    description:
      "Prove that single-decree Paxos chooses at most one value, then construct a liveness counterexample with dueling proposers. Typeset in LaTeX.",
    tasks: [
      {
        title: "Re-read “Paxos Made Simple” (PDF, 14 pp)",
        est: 30,
        study: true,
      },
      {
        title: "Proofs",
        children: [
          { title: "Show invariant P2c implies safety", est: 40 },
          { title: "Dueling-proposers liveness counterexample", est: 30 },
        ],
      },
      { title: "Typeset in LaTeX and submit", est: 20 },
    ],
  },
  {
    id: "cs3801-midterm",
    course_id: "cs3801",
    title: "Midterm Exam: Consensus & Replication",
    dueInHours: 150,
    points: 200,
    weight: 30,
    description:
      "In person, closed book. Covers lectures 1–9: clocks, consensus, replication, and CAP. One handwritten formula sheet allowed. Midterm Study Guide PDF on Canvas.",
    tasks: [
      {
        title: "Midterm Study Guide (PDF, 38 MB · 112 slides)",
        study: true,
        children: [
          {
            title: "Skim lectures 1–9 and flag weak topics",
            est: 45,
            act: 40,
            done: true,
            study: true,
          },
          {
            title: "One-page summary: FLP impossibility and CAP",
            est: 30,
            study: true,
          },
        ],
      },
      {
        title: "Practice",
        children: [
          { title: "Timed run: Fall 2025 midterm", est: 60 },
          { title: "Vector clock and causal-ordering drills", est: 30 },
        ],
      },
      { title: "Bring Raft vs. Paxos questions to office hours", est: 20 },
    ],
  },
  {
    id: "math4102-hw7",
    course_id: "math4102",
    title: "Homework 7: Continuous-Time Markov Chains",
    dueInHours: 4,
    points: 50,
    weight: 10,
    description:
      "Problems 1–5 from chapter 6: generator matrices, stationary distributions, and Kolmogorov equations. Show all work; scanned submissions accepted.",
    tasks: [
      {
        title: "Problems 1–3: generator matrices",
        children: [
          {
            title: "Build Q for the birth–death chain",
            est: 25,
            act: 30,
            done: true,
          },
          {
            title: "Solve πQ = 0 for the stationary distribution",
            est: 30,
            act: 40,
            done: true,
          },
        ],
      },
      {
        title: "Problems 4–5: transient behavior",
        children: [
          { title: "Kolmogorov forward equations for P(t)", est: 40, act: 25 },
          {
            title: "Check P(t) numerically with a matrix exponential",
            est: 20,
          },
        ],
      },
      { title: "Scan and upload to Canvas", est: 10 },
    ],
  },
  {
    id: "math4102-queue",
    course_id: "math4102",
    title: "Project: M/M/c Queue Simulation Study",
    dueInHours: 98,
    points: 120,
    weight: 20,
    description:
      "Simulate an M/M/c queue for c = 1–4 servers, compare simulated waiting times against Erlang C, and report 95% confidence intervals in a four-page write-up.",
  },
  {
    id: "math4102-exam",
    course_id: "math4102",
    title: "Exam 2: Poisson Processes & Renewal Theory",
    dueInHours: 190,
    points: 200,
    weight: 30,
    description:
      "Covers chapters 5 and 7: Poisson processes, thinning, compound processes, and renewal-reward. Exam 2 Study Guide PDF and a practice exam are posted.",
    tasks: [
      {
        title: "Exam 2 Study Guide (PDF, 24 MB)",
        study: true,
        children: [
          {
            title: "Rework thinning and superposition examples",
            est: 40,
            study: true,
          },
          {
            title: "Derive the renewal-reward theorem from memory",
            est: 35,
            study: true,
          },
        ],
      },
      { title: "Timed practice exam (Spring 2025)", est: 60 },
      { title: "Build the formula sheet", est: 20 },
    ],
  },
  {
    id: "eng2001-memo",
    course_id: "eng2001",
    title: "Technical Memo: Incident Postmortem",
    dueInHours: 9,
    points: 50,
    weight: 10,
    description:
      "Write a blameless postmortem memo (two pages maximum) for the case-packet outage: timeline, root cause, contributing factors, and corrective actions with owners.",
    tasks: [
      {
        title: "Extract the incident timeline from the case packet",
        est: 20,
        act: 25,
        done: true,
      },
      {
        title: "Draft",
        children: [
          { title: "Root cause and contributing factors", est: 35, act: 20 },
          { title: "Corrective actions with owners and dates", est: 25 },
        ],
      },
      {
        title: "Peer edit against the Course Style Guide (PDF)",
        est: 20,
        study: true,
      },
    ],
  },
  {
    id: "eng2001-proposal",
    course_id: "eng2001",
    title: "Grant Proposal Draft for Peer Review",
    dueInHours: 60,
    points: 100,
    weight: 20,
    description:
      "Draft a 1,500-word proposal for a campus technology grant: problem statement, objectives, methods, budget table, and evaluation plan.",
  },
  {
    id: "eng2001-manual",
    course_id: "eng2001",
    title: "User Manual: API Onboarding Guide",
    dueInHours: 122,
    points: 150,
    weight: 25,
    description:
      "Produce a task-based onboarding guide for a public REST API. Rubric: accuracy 30%, task orientation 30%, visual design 20%, usability-test findings 20%.",
    tasks: [
      { title: "Audience and task analysis", est: 30 },
      {
        title: "Draft sections",
        children: [
          { title: "Quickstart: authentication and first request", est: 45 },
          { title: "Error-reference table", est: 30 },
          { title: "Annotated screenshots", est: 25 },
        ],
      },
      { title: "Usability test with two classmates", est: 40 },
      {
        title: "Final pass against the Course Style Guide (PDF, 9 MB)",
        est: 15,
        study: true,
      },
    ],
  },
  {
    id: "fin3100-var",
    course_id: "fin3100",
    title: "Case 3: Value-at-Risk Backtest",
    dueInHours: 18,
    points: 100,
    weight: 20,
    description:
      "Estimate one-day 99% VaR for the 10-asset case portfolio using historical simulation and variance-covariance methods, then backtest with Kupiec's POF test. Submit the notebook and a two-page memo.",
    tasks: [
      {
        title: "Data",
        children: [
          {
            title: "Pull 5 years of daily returns for the 10-asset book",
            est: 20,
            act: 25,
            done: true,
          },
          {
            title: "Adjust for splits and fill missing prices",
            est: 25,
            act: 35,
            done: true,
          },
        ],
      },
      {
        title: "Models",
        children: [
          {
            title: "Historical-simulation 99% VaR",
            est: 30,
            act: 30,
            done: true,
          },
          { title: "Variance-covariance VaR", est: 30, act: 15 },
          { title: "Kupiec POF backtest", est: 40 },
        ],
      },
      { title: "Two-page memo with exception plot", est: 30 },
    ],
  },
  {
    id: "fin3100-quiz",
    course_id: "fin3100",
    title: "Quiz 4: Mean-Variance Optimization",
    dueInHours: 34,
    points: 50,
    weight: 10,
    description:
      "Timed 40-minute quiz on efficient frontiers, the tangency portfolio, and short-sale constraints. Review the lecture 6 slides.",
  },
  {
    id: "fin3100-factor",
    course_id: "fin3100",
    title: "Problem Set 5: Fama-French Factor Regressions",
    dueInHours: 47,
    points: 80,
    weight: 15,
    description:
      "Regress the 25 size/value portfolios on the three Fama-French factors with Newey-West standard errors, run the GRS test, and interpret the alphas.",
    tasks: [
      { title: "Review lecture 8 slides (PDF, 52 MB)", est: 20, study: true },
      { title: "Download factor data from the Ken French library", est: 15 },
      {
        title: "Regressions",
        children: [
          { title: "OLS for 25 portfolios with Newey-West SEs", est: 45 },
          { title: "GRS test of joint alphas", est: 30 },
        ],
      },
      { title: "Interpret alphas and size/value patterns", est: 25 },
    ],
  },
];

/** Parents roll up their children's estimates and completion; IDs encode tree position. */
function grow(
  assignmentId: string,
  tasks: Task[],
  parentId: string | null = null,
  path = "",
): SubTaskNode[] {
  return tasks.map((task, index) => {
    const id = `${assignmentId}-${path}${index + 1}`;
    const children = grow(
      assignmentId,
      task.children ?? [],
      id,
      `${path}${index + 1}.`,
    );
    return {
      id,
      assignment_id: assignmentId,
      parent_id: parentId,
      title: task.title,
      estimated_minutes: children.length
        ? children.reduce((sum, child) => sum + child.estimated_minutes, 0)
        : (task.est ?? 30),
      actual_minutes: children.length ? 0 : (task.act ?? 0),
      is_completed: children.length
        ? children.every((child) => child.is_completed)
        : Boolean(task.done),
      is_study_recommendation: Boolean(task.study),
      children,
    };
  });
}

const started = (nodes: SubTaskNode[]): boolean =>
  nodes.some(
    (node) =>
      node.is_completed || node.actual_minutes > 0 || started(node.children),
  );

export function createMockState(now: number): TerminalState {
  const courses: Course[] = MOCK_COURSES.map(({ trend, ...course }) => ({
    ...course,
    portfolio_margin: course.current_score - course.target_score,
    grade_history: trend.map((score, index) => ({
      at: new Date(now - (trend.length - 1 - index) * 7 * DAY).toISOString(),
      score,
    })),
  }));
  const codeOf = new Map(courses.map((c) => [c.id, c.course_code]));

  const assignments: Assignment[] = MOCK_ASSIGNMENTS.map((fixture) => {
    const subtasks = grow(fixture.id, fixture.tasks ?? []);
    return {
      id: fixture.id,
      course_id: fixture.course_id,
      course_code: codeOf.get(fixture.course_id) ?? fixture.course_id,
      title: fixture.title,
      due_at: new Date(now + fixture.dueInHours * HOUR).toISOString(),
      points_possible: fixture.points,
      weight: fixture.weight,
      description: fixture.description,
      status: started(subtasks) ? "in_progress" : "pending",
      graded: false,
      priority_score: 0,
      subtasks,
    };
  });

  return {
    courses,
    assignments,
    metrics: {
      completion_velocity: 0,
      assignment_volatility: 0,
      total_budgeted_minutes: 0,
      total_actual_minutes: 0,
      last_synced_at: new Date(now).toISOString(),
      demo_mode: true,
    },
  };
}
