// Circuit breaker: the contract of POST /api/v1/portfolio/circuit-breaker and
// the offline evaluator behind api.circuitBreaker. An academic Rule 80B
// analog on percentage-point shortfalls (not market drawdowns). Mirrors
// backend/service.py `evaluate_circuit_breaker` line for line, so a detached
// desk trips at the same thresholds. Restriction pauses work in healthy
// courses ("halted") to protect weighted work in below-target ones. It only
// recommends: no task, budget, or deadline is ever changed.

import { leaves } from "@/lib/engine";
import type { Assignment, TerminalState } from "@/types";

export const BREAKER_LEVELS = [
  "NORMAL",
  "LEVEL_1_CAUTION",
  "LEVEL_2_RESTRICTION",
  "LEVEL_3_HALT",
] as const;
export type BreakerLevel = (typeof BREAKER_LEVELS)[number];

/** Level 1: a course more than this many points under its target. */
export const CAUTION_DEFICIT = 5;
/** Level 2: any course under this score (or two courses under target). */
export const RESTRICTION_FLOOR = 65;
/** Level 3: any course under this score. */
export const HALT_FLOOR = 55;
/** Level 3: the mean shortfall across graded courses reaches this. */
export const LIQUIDATION_DEFICIT = 20;

export interface CircuitBreakerStatus {
  level: BreakerLevel;
  triggered: boolean;
  /** Healthy courses whose open work is paused so its time can move. */
  halted_course_ids: string[];
  /** Weighted open work in below-target or ungraded courses. */
  protected_assignment_ids: string[];
  /** Remaining estimated minutes on paused work, proposed for reallocation. */
  reallocated_minutes: number;
  reason: string;
  recommendations: string[];
}

const byId = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

export function evaluateCircuitBreaker(
  state: Pick<TerminalState, "courses" | "assignments">,
): CircuitBreakerStatus {
  const observed = state.courses.filter(
    (c): c is typeof c & { current_score: number } => c.current_score !== null,
  );
  const breached = observed.filter((c) => c.current_score < c.target_score);
  const deficit = observed.length
    ? mean(observed.map((c) => c.target_score - c.current_score))
    : 0;
  let level: BreakerLevel = "NORMAL";
  let reason = "No posted course crosses an intervention threshold.";
  if (
    observed.some((c) => c.current_score < HALT_FLOOR) ||
    deficit >= LIQUIDATION_DEFICIT
  ) {
    level = "LEVEL_3_HALT";
    reason =
      "A course is below 55% or the portfolio deficit reaches 20 percentage points.";
  } else if (
    breached.length >= 2 ||
    observed.some((c) => c.current_score < RESTRICTION_FLOOR)
  ) {
    level = "LEVEL_2_RESTRICTION";
    reason = "Multiple courses are below target or a course is below 65%.";
  } else if (
    breached.some((c) => c.target_score - c.current_score > CAUTION_DEFICIT)
  ) {
    level = "LEVEL_1_CAUTION";
    reason = "A course is more than five percentage points below its target.";
  }

  const triggered = level !== "NORMAL";
  const restricted =
    level === "LEVEL_2_RESTRICTION" || level === "LEVEL_3_HALT";
  const healthy = new Set(
    observed
      .filter(
        (c) =>
          c.current_score >= c.target_score &&
          c.current_score >= RESTRICTION_FLOOR,
      )
      .map((c) => c.id),
  );
  const vulnerable = new Set(
    state.courses.filter((c) => !healthy.has(c.id)).map((c) => c.id),
  );
  const active = state.assignments.filter(
    (a) => !a.graded && a.status !== "completed",
  );
  const protectedWork = active.filter(
    (a) => vulnerable.has(a.course_id) && a.weight > 0,
  );
  // Zero-weight work is deferred only at HALT, and only when a critical path exists.
  const deferred =
    restricted && protectedWork.length
      ? active.filter(
          (a) =>
            healthy.has(a.course_id) ||
            (level === "LEVEL_3_HALT" && a.weight === 0),
        )
      : [];
  const minutes = deferred
    .flatMap((a) => leaves(a.subtasks))
    .filter((leaf) => !leaf.is_completed)
    .reduce(
      (sum, leaf) =>
        sum + Math.max(0, leaf.estimated_minutes - leaf.actual_minutes),
      0,
    );

  const recommendations: string[] = [];
  if (triggered) {
    recommendations.push(
      "Protect required rubric criteria in below-target courses first.",
    );
    for (const a of [...active].sort((x, y) => byId(x.id, y.id))) {
      if (a.weight === 0) {
        recommendations.push(
          `Review low-yield subtasks for ${a.id}: ${a.title}; ` +
            "zero recorded weight may mean the grade weight is unknown.",
        );
      }
    }
    if (deferred.length) {
      recommendations.push(
        `Temporarily defer non-critical work and propose moving ${minutes} remaining ` +
          "study minutes to protected assignments; confirm course requirements first.",
      );
    }
    if (level === "LEVEL_3_HALT") {
      recommendations.push(
        "Discuss a recovery plan with the instructor or academic adviser.",
      );
    }
  }
  if (observed.length < state.courses.length) {
    recommendations.push(
      "Verify missing course grades before reallocating their study time.",
    );
  }
  return {
    level,
    triggered,
    halted_course_ids: [
      ...new Set(
        deferred
          .filter((a) => healthy.has(a.course_id))
          .map((a) => a.course_id),
      ),
    ].sort(byId),
    protected_assignment_ids: triggered
      ? protectedWork.map((a) => a.id).sort(byId)
      : [],
    reallocated_minutes: minutes,
    reason,
    recommendations,
  };
}

/** Order book marks: paused for reallocation, or protected as critical path. */
export type HaltState = "halted" | "protected";

/**
 * Open deliverables the breaker acts on. A halted course pauses all of its
 * open work; protected work is named by id.
 */
export function haltIndex(
  assignments: Assignment[],
  status: CircuitBreakerStatus,
): Map<string, HaltState> {
  const index = new Map<string, HaltState>();
  if (!status.triggered) return index;
  const halted = new Set(status.halted_course_ids);
  const guarded = new Set(status.protected_assignment_ids);
  for (const a of assignments) {
    if (a.graded || a.status === "completed") continue;
    if (guarded.has(a.id)) index.set(a.id, "protected");
    else if (halted.has(a.course_id)) index.set(a.id, "halted");
  }
  return index;
}

export interface LevelStyle {
  /** 0 for NORMAL, then 1–3. */
  rank: 0 | 1 | 2 | 3;
  label: string;
  short: string;
}

export const LEVEL_STYLE: Record<BreakerLevel, LevelStyle> = {
  NORMAL: { rank: 0, label: "NORMAL", short: "NORMAL" },
  LEVEL_1_CAUTION: { rank: 1, label: "LEVEL 1 · CAUTION", short: "L1" },
  LEVEL_2_RESTRICTION: { rank: 2, label: "LEVEL 2 · RESTRICTION", short: "L2" },
  LEVEL_3_HALT: { rank: 3, label: "LEVEL 3 · HALT", short: "L3" },
};
