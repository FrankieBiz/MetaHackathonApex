// Margin call: the contract of POST /api/v1/portfolio/margin-call and the
// offline engine behind api.marginCall. Mirrors backend/service.py
// `generate_margin_call` (built on the same dossier figures), so a detached
// desk raises the same call and drafts the same message. Nothing is ever sent:
// the WhatsApp payload is a preview the student can copy or share themselves.

import { generateLocalReport, type AcademicStance } from "@/lib/portfolioReport";
import type { TerminalState } from "@/types";

/** A book this far under target triggers a call even outside CRITICAL_INTERVENTION. */
export const LIQUIDATION_TRIGGER = 5;
/** WhatsApp's text body limit. */
export const WHATSAPP_BODY_LIMIT = 4096;

export interface MarginCallCourse {
  course_id: string;
  course_code: string;
  current_score: number;
  target_score: number;
  /** Points under target, ≥ 0. */
  deficit: number;
}

export interface MarginRestorationAction {
  assignment_id: string;
  course_id: string;
  title: string;
  due_at: string | null;
  /** Final-grade points per point scored, 0–1. */
  marginal_impact: number;
  /** Score this deliverable alone needs to restore the target; null without a grade. */
  required_score: number | null;
}

/** WhatsApp Cloud API text message, ready for a messaging adapter; never dispatched here. */
export interface MarginCallWebhookPayload {
  messaging_product: "whatsapp";
  type: "text";
  text: { body: string };
}

export interface MarginCallReport {
  triggered: boolean;
  academic_stance: AcademicStance;
  /** How far the book's mean grade sits under its mean target, ≥ 0. */
  liquidation_deficit: number;
  breached_courses: MarginCallCourse[];
  /** Empty unless triggered. */
  restoration_order: MarginRestorationAction[];
  webhook_payload: MarginCallWebhookPayload | null;
}

/** Python's `:g`: six significant digits, no trailing zeros. */
const g = (value: number) => String(Number(value.toPrecision(6)));

/** As backend/ai_engine.py `grade_floor`: the break-even score with other work held. */
const gradeFloor = (weight: number, current: number, target: number) =>
  weight > 0 ? current - ((current - target) * 100) / weight : null;

const byId = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
const dueKey = (iso: string | null) =>
  iso === null ? Number.POSITIVE_INFINITY : Date.parse(iso);

/** The message the backend drafts, line for line. */
export function marginCallMessage(
  report: Pick<
    MarginCallReport,
    "academic_stance" | "liquidation_deficit" | "breached_courses"
  >,
  actions: MarginRestorationAction[],
): string {
  const lines = [
    "ACADEMIC MARGIN CALL",
    `Stance: ${report.academic_stance}; portfolio deficit: ${report.liquidation_deficit.toFixed(2)} percentage points.`,
    ...report.breached_courses.map(
      (c) =>
        `${c.course_code}: ${g(c.current_score)}% / target ${g(c.target_score)}%`,
    ),
  ];
  const first = actions[0];
  if (first) {
    lines.push(`Restore first: ${first.title}.`);
    if (first.required_score !== null && first.required_score > 100) {
      lines.push(
        "This assignment alone cannot restore the target; review other recovery options.",
      );
    }
  } else {
    lines.push(
      "No open weighted work can restore the target; review recovery options with the instructor.",
    );
  }
  return lines.join("\n").slice(0, WHATSAPP_BODY_LIMIT);
}

export function generateLocalMarginCall(
  state: Pick<TerminalState, "courses" | "assignments">,
  now = Date.now(),
): MarginCallReport {
  const portfolio = generateLocalReport(state, now);
  const deficit = Math.max(0, -portfolio.margin);
  const triggered =
    portfolio.academic_stance === "CRITICAL_INTERVENTION" ||
    deficit > LIQUIDATION_TRIGGER;
  const breaches: MarginCallCourse[] = portfolio.course_breakdown
    .filter(
      (c): c is typeof c & { current_score: number } =>
        c.current_score !== null &&
        (c.current_score < c.target_score || c.status === "AT_RISK"),
    )
    .map((c) => ({
      course_id: c.course_id,
      course_code: c.course_code,
      current_score: c.current_score,
      target_score: c.target_score,
      deficit: Math.max(0, c.target_score - c.current_score),
    }))
    .sort((x, y) => y.deficit - x.deficit || byId(x.course_id, y.course_id));
  const byCourse = new Map(breaches.map((c) => [c.course_id, c]));
  const totals = new Map(
    breaches.map((c) => [
      c.course_id,
      Math.max(
        100,
        state.assignments
          .filter((a) => a.course_id === c.course_id && !a.graded)
          .reduce((sum, a) => sum + a.weight, 0),
      ),
    ]),
  );

  const actions: MarginRestorationAction[] = [];
  for (const assignment of state.assignments) {
    const course = byCourse.get(assignment.course_id);
    if (
      !course ||
      assignment.graded ||
      assignment.status === "completed" ||
      assignment.weight <= 0
    )
      continue;
    const impact = assignment.weight / totals.get(course.course_id)!;
    const required = gradeFloor(
      impact * 100,
      course.current_score,
      course.target_score,
    );
    actions.push({
      assignment_id: assignment.id,
      course_id: assignment.course_id,
      title: assignment.title,
      due_at: assignment.due_at,
      marginal_impact: impact,
      required_score: required === null ? null : Math.max(0, required),
    });
  }
  actions.sort(
    (x, y) =>
      byCourse.get(y.course_id)!.deficit - byCourse.get(x.course_id)!.deficit ||
      y.marginal_impact - x.marginal_impact ||
      dueKey(x.due_at) - dueKey(y.due_at) ||
      byId(x.assignment_id, y.assignment_id),
  );

  const body = {
    academic_stance: portfolio.academic_stance,
    liquidation_deficit: deficit,
    breached_courses: breaches,
  };
  return {
    triggered,
    ...body,
    restoration_order: triggered ? actions : [],
    webhook_payload: triggered
      ? {
          messaging_product: "whatsapp",
          type: "text",
          text: { body: marginCallMessage(body, actions) },
        }
      : null,
  };
}

/**
 * Graded courses under target: the top bar's cheap trigger light, without the
 * Monte Carlo pass the full report runs.
 */
export const breachCount = (state: Pick<TerminalState, "courses">) =>
  state.courses.filter(
    (c) => c.current_score !== null && c.current_score < c.target_score,
  ).length;

/** Digits only, as wa.me expects; anything shorter than a real number is dropped. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

/** A click-to-chat link that opens WhatsApp with the text drafted; the student presses send. */
export function whatsappShareUrl(text: string, phone?: string | null): string {
  const to = phone ? normalizePhone(phone) : null;
  return `https://wa.me/${to ?? ""}?text=${encodeURIComponent(text)}`;
}
