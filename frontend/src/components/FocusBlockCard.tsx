"use client";

import { useMemo, useState } from "react";
import type { FocusBlock } from "@/lib/focusBlock";
import { addFocusBlockToCalendar } from "@/lib/calendarExport";
import { whatsappShareUrl } from "@/lib/marginCall";
import { pct, signed } from "@/lib/format";
import { useTerminal } from "@/store/terminal";

export function formatFocusBlockWhatsApp(
  block: FocusBlock,
  shockScore?: number | null,
): string {
  const taskList = block.tasks
    .map((t, idx) => `${idx + 1}. [ ] ${t.title} (${t.estimated_minutes}m)`)
    .join("\n");
  const lines = [
    `🎯 APEX 45-MIN FOCUS BLOCK · ${block.course_code}`,
    `Deliverable: ${block.assignment_title}`,
    block.due_at
      ? `Deadline: ${new Date(block.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : null,
    "",
    `• Break-Even Required: ${block.break_even_score !== null ? `${block.break_even_score.toFixed(1)}%` : "N/A"}`,
    `• Points Locked In: +${block.points_locked_in.toFixed(2)} pts`,
    `• Downside Floor (VaR 90%): ≥${block.downside_floor !== null ? `${block.downside_floor.toFixed(1)}%` : "N/A"}${
      shockScore !== null && shockScore !== undefined ? ` (Simulated @ ${shockScore}%)` : ""
    }`,
    "",
    `Actionable Sprint (${block.total_minutes}m):`,
    taskList,
    "",
    `Policy: ${block.policy_reason}`,
    "— Dispatched from Apex OS Local Sandbox",
  ].filter(Boolean);
  return lines.join("\n");
}

interface FocusBlockCardProps {
  focusBlock: FocusBlock;
  onToggleTask?: (taskId: string) => void;
  onAddToCalendar?: () => void;
  onDispatchWhatsApp?: () => void;
  className?: string;
}

export function FocusBlockCard({
  focusBlock,
  onToggleTask,
  onAddToCalendar,
  onDispatchWhatsApp,
  className = "",
}: FocusBlockCardProps) {
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [whatsAppDispatched, setWhatsAppDispatched] = useState(false);
  const [scoreShock, setScoreShock] = useState<number | null>(null);
  const studentMode = useTerminal((s) => s.studentMode);
  const toggle = useTerminal((s) => s.toggle);

  const weight = focusBlock.assignment_weight ?? 20;
  const exposure = Math.min(Math.max(weight, 0), 100) / 100;

  const effectiveFloor = useMemo(() => {
    if (scoreShock === null || focusBlock.downside_floor === null) {
      return focusBlock.downside_floor;
    }
    return Math.min(100, Math.max(0, focusBlock.downside_floor + (scoreShock * exposure)));
  }, [focusBlock.downside_floor, scoreShock, exposure]);

  const handleToggle = (taskId: string, isCompleted: boolean) => {
    if (onToggleTask) {
      onToggleTask(taskId);
    } else {
      toggle(focusBlock.assignment_id, taskId, !isCompleted);
    }
  };

  const handleCalendar = () => {
    addFocusBlockToCalendar(focusBlock);
    setCalendarAdded(true);
    if (onAddToCalendar) onAddToCalendar();
    setTimeout(() => setCalendarAdded(false), 4000);
  };

  const handleWhatsApp = () => {
    const text = formatFocusBlockWhatsApp(focusBlock, scoreShock);
    const url = whatsappShareUrl(text);
    if (typeof window !== "undefined") {
      window.open(url, "_blank");
    }
    setWhatsAppDispatched(true);
    if (onDispatchWhatsApp) onDispatchWhatsApp();
    setTimeout(() => setWhatsAppDispatched(false), 4000);
  };

  return (
    <div
      data-testid="focus-block-card"
      data-tour="focus-card"
      className={`relative flex flex-col border border-accent/50 bg-head/95 p-5 shadow-[0_0_35px_-5px_rgba(255,107,0,0.18)] backdrop-blur-sm transition-all duration-300 hover:border-accent/70 hover:shadow-[0_0_45px_-5px_rgba(255,107,0,0.25)] ${className}`}
    >
      {/* Top ambient highlight line */}
      <div className="absolute inset-x-0 -top-px h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent opacity-80" />

      {/* Eyebrow & Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-bold tracking-widest text-accent uppercase">
            NEXT 45 MINUTES
          </span>
          <span className="font-mono text-[11px] text-ink-3">·</span>
          <span className="font-mono text-[11px] font-semibold text-ink">
            {focusBlock.course_code}
          </span>
          <span className="font-mono text-[11px] text-ink-3">·</span>
          <span className="max-w-[220px] truncate font-mono text-[11px] text-ink-2">
            {focusBlock.assignment_title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="policy-reason-badge"
            className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium text-accent"
          >
            {focusBlock.policy_reason}
          </span>
          {focusBlock.due_at && (
            <span className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-ink-3">
              DUE {new Date(focusBlock.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
      </div>

      {/* 3 Consequential Metrics */}
      <div className="my-4 grid grid-cols-3 gap-3 border-b border-line pb-4">
        <div className="flex flex-col border-r border-line pr-2">
          <span className="font-mono text-2xl font-black tabular-nums text-accent">
            {focusBlock.break_even_score !== null ? pct(focusBlock.break_even_score) : "—"}
          </span>
          <span className="text-[10px] font-medium text-ink-2">
            {studentMode ? "Target Score Needed" : "Break-Even Score"}
          </span>
          <span className="text-[9px] text-ink-3">
            required on remaining work
          </span>
        </div>

        <div className="flex flex-col border-r border-line pr-2">
          <span className="font-mono text-2xl font-black tabular-nums text-up">
            {signed(focusBlock.points_locked_in)}
          </span>
          <span className="text-[10px] font-medium text-ink-2">
            {studentMode ? "GPA Points Earned" : "Grade Points Locked In"}
          </span>
          <span className="text-[9px] text-ink-3">
            final course-grade points
          </span>
        </div>

        <div className="flex flex-col">
          <span
            data-testid="downside-floor-metric"
            className={`font-mono text-2xl font-black tabular-nums ${
              scoreShock !== null ? "text-accent" : "text-ink"
            }`}
          >
            {effectiveFloor !== null ? `≥${pct(effectiveFloor)}` : "—"}
          </span>
          <span className="text-[10px] font-medium text-ink-2">
            {studentMode ? "Grade Floor Protected" : "Downside Floor (VaR)"}
          </span>
          <span className="text-[9px] text-ink-3">
            {scoreShock !== null ? `simulated @ ${scoreShock}% shock` : "1-in-10 worst-case scenario"}
          </span>
        </div>
      </div>

      {/* Interactive Score Shock Simulator */}
      <div className="mb-4 rounded border border-line bg-panel/60 p-3">
        <div className="flex items-center justify-between text-[10px] uppercase">
          <span className="font-mono font-bold text-ink">
            {studentMode ? "Tactile Score Shock" : "Stress Test: Score Shock Simulator"}
          </span>
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-ink-3">Hypothetical Score:</span>
            <span className="font-bold text-accent">
              {scoreShock !== null ? `${scoreShock}%` : "Worst Case (0%)"}
            </span>
            {scoreShock !== null && (
              <button
                type="button"
                onClick={() => setScoreShock(null)}
                className="ml-1 text-[9px] text-ink-3 underline hover:text-ink cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={scoreShock ?? 0}
            style={{ ["--shock-pct" as string]: `${scoreShock ?? 0}%` }}
            onChange={(e) => setScoreShock(Number(e.target.value))}
            className="score-shock-range w-full"
            aria-label="Hypothetical deliverable score slider"
          />
          <div className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setScoreShock(0)}
              className="border border-line bg-head px-1.5 py-0.5 hover:border-accent hover:text-accent hover:shadow-[0_0_8px_rgba(255,107,0,0.25)] transition-all cursor-pointer"
            >
              0%
            </button>
            <button
              type="button"
              onClick={() => setScoreShock(85)}
              className="border border-line bg-head px-1.5 py-0.5 hover:border-accent hover:text-accent hover:shadow-[0_0_8px_rgba(255,107,0,0.25)] transition-all cursor-pointer"
            >
              85%
            </button>
            <button
              type="button"
              onClick={() => setScoreShock(100)}
              className="border border-line bg-head px-1.5 py-0.5 hover:border-accent hover:text-accent hover:shadow-[0_0_8px_rgba(255,107,0,0.25)] transition-all cursor-pointer"
            >
              100%
            </button>
          </div>
        </div>
      </div>

      {/* 45-Minute Subtasks Checklist */}
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between text-[11px] font-medium text-ink-3 uppercase">
          <span>Actionable Subtasks ({focusBlock.total_minutes}m budget)</span>
          <span>{focusBlock.tasks.filter((t) => t.is_completed).length}/{focusBlock.tasks.length} Done</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {focusBlock.tasks.map((task) => (
            <label
              key={task.id}
              className={`flex cursor-pointer items-center justify-between gap-3 border border-line-strong bg-panel/70 px-3 py-2 text-xs transition-colors hover:border-accent/40 ${
                task.is_completed ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={task.is_completed}
                  onChange={() => handleToggle(task.id, task.is_completed)}
                  className="h-3.5 w-3.5 rounded border-line accent-accent"
                />
                <span
                  className={`font-mono text-[11px] text-ink ${
                    task.is_completed ? "line-through text-ink-3" : ""
                  }`}
                >
                  {task.title}
                </span>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-ink-3">
                {task.estimated_minutes}m
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Action Buttons: Calendar + WhatsApp */}
      <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-3">
        <button
          type="button"
          onClick={handleCalendar}
          className={`flex items-center justify-center gap-1.5 border px-3 py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-all duration-150 cursor-pointer ${
            calendarAdded
              ? "border-up bg-up/20 text-up shadow-[0_0_15px_rgba(0,255,102,0.3)]"
              : "border-accent bg-accent/20 text-accent hover:bg-accent hover:text-canvas hover:shadow-[0_0_20px_rgba(255,107,0,0.35)] active:scale-[0.98]"
          }`}
        >
          <span>{calendarAdded ? "✓ ADDED TO CALENDAR (.ICS + GOOGLE)" : "📅 ADD 45-MIN BLOCK TO CALENDAR"}</span>
        </button>
        <button
          type="button"
          onClick={handleWhatsApp}
          className={`flex items-center justify-center gap-1.5 border px-3 py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-all duration-150 cursor-pointer ${
            whatsAppDispatched
              ? "border-up bg-up/20 text-up shadow-[0_0_15px_rgba(0,255,102,0.3)]"
              : "border-emerald-500/60 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-black hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-[0.98]"
          }`}
        >
          <span>{whatsAppDispatched ? "✓ WHATSAPP OPENED" : "💬 DISPATCH TO WHATSAPP"}</span>
        </button>
      </div>
    </div>
  );
}
