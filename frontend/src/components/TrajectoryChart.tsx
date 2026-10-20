"use client";

import { useId, useMemo, useState, type CSSProperties, type Ref } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Key } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  DAY,
  projectGrade,
  simulatable,
  type Projection,
  type Scenario,
} from "@/lib/engine";
import { pct, shortDate, signed } from "@/lib/format";
import type { Assignment, Course } from "@/types";
import { useTerminal } from "@/store/terminal";

const UP = "#00ff66";
const DOWN = "#ff3b30";
const PANEL = "#111315";
const GRID = "#1e2328";
const RULE = "#2b3138";
const INK_3 = "#7a848f";
/** History shown before now; long enough for a trend, short enough that the projection stays legible. */
const LOOKBACK = 28 * DAY;

interface Row {
  t: number;
  score?: number;
  projected?: number;
  /** Projection steps carry the assignment whose deadline they land on. */
  step?: string | null;
}

function rowsFor(
  course: Course,
  projection: Projection | null,
  now: number,
): Row[] {
  const history = course.grade_history
    .map((point) => ({ t: Date.parse(point.at), score: point.score }))
    .filter((point) => Number.isFinite(point.t) && point.t <= now)
    .sort((x, y) => x.t - y.t);
  const recent = history.filter((point) => point.t >= now - LOOKBACK);
  const shown = recent.length >= 2 ? recent : history.slice(-2);
  const steps = (projection?.path ?? []).map((step) => ({
    t: step.at,
    projected: step.score,
    step: step.assignment_id,
  }));
  return [...shown, ...steps];
}

/** Snaps to 5-point bands so the axis holds still while a slider moves. */
function domainFor(rows: Row[], target: number): [number, number] {
  const values = rows.flatMap((row) =>
    [row.score, row.projected].filter((v): v is number => v !== undefined),
  );
  values.push(target);
  return [
    Math.max(0, Math.floor((Math.min(...values) - 0.5) / 5) * 5),
    Math.ceil((Math.max(...values) + 0.5) / 5) * 5,
  ];
}

function TrajectoryTooltip({
  active,
  payload,
  target,
  titles,
  scenario,
  current,
}: {
  active?: boolean;
  payload?: readonly { payload?: Row }[];
  target: number;
  titles: Map<string, string>;
  scenario: Scenario;
  current: number;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const value = row.projected ?? row.score;
  if (value === undefined) return null;
  const projected = row.projected !== undefined;
  return (
    <div className="max-w-[260px] border border-line-strong bg-canvas px-2 py-1 text-[11px] shadow-lg shadow-black/60">
      <div className="text-ink">
        {projected && <span className="text-ink-3">PROJ </span>}
        {pct(value)}
      </div>
      {row.step && (
        <div className="truncate text-ink-2">
          after {titles.get(row.step)} @ {pct(scenario[row.step] ?? current)}
        </div>
      )}
      <div className="text-ink-3">
        {projected && !row.step
          ? "NOW"
          : shortDate(new Date(row.t).toISOString())}{" "}
        · {signed(value - target)} vs target
      </div>
    </div>
  );
}

function Swatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg aria-hidden width="16" height="6" className="shrink-0">
      <line
        x1="0"
        y1="3"
        x2="16"
        y2="3"
        stroke={color}
        strokeWidth={dash === "3 3" ? 1 : 2}
        strokeDasharray={dash}
      />
    </svg>
  );
}

/** `+4.2% BUFFER ABOVE 90.0% TARGET` or `−1.8% MARGIN DEFICIT [ WARNING ]`. */
export function MarginOfSafety({
  margin,
  target,
}: {
  margin: number | null;
  target: number;
}) {
  if (margin === null) {
    return (
      <span className="flex h-[22px] items-center border border-line-strong px-1.5 text-[11px] text-ink-3">
        NO GRADE YET
      </span>
    );
  }
  const safe = margin >= 0;
  return (
    <span
      role="status"
      className={`flex h-[22px] items-center gap-1.5 border px-1.5 text-[11px] whitespace-nowrap ${
        safe ? "border-up/40 text-up" : "border-down/70 bg-down/10 text-down"
      }`}
    >
      <span aria-hidden>{safe ? "▲" : "▼"}</span>
      {safe
        ? `${signed(margin)}% BUFFER ABOVE ${pct(target)} TARGET`
        : `${signed(margin)}% MARGIN DEFICIT`}
      {!safe && <span className="font-semibold">[ WARNING ]</span>}
    </span>
  );
}

/** Typed entry for the same score the slider sets; holds a draft while focused. */
function ScoreInput({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (score: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center text-[11px] text-ink-3">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step={0.1}
        aria-label={label}
        value={draft ?? value.toFixed(1)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(Math.min(100, Math.max(0, next)));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-[20px] w-[52px] [appearance:textfield] border border-line-strong bg-canvas px-1 text-right text-ink focus:border-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="ml-0.5">%</span>
    </span>
  );
}

function dueLabel(assignment: Assignment, now: number): string {
  if (assignment.status === "completed") return "DONE · AWAITING GRADE";
  if (!assignment.due_at) return "NO DUE DATE";
  const due = Date.parse(assignment.due_at);
  return due < now ? "OVERDUE" : `DUE ${shortDate(assignment.due_at)}`;
}

function WhatIfRow({
  assignment,
  score,
  hold,
  impact,
  now,
  onScore,
  active,
}: {
  assignment: Assignment;
  score: number;
  /** The current grade: the score that leaves the projection unchanged. */
  hold: number;
  impact: number;
  now: number;
  onScore: (assignmentId: string, score: number) => void;
  active: boolean;
}) {
  const id = useId();
  const moved = Math.abs(impact) >= 0.005;
  const unit = (value: number) => Math.min(1, Math.max(0, value / 100));
  return (
    <li
      className={`flex flex-col border-b border-line/70 px-2.5 py-1 last:border-b-0 ${active ? "border-l-2 border-l-accent bg-accent/5" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <label
          htmlFor={id}
          className="min-w-0 truncate text-ink"
          title={assignment.title}
        >
          {active && <span className="mr-1 text-accent">ACTIVE ORDER ·</span>}
          {assignment.title}
        </label>
        <span className="shrink-0 text-[10px] tracking-wider text-ink-3 uppercase">
          {assignment.weight.toFixed(1)}% wt · {dueLabel(assignment, now)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={score}
          onChange={(event) =>
            onScore(assignment.id, Number(event.target.value))
          }
          aria-valuetext={`${score.toFixed(1)} percent, ${signed(impact, 2)} points to the course grade`}
          className="whatif-range flex-1"
          style={
            {
              "--hold": unit(hold),
              "--lo": unit(Math.min(score, hold)),
              "--hi": unit(Math.max(score, hold)),
              "--fill": score >= hold ? UP : DOWN,
            } as CSSProperties
          }
        />
        <ScoreInput
          value={score}
          label={`Hypothetical score for ${assignment.title}, in percent`}
          onChange={(next) => onScore(assignment.id, next)}
        />
        <span
          className={`w-12 shrink-0 text-right text-[11px] ${
            !moved ? "text-ink-3" : impact > 0 ? "text-up" : "text-down"
          }`}
          title="Points this score moves the course grade"
        >
          {signed(impact, 2)}
        </span>
      </div>
    </li>
  );
}

function BreakEven({
  projection,
  target,
}: {
  projection: Projection;
  target: number;
}) {
  const { breakEven } = projection;
  if (breakEven === null) return null;
  const [label, text, tone] =
    breakEven > 100
      ? [
          "TARGET OUT OF REACH",
          `needs ${pct(breakEven)} average on open work`,
          "text-down",
        ]
      : breakEven <= 0
        ? [
            "TARGET LOCKED",
            `${pct(target)} holds even at 0% on open work`,
            "text-up",
          ]
        : [
            "BREAK-EVEN",
            `${pct(breakEven)} average on open work holds ${pct(target)}`,
            "text-ink",
          ];
  return (
    <div className="flex flex-wrap gap-x-2 border-t border-line px-2.5 py-1 text-[11px]">
      <span className="tracking-wider text-ink-3">{label}</span>
      <span className={tone}>{text}</span>
    </div>
  );
}

/**
 * The selected course's grade trajectory with a what-if simulator: a score
 * for each open assignment re-projects the grade, draws the dashed projected
 * trajectory through each deadline, and re-rates the margin of safety.
 */
export function TrajectoryChart({
  course,
  assignments,
  scenario,
  onScore,
  onReset,
  ref,
}: {
  course: Course;
  assignments: Assignment[];
  scenario: Scenario;
  onScore: (assignmentId: string, score: number) => void;
  onReset: (assignmentIds: string[]) => void;
  ref?: Ref<HTMLElement>;
}) {
  const now = useNow(60_000);
  const selectedId = useTerminal((s) => s.selectedId);
  const open = useMemo(
    () => simulatable(course.id, assignments),
    [course.id, assignments],
  );
  const projection = useMemo(
    () => projectGrade(course, open, scenario, now),
    [course, open, scenario, now],
  );
  const rows = useMemo(
    () => rowsFor(course, projection, now),
    [course, projection, now],
  );
  const domain = useMemo(
    () => domainFor(rows, course.target_score),
    [rows, course.target_score],
  );
  const titles = useMemo(
    () => new Map(open.map((a) => [a.id, a.title])),
    [open],
  );

  const current = course.current_score;
  const simulating =
    current !== null &&
    open.some(
      (a) => scenario[a.id] !== undefined && scenario[a.id] !== current,
    );
  const margin = projection?.margin ?? course.portfolio_margin;
  const actualColor = (course.portfolio_margin ?? 0) >= 0 ? UP : DOWN;
  const projectedColor = (projection?.margin ?? 0) >= 0 ? UP : DOWN;
  const ticks = Array.from(
    { length: (domain[1] - domain[0]) / 5 + 1 },
    (_, i) => domain[0] + i * 5,
  );
  const first = rows[0]?.t ?? now;
  const last = rows.at(-1)?.t ?? now;

  return (
    <section
      ref={ref}
      aria-label={`${course.course_code} grade trajectory and what-if simulator`}
      className="border-b border-line"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 py-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[12px] font-semibold whitespace-nowrap text-accent">
            {course.course_code}
          </span>
          <span className="truncate text-[11px] text-ink-3">{course.name}</span>
          <span className="shrink-0 text-[13px] text-ink">
            {current === null ? "—" : pct(current)}
            {simulating && projection && (
              <>
                <span className="text-ink-3"> → </span>
                {pct(projection.grade)}
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-wider text-ink-3 uppercase">
            {simulating ? "Projected margin" : "Margin of safety"}
          </span>
          <MarginOfSafety margin={margin} target={course.target_score} />
        </div>
      </div>

      {current === null ? (
        <p className="border-t border-dashed border-line px-2.5 py-4 text-center text-[11px] text-ink-3">
          AWAITING FIRST POSTED GRADE · the simulator projects from your current
          grade
        </p>
      ) : (
        <>
          <p className="sr-only">
            {course.course_code} is at {pct(current)} against a{" "}
            {pct(course.target_score)} target
            {projection ? `, projected ${pct(projection.grade)}` : ""}. Use the
            sliders below to change the hypothetical scores; the table view
            lists every course.
          </p>
          <div className="h-[136px] min-h-[136px] px-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 8, right: 34, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[first, last]}
                  ticks={first === last ? [first] : [first, last]}
                  tickFormatter={(t: number) =>
                    shortDate(new Date(t).toISOString())
                  }
                  tick={{ fill: INK_3, fontSize: 10 }}
                  axisLine={{ stroke: RULE }}
                  tickLine={false}
                  height={18}
                />
                <YAxis
                  domain={domain}
                  ticks={ticks}
                  tick={{ fill: INK_3, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <ReferenceLine
                  y={course.target_score}
                  stroke={INK_3}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  label={{
                    value: course.target_score.toFixed(1),
                    position: "right",
                    fill: INK_3,
                    fontSize: 10,
                    fontFamily: "inherit",
                  }}
                />
                <ReferenceLine
                  x={now}
                  stroke={RULE}
                  strokeWidth={1}
                  label={{
                    value: "NOW",
                    position: "insideTopLeft",
                    fill: INK_3,
                    fontSize: 9,
                    fontFamily: "inherit",
                  }}
                />
                <Tooltip
                  cursor={{ stroke: RULE, strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={({ active, payload }) => (
                    <TrajectoryTooltip
                      active={active}
                      payload={payload}
                      target={course.target_score}
                      titles={titles}
                      scenario={scenario}
                      current={current}
                    />
                  )}
                />
                <Area
                  type="linear"
                  dataKey="score"
                  stroke={actualColor}
                  strokeWidth={2}
                  fill={actualColor}
                  fillOpacity={0.1}
                  isAnimationActive={false}
                  activeDot={{
                    r: 4,
                    fill: actualColor,
                    stroke: PANEL,
                    strokeWidth: 2,
                  }}
                  dot={false}
                />
                <Line
                  type="linear"
                  dataKey="projected"
                  name="Projected trajectory"
                  stroke={projectedColor}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  isAnimationActive={false}
                  connectNulls
                  dot={(props: {
                    cx?: number;
                    cy?: number;
                    index?: number;
                    payload?: Row;
                  }) => (
                    <circle
                      key={props.index}
                      cx={props.cx}
                      cy={props.cy}
                      r={props.payload?.step ? 3.5 : 0}
                      fill={projectedColor}
                      stroke={PANEL}
                      strokeWidth={2}
                    />
                  )}
                  activeDot={{
                    r: 4,
                    fill: projectedColor,
                    stroke: PANEL,
                    strokeWidth: 2,
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 pb-1 text-[10px] tracking-wider text-ink-3 uppercase">
            <span className="flex items-center gap-1">
              <Swatch color={actualColor} /> Actual
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={projectedColor} dash="6 4" /> Projected trajectory
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={INK_3} dash="3 3" /> Target
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line bg-head px-2.5 py-0.5">
            <span className="text-[10px] tracking-wider text-ink-3 uppercase">
              What-if · work awaiting a grade
            </span>
            <Key
              onClick={() => onReset(open.map((a) => a.id))}
              disabled={!simulating}
              aria-label={`Reset hypothetical scores for ${course.course_code}`}
            >
              Reset
            </Key>
          </div>
          {open.length && projection ? (
            <>
              <ul aria-label={`Hypothetical scores for ${course.course_code}`}>
                {[...open]
                  .sort(
                    (a, b) =>
                      Number(b.id === selectedId) - Number(a.id === selectedId),
                  )
                  .map((assignment) => (
                    <WhatIfRow
                      key={assignment.id}
                      assignment={assignment}
                      score={scenario[assignment.id] ?? current}
                      hold={current}
                      impact={projection.impact[assignment.id]}
                      now={now}
                      onScore={onScore}
                      active={assignment.id === selectedId}
                    />
                  ))}
              </ul>
              <BreakEven projection={projection} target={course.target_score} />
            </>
          ) : (
            <p className="px-2.5 py-2 text-[11px] text-ink-3">
              Everything weighted in {course.course_code} is graded; the grade
              is what Canvas reports.
            </p>
          )}
        </>
      )}
    </section>
  );
}
