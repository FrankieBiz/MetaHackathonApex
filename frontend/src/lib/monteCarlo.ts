// Monte Carlo what-if desk: the contract of POST /api/v1/simulate/monte-carlo
// and the offline engine behind api.simulateMonteCarlo. The engine mirrors
// backend/service.py `_simulate_course`, so a detached or pinned desk reads the
// same distribution shape the backend would draw from the same course book.

import { seededRandom } from "@/lib/engine";
import type { Assignment, Course, TerminalState } from "@/types";

/** Backend bounds on `iterations`. */
export const MIN_ITERATIONS = 100;
export const MAX_ITERATIONS = 10_000;
export const DEFAULT_ITERATIONS = 2000;
/** Spread, in points, when a course has fewer than two grade observations. */
export const DEFAULT_SPREAD = 10;
/** The ranking's "+10 PTS" column: final-grade points a 10-point lift on one deliverable buys. */
export const SENSITIVITY_BUMP = 10;

export interface MonteCarloRequest {
  course_id?: string;
  iterations?: number;
  /** Fixed hypothetical scores (0–100) keyed by assignment id; unset work stays stochastic. */
  shock_overrides?: Record<string, number>;
}

export interface ScorePercentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface AssignmentSensitivity {
  assignment_id: string;
  weight: number;
  /** Final course points gained per point scored on this assignment. */
  marginal_impact: number;
}

export interface CourseSimulation {
  course_id: string;
  target_score: number;
  /** Null for a course with no defensible baseline (no grade, no fully specified shocks). */
  percentiles: ScorePercentiles | null;
  /** 90% downside VaR: max(0, mean simulated grade − p10), in points. */
  var_90: number | null;
  /** A probability in [0, 1]. */
  probability_of_target: number | null;
  sensitivity_matrix: AssignmentSensitivity[];
}

export interface MonteCarloResponse {
  iterations: number;
  courses: CourseSimulation[];
}

/** Work that can still move the grade, in the backend's order (by id). */
export const remainingWork = (courseId: string, assignments: Assignment[]) =>
  assignments
    .filter((a) => a.course_id === courseId && !a.graded && a.weight > 0)
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/** Highest leverage first; ties keep the backend's id order. */
export const rankSensitivity = (rows: AssignmentSensitivity[]) =>
  [...rows].sort((x, y) => y.marginal_impact - x.marginal_impact);

const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/** Population standard deviation, as Python's statistics.pstdev. */
function pstdev(values: number[]): number {
  const mu = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - mu) ** 2)));
}

/** FNV-1a, so each assignment keeps its own stream as shocks and filters change. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Linear interpolation between closest ranks of an ascending sample. */
function percentile(sorted: Float64Array, q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function simulateCourse(
  course: Course,
  assignments: Assignment[],
  iterations: number,
  overrides: Record<string, number>,
): CourseSimulation {
  const remaining = remainingWork(course.id, assignments);
  const openWeight = remaining.reduce((sum, a) => sum + a.weight, 0);
  const total = Math.max(100, openWeight);
  const sensitivity = remaining.map((a) => ({
    assignment_id: a.id,
    weight: a.weight,
    marginal_impact: a.weight / total,
  }));
  const result: CourseSimulation = {
    course_id: course.id,
    target_score: course.target_score,
    percentiles: null,
    var_90: null,
    probability_of_target: null,
    sensitivity_matrix: sensitivity,
  };

  const history = course.grade_history.map((point) => point.score);
  // Canvas does not supply grade history; posted assignment grades are the fallback.
  const posted = assignments
    .filter(
      (a) =>
        a.course_id === course.id &&
        a.graded &&
        a.score != null &&
        a.points_possible > 0,
    )
    .map((a) => (100 * a.score!) / a.points_possible);
  const observations = history.length >= 2 ? history : posted;
  let current = course.current_score;
  if (current === null && (history.length || posted.length)) {
    current = mean(history.length ? history : posted);
  }
  // Without a baseline only fully specified shocks can set the grade.
  const fullySpecified =
    openWeight >= 100 && remaining.every((a) => a.id in overrides);
  if (current === null && !fullySpecified) return result;
  const baseline = Math.min(100, Math.max(0, current ?? 0));
  const spread =
    observations.length >= 2 ? pstdev(observations) : DEFAULT_SPREAD;

  const paths = new Float64Array(iterations).fill(
    baseline * (1 - openWeight / total),
  );
  remaining.forEach((assignment, index) => {
    const { marginal_impact } = sensitivity[index];
    const override = overrides[assignment.id];
    if (override !== undefined) {
      for (let i = 0; i < iterations; i += 1) paths[i] += marginal_impact * override;
      return;
    }
    const random = seededRandom(
      hash(`apex-monte-carlo:${course.id}:${assignment.id}`),
    );
    for (let i = 0; i < iterations; i += 1) {
      const z =
        Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) *
        Math.cos(2 * Math.PI * random());
      paths[i] +=
        marginal_impact * Math.min(100, Math.max(0, baseline + spread * z));
    }
  });
  paths.sort();

  const percentiles: ScorePercentiles = {
    p10: percentile(paths, 0.1),
    p25: percentile(paths, 0.25),
    p50: percentile(paths, 0.5),
    p75: percentile(paths, 0.75),
    p90: percentile(paths, 0.9),
  };
  let sum = 0;
  let hits = 0;
  for (const grade of paths) {
    sum += grade;
    if (grade >= course.target_score) hits += 1;
  }
  return {
    ...result,
    percentiles,
    var_90: Math.max(0, sum / iterations - percentiles.p10),
    probability_of_target: hits / iterations,
  };
}

/** The offline engine: the backend's response, computed from the terminal's own course book. */
export function simulateLocally(
  request: MonteCarloRequest,
  state: Pick<TerminalState, "courses" | "assignments">,
): MonteCarloResponse {
  const iterations = Math.round(
    Math.min(
      MAX_ITERATIONS,
      Math.max(MIN_ITERATIONS, request.iterations ?? DEFAULT_ITERATIONS),
    ),
  );
  const overrides = Object.fromEntries(
    Object.entries(request.shock_overrides ?? {})
      .filter(([, score]) => Number.isFinite(score))
      .map(([id, score]) => [id, Math.min(100, Math.max(0, score))]),
  );
  const courses = state.courses.filter(
    (c) => request.course_id === undefined || c.id === request.course_id,
  );
  return {
    iterations,
    courses: courses.map((course) =>
      simulateCourse(course, state.assignments, iterations, overrides),
    ),
  };
}

// ------------------------------------------------------------------ desk views

/**
 * The desk's request for one course. Overrides outside the course's remaining
 * weighted work are dropped: the backend rejects them with HTTP 422.
 */
export function shockRequest(
  courseId: string,
  assignments: Assignment[],
  overrides: Record<string, number>,
  iterations = DEFAULT_ITERATIONS,
): MonteCarloRequest {
  const eligible = new Set(remainingWork(courseId, assignments).map((a) => a.id));
  return {
    course_id: courseId,
    iterations,
    shock_overrides: Object.fromEntries(
      Object.entries(overrides).filter(([id]) => eligible.has(id)),
    ),
  };
}

export interface QuantilePoint {
  /** Percentile, 10–90. */
  q: number;
  grade: number;
}

/** The final grade's quantile curve (inverse CDF) through the reported percentiles. */
export const quantileCurve = (p: ScorePercentiles): QuantilePoint[] => [
  { q: 10, grade: p.p10 },
  { q: 25, grade: p.p25 },
  { q: 50, grade: p.p50 },
  { q: 75, grade: p.p75 },
  { q: 90, grade: p.p90 },
];

export interface LeverageRow extends AssignmentSensitivity {
  rank: number;
  title: string;
  /** Final-grade points a SENSITIVITY_BUMP-point lift on this deliverable buys. */
  lift: number;
  /** Leverage relative to the top row, 0–1. */
  share: number;
}

/** The sensitivity matrix ranked by marginal leverage, with titles from the course book. */
export function leverageTable(
  simulation: CourseSimulation,
  assignments: Assignment[],
): LeverageRow[] {
  const titles = new Map(assignments.map((a) => [a.id, a.title]));
  const ranked = rankSensitivity(simulation.sensitivity_matrix);
  const top = ranked[0]?.marginal_impact ?? 0;
  return ranked.map((row, index) => ({
    ...row,
    rank: index + 1,
    title: titles.get(row.assignment_id) ?? row.assignment_id,
    lift: row.marginal_impact * SENSITIVITY_BUMP,
    share: top > 0 ? row.marginal_impact / top : 0,
  }));
}
