// Focus block: the one time-boxed work session to start now, chosen from the
// terminal state and, when it is supplied, the circuit breaker's guidance. Pure
// and deterministic given `now`. It only recommends: no task, budget, or
// deadline is ever changed.

import { LEVEL_STYLE, type CircuitBreakerStatus } from "@/lib/circuitBreaker";
import {
  gradeRisk,
  isUntriaged,
  leaves,
  rankQueue,
  rollup,
} from "@/lib/engine";
import type { Assignment, SubTaskNode, TerminalState } from "@/types";

/** Minutes of work one focus block holds. */
export const FOCUS_BLOCK_MINUTES = 45;

export interface FocusBlockTask {
  id: string;
  title: string;
  estimated_minutes: number;
  is_completed: boolean;
}

export interface FocusBlock {
  assignment_id: string;
  course_id: string;
  course_code: string;
  assignment_title: string;
  due_at: string | null;
  /** Lowest score on this deliverable that keeps the course on target; null without a grade or weight. */
  break_even_score: number | null;
  /** Final-grade points the block locks in: weight × its share of the plan's estimate. */
  points_locked_in: number;
  /** Course grade left if this deliverable scored zero, other work held at the current grade. */
  downside_floor: number | null;
  total_minutes: number;
  tasks: FocusBlockTask[];
  policy_reason: string;
}

interface Candidate {
  assignment: Assignment;
  /** Open leaves in plan order; null while the deliverable still needs triage. */
  open: SubTaskNode[] | null;
}

/** The first deliverable in the queue with work left to do. */
function firstWorkable(queue: Assignment[]): Candidate | null {
  for (const assignment of queue) {
    if (isUntriaged(assignment)) return { assignment, open: null };
    const open = leaves(assignment.subtasks).filter(
      (leaf) => !leaf.is_completed,
    );
    if (open.length) return { assignment, open };
  }
  return null;
}

/**
 * Open leaves in plan order until the next one would overflow the budget. A
 * first leaf longer than the whole budget is time-boxed to it, so a block is
 * never empty. An untriaged deliverable gets one full-length focus task.
 */
function pack({ assignment, open }: Candidate): FocusBlockTask[] {
  if (!open) {
    return [
      {
        id: `${assignment.id}-focus`,
        title: `Focus: ${assignment.title}`,
        estimated_minutes: FOCUS_BLOCK_MINUTES,
        is_completed: false,
      },
    ];
  }
  const tasks: FocusBlockTask[] = [];
  let used = 0;
  for (const leaf of open) {
    const wanted = Math.max(0, leaf.estimated_minutes);
    const room = FOCUS_BLOCK_MINUTES - used;
    if (wanted > room && tasks.length) break;
    const minutes = Math.min(wanted, room);
    tasks.push({
      id: leaf.id,
      title: leaf.title,
      estimated_minutes: minutes,
      is_completed: false,
    });
    used += minutes;
  }
  return tasks;
}

/**
 * Picks the top-priority open deliverable and packs its next tasks into one
 * block. Under a Level 2 or 3 breaker, courses it halted are never chosen from;
 * at any triggered level, the work it protects goes ahead of the rest of the
 * queue. Null when no eligible deliverable has work left.
 */
export function buildFocusBlock(
  state: TerminalState,
  now: number = Date.now(),
  breaker?: CircuitBreakerStatus | null,
): FocusBlock | null {
  const queue = rankQueue(
    state.assignments.filter((a) => !a.graded),
    now,
  ).map((entry) => entry.assignment);

  const rank = breaker ? LEVEL_STYLE[breaker.level].rank : 0;
  const halted = new Set(rank >= 2 ? breaker?.halted_course_ids : []);
  const guarded = new Set(rank >= 1 ? breaker?.protected_assignment_ids : []);
  const eligible = queue.filter((a) => !halted.has(a.course_id));
  const chosen = firstWorkable([
    ...eligible.filter((a) => guarded.has(a.id)),
    ...eligible.filter((a) => !guarded.has(a.id)),
  ]);
  if (!chosen) return null;

  const { assignment } = chosen;
  const course =
    state.courses.find((c) => c.id === assignment.course_id) ?? null;
  const tasks = pack(chosen);
  const totalMinutes = tasks.reduce((sum, t) => sum + t.estimated_minutes, 0);
  const planMinutes = rollup(assignment.subtasks).estimated;
  const current = course?.current_score ?? null;
  const exposure = Math.min(Math.max(assignment.weight, 0), 100) / 100;

  // Without the breaker, would a halted course have taken this slot?
  const unconstrained = firstWorkable(queue);
  const policy_reason = guarded.has(assignment.id)
    ? `BREAKER L${rank} · PROTECTING ${assignment.course_code}`
    : unconstrained && unconstrained.assignment.id !== assignment.id
      ? `BREAKER L${rank} · ${unconstrained.assignment.course_code} HALTED · REALLOCATED TO ${assignment.course_code}`
      : "HIGHEST GRADE YIELD · TOP OF QUEUE";

  return {
    assignment_id: assignment.id,
    course_id: assignment.course_id,
    course_code: assignment.course_code,
    assignment_title: assignment.title,
    due_at: assignment.due_at,
    break_even_score: gradeRisk(assignment, course).floor,
    points_locked_in:
      planMinutes > 0 ? (assignment.weight * totalMinutes) / planMinutes : 0,
    downside_floor: current === null ? null : current * (1 - exposure),
    total_minutes: totalMinutes,
    tasks,
    policy_reason,
  };
}
