"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Key, useEscape, useRestoreFocus } from "@/components/ui";
import {
  calculateClientEfficientFrontier,
  fetchEfficientFrontier,
  type EfficientFrontierResponse,
  type FrontierStrategy,
} from "@/lib/efficientFrontier";
import { isRemote, useTerminal } from "@/store/terminal";

export const useEfficientFrontier = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function EfficientFrontierModal() {
  const open = useEfficientFrontier((s) => s.open);
  const setOpen = useEfficientFrontier((s) => s.setOpen);

  if (!open) return null;
  return <EfficientFrontierDialog onClose={() => setOpen(false)} />;
}

const STRATEGY_LABELS: Record<FrontierStrategy, { title: string; desc: string }> = {
  magna_cum_laude: {
    title: "MAGNA CUM LAUDE",
    desc: "Aggressively targets courses near 4.0 grade thresholds",
  },
  balanced: {
    title: "BALANCED",
    desc: "Equalizes risk-adjusted marginal returns across all courses",
  },
  drawdown_defense: {
    title: "DRAWDOWN DEFENSE",
    desc: "Heavily shields negative-margin and vulnerable courses",
  },
};

function EfficientFrontierDialog({ onClose }: { onClose: () => void }) {
  const data = useTerminal((s) => s.data);
  const remote = useTerminal((s) => isRemote(s.mode));
  const studentMode = useTerminal((s) => s.studentMode);
  const [weeklyHours, setWeeklyHours] = useState(20);
  const [strategy, setStrategy] = useState<FrontierStrategy>("balanced");
  const [applied, setApplied] = useState(false);
  const [serverFrontier, setServerFrontier] = useState<EfficientFrontierResponse | null>(null);

  useRestoreFocus();
  useEscape(onClose);

  // Client-side instant computation (works in offline simulation mode and during slider drag)
  const clientFrontier = useMemo(() => {
    if (!data) return null;
    return calculateClientEfficientFrontier(data, weeklyHours, strategy);
  }, [data, weeklyHours, strategy]);

  // Fetch server calculation if remote backend is connected
  useEffect(() => {
    if (!remote) return;
    let active = true;
    void fetchEfficientFrontier(weeklyHours, strategy)
      .then((res) => {
        if (active) setServerFrontier(res);
      })
      .catch(() => {
        // Fall back to clientFrontier
      });
    return () => {
      active = false;
    };
  }, [remote, weeklyHours, strategy]);

  const frontier = (remote && serverFrontier) || clientFrontier;

  const handleApplyAllocation = () => {
    if (!frontier || !data) return;
    setApplied(true);
    setTimeout(() => setApplied(false), 2500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="frontier-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-line-strong bg-panel shadow-2xl shadow-black">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-head px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="bg-accent px-1.5 py-0.5 text-[10px] font-bold text-canvas uppercase">
              MARKOWITZ PARETO
            </span>
            <h2
              id="frontier-title"
              className="text-[13px] font-bold tracking-wider text-ink uppercase"
            >
              {studentMode
                ? "Optimal Study Schedule · Markowitz GPA Allocator"
                : "Academic Efficient Frontier & Study Allocator"}
            </h2>
          </div>
          <Key onClick={onClose} aria-label="Close efficient frontier desk">
            ESC ✕
          </Key>
        </div>

        {/* Metrics Banner */}
        {frontier && (
          <div className="grid grid-cols-2 gap-2 border-b border-line bg-canvas/40 px-4 py-3 sm:grid-cols-5">
            <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
              <span className="text-[10px] text-ink-3 uppercase">Current GPA</span>
              <span className="text-[18px] font-bold text-ink tabular-nums">
                {frontier.current_portfolio_gpa.toFixed(2)}
              </span>
              <span className="text-[9px] text-ink-3">Baseline portfolio</span>
            </div>

            <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
              <span className="text-[10px] text-ink-3 uppercase">Projected GPA</span>
              <span className="text-[18px] font-bold text-up tabular-nums">
                {frontier.projected_portfolio_gpa.toFixed(2)}
              </span>
              <span className="text-[9px] text-up">
                +{frontier.gpa_delta.toFixed(2)} GPA gain
              </span>
            </div>

            <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
              <span className="text-[10px] text-ink-3 uppercase">
                {studentMode ? "Study ROI (Sharpe)" : "Academic Sharpe"}
              </span>
              <span className="text-[18px] font-bold text-accent tabular-nums">
                {frontier.sharpe_ratio.toFixed(2)}
              </span>
              <span className="text-[9px] text-ink-3">
                {studentMode ? "GPA Yield per Hour" : "Yield / Volatility"}
              </span>
            </div>

            <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
              <span className="text-[10px] text-ink-3 uppercase">Portfolio Vol</span>
              <span className="text-[18px] font-bold text-ink tabular-nums">
                {(frontier.portfolio_volatility * 100).toFixed(1)}%
              </span>
              <span className="text-[9px] text-ink-3">Outcome variance</span>
            </div>

            <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
              <span className="text-[10px] text-ink-3 uppercase">Weekly Budget</span>
              <span className="text-[18px] font-bold text-ink tabular-nums">
                {weeklyHours}h / wk
              </span>
              <span className="text-[9px] text-ink-3">{weeklyHours * 60} study minutes</span>
            </div>
          </div>
        )}

        {/* Controls: Hours Slider & Strategy Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-head/50 px-4 py-2.5 text-[11px]">
          {/* Weekly Hours Slider */}
          <div className="flex min-w-[260px] flex-1 items-center gap-3">
            <span className="text-[10px] font-bold text-ink-3 uppercase whitespace-nowrap">
              Study Budget:
            </span>
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none bg-line-strong accent-accent"
              aria-label="Weekly study budget hours"
            />
            <span className="border border-accent px-1.5 py-0.5 text-[11px] font-bold text-accent tabular-nums whitespace-nowrap">
              {weeklyHours} HRS
            </span>
          </div>

          {/* Strategy Toggles */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-ink-3 uppercase">Objective:</span>
            {(["magna_cum_laude", "balanced", "drawdown_defense"] as FrontierStrategy[]).map(
              (strat) => (
                <button
                  key={strat}
                  type="button"
                  onClick={() => setStrategy(strat)}
                  title={STRATEGY_LABELS[strat].desc}
                  className={`border px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                    strategy === strat
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-panel text-ink-3 hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {STRATEGY_LABELS[strat].title}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Frontier Curve SVG Visualization */}
        {frontier && frontier.frontier_curve.length > 0 && (
          <div className="border-b border-line bg-canvas/30 px-4 py-2">
            <div className="mb-1 flex items-center justify-between text-[10px] text-ink-3 uppercase">
              <span>Efficient Frontier Curve (GPA vs Weekly Hours)</span>
              <span>Diminishing marginal returns envelope</span>
            </div>
            <div className="relative h-16 w-full border border-line bg-panel/40 p-2">
              <svg className="h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 40">
                {/* Grid lines */}
                <line x1="0" y1="10" x2="100" y2="10" stroke="currentColor" className="text-line/40" strokeDasharray="2,2" />
                <line x1="0" y1="25" x2="100" y2="25" stroke="currentColor" className="text-line/40" strokeDasharray="2,2" />

                {/* Curve path */}
                {(() => {
                  const pts = frontier.frontier_curve;
                  const minG = 2.0;
                  const maxG = 4.0;
                  const coords = pts.map((p) => {
                    const x = ((p.total_hours - 5) / 35) * 100;
                    const y = 40 - ((p.portfolio_gpa - minG) / (maxG - minG)) * 36 - 2;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  });
                  return (
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-accent"
                      points={coords.join(" ")}
                    />
                  );
                })()}

                {/* Benchmark dots & Active selection dot */}
                {frontier.frontier_curve.map((pt) => {
                  const x = ((pt.total_hours - 5) / 35) * 100;
                  const minG = 2.0;
                  const maxG = 4.0;
                  const y = 40 - ((pt.portfolio_gpa - minG) / (maxG - minG)) * 36 - 2;
                  const isCurrent = Math.abs(pt.total_hours - weeklyHours) < 2.5;

                  return (
                    <g key={pt.total_hours}>
                      <circle
                        cx={x}
                        cy={y}
                        r={isCurrent ? 4 : 2}
                        className={isCurrent ? "fill-up stroke-canvas stroke-1" : "fill-accent"}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}

        {/* Course Allocation Matrix Table */}
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-ink-3 uppercase">
              Pareto Optimal Course Allocation Matrix
            </span>
            <span className="text-[10px] text-ink-3">
              Sorted by Marginal GPA Yield ($dGPA/dHr$)
            </span>
          </div>

          {(!frontier || !frontier.optimal_allocation.length) ? (
            <div className="border border-line-strong p-8 text-center text-[12px] text-ink-3">
              No active courses in the portfolio to optimize.
            </div>
          ) : (
            <div className="overflow-x-auto border border-line-strong">
              <table className="w-full text-left text-[11px] tabular-nums">
                <thead className="border-b border-line bg-head text-[10px] text-ink-3 uppercase">
                  <tr>
                    <th className="px-2 py-1.5">Rank</th>
                    <th className="px-2 py-1.5">Course</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-3 py-1.5">Current Grade</th>
                    <th className="px-3 py-1.5">Projected Grade</th>
                    <th className="px-3 py-1.5">Allocated Hours</th>
                    <th className="px-3 py-1.5 text-right">Marginal Yield</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 bg-canvas/40">
                  {frontier.optimal_allocation.map((alloc) => {
                    const share = ((alloc.allocated_minutes / (weeklyHours * 60)) * 100).toFixed(0);
                    return (
                      <tr key={alloc.course_id} className="hover:bg-hover/50">
                        <td className="px-2 py-1.5 font-bold text-accent">
                          #{alloc.efficiency_rank}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="font-bold text-ink">{alloc.course_code}</span>
                          <span className="ml-2 text-ink-3">{alloc.course_name}</span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {alloc.status === "healthy" ? (
                            <span className="border border-up/50 bg-up/10 px-1 py-0.5 text-[9px] font-bold text-up">
                              HEALTHY
                            </span>
                          ) : alloc.status === "drawdown" ? (
                            <span className="border border-accent/50 bg-accent/10 px-1 py-0.5 text-[9px] font-bold text-accent">
                              DRAWDOWN
                            </span>
                          ) : (
                            <span className="border border-down/50 bg-down/10 px-1 py-0.5 text-[9px] font-bold text-down">
                              CRITICAL
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-ink-2">
                          {alloc.current_score.toFixed(1)}%
                          <span className="text-[9px] text-ink-3 ml-1">
                            (Tgt: {alloc.target_score.toFixed(0)}%)
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-bold text-up">
                          {alloc.projected_score.toFixed(1)}%
                          <span className="text-[9px] text-up ml-1">
                            (+{alloc.score_delta.toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-ink">
                          {alloc.allocated_hours.toFixed(1)}h
                          <span className="text-[9px] text-ink-3 ml-1">
                            ({alloc.allocated_minutes}m · {share}%)
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-bold text-accent">
                          +{alloc.marginal_gpa_yield.toFixed(3)}
                          <span className="text-[9px] text-ink-3 font-normal ml-0.5">
                            GPA/hr
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer & Action Key */}
        <div className="flex items-center justify-between border-t border-line bg-head px-4 py-2 text-[10px] text-ink-3">
          <span>
            {applied
              ? "✓ STUDY BUDGETS REBALANCED ACCORDING TO EFFICIENT FRONTIER"
              : "Markowitz convex quadratic resource optimization applied to academic risk"}
          </span>
          <Key
            tone={applied ? "up" : "accent"}
            onClick={handleApplyAllocation}
            title="Update task tree study budgets with the Pareto optimal allocation"
            aria-label="Apply Pareto allocation"
          >
            {applied ? "✓ ALLOCATION ARMED" : "⚡ APPLY PARETO ALLOCATION"}
          </Key>
        </div>
      </div>
    </div>
  );
}
