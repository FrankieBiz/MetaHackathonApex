// Saved-sandbox support. The dataset itself lives in mockData.ts; this keeps a
// session restored from localStorage on live countdowns.

import type { TerminalState } from "@/types";

const shiftIso = (iso: string | null, ms: number) =>
  iso ? new Date(Date.parse(iso) + ms).toISOString() : iso;

/** Slides every timestamp forward so a saved sandbox keeps its live countdowns. */
export function reanchor(state: TerminalState, ms: number): TerminalState {
  return {
    ...state,
    courses: state.courses.map((course) => ({
      ...course,
      grade_history: course.grade_history.map((point) => ({
        ...point,
        at: shiftIso(point.at, ms) ?? point.at,
      })),
    })),
    assignments: state.assignments.map((assignment) => ({
      ...assignment,
      due_at: shiftIso(assignment.due_at, ms),
    })),
  };
}
