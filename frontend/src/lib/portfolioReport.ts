// Academic standing dossier: the contract of POST /api/v1/portfolio/report and
// the offline synthesizer behind api.portfolioReport. The figures mirror
// backend/service.py `_portfolio_report` (same Monte Carlo model, statuses,
// stance ladder, and action ranking), so a detached desk files the same book.

import { simulateCourse } from "@/lib/monteCarlo";
import { pct, signed } from "@/lib/format";
import type { TerminalState } from "@/types";

export type AcademicStance =
  | "MAXIMAL_AGGRESSION"
  | "ACTIVE_PROTECTION"
  | "MAINTAIN_FLOOR"
  | "CRITICAL_INTERVENTION";

export const ACADEMIC_STANCES = [
  "MAXIMAL_AGGRESSION",
  "ACTIVE_PROTECTION",
  "MAINTAIN_FLOOR",
  "CRITICAL_INTERVENTION",
] as const satisfies readonly AcademicStance[];

export type CourseStatus = "AHEAD" | "AT_TARGET" | "BEHIND" | "AT_RISK";

export interface CourseStanding {
  course_id: string;
  course_code: string;
  name: string;
  current_score: number | null;
  target_score: number;
  /** Lenient on read: an unknown backend label still renders. */
  status: CourseStatus | (string & {});
  var_90: number | null;
  /** 0–1. */
  probability_of_target: number | null;
  /** Percent of the final grade not yet graded. */
  remaining_weight: number;
}

export interface LeverageAction {
  assignment_id: string;
  course_code: string;
  title: string;
  weight: number;
  /** Final-grade points per point scored on the deliverable. */
  marginal_impact: number;
  due_at: string | null;
  /** The assignment's §4.1 priority score (weight × points / hours until due). */
  priority_score: number;
}

export interface ReportTelemetry {
  model: string;
  provider: string | null;
  tokens_per_second: number | null;
  latency_ms: number;
}

export interface PortfolioReport {
  generated_at: string;
  /** The memo, as Markdown. */
  executive_summary: string;
  academic_stance: AcademicStance;
  /** Equal-course 4.0-scale estimate from each course's median projection; 0 with none. */
  projected_gpa: number;
  /** Mean current grade across graded courses; 0 when nothing is graded. */
  portfolio_score: number;
  /** Mean target across the same courses. */
  target_score: number;
  /** portfolio_score − target_score. */
  margin: number;
  /** 90% VaR of the equal-weighted book: mean − p10 of the per-path course mean. */
  downside_var_90: number;
  course_breakdown: CourseStanding[];
  high_leverage_actions: LeverageAction[];
  telemetry: ReportTelemetry | null;
}

export type ReportFormat = "markdown" | "json";

/** The backend's report run: its default Monte Carlo request. */
export const REPORT_ITERATIONS = 1000;
export const MAX_ACTIONS = 10;
/** A margin this far below target, or a course this unlikely to recover, is at risk. */
const RISK_MARGIN = -5;
const RISK_PROBABILITY = 0.25;
/** The buffer a fully graded book needs before it presses. */
const AGGRESSION_MARGIN = 5;

export const LOCAL_TELEMETRY_MODEL = "apex-local-synthesizer";

/** US 4.0 scale: A 93, A− 90, B+ 87, B 83, B− 80, C+ 77, C 73, C− 70, D+ 67, D 63, D− 60. */
const GPA_BANDS: [number, number][] = [
  [93, 4.0],
  [90, 3.7],
  [87, 3.3],
  [83, 3.0],
  [80, 2.7],
  [77, 2.3],
  [73, 2.0],
  [70, 1.7],
  [67, 1.3],
  [63, 1.0],
  [60, 0.7],
];

export function gradePoints(score: number): number {
  return GPA_BANDS.find(([floor]) => score >= floor)?.[1] ?? 0;
}

const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/** AT_RISK: ungraded, more than 5 under, or under a 25% chance of target. */
export function courseStatus(
  margin: number | null,
  probability: number | null,
): CourseStatus {
  if (
    margin === null ||
    margin < RISK_MARGIN ||
    (probability !== null && probability < RISK_PROBABILITY)
  ) {
    return "AT_RISK";
  }
  if (margin < 0) return "BEHIND";
  return margin === 0 ? "AT_TARGET" : "AHEAD";
}

/**
 * The first rung that applies: a graded course at risk → CRITICAL_INTERVENTION;
 * any course behind → ACTIVE_PROTECTION; an ungraded course or a buffer under
 * 5 points → MAINTAIN_FLOOR; otherwise MAXIMAL_AGGRESSION.
 */
export function dossierStance(
  courses: Pick<CourseStanding, "status" | "current_score">[],
  margin: number,
): AcademicStance {
  if (courses.some((c) => c.status === "AT_RISK" && c.current_score !== null))
    return "CRITICAL_INTERVENTION";
  if (courses.some((c) => c.status === "BEHIND")) return "ACTIVE_PROTECTION";
  const observed = courses.filter((c) => c.current_score !== null);
  if (!observed.length || observed.length < courses.length || margin < AGGRESSION_MARGIN)
    return "MAINTAIN_FLOOR";
  return "MAXIMAL_AGGRESSION";
}

const STANCE_BRIEF: Record<AcademicStance, string> = {
  MAXIMAL_AGGRESSION:
    "Every course is graded and above target, with a buffer of at least five points. Press the high-leverage deliverables early and bank the margin.",
  ACTIVE_PROTECTION:
    "A course is trailing its target. Defend the margin there before adding risk anywhere else.",
  MAINTAIN_FLOOR:
    "The book holds its targets, but the buffer is thin or a course has no posted grade yet. Hold every floor and spend effort where leverage is highest.",
  CRITICAL_INTERVENTION:
    "A graded course is more than five points under target or unlikely to recover. Work the top action tonight and talk to the instructor.",
};

export const stanceLabel = (stance: AcademicStance) => stance.replaceAll("_", " ");

/** The 10th percentile by linear interpolation, as Python's quantiles(method="inclusive"). */
function p10(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * 0.1;
  const low = Math.floor(position);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const utc = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "undated");
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const num = (value: number | null, digits = 1, unit = "") =>
  value === null ? "—" : `${value.toFixed(digits)}${unit}`;
const prob = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

/** The memo for a report's figures, as Markdown. */
export function renderMemo(
  report: Omit<PortfolioReport, "executive_summary" | "telemetry">,
  source = "Local synthesizer",
): string {
  const graded = report.course_breakdown.some((c) => c.current_score !== null);
  const lines = [
    "# ACADEMIC STANDING DOSSIER",
    "",
    `_${utc(report.generated_at)} · ${source}_`,
    "",
    `## Stance: ${stanceLabel(report.academic_stance)}`,
    "",
    STANCE_BRIEF[report.academic_stance],
    "",
    "## Book",
    "",
    graded
      ? `- Portfolio score: **${pct(report.portfolio_score)}** vs ${pct(report.target_score)} target (margin ${signed(report.margin)})`
      : "- Portfolio score: no posted grades yet",
    `- Projected GPA: **${report.projected_gpa.toFixed(2)}** / 4.00 (equal course weights, standard letter bands; not an official GPA)`,
    `- Downside VaR 90: **${report.downside_var_90.toFixed(2)} pts** across the equal-weighted book`,
    "",
    "## Positions",
    "",
  ];
  if (report.course_breakdown.length) {
    lines.push(
      "| Course | Grade | Target | Status | P(target) | VaR 90 | Open wt |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...report.course_breakdown.map(
        (c) =>
          `| ${cell(c.course_code)} | ${num(c.current_score, 1, "%")} | ${num(c.target_score, 1, "%")} | ${c.status} | ${prob(c.probability_of_target)} | ${num(c.var_90, 2)} | ${num(c.remaining_weight, 1, "%")} |`,
      ),
    );
  } else {
    lines.push("No courses on the book.");
  }
  lines.push("", "## High-leverage actions", "");
  if (report.high_leverage_actions.length) {
    lines.push(
      ...report.high_leverage_actions.map(
        (a, i) =>
          `${i + 1}. **${cell(a.course_code)} · ${cell(a.title)}**: ${a.weight.toFixed(1)}% weight, ${signed(a.marginal_impact * 10, 2)} final pts per +10, due ${day(a.due_at)}`,
      ),
    );
  } else {
    lines.push("No remaining weighted deliverables are recorded.");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The offline dossier, built deterministically from the terminal's own course
 * book with the backend's report model. Only the telemetry latency varies.
 */
export function generateLocalReport(
  state: Pick<TerminalState, "courses" | "assignments">,
  now = Date.now(),
): PortfolioReport {
  const started = performance.now();
  const course_breakdown: CourseStanding[] = [];
  const actions: LeverageAction[] = [];
  const samples: number[][] = [];
  const projected: number[] = [];

  for (const course of state.courses) {
    const own = state.assignments.filter((a) => a.course_id === course.id);
    const paths: number[] = [];
    const forecast = simulateCourse(course, own, REPORT_ITERATIONS, {}, paths);
    if (paths.length && forecast.percentiles) {
      samples.push(paths);
      projected.push(gradePoints(forecast.percentiles.p50));
    }
    course_breakdown.push({
      course_id: course.id,
      course_code: course.course_code,
      name: course.name,
      current_score: course.current_score,
      target_score: course.target_score,
      status: courseStatus(course.portfolio_margin, forecast.probability_of_target),
      var_90: forecast.var_90,
      probability_of_target: forecast.probability_of_target,
      remaining_weight: own
        .filter((a) => !a.graded)
        .reduce((sum, a) => sum + a.weight, 0),
    });
    const byId = new Map(own.map((a) => [a.id, a]));
    for (const row of forecast.sensitivity_matrix) {
      const a = byId.get(row.assignment_id)!;
      actions.push({
        assignment_id: a.id,
        course_code: course.course_code,
        title: a.title,
        weight: a.weight,
        marginal_impact: row.marginal_impact,
        due_at: a.due_at,
        priority_score: a.priority_score,
      });
    }
  }

  const observed = state.courses.filter((c) => c.current_score !== null);
  const portfolio_score = observed.length
    ? mean(observed.map((c) => c.current_score!))
    : 0;
  const target_score = observed.length
    ? mean(observed.map((c) => c.target_score))
    : 0;
  const margin = portfolio_score - target_score;
  const book = samples.length
    ? samples[0].map((_, i) => mean(samples.map((paths) => paths[i])))
    : [];
  const downside_var_90 = book.length ? Math.max(0, mean(book) - p10(book)) : 0;
  actions.sort(
    (x, y) =>
      y.marginal_impact - x.marginal_impact ||
      y.priority_score - x.priority_score ||
      (x.assignment_id < y.assignment_id ? -1 : x.assignment_id > y.assignment_id ? 1 : 0),
  );

  const figures = {
    generated_at: new Date(now).toISOString(),
    academic_stance: dossierStance(course_breakdown, margin),
    projected_gpa: projected.length
      ? Math.round(mean(projected) * 100) / 100
      : 0,
    portfolio_score,
    target_score,
    margin,
    downside_var_90,
    course_breakdown,
    high_leverage_actions: actions.slice(0, MAX_ACTIONS),
  };
  return {
    ...figures,
    executive_summary: renderMemo(figures),
    telemetry: {
      model: LOCAL_TELEMETRY_MODEL,
      provider: "local",
      tokens_per_second: null,
      latency_ms: performance.now() - started,
    },
  };
}

export function reportFilename(report: Pick<PortfolioReport, "generated_at">) {
  const at = new Date(report.generated_at);
  return `apex-dossier-${Number.isNaN(at.getTime()) ? "report" : at.toISOString().slice(0, 10)}.md`;
}

// ------------------------------------------------------------- memo blocks

export type MemoBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replaceAll("\\|", "|"));
const ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

/**
 * Splits the memo into blocks the modal renders as plain React text: headings,
 * paragraphs, lists, and pipe tables. Anything else reads as a paragraph, so a
 * richer backend memo degrades to legible text rather than raw HTML.
 */
export function parseMemo(markdown: string): MemoBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MemoBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: Math.min(3, heading[1].length) as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isRule(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const next = ITEM.exec(lines[i]);
        if (!next || (next[2] !== undefined) !== ordered) break;
        items.push(next[3].trim());
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !ITEM.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    if (!paragraph.length) {
      // A lone table row with no rule under it.
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

export type InlineSpan = { text: string; style: "plain" | "strong" | "em" | "code" };

/** **bold**, _em_ / *em*, and `code`; everything else is plain text. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|(?<![\w*])[_*](?![\s_*])(.+?)(?<![\s_*])[_*](?![\w*])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) spans.push({ text: text.slice(last, match.index), style: "plain" });
    if (match[1] !== undefined) spans.push({ text: match[1], style: "strong" });
    else if (match[2] !== undefined) spans.push({ text: match[2], style: "code" });
    else spans.push({ text: match[3], style: "em" });
    last = match.index + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), style: "plain" });
  return spans;
}
