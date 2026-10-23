"use client";

import { useState } from "react";
import type { FocusBlock } from "@/lib/focusBlock";
import { addFocusBlockToCalendar } from "@/lib/calendarExport";
import { pct, signed } from "@/lib/format";
import { useTerminal } from "@/store/terminal";

interface FocusBlockCardProps {
  focusBlock: FocusBlock;
  onToggleTask?: (taskId: string) => void;
  onAddToCalendar?: () => void;
  className?: string;
}

export function FocusBlockCard({
  focusBlock,
  onToggleTask,
  onAddToCalendar,
  className = "",
}: FocusBlockCardProps) {
  const [calendarAdded, setCalendarAdded] = useState(false);
  const studentMode = useTerminal((s) => s.studentMode);
  const toggle = useTerminal((s) => s.toggle);

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

  return (
    <div
      data-testid="focus-block-card"
      data-tour="focus-card"
      className={`flex flex-col border border-accent/40 bg-head/90 p-5 shadow-2xl backdrop-blur-sm ${className}`}
    >
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
          <span className="font-mono text-2xl font-black tabular-nums text-ink">
            {focusBlock.downside_floor !== null ? `≥${pct(focusBlock.downside_floor)}` : "—"}
          </span>
          <span className="text-[10px] font-medium text-ink-2">
            {studentMode ? "Grade Floor Protected" : "Downside Floor (VaR)"}
          </span>
          <span className="text-[9px] text-ink-3">
            1-in-10 worst-case scenario
          </span>
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

      {/* 1-Click Calendar Button */}
      <div className="mt-5 pt-3">
        <button
          type="button"
          onClick={handleCalendar}
          className={`flex w-full items-center justify-center gap-2 border px-4 py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-all ${
            calendarAdded
              ? "border-up bg-up/20 text-up"
              : "border-accent bg-accent/20 text-accent hover:bg-accent hover:text-canvas"
          }`}
        >
          <span>{calendarAdded ? "✓ ADDED TO CALENDAR (.ICS + GOOGLE)" : "📅 ADD 45-MIN BLOCK TO CALENDAR"}</span>
          <span className="text-[10px] opacity-75">(WITH 24H & 2H ALARMS)</span>
        </button>
      </div>
    </div>
  );
}
