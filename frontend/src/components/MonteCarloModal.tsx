"use client";

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { create } from "zustand";
import { Key, Spinner, useEscape, useRestoreFocus } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import { api, type MonteCarloRun } from "@/lib/api";
import {
  clusterWindow,
  congestionTier,
  courseClusters,
  detectCongestion,
  type CongestionCluster,
} from "@/lib/congestion";
import { simulatable } from "@/lib/engine";
import { pct, signed } from "@/lib/format";
import {
  SENSITIVITY_BUMP,
  leverageTable,
  quantileCurve,
  shockRequest,
  type CourseSimulation,
} from "@/lib/monteCarlo";
import { activeCourseOf, isRemote, useTerminal } from "@/store/terminal";
import type { Assignment, Course } from "@/types";

const UP = "#00ff66";
const DOWN = "#ff3b30";
const ACCENT = "#ff6b00";
const GRID = "#1e2328";
const RULE = "#2b3138";
const INK_3 = "#7a848f";
/** Slider drags settle this long before the desk re-runs. */
const DEBOUNCE_MS = 120;

/** Opened from the top bar and the command palette. */
export const useMonteCarlo = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

export function MonteCarloModal() {
  const open = useMonteCarlo((s) => s.open);
  const setOpen = useMonteCarlo((s) => s.setOpen);
  if (!open) return null;
  return <MonteCarloDialog onClose={() => setOpen(false)} />;
}

function QuantileCurve({
  simulation,
}: {
  simulation: CourseSimulation & {
    percentiles: NonNullable<CourseSimulation["percentiles"]>;
  };
}) {
  const { percentiles: p, target_score: target, var_90 } = simulation;
  const rows = quantileCurve(p);
  const mean = p.p10 + (var_90 ?? 0);
  const lo = Math.max(0, Math.floor(Math.min(p.p10, target) - 2));
  const hi = Math.min(100, Math.ceil(Math.max(p.p90, target) + 2));
  const color = p.p50 >= target ? UP : DOWN;
  const marker = (q: number, label: string) => (
    <ReferenceLine
      key={label}
      x={q}
      stroke={q === 50 ? color : INK_3}
      strokeDasharray={q === 50 ? undefined : "2 3"}
      label={{
        value: label,
        position: "insideTopLeft",
        fill: q === 50 ? color : INK_3,
        fontSize: 9,
        fontFamily: "inherit",
      }}
    />
  );
  return (
    <div className="h-[180px] min-h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 10, right: 40, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="q"
            type="number"
            domain={[10, 90]}
            ticks={[10, 25, 50, 75, 90]}
            tickFormatter={(q: number) => `P${q}`}
            tick={{ fill: INK_3, fontSize: 10 }}
            axisLine={{ stroke: RULE }}
            tickLine={false}
            height={18}
          />
          <YAxis
            domain={[lo, hi === lo ? lo + 1 : hi]}
            tick={{ fill: INK_3, fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(0)}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          {var_90 !== null && var_90 > 0 && (
            <ReferenceArea
              y1={p.p10}
              y2={mean}
              fill={DOWN}
              fillOpacity={0.12}
              stroke="none"
              label={{
                value: `VaR90 ${var_90.toFixed(2)}`,
                position: "insideBottomRight",
                fill: DOWN,
                fontSize: 9,
                fontFamily: "inherit",
              }}
            />
          )}
          <ReferenceLine
            y={target}
            stroke={INK_3}
            strokeDasharray="3 3"
            label={{
              value: `TGT ${target.toFixed(1)}`,
              position: "right",
              fill: INK_3,
              fontSize: 10,
              fontFamily: "inherit",
            }}
          />
          {marker(10, "P10")}
          {marker(50, "P50")}
          {marker(90, "P90")}
          <Area
            type="monotone"
            dataKey="grade"
            baseValue={lo}
            stroke="none"
            fill={color}
            fillOpacity={0.08}
            isAnimationActive={false}
            activeDot={false}
          />
          <Line
            type="monotone"
            dataKey="grade"
            stroke={color}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) => (
              <circle
                key={props.index}
                cx={props.cx}
                cy={props.cy}
                r={props.index === 0 || props.index === 2 || props.index === 4 ? 3.5 : 2}
                fill={color}
              />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "text-ink",
  title,
}: {
  label: string;
  value: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <dt className="text-[10px] tracking-wider text-ink-3 uppercase">
        {label}
      </dt>
      <dd className={`text-[13px] tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

function SensitivityTable({
  simulation,
  assignments,
}: {
  simulation: CourseSimulation;
  assignments: Assignment[];
}) {
  const rows = leverageTable(simulation, assignments);
  if (!rows.length) {
    return (
      <p className="px-2.5 py-3 text-center text-[11px] text-ink-3">
        NO OPEN WEIGHTED WORK · nothing left can move this grade
      </p>
    );
  }
  return (
    <table className="w-full text-[11px]">
      <thead className="text-[10px] tracking-wider text-ink-3 uppercase">
        <tr className="border-b border-line">
          <th className="w-6 px-2.5 py-1 text-left font-normal">#</th>
          <th className="py-1 text-left font-normal">Deliverable</th>
          <th className="px-2 py-1 text-right font-normal">WT</th>
          <th
            className="px-2 py-1 text-right font-normal"
            title="Final-grade points gained per point scored on this deliverable"
          >
            Leverage
          </th>
          <th
            className="px-2.5 py-1 text-right font-normal"
            title={`Final-grade points a ${SENSITIVITY_BUMP}-point lift on this deliverable buys`}
          >
            +{SENSITIVITY_BUMP} PTS
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const top = row.rank === 1;
          return (
            <tr
              key={row.assignment_id}
              className={`border-b border-line/70 last:border-b-0 ${top ? "bg-accent/5" : ""}`}
            >
              <td
                className={`px-2.5 py-1 tabular-nums ${top ? "text-accent" : "text-ink-3"}`}
              >
                {row.rank}
              </td>
              <td className="max-w-0 py-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-ink" title={row.title}>
                    {row.title}
                  </span>
                  {top && (
                    <span className="shrink-0 border border-accent/60 px-1 text-[9px] tracking-wider text-accent">
                      MAX LEVERAGE
                    </span>
                  )}
                </div>
                <div aria-hidden className="mt-0.5 h-[2px] w-full bg-line">
                  <div
                    className="h-full"
                    style={{
                      width: `${row.share * 100}%`,
                      background: top ? ACCENT : INK_3,
                    }}
                  />
                </div>
              </td>
              <td className="px-2 py-1 text-right text-ink-2 tabular-nums">
                {row.weight.toFixed(1)}%
              </td>
              <td className="px-2 py-1 text-right text-ink tabular-nums">
                {row.marginal_impact.toFixed(3)}
              </td>
              <td className="px-2.5 py-1 text-right text-up tabular-nums">
                {signed(row.lift, 2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ShockSlider({
  assignment,
  hold,
  override,
  onChange,
}: {
  assignment: Assignment;
  /** The baseline grade: where unset work is centred. */
  hold: number;
  override: number | undefined;
  onChange: (score: number | undefined) => void;
}) {
  const id = useId();
  const value = override ?? hold;
  const unit = (v: number) => Math.min(1, Math.max(0, v / 100));
  return (
    <li className="flex items-center gap-2 border-b border-line/70 px-2.5 py-1 last:border-b-0">
      <label
        htmlFor={id}
        className="w-[38%] min-w-0 truncate text-[11px] text-ink"
        title={assignment.title}
      >
        {assignment.title}
        <span className="ml-1.5 text-[10px] text-ink-3">
          {assignment.weight.toFixed(1)}%
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={
          override === undefined
            ? `Stochastic, centred on ${hold.toFixed(1)} percent`
            : `Fixed at ${override.toFixed(1)} percent`
        }
        className="whatif-range flex-1"
        style={
          {
            "--hold": unit(hold),
            "--lo": unit(Math.min(value, hold)),
            "--hi": unit(Math.max(value, hold)),
            "--fill": value >= hold ? UP : DOWN,
          } as CSSProperties
        }
      />
      <span
        className={`w-[76px] shrink-0 text-right text-[11px] tabular-nums ${
          override === undefined
            ? "text-ink-3"
            : override >= hold
              ? "text-up"
              : "text-down"
        }`}
      >
        {override === undefined ? "STOCHASTIC" : `FIXED ${override.toFixed(1)}`}
      </span>
      <Key
        onClick={() => onChange(undefined)}
        disabled={override === undefined}
        aria-label={`Release the shock on ${assignment.title}`}
        title="Return this deliverable to a random draw"
      >
        ×
      </Key>
    </li>
  );
}

/** Deadline pile-ups this course shares with others, and what they do to the spread. */
function CongestionBanner({
  clusters,
  course,
  courses,
  assignments,
}: {
  clusters: CongestionCluster[];
  course: Course;
  courses: Course[];
  assignments: Assignment[];
}) {
  const [worst, ...rest] = courseClusters(clusters, course.id);
  if (!worst) return null;
  const critical = congestionTier(worst.congestion_score) === "critical";
  const codes = worst.course_ids
    .map((id) => courses.find((c) => c.id === id)?.course_code ?? id)
    .join(" · ");
  const titles = worst.assignment_ids
    .map((id) => assignments.find((a) => a.id === id))
    .filter((a): a is Assignment => Boolean(a))
    .map((a) => `${a.course_code} ${a.title}`);
  return (
    <div
      role="note"
      aria-label="Deadline congestion"
      title={titles.join("\n")}
      className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-3 py-1.5 text-[11px] ${
        critical
          ? "border-down/50 bg-down/10 text-down"
          : "border-accent/40 bg-accent/10 text-accent"
      }`}
    >
      <span className="shrink-0 tracking-wider uppercase">
        ⚠ Deadline congestion
      </span>
      <span className="text-ink">
        {worst.assignment_ids.length} deliverables across {codes} due{" "}
        {clusterWindow(worst)}
      </span>
      <span className="tabular-nums">
        VAR ×{worst.variance_inflation.toFixed(2)} · σ ×
        {Math.sqrt(worst.variance_inflation).toFixed(2)} on clustered work
      </span>
      {rest.length > 0 && (
        <span className="text-ink-3">
          +{rest.length} more window{rest.length === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

function MonteCarloDialog({ onClose }: { onClose: () => void }) {
  useRestoreFocus();
  useEscape(onClose);
  const data = useTerminal((s) => s.data);
  const offline = useTerminal((s) => !isRemote(s.mode) || s.simulationPinned);
  const [courseId, setCourseId] = useState<string | null>(
    () => activeCourseOf(useTerminal.getState())?.id ?? null,
  );
  // Seeded from the equity curve's what-if scores; edits stay inside the desk.
  const [overrides, setOverrides] = useState<Record<string, number>>(() => ({
    ...useTerminal.getState().scenario,
  }));
  const [run, setRun] = useState<{ key: string; run: MonteCarloRun } | null>(
    null,
  );

  const course: Course | null =
    data?.courses.find((c) => c.id === courseId) ?? data?.courses[0] ?? null;
  const body = useMemo(
    () =>
      course && data ? shockRequest(course.id, data.assignments, overrides) : null,
    [course, data, overrides],
  );
  const key = JSON.stringify(body);

  useEffect(() => {
    if (!body || !data) return;
    let active = true;
    const timer = setTimeout(() => {
      void api.simulateMonteCarlo(body, data, { offline }).then((next) => {
        if (active) setRun({ key: JSON.stringify(body), run: next });
      });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [body, data, offline]);

  const pending = run?.key !== key;
  // The run's own matrix when the backend sent one; else the local detector.
  const sent = run?.run.response.congestion_matrix;
  const now = useNow(60_000);
  const clusters = useMemo(
    () => sent ?? (data ? detectCongestion(data.assignments, now) : []),
    [sent, data, now],
  );
  const simulation =
    run?.run.response.courses.find((c) => c.course_id === course?.id) ?? null;
  const open = course && data ? simulatable(course.id, data.assignments) : [];
  const hold = course?.current_score ?? course?.target_score ?? 0;
  const shocked = open.filter((a) => overrides[a.id] !== undefined).length;
  const p = simulation?.percentiles ?? null;
  const probability = simulation?.probability_of_target ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 px-4 pt-[8vh] pb-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="monte-carlo-title"
        aria-busy={pending}
        // Keep the workstation's single-key hotkeys (J/K/T/M) out of the dialog; Escape still closes.
        onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
        className="w-full max-w-[760px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <h2
          id="monte-carlo-title"
          className="flex items-center justify-between border-b border-line bg-head px-2.5 py-1 text-[11px] tracking-wider text-accent uppercase"
        >
          <span>WHAT-IF // VaR · MONTE CARLO DESK</span>
          <span className="text-ink-3">ESC</span>
        </h2>

        {!data || !course ? (
          <p className="px-3 py-6 text-center text-[11px] text-ink-3">
            NO COURSE BOOK LOADED · sync Canvas or load a sample syllabus first
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
              <div role="radiogroup" aria-label="Course" className="flex flex-wrap">
                {data.courses.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={c.id === course.id}
                    autoFocus={c.id === course.id}
                    onClick={() => setCourseId(c.id)}
                    className={`-ml-px h-[22px] border px-1.5 text-[10px] tracking-wider uppercase first:ml-0 ${
                      c.id === course.id
                        ? "relative z-10 border-accent bg-accent/15 text-accent"
                        : "border-line-strong text-ink-3 hover:text-ink"
                    }`}
                  >
                    {c.course_code}
                  </button>
                ))}
              </div>
              <span
                role="status"
                className="ml-auto flex items-center gap-1.5 text-[10px] tracking-wider text-ink-3 uppercase"
                title={run?.run.source === "local" ? run.run.cause.message : undefined}
              >
                {pending && <Spinner />}
                {run && (
                  <>
                    <span
                      className={run.run.source === "backend" ? "text-up" : "text-accent"}
                    >
                      ● {run.run.source === "backend" ? "BACKEND" : "LOCAL ENGINE"}
                    </span>
                    <span>
                      {run.run.response.iterations.toLocaleString()} PATHS
                    </span>
                  </>
                )}
              </span>
            </div>

            <CongestionBanner
              clusters={clusters}
              course={course}
              courses={data.courses}
              assignments={data.assignments}
            />

            {!simulation ? (
              <p className="flex items-center justify-center gap-2 px-3 py-10 text-[11px] text-accent">
                <Spinner /> SIMULATING {course.course_code}
              </p>
            ) : !p ? (
              <p className="border-b border-dashed border-line px-3 py-8 text-center text-[11px] text-ink-3">
                NO BASELINE · post a grade, or fix a score on every open
                deliverable, to draw a distribution
              </p>
            ) : (
              <section
                aria-label="Final grade distribution"
                className="grid grid-cols-1 gap-x-3 border-b border-line px-3 py-2 sm:grid-cols-[1fr_200px]"
              >
                <p className="sr-only">
                  {course.course_code} final grade: 10th percentile {pct(p.p10)},
                  median {pct(p.p50)}, 90th percentile {pct(p.p90)}
                  {probability !== null
                    ? `, ${Math.round(probability * 100)}% chance of reaching the ${pct(course.target_score)} target`
                    : ""}
                  {simulation.var_90 !== null
                    ? `, 90% value at risk ${simulation.var_90.toFixed(2)} points`
                    : ""}
                  .
                </p>
                <QuantileCurve simulation={{ ...simulation, percentiles: p }} />
                <dl className="flex flex-col justify-center gap-1.5 border-t border-line pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
                  <Stat
                    label="P(≥ target)"
                    value={probability === null ? "—" : pct(probability * 100, 0)}
                    tone={
                      probability === null
                        ? "text-ink-3"
                        : probability >= 0.5
                          ? "text-up"
                          : "text-down"
                    }
                    title={`Share of simulated paths finishing at or above the ${pct(course.target_score)} target`}
                  />
                  <Stat label="P50 median" value={pct(p.p50, 2)} />
                  <Stat
                    label="P10 – P90"
                    value={`${p.p10.toFixed(1)} – ${p.p90.toFixed(1)}`}
                    tone="text-ink-2"
                  />
                  <Stat
                    label="VaR 90"
                    value={
                      simulation.var_90 === null
                        ? "—"
                        : `${simulation.var_90.toFixed(2)} PTS`
                    }
                    tone={simulation.var_90 ? "text-down" : "text-ink-3"}
                    title="90% downside value at risk: mean simulated grade minus the 10th percentile"
                  />
                  <Stat
                    label="P10 vs target"
                    value={signed(p.p10 - course.target_score, 2)}
                    tone={p.p10 >= course.target_score ? "text-up" : "text-down"}
                    title="Margin of safety left in a bad (1-in-10) outcome"
                  />
                </dl>
              </section>
            )}

            {simulation && (
              <section aria-labelledby="mc-sensitivity" className="border-b border-line">
                <h3
                  id="mc-sensitivity"
                  className="flex justify-between bg-head px-2.5 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase"
                >
                  <span>Sensitivity · marginal leverage</span>
                  <span>Ranked by final-grade points per point</span>
                </h3>
                <SensitivityTable
                  simulation={simulation}
                  assignments={data.assignments}
                />
              </section>
            )}

            <section aria-labelledby="mc-shocks">
              <h3
                id="mc-shocks"
                className="flex justify-between bg-head px-2.5 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase"
              >
                <span>Shock sliders · fix a score to stress the book</span>
                <span className="tabular-nums">
                  {shocked}/{open.length} FIXED
                </span>
              </h3>
              {open.length ? (
                <ul className="max-h-[26vh] overflow-auto">
                  {open.map((assignment) => (
                    <ShockSlider
                      key={assignment.id}
                      assignment={assignment}
                      hold={hold}
                      override={overrides[assignment.id]}
                      onChange={(score) =>
                        setOverrides((current) => {
                          const next = { ...current };
                          if (score === undefined) delete next[assignment.id];
                          else next[assignment.id] = score;
                          return next;
                        })
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-2.5 py-3 text-center text-[11px] text-ink-3">
                  Every weighted deliverable is graded · nothing to shock
                </p>
              )}
            </section>
          </>
        )}

        <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
          <span className="text-[10px] text-ink-3">
            Unfixed work draws around the current grade with the course&apos;s
            historical spread.
          </span>
          <Key
            className="ml-auto"
            onClick={() =>
              setOverrides((current) =>
                Object.fromEntries(
                  Object.entries(current).filter(
                    ([id]) => !open.some((a) => a.id === id),
                  ),
                ),
              )
            }
            disabled={!shocked}
          >
            CLEAR SHOCKS
          </Key>
          <Key tone="accent" onClick={onClose}>
            CLOSE
          </Key>
        </div>
      </div>
    </div>
  );
}
