// Defense Council: the contract of POST /api/v1/triage/{id}/council and the
// offline council behind api.defenseCouncil. Three seats argue one
// deliverable: the Professor holds the rubric, the Student holds the workload,
// and the Arbitrator reconciles them into a verdict. The local council mirrors
// backend/ai_engine.py `_local_defense_council` word for word, so a detached
// desk convenes the same bench the backend falls back to.

import {
  gradeRisk,
  localTriage,
  reasoningTrace,
  rubricBreakdown,
  triageContext,
} from "@/lib/engine";
import type { InferenceTelemetry } from "@/store/inference";
import type { Assignment, SubTaskNode, TerminalState } from "@/types";

export const COUNCIL_ROLES = ["Professor", "Student", "Arbitrator"] as const;
export type CouncilRole = (typeof COUNCIL_ROLES)[number];

/** What each seat argues for. */
export const COUNCIL_SEATS: Record<CouncilRole, { brief: string }> = {
  Professor: { brief: "Academic standards & rubric strictness" },
  Student: { brief: "Syllabus arbitrage & high-ROI triage" },
  Arbitrator: { brief: "Reconciled consensus action plan" },
};

export interface DefenseCouncilMember {
  role: CouncilRole;
  position: string;
  priorities: string[];
}

export interface DefenseCouncilDeliberation {
  assignment_id: string;
  /** Always Professor, Student, Arbitrator, in that order. */
  members: DefenseCouncilMember[];
  verdict: string;
  /** The council's consensus work breakdown (the existing tree once work has started). */
  subtasks: SubTaskNode[];
  source: "ai" | "local";
  telemetry: InferenceTelemetry;
}

export const LOCAL_COUNCIL_MODEL = "local-defense-council";

/** Python's `:g`: six significant digits, no trailing zeros. */
const g = (value: number) => String(Number(value.toPrecision(6)));

/**
 * As backend `rubric_constraints` for "Rubric: a 60% (…), b 30%." prompts:
 * each criterion with its share and points, highest weight first.
 */
export function rubricConstraints(
  assignment: Pick<Assignment, "description" | "points_possible">,
): string[] {
  return rubricBreakdown(assignment)
    .map((line) => {
      const points = Math.floor(line.points * 10 + 0.5) / 10;
      let text = `${line.criterion} ${g(line.percent)}% (${g(points)} pts)`;
      if (line.detail) text += `: ${line.detail.split(/\s+/).join(" ")}`;
      return { percent: line.percent, text };
    })
    .sort((x, y) => y.percent - x.percent)
    .map((line) => line.text);
}

/** The Arbitrator's note on the protective score (the grade floor). */
export function floorNote(floor: number | null): string {
  if (floor === null)
    return "The protective score is unknown without a posted grade and positive assignment weight.";
  return (
    `The protective score is ${floor.toFixed(1)}%. ` +
    (floor > 100
      ? "It exceeds 100%; this assignment alone cannot restore the target."
      : "")
  );
}

export function localDefenseCouncil(
  assignment: Assignment,
  state: Pick<TerminalState, "courses" | "assignments">,
  now = Date.now(),
): DefenseCouncilDeliberation {
  const started = performance.now();
  const context = triageContext(state, assignment, now);
  const constraints = rubricConstraints(assignment)
    .slice(0, 6)
    .map((c) => c.slice(0, 500));
  const { floor } = gradeRisk(assignment, context.course);
  const note = floorNote(floor);
  const verdict =
    "Secure the highest-weighted stated rubric criteria first, check each deliverable, " +
    "then submit within the available capacity. " +
    note;
  const capacity = reasoningTrace(assignment, context, assignment.subtasks, {
    engine: LOCAL_COUNCIL_MODEL,
    latency_ms: 0,
  })[1];
  return {
    assignment_id: assignment.id,
    members: [
      {
        role: "Professor",
        position:
          "Evaluate the stated rubric and require evidence for each criterion.",
        priorities: constraints.length
          ? constraints
          : ["Read the brief and identify the stated deliverables"],
      },
      {
        role: "Student",
        position: capacity.summary,
        priorities: [
          `Account for ${context.queued} queued minutes before this deadline`,
          "Use short work blocks and verify the highest-weighted criteria first",
        ],
      },
      {
        role: "Arbitrator",
        position: verdict,
        priorities: [
          note.trim(),
          "Check evidence against the rubric before submission",
        ],
      },
    ],
    verdict,
    subtasks: assignment.subtasks.length
      ? assignment.subtasks
      : localTriage(assignment),
    source: "local",
    telemetry: {
      model_used: LOCAL_COUNCIL_MODEL,
      latency_ms: Math.round(performance.now() - started),
      prompt_tokens: null,
      completion_tokens: null,
      tokens_per_sec: null,
    },
  };
}
