import { useId, useMemo, useState } from "react";
import { RotateCcw, TrendingUp } from "lucide-react";
import type { CanvasAssignment } from "../types";
import {
  gradableAssignments,
  projectTrajectory,
  sameCourse,
  type GradeAssumptions,
} from "../lib/grades";
import { formatDate } from "../lib/dates";

const defaults: GradeAssumptions = {
  currentGrade: 85,
  gradedPoints: 300,
  targetGrade: 80,
};

export function TrajectoryChart({
  assignments,
  initialAssignmentId,
}: {
  assignments: CanvasAssignment[];
  initialAssignmentId?: string;
}) {
  const orders = useMemo(() => gradableAssignments(assignments), [assignments]);
  const [activeId, setActiveId] = useState(
    initialAssignmentId ?? orders[0]?.id,
  );
  const active = orders.find((a) => a.id === activeId) ?? orders[0];
  const [score, setScore] = useState(85);
  const [assumptions, setAssumptions] = useState(defaults);
  const id = useId();
  const projection = useMemo(
    () =>
      active
        ? projectTrajectory(assignments, active.id, score, assumptions)
        : null,
    [assignments, active, score, assumptions],
  );
  if (!active || !projection)
    return (
      <div className="grade-empty">
        <TrendingUp size={24} />
        <h3>Point values needed</h3>
        <p>
          Connect Canvas or explore the demo to simulate an unfinished
          assignment with a known point value.
        </p>
      </div>
    );

  const { currentGrade, gradedPoints, targetGrade } = assumptions;
  const { points, finalGrade, marginOfSafety, requiredScore } = projection;
  const width = 560,
    height = 230,
    left = 38,
    right = 20,
    top = 16,
    bottom = 32;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (i: number) => left + (i / (points.length - 1)) * chartWidth;
  const y = (grade: number) => top + ((100 - grade) / 100) * chartHeight;
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.grade)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1)},${y(targetGrade)} L${left},${y(targetGrade)} Z`;
  const marginLabel = `${marginOfSafety >= 0 ? "+" : ""}${marginOfSafety.toFixed(1)}`;
  const selectAssignment = (assignment: CanvasAssignment) => {
    if (!sameCourse(assignment, active)) setAssumptions(defaults);
    setActiveId(assignment.id);
    setScore(85);
  };
  return (
    <div className="grade-simulator">
      <p className="grade-disclosure">
        Point-weighted scenario · starting values are editable assumptions, not
        a Canvas grade.
      </p>
      <div className="grade-terminal">
        <div className="grade-order-book">
          <div className="grade-section-heading">
            <h3>Order Book</h3>
            <span>{orders.length} assignments</span>
          </div>
          <div
            className="grade-orders"
            role="group"
            aria-label="Select an assignment to simulate"
          >
            {orders.map((assignment) => (
              <div
                className={`grade-order ${assignment.id === active.id ? "active" : ""}`}
                key={assignment.id}
              >
                <button
                  className="grade-order-select"
                  aria-pressed={assignment.id === active.id}
                  onClick={() => selectAssignment(assignment)}
                >
                  <span className="grade-order-meta">
                    <span>{assignment.course}</span>
                    <span>{assignment.points} pts</span>
                  </span>
                  <strong>{assignment.title}</strong>
                  <span className="grade-order-date">
                    Due {formatDate(assignment.dueAt)}
                  </span>
                </button>
                {assignment.id === active.id && (
                  <div className="grade-score-control">
                    <label htmlFor={`${id}-score`}>
                      What-if score{" "}
                      <output htmlFor={`${id}-score`} className="mono">
                        {score}%
                      </output>
                    </label>
                    <input
                      id={`${id}-score`}
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={score}
                      aria-label={`Hypothetical score for ${active.title}`}
                      aria-valuetext={`${score} percent`}
                      onChange={(e) => setScore(Number(e.target.value))}
                    />
                    <div className="grade-range-labels mono">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="grade-projection">
          <div className="grade-section-heading">
            <div>
              <h3>Grade trajectory</h3>
              <span>
                {active.course} · {projection.assignmentWeight.toFixed(1)}% of
                projected points
              </span>
            </div>
            <button
              className="text-link"
              onClick={() => {
                setScore(85);
                setAssumptions(defaults);
              }}
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>
          <div className="grade-readouts" aria-live="polite" aria-atomic="true">
            <div>
              <span>Projected grade</span>
              <strong className="mono" data-testid="projected-grade">
                {finalGrade.toFixed(1)}
                <small>%</small>
              </strong>
            </div>
            <div className={marginOfSafety >= 0 ? "emerald" : "rose"}>
              <span>Margin of Safety</span>
              <strong className="mono" data-testid="grade-margin">
                {marginLabel}
                <small> pp</small>
              </strong>
              <span>
                {marginOfSafety >= 0 ? "Above target" : "Below target"}
              </span>
            </div>
          </div>
          <svg
            className="trajectory-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={`${id}-title ${id}-description`}
          >
            <title id={`${id}-title`}>
              Projected grade for {active.course}
            </title>
            <desc id={`${id}-description`}>
              {score}% on {active.title} projects {finalGrade.toFixed(1)}%, with
              a {marginLabel} percentage point margin against the {targetGrade}%
              target. Other pending assignments assume {currentGrade}%.
            </desc>
            <defs>
              <clipPath id={`${id}-above`}>
                <rect
                  x={left}
                  y={top}
                  width={chartWidth}
                  height={y(targetGrade) - top}
                />
              </clipPath>
              <clipPath id={`${id}-below`}>
                <rect
                  x={left}
                  y={y(targetGrade)}
                  width={chartWidth}
                  height={top + chartHeight - y(targetGrade)}
                />
              </clipPath>
            </defs>
            {[0, 25, 50, 75, 100].map((tick) => (
              <g key={tick} className="grade-grid">
                <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
                <text x={left - 8} y={y(tick) + 3} textAnchor="end">
                  {tick}%
                </text>
              </g>
            ))}
            <path
              d={area}
              className="grade-buffer-positive"
              clipPath={`url(#${id}-above)`}
            />
            <path
              d={area}
              className="grade-buffer-negative"
              clipPath={`url(#${id}-below)`}
            />
            <line
              className="grade-baseline"
              x1={left}
              x2={width - right}
              y1={y(currentGrade)}
              y2={y(currentGrade)}
            />
            <line
              className="grade-target"
              x1={left}
              x2={width - right}
              y1={y(targetGrade)}
              y2={y(targetGrade)}
            />
            <path
              className="grade-trajectory"
              d={line}
              data-testid="grade-trajectory"
            />
            {points.map((p, i) => (
              <circle
                key={p.id}
                cx={x(i)}
                cy={y(p.grade)}
                r={p.id === active.id ? 5 : 3}
                className={
                  p.id === active.id ? "grade-point active" : "grade-point"
                }
              >
                <title>
                  {p.label}: {p.grade.toFixed(1)}%
                </title>
              </circle>
            ))}
            <g className="grade-axis">
              <text x={left} y={height - 6}>
                Now
              </text>
              <text x={width - right} y={height - 6} textAnchor="end">
                Last due · {formatDate(points[points.length - 1].dueAt!)}
              </text>
            </g>
          </svg>
          <div className="grade-legend">
            <span>
              <i className="projection-key" />
              What-if
            </span>
            <span>
              <i className="baseline-key" />
              Starting grade
            </span>
            <span>
              <i className="target-key" />
              Target {targetGrade}%
            </span>
          </div>
          <fieldset className="grade-assumptions">
            <legend>Scenario assumptions</legend>
            {(
              [
                ["currentGrade", "Starting grade (%)", 100],
                ["gradedPoints", "Points already graded", 1_000_000],
                ["targetGrade", "Target grade (%)", 100],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min="0"
                  max={max}
                  step={key === "gradedPoints" ? "1" : "0.1"}
                  value={assumptions[key]}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value))
                      setAssumptions((s) => ({
                        ...s,
                        [key]: Math.min(max, Math.max(0, value)),
                      }));
                  }}
                />
              </label>
            ))}
          </fieldset>
          <p className="grade-model-note">
            {gradedPoints} graded points at {currentGrade}%. Other unfinished{" "}
            {active.course} assignments assume {currentGrade}%.{" "}
            {requiredScore > 100
              ? "Target is unreachable from this assignment alone."
              : requiredScore <= 0
                ? "Target holds even at 0% on this assignment."
                : `Score at least ${Math.ceil(requiredScore)}% here to reach the target.`}{" "}
            Category weights, extra credit, and missing coursework are excluded.
          </p>
        </div>
      </div>
    </div>
  );
}
