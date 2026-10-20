"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Meter, Panel, Segmented, STATUS_COLOR } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  assignmentVolatility,
  capacity,
  completionVelocity,
  deadlineLoad,
  leaves,
  temporalByCourse,
  volatilityRegime,
  type CourseTime,
  type Regime,
} from "@/lib/engine";
import { minutes, pct } from "@/lib/format";
import { useTerminal } from "@/store/terminal";
import type { Assignment, Course } from "@/types";

const NO_COURSES: Course[] = [];
const NO_ASSIGNMENTS: Assignment[] = [];

const UP = "#00ff66";
const DOWN = "#ff3b30";
const NEUTRAL = "#4a535d";
const INK_3 = "#7a848f";

const REGIME: Record<Regime, { label: string; color: string }> = {
  low: { label: "LOW · EVENLY SPREAD", color: STATUS_COLOR.up },
  elevated: { label: "ELEVATED · CLUSTERING", color: STATUS_COLOR.accent },
  high: { label: "HIGH · DEADLINES STACKED", color: STATUS_COLOR.down },
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-panel px-2.5 py-2">
      <div className="text-[10px] tracking-wider text-ink-3 uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

function TimeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: CourseTime }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const over = row.actual > row.estimated;
  return (
    <div className="border border-line-strong bg-canvas px-2 py-1 text-[11px] shadow-lg shadow-black/60">
      <div className="text-ink">
        {minutes(row.actual)} <span className="text-ink-3">act /</span>{" "}
        {minutes(row.estimated)} <span className="text-ink-3">est</span>
      </div>
      <div className="text-ink-3">
        {row.course_code} ·{" "}
        {row.estimated || row.actual
          ? over
            ? `${minutes(row.actual - row.estimated)} over budget`
            : `${minutes(row.estimated - row.actual)} under budget`
          : "no worked tasks yet"}
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2 w-2"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

export function Velocity() {
  const courses = useTerminal((s) => s.data?.courses ?? NO_COURSES);
  const assignments = useTerminal((s) => s.data?.assignments ?? NO_ASSIGNMENTS);
  const hour = useNow(60_000);
  const [view, setView] = useState<"graph" | "table">("graph");

  const velocity = useMemo(
    () => completionVelocity(assignments),
    [assignments],
  );
  const fills = useMemo(
    () =>
      assignments
        .flatMap((a) => leaves(a.subtasks))
        .filter((leaf) => leaf.is_completed && leaf.actual_minutes > 0),
    [assignments],
  );
  const load = useMemo(
    () => deadlineLoad(assignments, hour),
    [assignments, hour],
  );
  const volatility = assignmentVolatility(load);
  const regime = REGIME[volatilityRegime(volatility)];
  const cap = useMemo(() => capacity(assignments), [assignments]);
  const times = useMemo(
    () => temporalByCourse(courses, assignments),
    [courses, assignments],
  );

  const fillEstimated = fills.reduce(
    (sum, leaf) => sum + leaf.estimated_minutes,
    0,
  );
  const fillActual = fills.reduce((sum, leaf) => sum + leaf.actual_minutes, 0);
  const ahead = velocity !== null && velocity >= 100;
  const velocityColor =
    velocity === null
      ? STATUS_COLOR.neutral
      : ahead
        ? STATUS_COLOR.up
        : STATUS_COLOR.down;
  // Fits the longest course code: 11px mono measures ~7px a character, plus the tick gap.
  const axisWidth = Math.min(
    120,
    Math.max(
      68,
      14 + 7 * Math.max(0, ...times.map((row) => row.course_code.length)),
    ),
  );
  const peak = Math.max(...load, 0);
  const peakDay = load.indexOf(peak);
  const done = cap.budgeted - cap.remaining;

  return (
    <Panel
      title="OPERATIONAL METRICS // VELOCITY & CAPACITY"
      actions={
        <Segmented
          label="Temporal visibility view"
          value={view}
          onChange={setView}
          options={[
            { value: "graph", label: "GRAPH" },
            { value: "table", label: "TABLE" },
          ]}
        />
      }
    >
      <div className="flex min-h-full flex-col">
        <div className="grid grid-cols-1 gap-px border-b border-line bg-line @md:grid-cols-3">
          <Stat label="Completion velocity">
            <div className="flex items-baseline gap-2">
              <span
                className="text-[24px] leading-none font-semibold whitespace-nowrap"
                style={{ color: velocityColor }}
              >
                {velocity === null ? "—" : pct(velocity)}
              </span>
              <span
                className="text-[10px] tracking-wider"
                style={{ color: velocityColor }}
              >
                {velocity === null
                  ? "NO FILLS"
                  : ahead
                    ? "▲ AHEAD"
                    : "▼ OVERRUN"}
              </span>
            </div>
            <Meter
              label="Completion velocity, 100% marker is on budget"
              value={velocity ?? 0}
              max={200}
              marker={100}
              color={velocityColor}
            />
            <div className="text-[10px] text-ink-3">
              {minutes(fillEstimated)} EST / {minutes(fillActual)} ACT ·{" "}
              {fills.length} FILLS
            </div>
          </Stat>

          <Stat label="Assignment volatility">
            <div className="flex items-baseline gap-2">
              <span className="text-[24px] leading-none font-semibold whitespace-nowrap text-ink">
                {volatility.toFixed(0)}
              </span>
              <span
                className="text-[10px] tracking-wider"
                style={{ color: regime.color }}
              >
                {regime.label}
              </span>
            </div>
            <div
              className="flex h-6 items-end gap-[2px]"
              role="img"
              aria-label="Deadline load for the next 14 days"
            >
              {load.map((value, day) => (
                <span
                  key={day}
                  title={`D+${day}: ${value.toFixed(1)} weighted pts due`}
                  className="flex-1"
                  style={{
                    height: `${peak ? Math.max(8, (value / peak) * 100) : 8}%`,
                    background: value
                      ? day === peakDay
                        ? regime.color
                        : "var(--color-ink-3)"
                      : "var(--color-line)",
                  }}
                />
              ))}
            </div>
            <div className="text-[10px] text-ink-3">
              σ/μ OF 14D DEADLINE LOAD · PEAK {peak ? `D+${peakDay}` : "—"}
            </div>
          </Stat>

          <Stat label="Capacity">
            <div className="flex items-baseline gap-2">
              <span className="text-[24px] leading-none font-semibold whitespace-nowrap text-ink">
                {minutes(cap.remaining)}
              </span>
              <span className="text-[10px] tracking-wider text-ink-3">
                OPEN BUDGET
              </span>
            </div>
            <Meter
              label="Share of budget completed"
              value={done}
              max={cap.budgeted}
              color="var(--color-ink-2)"
            />
            <div className="text-[10px] text-ink-3">
              {minutes(cap.logged)} LOGGED · {minutes(cap.budgeted)} BUDGETED
            </div>
          </Stat>
        </div>

        <div className="flex items-center justify-between gap-2 px-2.5 pt-2 text-[10px] tracking-wider text-ink-3 uppercase">
          <span>Temporal visibility · est vs act, worked tasks</span>
          <span className="flex gap-2.5">
            <Swatch color={NEUTRAL} label="EST" />
            <Swatch color={UP} label="ACT ≤ EST" />
            <Swatch color={DOWN} label="ACT > EST" />
          </span>
        </div>

        {view === "graph" ? (
          // Absolute fill gives ResponsiveContainer a definite height to measure.
          <div className="relative min-h-[140px] flex-1">
            <div className="absolute inset-0 px-1 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={times}
                  layout="vertical"
                  barGap={2}
                  barCategoryGap="22%"
                  margin={{ top: 6, right: 44, bottom: 0, left: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="#1e2328" />
                  <XAxis
                    type="number"
                    tickFormatter={(value: number) => minutes(value)}
                    tick={{ fill: INK_3, fontSize: 10, fontFamily: "inherit" }}
                    axisLine={{ stroke: "#1e2328" }}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="course_code"
                    width={axisWidth}
                    tick={{
                      fill: "#a3acb6",
                      fontSize: 11,
                      fontFamily: "inherit",
                    }}
                    axisLine={{ stroke: "#1e2328" }}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "#171b20" }}
                    isAnimationActive={false}
                    content={({ active, payload }) => (
                      <TimeTooltip active={active} payload={payload} />
                    )}
                  />
                  <Bar
                    dataKey="estimated"
                    name="Estimated"
                    fill={NEUTRAL}
                    maxBarSize={10}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="actual"
                    name="Actual"
                    maxBarSize={10}
                    isAnimationActive={false}
                  >
                    {times.map((row) => (
                      <Cell
                        key={row.course_id}
                        fill={row.actual > row.estimated ? DOWN : UP}
                      />
                    ))}
                    <LabelList
                      dataKey="actual"
                      position="right"
                      formatter={(value) =>
                        Number(value) ? minutes(Number(value)) : ""
                      }
                      style={{
                        fill: "#a3acb6",
                        fontSize: 10,
                        fontFamily: "inherit",
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <table className="mt-1 w-full border-collapse text-[12px]">
            <caption className="sr-only">
              Estimated versus actual minutes per course
            </caption>
            <thead className="text-[10px] tracking-wider text-ink-3 uppercase">
              <tr className="border-b border-line">
                <th scope="col" className="py-1 pl-2.5 text-left font-normal">
                  Course
                </th>
                <th scope="col" className="px-2 py-1 text-right font-normal">
                  Est
                </th>
                <th scope="col" className="px-2 py-1 text-right font-normal">
                  Act
                </th>
                <th scope="col" className="py-1 pr-2.5 text-right font-normal">
                  Variance
                </th>
              </tr>
            </thead>
            <tbody>
              {times.map((row) => {
                const variance = row.actual - row.estimated;
                return (
                  <tr key={row.course_id} className="border-b border-line/70">
                    <th
                      scope="row"
                      className="py-1 pl-2.5 text-left font-normal text-ink"
                    >
                      {row.course_code}
                    </th>
                    <td className="px-2 py-1 text-right text-ink-2">
                      {minutes(row.estimated)}
                    </td>
                    <td className="px-2 py-1 text-right text-ink">
                      {minutes(row.actual)}
                    </td>
                    <td
                      className={`py-1 pr-2.5 text-right ${variance > 0 ? "text-down" : row.actual ? "text-up" : "text-ink-3"}`}
                    >
                      {row.actual || row.estimated
                        ? `${variance > 0 ? "+" : ""}${minutes(variance)}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
