// Office hours negotiator: the contract of POST /api/v1/triage/{id}/negotiate
// and the offline template behind api.negotiatePetition. The local petition mirrors
// backend/ai_engine.py `_local_negotiation_draft` word for word, so a detached
// desk drafts what the backend falls back to. Drafts are never sent: the
// student edits, copies, or opens them in their own mail client.
//
// The case file is terminal-side only. It surfaces facts the drafting model is
// not given (other courses' deadlines, the student's logged progress, the
// circuit breaker) as first-person sentences the student may add to the
// self-reported reason.

import {
  haltIndex,
  LEVEL_STYLE,
  type CircuitBreakerStatus,
} from "@/lib/circuitBreaker";
import {
  clusterIndex,
  clusterWindow,
  congestionTier,
  detectCongestion,
} from "@/lib/congestion";
import {
  floorText,
  gradeRisk,
  hoursUntil,
  isActive,
  leaves,
  rollup,
  triageContext,
} from "@/lib/engine";
import { minutes, shortDate, signed } from "@/lib/format";
import type { InferenceTelemetry } from "@/store/inference";
import type { Assignment, TerminalState } from "@/types";

export const PETITION_TYPES = [
  "extension",
  "regrade",
  "office_hours_script",
] as const;
export type PetitionType = (typeof PETITION_TYPES)[number];

export const PETITION_LABEL: Record<
  PetitionType,
  { label: string; brief: string }
> = {
  extension: {
    label: "EXTENSION REQUEST",
    brief: "Ask whether a new deadline is possible",
  },
  regrade: {
    label: "REGRADE PETITION",
    brief: "Review how the rubric applied to scored work",
  },
  office_hours_script: {
    label: "OFFICE HOURS PITCH",
    brief: "Focused questions and a concrete next step",
  },
};

/** The backend's `student_reason` bound. */
export const STUDENT_REASON_LIMIT = 4000;
export const LOCAL_NEGOTIATION_MODEL = "local-negotiation-template";

export interface NegotiationRequest {
  petition_type: PetitionType;
  /** Self-reported and unverified; null when blank. */
  student_reason: string | null;
}

export interface NegotiationPetition {
  assignment_id: string;
  petition_type: PetitionType;
  /** "Instructor" unless the syllabus names one exactly. */
  instructor_name: string;
  /** One line. */
  email_subject: string;
  email_body: string;
  /** One to six spoken beats, about a minute in all. */
  office_hours_pitch_60s: string[];
  /** Exact syllabus excerpts; empty when no policy was found. */
  syllabus_clauses_cited: string[];
  source: "ai" | "local";
  telemetry: InferenceTelemetry;
}

const PETITION_ACTIONS: Record<PetitionType, readonly [string, string]> = {
  extension: [
    "Extension request",
    "Could we discuss whether an extension is possible and, if so, agree on a new " +
      "deadline? I understand that approval depends on the course policy.",
  ],
  regrade: [
    "Rubric review request",
    "Could we review how the rubric applies to my work and clarify any discrepancy? " +
      "I will bring the submission and specific rubric evidence for discussion.",
  ],
  office_hours_script: [
    "Office hours discussion",
    "Could we review the assignment requirements during office hours and identify " +
      "the most useful next step? I will bring specific questions and my work.",
  ],
};

/** Trimmed and bounded as the backend validates it; blank is null. */
export function normalizeReason(raw: string | null | undefined): string | null {
  const reason = (raw ?? "").trim().slice(0, STUDENT_REASON_LIMIT).trim();
  return reason || null;
}

/** Python's `" ".join(text.split())`. */
const collapse = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");

export function localNegotiationPetition(
  assignment: Pick<Assignment, "id" | "title" | "course_code">,
  request: NegotiationRequest,
  started = performance.now(),
): NegotiationPetition {
  const [subject, action] = PETITION_ACTIONS[request.petition_type];
  const given = request.student_reason?.trim();
  const reason = given
    ? `My reason for requesting this discussion: ${given}\n\n`
    : "";
  return {
    assignment_id: assignment.id,
    petition_type: request.petition_type,
    instructor_name: "Instructor",
    email_subject: collapse(
      `${subject}: ${assignment.course_code} — ${assignment.title}`,
    ).slice(0, 500),
    email_body:
      `Dear Instructor,\n\nI am writing about ${assignment.title} in ` +
      `${assignment.course_code}.\n\n${reason}${action}\n\n` +
      "I have not verified an applicable syllabus policy; please confirm the relevant " +
      "policy and available options.\n\nThank you for your time.",
    office_hours_pitch_60s: [
      `Thank you for meeting with me about ${assignment.title}.`.slice(0, 1500),
      action,
      "Please help me confirm the applicable policy and agree on a concrete next step.",
    ],
    syllabus_clauses_cited: [],
    source: "local",
    telemetry: {
      model_used: LOCAL_NEGOTIATION_MODEL,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
      prompt_tokens: null,
      completion_tokens: null,
      tokens_per_sec: null,
    },
  };
}

// ------------------------------------------------------------- case file

export type FactTone = "up" | "down" | "accent" | "neutral";

export interface CaseFact {
  id:
    | "standing"
    | "floor"
    | "deadline"
    | "congestion"
    | "workload"
    | "progress"
    | "breaker";
  label: string;
  detail: string;
  tone: FactTone;
  /**
   * A first-person sentence for the petition reason; null for facts the
   * drafting model already receives (grades, weight, due date).
   */
  reason: string | null;
}

export interface NegotiationCase {
  facts: CaseFact[];
  recommended: PetitionType;
  rationale: string;
}

/** Open work above this share of the clock left is a crunch (the trace's risk line). */
export const CRUNCH_SHARE = 0.5;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** 9h · 2d 4h */
function span(hours: number): string {
  const h = Math.round(Math.abs(hours));
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * What the student can bring to the table for one deliverable, and the
 * petition that fits it: scored work → regrade; past due, a congested window,
 * or more open work than half the clock left → extension; otherwise a focused
 * office hours conversation.
 */
export function negotiationCase(
  assignment: Assignment,
  state: Pick<TerminalState, "courses" | "assignments">,
  now: number,
  breaker?: CircuitBreakerStatus,
): NegotiationCase {
  const facts: CaseFact[] = [];
  const course =
    state.courses.find((c) => c.id === assignment.course_id) ?? null;
  const code = assignment.course_code;
  const open = isActive(assignment) && !assignment.graded;
  const hours = hoursUntil(assignment.due_at, now);
  const codes = new Map(state.courses.map((c) => [c.id, c.course_code]));

  facts.push(
    course?.current_score == null
      ? {
          id: "standing",
          label: "Standing",
          detail: `${code} · no course grade posted yet`,
          tone: "neutral",
          reason: null,
        }
      : {
          id: "standing",
          label: "Standing",
          detail: `${code} ${course.current_score.toFixed(1)}% vs ${course.target_score.toFixed(1)}% target (${signed(course.current_score - course.target_score)})`,
          tone: course.current_score >= course.target_score ? "up" : "down",
          reason: null,
        },
  );

  if (assignment.graded) {
    facts.push({
      id: "floor",
      label: "Scored",
      detail:
        assignment.score == null
          ? "Graded or excused in Canvas"
          : `${assignment.score} / ${assignment.points_possible} pts · ${assignment.weight.toFixed(1)}% of the grade`,
      tone: "neutral",
      reason: null,
    });
  } else {
    const { floor } = gradeRisk(assignment, course);
    facts.push({
      id: "floor",
      label: "Floor",
      detail: floorText(floor, course),
      tone:
        floor === null
          ? "neutral"
          : floor > 100
            ? "down"
            : floor >= 85
              ? "accent"
              : "neutral",
      reason: null,
    });
  }

  if (assignment.due_at && hours !== null) {
    const date = shortDate(assignment.due_at);
    facts.push({
      id: "deadline",
      label: "Deadline",
      detail: !open
        ? `Due ${date} · submitted`
        : hours < 0
          ? `Past due ${date} · ${span(hours)} ago`
          : `Due ${date} · in ${span(hours)}`,
      tone: !open
        ? "neutral"
        : hours < 0
          ? "down"
          : hours < 24
            ? "accent"
            : "neutral",
      reason: null,
    });
  } else {
    facts.push({
      id: "deadline",
      label: "Deadline",
      detail: "No due date published",
      tone: "neutral",
      reason: null,
    });
  }

  const cluster = open
    ? clusterIndex(detectCongestion(state.assignments, now)).get(assignment.id)
    : undefined;
  const tier = cluster ? congestionTier(cluster.congestion_score) : null;
  if (cluster) {
    const others = cluster.assignment_ids.length - 1;
    const otherCourses = cluster.course_ids
      .filter((id) => id !== assignment.course_id)
      .map((id) => codes.get(id) ?? id)
      .join(", ");
    const window = clusterWindow(cluster);
    facts.push({
      id: "congestion",
      label: "Congestion",
      detail: `${plural(cluster.assignment_ids.length, "deliverable")} across ${cluster.course_ids.map((id) => codes.get(id) ?? id).join(", ")} due ${window}`,
      tone:
        tier === "critical"
          ? "down"
          : tier === "elevated"
            ? "accent"
            : "neutral",
      reason: `This deadline falls in a 72-hour window with ${plural(others, "other deliverable")} across ${otherCourses} (${window}).`,
    });
  }

  let share = 0;
  if (open && hours !== null && hours > 0) {
    const own = leaves(assignment.subtasks)
      .filter((leaf) => !leaf.is_completed)
      .reduce((sum, leaf) => sum + leaf.estimated_minutes, 0);
    const total = own + triageContext(state, assignment, now).queued;
    if (total > 0) {
      share = total / 60 / hours;
      facts.push({
        id: "workload",
        label: "Workload",
        detail: `${minutes(total)} planned before this deadline · ${span(hours)} left (${Math.round(share * 100)}% of the clock)`,
        tone:
          share >= CRUNCH_SHARE
            ? "down"
            : share >= CRUNCH_SHARE / 2
              ? "accent"
              : "neutral",
        reason: `I have about ${minutes(total)} of planned coursework due before this deadline, with ${Math.round(hours)} hours remaining.`,
      });
    }
  }

  if (assignment.subtasks.length) {
    const r = rollup(assignment.subtasks);
    facts.push({
      id: "progress",
      label: "Progress",
      detail: `${r.done} of ${plural(r.total, "step")} done · ${minutes(r.actual)} logged`,
      tone: r.done ? "up" : "neutral",
      reason:
        r.done || r.actual
          ? `I have completed ${r.done} of ${plural(r.total, "planned step")} and logged ${minutes(r.actual)} on it so far.`
          : null,
    });
  } else {
    facts.push({
      id: "progress",
      label: "Progress",
      detail: "Not broken down yet · triage to size the work",
      tone: "neutral",
      reason: null,
    });
  }

  const mark = breaker
    ? haltIndex([assignment], breaker).get(assignment.id)
    : undefined;
  if (breaker && mark) {
    const level = LEVEL_STYLE[breaker.level].label;
    facts.push(
      mark === "protected"
        ? {
            id: "breaker",
            label: "Breaker",
            detail: `Protected · ${level}`,
            tone: "down",
            reason:
              course?.current_score == null
                ? `${code} has no posted grade yet, so I am treating this assignment as a priority.`
                : course.current_score < course.target_score
                  ? `My grade in ${code} is below my target, so this assignment is my priority.`
                  : `My grade in ${code} is below 65%, so this assignment is my priority.`,
          }
        : {
            id: "breaker",
            label: "Breaker",
            detail: `Paused · ${level} · time moves to protected work`,
            tone: "accent",
            reason: null,
          },
    );
  }

  if (assignment.graded && assignment.score != null) {
    return {
      facts,
      recommended: "regrade",
      rationale:
        "Scored work: ask for a rubric review against evidence, not points.",
    };
  }
  if (open && hours !== null && hours < 0) {
    return {
      facts,
      recommended: "extension",
      rationale:
        "Past due: ask whether late work or a new deadline is possible.",
    };
  }
  if (
    open &&
    (tier === "critical" || tier === "elevated" || share >= CRUNCH_SHARE)
  ) {
    return {
      facts,
      recommended: "extension",
      rationale:
        tier === "critical" || tier === "elevated"
          ? "Deadline pile-up across courses: ask whether the date can move."
          : "More open work than half the clock left: ask whether the date can move.",
    };
  }
  return {
    facts,
    recommended: "office_hours_script",
    rationale:
      "Nothing forces a petition: clarify requirements and agree a next step.",
  };
}

/** Appends a fact sentence to the reason once, inside the backend's bound. */
export function addToReason(reason: string, sentence: string): string {
  if (reason.includes(sentence)) return reason;
  const base = reason.trimEnd();
  return `${base}${base ? " " : ""}${sentence}`.slice(0, STUDENT_REASON_LIMIT);
}

// --------------------------------------------------------- send yourself

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/;

export const isEmail = (raw: string) => EMAIL.test(raw.trim());

/**
 * A mailto: link that opens the student's mail client with the draft filled
 * in; they press send. Line breaks become CRLF as RFC 6068 asks, and the
 * subject is forced onto one line.
 */
export function mailtoUrl(subject: string, body: string, to = ""): string {
  const address = isEmail(to) ? encodeURIComponent(to.trim()) : "";
  return (
    `mailto:${address}?subject=${encodeURIComponent(collapse(subject))}` +
    `&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`
  );
}

/** About 150 spoken words a minute. */
export const SPEAKING_WPM = 150;

export function spokenSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.round((words * 60) / SPEAKING_WPM)) : 0;
}

/** The pitch as plain text: one numbered beat per line. */
export const pitchText = (beats: string[]) =>
  beats.map((beat, index) => `${index + 1}. ${beat}`).join("\n");
