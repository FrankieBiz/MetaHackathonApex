// Pure terminal logic: core mathematical formulas and tree rules.
// Everything here is deterministic given `now`, so the client sandbox and the
// live backend render through the same math.

import type {
  Assignment,
  AssignmentStatus,
  Course,
  GradePoint,
  StudyRecommendation,
  SubTaskNode,
  TerminalState,
} from "@/types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

let sequence = 0;
/** Collision-safe local id; crypto.randomUUID is unavailable on plain-HTTP LAN origins. */
export function uid(prefix = "n"): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------- priority

export function hoursUntil(dueAt: string | null, now: number): number | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  return Number.isNaN(due) ? null : (due - now) / HOUR;
}

/** Weight × Points Possible / max(Hours Until Due, 1). Undated work scores 0. */
export function priorityScore(
  a: Pick<Assignment, "weight" | "points_possible" | "due_at">,
  now: number,
): number {
  const hours = hoursUntil(a.due_at, now);
  if (hours === null) return 0;
  return (a.weight * a.points_possible) / Math.max(hours, 1);
}

export const isActive = (a: Assignment) => a.status !== "completed";

export interface QueueEntry {
  assignment: Assignment;
  priority: number;
  hours: number | null;
}

/** Active assignments, highest priority first; ties go to the earlier deadline. */
export function rankQueue(
  assignments: Assignment[],
  now: number,
): QueueEntry[] {
  return assignments
    .filter(isActive)
    .map((assignment) => ({
      assignment,
      priority: priorityScore(assignment, now),
      hours: hoursUntil(assignment.due_at, now),
    }))
    .sort(
      (x, y) =>
        y.priority - x.priority ||
        (x.hours ?? Infinity) - (y.hours ?? Infinity),
    );
}

export type PriorityTier = "high" | "medium" | "low";

/**
 * Absolute bands on the §4.1 score with weight in percent: 50 is a 20%
 * assignment worth 100 points due in 40 hours. Absolute, so one overdue
 * outlier cannot demote the rest of the queue.
 */
export function priorityTier(score: number): PriorityTier {
  if (score >= 50) return "high";
  if (score >= 10) return "medium";
  return "low";
}

// -------------------------------------------------------------------- tree

export function flatten(nodes: SubTaskNode[]): SubTaskNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

export function leaves(nodes: SubTaskNode[]): SubTaskNode[] {
  return nodes.flatMap((node) =>
    node.children.length ? leaves(node.children) : [node],
  );
}

export function findNode(
  nodes: SubTaskNode[],
  id: string,
): SubTaskNode | undefined {
  return flatten(nodes).find((node) => node.id === id);
}

export interface Rollup {
  estimated: number;
  actual: number;
  done: number;
  total: number;
}

/** Leaf totals beneath (or at) a node. Parents never double-count their own estimate. */
export function rollup(nodes: SubTaskNode | SubTaskNode[]): Rollup {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  return leaves(list).reduce<Rollup>(
    (sum, leaf) => ({
      estimated: sum.estimated + leaf.estimated_minutes,
      actual: sum.actual + leaf.actual_minutes,
      done: sum.done + (leaf.is_completed ? 1 : 0),
      total: sum.total + 1,
    }),
    { estimated: 0, actual: 0, done: 0, total: 0 },
  );
}

const markSubtree = (node: SubTaskNode, value: boolean): SubTaskNode => ({
  ...node,
  is_completed: value,
  children: node.children.map((child) => markSubtree(child, value)),
});

/**
 * Recursive task-tree rule (§4.3): the toggled node cascades to every
 * descendant, then each ancestor re-derives its state from its children —
 * all complete checks the parent, any incomplete unchecks it.
 */
export function setCompletion(
  nodes: SubTaskNode[],
  id: string,
  value: boolean,
): SubTaskNode[] {
  const visit = (list: SubTaskNode[]): [SubTaskNode[], boolean] => {
    let found = false;
    const next = list.map((node) => {
      if (node.id === id) {
        found = true;
        return markSubtree(node, value);
      }
      if (!node.children.length) return node;
      const [children, inside] = visit(node.children);
      if (!inside) return node;
      found = true;
      return {
        ...node,
        children,
        is_completed: children.every((child) => child.is_completed),
      };
    });
    return [found ? next : list, found];
  };
  return visit(nodes)[0];
}

/** Adjusts a leaf's logged minutes, never below zero. Parents are rollups and ignore it. */
export function logMinutes(
  nodes: SubTaskNode[],
  id: string,
  delta: number,
): SubTaskNode[] {
  return nodes.map((node) => {
    if (node.id === id && !node.children.length) {
      return {
        ...node,
        actual_minutes: Math.max(0, node.actual_minutes + delta),
      };
    }
    return node.children.length
      ? { ...node, children: logMinutes(node.children, id, delta) }
      : node;
  });
}

export function deriveStatus(
  subtasks: SubTaskNode[],
  current: AssignmentStatus,
): AssignmentStatus {
  if (!subtasks.length) return current;
  if (subtasks.every((node) => node.is_completed)) return "completed";
  const touched = leaves(subtasks).some(
    (leaf) => leaf.is_completed || leaf.actual_minutes > 0,
  );
  return touched ? "in_progress" : "pending";
}

/** Replaces one assignment's subtasks and re-derives its status. */
export function updateSubtasks(
  state: TerminalState,
  assignmentId: string,
  update: (subtasks: SubTaskNode[]) => SubTaskNode[],
): TerminalState {
  return {
    ...state,
    assignments: state.assignments.map((assignment) => {
      if (assignment.id !== assignmentId) return assignment;
      const subtasks = update(assignment.subtasks);
      return {
        ...assignment,
        subtasks,
        status: deriveStatus(subtasks, assignment.status),
      };
    }),
  };
}

// ----------------------------------------------------------------- metrics

/**
 * Completion Velocity (§4.2): Σ estimated / max(Σ actual, 1) × 100 over
 * completed leaves. Leaves checked off without any logged time are left out —
 * they carry no actual to compare and would read as infinite speed.
 */
export function completionVelocity(assignments: Assignment[]): number | null {
  let estimated = 0;
  let actual = 0;
  let fills = 0;
  for (const assignment of assignments) {
    for (const leaf of leaves(assignment.subtasks)) {
      if (!leaf.is_completed || leaf.actual_minutes <= 0) continue;
      estimated += leaf.estimated_minutes;
      actual += leaf.actual_minutes;
      fills += 1;
    }
  }
  return fills ? (estimated / Math.max(actual, 1)) * 100 : null;
}

/** Completion Velocity per course id; courses with no timed fills map to null. */
export function velocityByCourse(
  assignments: Assignment[],
): Map<string, number | null> {
  const byCourse = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    byCourse.set(assignment.course_id, [
      ...(byCourse.get(assignment.course_id) ?? []),
      assignment,
    ]);
  }
  return new Map(
    [...byCourse].map(([id, own]) => [id, completionVelocity(own)]),
  );
}

/** Weight × points due in each of the next `days` days for open work. */
export function deadlineLoad(
  assignments: Assignment[],
  now: number,
  days = 14,
): number[] {
  const load = Array.from({ length: days }, () => 0);
  for (const assignment of assignments) {
    if (!isActive(assignment)) continue;
    const hours = hoursUntil(assignment.due_at, now);
    if (hours === null || hours < 0) continue;
    const day = Math.floor(hours / 24);
    if (day < days) load[day] += assignment.weight * assignment.points_possible;
  }
  return load;
}

/**
 * Assignment Volatility: coefficient of variation (σ / μ × 100) of the
 * daily deadline load. Evenly spread work scores low; deadlines stacked on
 * the same days score high.
 */
export function assignmentVolatility(load: number[]): number {
  if (!load.length) return 0;
  const mean = load.reduce((sum, value) => sum + value, 0) / load.length;
  if (mean === 0) return 0;
  const variance =
    load.reduce((sum, value) => sum + (value - mean) ** 2, 0) / load.length;
  return (Math.sqrt(variance) / mean) * 100;
}

export type Regime = "low" | "elevated" | "high";

export function volatilityRegime(volatility: number): Regime {
  if (volatility < 120) return "low";
  if (volatility < 200) return "elevated";
  return "high";
}

export interface Capacity {
  /** Estimated minutes still open across active assignments. */
  remaining: number;
  /** Estimated minutes across every active assignment's tree. */
  budgeted: number;
  /** Minutes logged anywhere. */
  logged: number;
}

export function capacity(assignments: Assignment[]): Capacity {
  let remaining = 0;
  let budgeted = 0;
  let logged = 0;
  for (const assignment of assignments) {
    for (const leaf of leaves(assignment.subtasks)) {
      logged += leaf.actual_minutes;
      if (!isActive(assignment)) continue;
      budgeted += leaf.estimated_minutes;
      if (!leaf.is_completed) remaining += leaf.estimated_minutes;
    }
  }
  return { remaining, budgeted, logged };
}

export interface CourseTime {
  course_id: string;
  course_code: string;
  estimated: number;
  actual: number;
}

/** Estimated vs actual minutes per course, over leaves that have been worked. */
export function temporalByCourse(
  courses: Course[],
  assignments: Assignment[],
): CourseTime[] {
  return courses.map((course) => {
    const worked = assignments
      .filter((a) => a.course_id === course.id)
      .flatMap((a) => leaves(a.subtasks))
      .filter((leaf) => leaf.is_completed || leaf.actual_minutes > 0);
    return {
      course_id: course.id,
      course_code: course.course_code,
      estimated: worked.reduce((sum, leaf) => sum + leaf.estimated_minutes, 0),
      actual: worked.reduce((sum, leaf) => sum + leaf.actual_minutes, 0),
    };
  });
}

// ------------------------------------------------------- study fallback §4.4

export const STUDY_KEYWORDS = [
  "study guide",
  "midterm",
  "exam",
  "review",
  "syllabus",
  "pdf",
];

/** A Rapid Study Action for any course with no open deliverables; null otherwise. */
export function studyRecommendation(
  course: Course,
  assignments: Assignment[],
): StudyRecommendation | null {
  const own = assignments.filter((a) => a.course_id === course.id);
  if (own.some(isActive)) return null;

  const margin = course.portfolio_margin ?? 0;
  const estimated_minutes = margin < 0 ? 60 : 45;
  const keywordIn = (text: string) =>
    STUDY_KEYWORDS.find((keyword) => text.toLowerCase().includes(keyword));
  const match = own
    .map((assignment) => ({
      assignment,
      keyword: keywordIn(`${assignment.title} ${assignment.description ?? ""}`),
    }))
    .filter((candidate) => candidate.keyword)
    .sort(
      (x, y) =>
        (Date.parse(y.assignment.due_at ?? "") || 0) -
        (Date.parse(x.assignment.due_at ?? "") || 0),
    )[0];

  if (match) {
    return {
      course_id: course.id,
      title: `Re-drill ${match.assignment.title}`,
      reason: `No open deliverables. “${match.keyword}” found in recent coursework.`,
      estimated_minutes,
      source_assignment_id: match.assignment.id,
    };
  }
  const syllabusKeyword = course.syllabus
    ? keywordIn(course.syllabus)
    : undefined;
  if (syllabusKeyword) {
    return {
      course_id: course.id,
      title: `Review the ${syllabusKeyword} material in the ${course.course_code} syllabus`,
      reason: `No open deliverables. “${syllabusKeyword}” found in the syllabus.`,
      estimated_minutes,
      source_assignment_id: null,
    };
  }
  return {
    course_id: course.id,
    title: `Retrieval drill: ${course.name} core concepts`,
    reason:
      margin < 0
        ? `No open deliverables and ${Math.abs(margin).toFixed(1)} pts below target.`
        : "No open deliverables. Hold the margin with a short retrieval drill.",
    estimated_minutes,
    source_assignment_id: null,
  };
}

// --------------------------------------------------------------- portfolio

export interface Portfolio {
  /** Mean grade across graded courses; null when nothing is graded yet. */
  average: number | null;
  margin: number | null;
  graded: number;
  above: number;
}

export function portfolio(
  courses: Course[],
  projections?: ReadonlyMap<string, Projection | null>,
): Portfolio {
  const graded = courses.flatMap((course) => {
    const projection = projections?.get(course.id);
    const score = projection?.grade ?? course.current_score;
    const margin = projection?.margin ?? course.portfolio_margin;
    return score === null || margin === null ? [] : [{ score, margin }];
  });
  if (!graded.length)
    return { average: null, margin: null, graded: 0, above: 0 };
  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    average: mean(graded.map((g) => g.score)),
    margin: mean(graded.map((g) => g.margin)),
    graded: graded.length,
    above: graded.filter((g) => g.margin >= 0).length,
  };
}

// ------------------------------------------------------- what-if projection

/** Hypothetical scores (0–100) keyed by assignment id. */
export type Scenario = Record<string, number>;

/**
 * Work that can still move the grade: weighted and not yet graded. Submitted
 * work, or work whose tasks are all checked, stays in until Canvas scores it.
 * Earliest deadline first; undated last.
 */
export function simulatable(
  courseId: string,
  assignments: Assignment[],
): Assignment[] {
  const due = (a: Assignment) => Date.parse(a.due_at ?? "") || Infinity;
  return assignments
    .filter((a) => a.course_id === courseId && !a.graded && a.weight > 0)
    .sort((x, y) => due(x) - due(y) || x.id.localeCompare(y.id));
}

export interface ProjectionStep {
  at: number;
  score: number;
  /** The assignment whose deadline this step lands on; null for the starting point. */
  assignment_id: string | null;
}

export interface Projection {
  grade: number;
  /** grade − target. */
  margin: number;
  /** Points each assignment adds to (or takes from) the projected grade. */
  impact: Record<string, number>;
  /** One score on every open assignment that lands exactly on target; null with no open weight. */
  breakEven: number | null;
  /** Starts at the current grade now, then steps at each deadline. */
  path: ProjectionStep[];
}

/**
 * Weights are percents of the final grade. Work not being simulated (graded
 * work and anything Canvas hasn't published) is held at the current grade,
 * so an assignment with weight w scored s moves the grade by w·(s − current)
 * over the total weight in play — 100, unless open weight alone exceeds it.
 * With no hypothetical scores set, the projection equals the current grade.
 */
export function projectGrade(
  course: Course,
  open: Assignment[],
  scenario: Scenario,
  now: number,
): Projection | null {
  const current = course.current_score;
  if (current === null) return null;
  const openWeight = open.reduce((sum, a) => sum + a.weight, 0);
  const total = Math.max(100, openWeight);
  const scoreOf = (a: Assignment) => scenario[a.id] ?? current;
  const impact = Object.fromEntries(
    open.map((a) => [a.id, (a.weight * (scoreOf(a) - current)) / total]),
  );

  const lastDue = Math.max(
    now,
    ...open.map((a) => Date.parse(a.due_at ?? "") || now),
  );
  const path: ProjectionStep[] = [
    { at: now, score: current, assignment_id: null },
  ];
  let running = current;
  for (const a of open) {
    running += impact[a.id];
    const due = Date.parse(a.due_at ?? "");
    path.push({
      // Overdue work steps immediately; undated work lands a day past the last deadline.
      at: Number.isNaN(due) ? lastDue + DAY : Math.max(now, due),
      score: running,
      assignment_id: a.id,
    });
  }

  return {
    grade: running,
    margin: running - course.target_score,
    impact,
    breakEven: openWeight
      ? current + ((course.target_score - current) * total) / openWeight
      : null,
    path,
  };
}

// ---------------------------------------------------------- grade history

/** Appends a sync snapshot when the score moved or the last point is 6h old. */
export function appendSnapshot(
  history: GradePoint[],
  score: number,
  at: number,
  cap = 60,
): GradePoint[] {
  const last = history.at(-1);
  if (last && last.score === score && at - Date.parse(last.at) < 6 * HOUR) {
    return history;
  }
  return [...history, { at: new Date(at).toISOString(), score }].slice(-cap);
}

// ------------------------------------------------- local triage fallback

interface Blueprint {
  title: string;
  minutes?: number;
  children?: Blueprint[];
}

const PLAYBOOKS: { match: RegExp; plan: () => Blueprint[] }[] = [
  {
    match: /exam|midterm|final|quiz|test\b/i,
    plan: () => [
      {
        title: "Map exam coverage",
        children: [
          { title: "List every unit and learning objective", minutes: 20 },
          {
            title: "Rank units by confidence (red / amber / green)",
            minutes: 15,
          },
        ],
      },
      {
        title: "Active recall passes",
        children: [
          { title: "Closed-book summary of red units", minutes: 45 },
          { title: "Flashcard sweep of definitions and theorems", minutes: 30 },
          { title: "Re-derive two key results from memory", minutes: 40 },
        ],
      },
      {
        title: "Timed practice",
        children: [
          { title: "Full practice set under exam timing", minutes: 45 },
          { title: "Error log: classify every miss", minutes: 25 },
        ],
      },
    ],
  },
  {
    match: /lab|implement|project|build|code|prototype/i,
    plan: () => [
      {
        title: "Spec intake",
        children: [
          {
            title: "Read the spec and rubric; list graded behaviors",
            minutes: 20,
          },
          { title: "Sketch architecture and test plan", minutes: 25 },
        ],
      },
      {
        title: "Core build",
        children: [
          { title: "Scaffold modules and interfaces", minutes: 30 },
          { title: "Implement the primary path", minutes: 45 },
          { title: "Handle edge cases and failure modes", minutes: 40 },
        ],
      },
      {
        title: "Verify and ship",
        children: [
          { title: "Run the provided test suite; fix failures", minutes: 35 },
          { title: "Write-up and submission checklist", minutes: 20 },
        ],
      },
    ],
  },
  {
    match: /problem set|homework|\bps\b|\bhw\b|exercises/i,
    plan: () => [
      { title: "Review lecture notes for the covered sections", minutes: 25 },
      {
        title: "Solve",
        children: [
          { title: "First half of the problems", minutes: 45 },
          { title: "Second half of the problems", minutes: 45 },
          { title: "Return to skipped problems", minutes: 30 },
        ],
      },
      { title: "Check answers, typeset, submit", minutes: 25 },
    ],
  },
  {
    match: /essay|paper|review|response|report|reading|memo/i,
    plan: () => [
      {
        title: "Source work",
        children: [
          { title: "Close reading with margin notes", minutes: 40 },
          { title: "Pull three quotable passages", minutes: 15 },
        ],
      },
      { title: "Outline thesis and argument", minutes: 25 },
      {
        title: "Draft and revise",
        children: [
          { title: "Write the full draft", minutes: 45 },
          { title: "Revise against the rubric; check citations", minutes: 30 },
        ],
      },
    ],
  },
];

const DEFAULT_PLAN = (): Blueprint[] => [
  { title: "Parse the prompt and rubric", minutes: 20 },
  {
    title: "Execute",
    children: [
      { title: "First working pass", minutes: 45 },
      { title: "Second pass on weakest rubric line", minutes: 30 },
    ],
  },
  { title: "QA against the rubric and submit", minutes: 20 },
];

const snapMinutes = (minutes: number) =>
  Math.min(45, Math.max(15, Math.round(minutes / 5) * 5));

/**
 * Deterministic decomposition used when the Llama-3 endpoint is unreachable.
 * Leaves are atomic 15–45 minute blocks, scaled by the assignment's points.
 */
export function localTriage(assignment: Assignment): SubTaskNode[] {
  const playbook = PLAYBOOKS.find(({ match }) =>
    match.test(`${assignment.title} ${assignment.description ?? ""}`),
  );
  const blueprint = (playbook?.plan ?? DEFAULT_PLAN)();
  const scale = Math.min(1.4, Math.max(0.7, assignment.points_possible / 60));

  const build = (spec: Blueprint, parent_id: string | null): SubTaskNode => {
    const id = uid("local");
    const children = (spec.children ?? []).map((child) => build(child, id));
    return {
      id,
      assignment_id: assignment.id,
      parent_id,
      title: spec.title,
      estimated_minutes: children.length
        ? children.reduce((sum, child) => sum + child.estimated_minutes, 0)
        : snapMinutes((spec.minutes ?? 30) * scale),
      actual_minutes: 0,
      is_completed: false,
      is_study_recommendation: false,
      children,
    };
  };
  return blueprint.map((spec) => build(spec, null));
}
