"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrajectoryChart, WhatIfBar } from "@/components/TrajectoryChart";
import { Panel, Segmented } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  isActive,
  portfolio,
  projectGrade,
  simulatable,
  studyRecommendation,
  type Projection,
} from "@/lib/engine";
import { minutes, pct, shortDate, signed } from "@/lib/format";
import { useTerminal } from "@/store/terminal";
import type { Assignment, Course, StudyRecommendation } from "@/types";

const UP = "#00ff66";
const DOWN = "#ff3b30";
const PANEL = "#111315";

const NO_COURSES: Course[] = [];
const NO_ASSIGNMENTS: Assignment[] = [];

interface Point {
  at: string;
  score: number;
}

/** Shared y-scale so the small multiples compare honestly. */
function sharedDomain(
  courses: Course[],
  projections: ReadonlyMap<string, Projection | null>,
): [number, number] {
  const values = courses.flatMap((course) => [
    course.target_score,
    ...(course.current_score === null ? [] : [course.current_score]),
    ...course.grade_history.map((point) => point.score),
    ...Array.from(projections.get(course.id)?.path ?? [], (point) => point.score),
  ]);
  if (!values.length) return [80, 100];
  return [
    Math.floor(Math.min(...values) - 1),
    Math.ceil(Math.max(...values) + 1),
  ];
}

function seriesFor(course: Course): Point[] {
  return course.grade_history.map(({ at, score }) => ({ at, score }));
}

/** Change across the plotted window; null with fewer than two points. */
function driftOf(series: Point[]): number | null {
  return series.length > 1
    ? series[series.length - 1].score - series[0].score
    : null;
}

function CurveTooltip({
  active,
  payload,
  target,
}: {
  active?: boolean;
  payload?: readonly { payload?: Point }[];
  target: number;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="border border-line-strong bg-canvas px-2 py-1 text-[11px] shadow-lg shadow-black/60">
      <div className="text-ink">{pct(point.score)}</div>
      <div className="text-ink-3">
        {shortDate(point.at)} · {signed(point.score - target)} vs target
      </div>
    </div>
  );
}

const CourseTile = memo(function CourseTile({
  course,
  projection,
  domain,
  recommendation,
  focused,
  onFocus,
  onOpenSource,
}: {
  course: Course;
  projection: Projection | null;
  domain: [number, number];
  recommendation: StudyRecommendation | null;
  focused: boolean;
  onFocus: (id: string) => void;
  onOpenSource: (id: string) => void;
}) {
  const history = seriesFor(course);
  const simulating =
    projection !== null && projection.grade !== course.current_score;
  const series = simulating
    ? [
        ...history,
        ...projection.path.map((point) => ({
          at: new Date(point.at).toISOString(),
          score: point.score,
        })),
      ]
    : history;
  const score = projection?.grade ?? course.current_score;
  const margin = projection?.margin ?? course.portfolio_margin;
  const graded = score !== null && margin !== null;
  const up = (margin ?? 0) >= 0;
  const color = up ? UP : DOWN;
  const drift = driftOf(history);

  return (
    <article
      className={`flex min-w-0 flex-col gap-1 bg-panel p-2 ${recommendation || focused ? "shadow-[inset_0_0_0_1px_var(--color-accent)]" : ""}`}
      aria-label={`${course.course_code} grade trajectory`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => onFocus(course.id)}
          aria-pressed={focused}
          title={`Simulate ${course.course_code} in the what-if desk`}
          className="group flex min-w-0 items-baseline gap-2 text-left"
        >
          <span
            className={`shrink-0 text-[12px] font-semibold whitespace-nowrap group-hover:text-accent ${focused ? "text-accent" : "text-ink"}`}
          >
            {focused ? "◉" : "○"} {course.course_code}
          </span>
          <span className="truncate text-[11px] text-ink-3">{course.name}</span>
        </button>
        <span
          className={`text-[13px] ${simulating ? (up ? "text-up" : "text-down") : "text-ink"}`}
        >
          {simulating && <span className="text-[10px] text-ink-3">PROJ </span>}
          {score === null ? "—" : pct(score)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        {graded ? (
          <span style={{ color }}>
            {up ? "▲" : "▼"} {signed(margin ?? 0)}% MARGIN
          </span>
        ) : (
          <span className="text-ink-3">NO GRADE YET</span>
        )}
        <span className="text-ink-3">
          {drift === null
            ? series.length
              ? "1 SNAPSHOT"
              : "NO HISTORY"
            : `${signed(drift)} SINCE ${shortDate(series[0].at)}`}
        </span>
      </div>
      {series.length < 2 ? (
        <div className="flex h-[64px] items-center justify-center border border-dashed border-line text-[10px] tracking-wider text-ink-3 uppercase">
          {graded ? "Trajectory builds with each sync" : "Awaiting first grade"}
        </div>
      ) : (
        <div className="h-[64px] min-h-[64px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 4, right: 30, bottom: 0, left: 0 }}
            >
              <XAxis dataKey="at" hide />
              <YAxis hide domain={domain} />
              <ReferenceLine
                y={course.target_score}
                stroke="#7a848f"
                strokeDasharray="3 3"
                strokeWidth={1}
                label={{
                  value: course.target_score.toFixed(1),
                  position: "right",
                  fill: "#7a848f",
                  fontSize: 10,
                  fontFamily: "inherit",
                }}
              />
              <Tooltip
                cursor={{ stroke: "#2b3138", strokeWidth: 1 }}
                isAnimationActive={false}
                content={({ active, payload }) => (
                  <CurveTooltip
                    active={active}
                    payload={payload}
                    target={course.target_score}
                  />
                )}
              />
              <Area
                type="linear"
                dataKey="score"
                stroke={color}
                strokeWidth={2}
                fill={color}
                fillOpacity={0.1}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: color, stroke: PANEL, strokeWidth: 2 }}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {recommendation && (
        <div className="mt-0.5 border-l-2 border-accent bg-accent/10 px-2 py-1 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="tracking-wider text-accent">
              ◆ RAPID STUDY ACTION
            </span>
            <span className="text-ink-2">
              {minutes(recommendation.estimated_minutes)}
            </span>
          </div>
          <div className="text-ink">{recommendation.title}</div>
          <div className="text-ink-3">{recommendation.reason}</div>
          {recommendation.source_assignment_id && (
            <button
              type="button"
              onClick={() => onOpenSource(recommendation.source_assignment_id!)}
              className="mt-0.5 text-[10px] tracking-wider text-accent uppercase hover:underline"
            >
              Plan it in the execution deck
            </button>
          )}
        </div>
      )}
    </article>
  );
});

export function EquityCurve() {
  const courses = useTerminal((s) => s.data?.courses ?? NO_COURSES);
  const assignments = useTerminal((s) => s.data?.assignments ?? NO_ASSIGNMENTS);
  const select = useTerminal((s) => s.select);
  const selectedId = useTerminal((s) => s.selectedId);
  const selectedCourse = useTerminal(
    (s) =>
      s.data?.assignments.find((a) => a.id === s.selectedId)?.course_id ??
      s.activeCourseId,
  );
  const [view, setView] = useState<"graph" | "table">("graph");
  const scenario = useTerminal((s) => s.scenario);
  const setScenarioScore = useTerminal((s) => s.setScenarioScore);
  // A tile can focus another course until the execution deck's selection changes.
  const [picked, setPicked] = useState<string | null>(null);
  const selection = selectedId ?? selectedCourse;
  const [followed, setFollowed] = useState(selection);
  if (followed !== selection) {
    setFollowed(selection);
    setPicked(null);
  }
  const focus =
    courses.find((c) => c.id === (picked ?? selectedCourse)) ??
    courses[0] ??
    null;
  const now = useNow(60_000);
  const simulator = useRef<HTMLElement>(null);
  const focusTile = useCallback((id: string) => {
    setPicked(id);
    // The tiles sit below the simulator; bring the newly focused course into view.
    simulator.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const setScore = useCallback(
    (id: string, score: number) => setScenarioScore(id, score),
    [setScenarioScore],
  );
  const resetScores = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        setScenarioScore(id, undefined);
      }
    },
    [setScenarioScore],
  );

  const projections = useMemo(
    () =>
      new Map(
        courses.map((course) => [
          course.id,
          projectGrade(course, simulatable(course.id, assignments), scenario, now),
        ]),
      ),
    [courses, assignments, scenario, now],
  );
  const domain = useMemo(
    () => sharedDomain(courses, projections),
    [courses, projections],
  );
  const recommendations = useMemo(
    () =>
      new Map(
        courses.map((course) => [
          course.id,
          studyRecommendation(course, assignments),
        ]),
      ),
    [courses, assignments],
  );

  const book = portfolio(courses, projections);

  return (
    <Panel
      title="EQUITY CURVE // GRADE TRAJECTORY & MARGIN"
      footer={
        focus && (
          <WhatIfBar
            key={focus.id}
            course={focus}
            assignments={assignments}
            scenario={scenario}
            selectedId={selectedId}
            onSelect={select}
            onScore={setScore}
            onReset={resetScores}
          />
        )
      }
      actions={
        <Segmented
          label="Equity curve view"
          value={view}
          onChange={setView}
          options={[
            { value: "graph", label: "GRAPH" },
            { value: "table", label: "TABLE" },
          ]}
        />
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-b border-line px-2.5 py-1.5 text-[11px]">
        {courses.some((course) => {
          const projection = projections.get(course.id);
          return projection && projection.grade !== course.current_score;
        }) && <span className="text-accent">WHAT-IF ACTIVE</span>}
        <span>
          <span className="text-ink-3">PORTFOLIO </span>
          <span className="text-[14px] text-ink">
            {book.average === null ? "—" : pct(book.average)}
          </span>
        </span>
        {book.margin !== null && (
          <span className={book.margin >= 0 ? "text-up" : "text-down"}>
            {book.margin >= 0 ? "▲" : "▼"} {signed(book.margin)}% AVG MARGIN
          </span>
        )}
        <span className="text-ink-3">
          ABOVE TARGET{" "}
          <span className="text-ink">
            {book.above}/{book.graded}
          </span>
        </span>
      </div>

      {view === "graph" ? (
        <>
          {focus && (
            <TrajectoryChart
              course={focus}
              assignments={assignments}
              scenario={scenario}
              onScore={setScore}
              onReset={resetScores}
              ref={simulator}
            />
          )}
          <div className="flex flex-wrap justify-between gap-x-3 border-b border-line bg-head px-2.5 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase">
            <span>All courses · select one to simulate</span>
            <span>
              Shared scale {domain[0]}–{domain[1]}% · dashed = target
            </span>
          </div>
          <div className="grid grid-cols-1 gap-px bg-line @lg:grid-cols-2">
            {courses.map((course) => (
              <CourseTile
                key={course.id}
                course={course}
                projection={projections.get(course.id) ?? null}
                domain={domain}
                recommendation={recommendations.get(course.id) ?? null}
                focused={course.id === focus?.id}
                onFocus={focusTile}
                onOpenSource={select}
              />
            ))}
          </div>
        </>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">Course grades against target</caption>
          <thead className="text-[10px] tracking-wider text-ink-3 uppercase">
            <tr className="border-b border-line">
              <th scope="col" className="py-1 pl-2.5 text-left font-normal">
                Course
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                Grade
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                Target
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                Margin
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                Drift
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                What-if
              </th>
              <th scope="col" className="py-1 pr-2.5 text-right font-normal">
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => {
              const drift = driftOf(seriesFor(course));
              const whatIf = projections.get(course.id);
              const margin = whatIf?.margin ?? course.portfolio_margin;
              const open = assignments.filter(
                (a) => a.course_id === course.id && isActive(a),
              ).length;
              return (
                <tr key={course.id} className="border-b border-line/70">
                  <th
                    scope="row"
                    className="py-1 pl-2.5 text-left font-normal text-ink"
                  >
                    {course.course_code}
                  </th>
                  <td className="px-2 py-1 text-right text-ink">
                    {course.current_score === null
                      ? "—"
                      : pct(course.current_score)}
                  </td>
                  <td className="px-2 py-1 text-right text-ink-3">
                    {pct(course.target_score)}
                  </td>
                  <td
                    className={`px-2 py-1 text-right ${margin === null ? "text-ink-3" : margin >= 0 ? "text-up" : "text-down"}`}
                  >
                    {margin === null ? "—" : signed(margin)}
                  </td>
                  <td className="px-2 py-1 text-right text-ink-2">
                    {drift === null ? "—" : signed(drift)}
                  </td>
                  <td
                    className={`px-2 py-1 text-right ${
                      !whatIf || whatIf.grade === course.current_score
                        ? "text-ink-3"
                        : whatIf.margin >= 0
                          ? "text-up"
                          : "text-down"
                    }`}
                  >
                    {whatIf && whatIf.grade !== course.current_score
                      ? `${whatIf.margin >= 0 ? "▲" : "▼"} ${pct(whatIf.grade)}`
                      : "—"}
                  </td>
                  <td
                    className={`py-1 pr-2.5 text-right ${open ? "text-ink" : "text-accent"}`}
                  >
                    {open || "0 · STUDY"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
