"use client";

import { useMemo, type ReactNode } from "react";
import { Key, Spinner } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  assignmentVolatility,
  deadlineLoad,
  floorText,
  forecastGrade,
  nextBestAction,
  simulatable,
  volatilityRegime,
} from "@/lib/engine";
import { minutes, signed } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { useTerminal } from "@/store/terminal";

function Figure({
  label,
  help,
  tone = "text-ink",
  className = "",
  children,
}: {
  label: string;
  help: string;
  tone?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 cursor-help flex-col gap-0.5 ${className}`}
      title={help}
    >
      <span className={`text-[15px] leading-none font-semibold whitespace-nowrap ${tone}`}>
        {children}
      </span>
      <span className="text-[9px] tracking-wider whitespace-nowrap text-ink-3 uppercase underline decoration-dotted underline-offset-2">
        {label}
      </span>
    </div>
  );
}

function dueLabel(hours: number | null): string {
  if (hours === null) return "NO DEADLINE";
  if (hours < 0) return "OVERDUE";
  if (hours < 1) return "DUE <1H";
  if (hours < 48) return `DUE IN ${Math.round(hours)}H`;
  return `DUE IN ${Math.round(hours / 24)}D`;
}

function floorFigure(floor: number | null): { text: string; tone: string } {
  if (floor === null) return { text: "—", tone: "text-ink-3" };
  if (floor > 100) return { text: ">100%", tone: "text-down" };
  if (floor <= 0) return { text: "ANY", tone: "text-up" };
  return {
    text: `≥${floor.toFixed(1)}%`,
    tone: floor >= 85 ? "text-down" : floor >= 60 ? "text-accent" : "text-up",
  };
}

/**
 * Directive hero above the workstation grid: the one task with the most grade
 * leverage tonight, with the risk figures that justify it.
 */
export function NextBestAction() {
  const data = useTerminal((s) => s.data);
  const triaging = useTerminal((s) => s.triaging);
  const studentMode = useTerminal((s) => s.studentMode);
  const minute = useNow(60_000);

  const view = useMemo(() => {
    if (!data) return null;
    const action = nextBestAction(data, minute);
    if (!action) return null;
    const { course } = action;
    const forecast = course
      ? forecastGrade(course, simulatable(course.id, data.assignments), {})
      : null;
    return {
      action,
      safety: course?.portfolio_margin ?? null,
      valueAtRisk:
        forecast && course?.current_score != null
          ? Math.max(0, course.current_score - forecast.final.p10)
          : null,
      volatility: assignmentVolatility(deadlineLoad(data.assignments, minute)),
    };
  }, [data, minute]);

  if (!view) {
    return (
      <section
        aria-label="Next best action"
        className="flex h-9 shrink-0 items-center gap-3 border-b border-line border-l-2 border-l-up bg-head px-3 text-[11px]"
      >
        <span className="text-up">NEXT BEST ACTION</span>
        <span className="text-ink-2">Order book is clear. Nothing open tonight.</span>
      </section>
    );
  }

  const { action, safety, valueAtRisk, volatility } = view;
  const { assignment, course, leaf } = action;
  const busy = Boolean(triaging[assignment.id]);
  const floor = floorFigure(action.floor);
  const regime = volatilityRegime(volatility);
  const execute = () => {
    const store = useTerminal.getState();
    if (leaf) store.select(assignment.id);
    else void store.triage(assignment.id);
  };

  return (
    <section
      aria-label="Next best action"
      aria-live="polite"
      className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-line border-l-2 border-l-accent bg-head px-3 py-2"
    >
      <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1">
        <span className="text-[10px] tracking-wider text-accent">
          {studentMode
            ? "▶ TOP PRIORITY ACTION · HIGHEST GPA IMPACT"
            : "▶ NEXT BEST ACTION · TONIGHT"}
        </span>
        <span
          key={leaf?.id ?? assignment.id}
          className="tick-flash truncate text-[16px] leading-tight font-semibold text-ink"
          title={leaf?.title ?? assignment.title}
        >
          {leaf ? leaf.title : `Run AI triage: ${assignment.title}`}
        </span>
        <span className="truncate text-[10px] tracking-wider text-ink-3 uppercase">
          {assignment.course_code} · {leaf ? assignment.title : "no work breakdown yet"}{" "}
          · <span className={action.hours !== null && action.hours < 24 ? "text-down" : ""}>
            {dueLabel(action.hours)}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Figure
          label={studentMode ? "GPA impact" : "Margin protected"}
          help={GLOSSARY.marginProtected}
          tone="text-up"
        >
          +{action.protectedPoints.toFixed(2)} PTS
        </Figure>
        <Figure
          label="Duration"
          help={
            leaf
              ? "Estimated time for this task from its work breakdown."
              : "Unsized until triage breaks the deliverable into timed tasks."
          }
        >
          {action.duration === null ? "TRIAGE" : minutes(action.duration)}
        </Figure>
        <Figure
          label={studentMode ? "Min pass score" : "Grade floor"}
          help={`${GLOSSARY.gradeFloor}\n\n${floorText(action.floor, course)}.`}
          tone={floor.tone}
        >
          {floor.text}
        </Figure>
        <Figure
          label={studentMode ? "Score buffer" : "Margin of safety"}
          help={GLOSSARY.marginOfSafety}
          tone={safety === null ? "text-ink-3" : safety >= 0 ? "text-up" : "text-down"}
          className="hidden sm:flex"
        >
          {safety === null ? "—" : signed(safety)}
        </Figure>
        <Figure
          label={studentMode ? "Worst exam risk" : "VaR 90%"}
          help={GLOSSARY.var}
          tone={valueAtRisk === null ? "text-ink-3" : "text-accent"}
          className="hidden md:flex"
        >
          {valueAtRisk === null ? "—" : `−${valueAtRisk.toFixed(1)} PTS`}
        </Figure>
        <Figure
          label="Volatility"
          help={GLOSSARY.volatility}
          tone={regime === "high" ? "text-down" : regime === "elevated" ? "text-accent" : "text-ink"}
          className="hidden lg:flex"
        >
          {volatility.toFixed(0)}
        </Figure>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Key
          tone="accent"
          size="lg"
          onClick={execute}
          disabled={busy}
          aria-label={leaf ? `Open ${leaf.title} in the execution deck` : `Run AI triage on ${assignment.title}`}
        >
          {busy ? (
            <>
              TRIAGING&nbsp;
              <Spinner />
            </>
          ) : leaf ? (
            "EXECUTE"
          ) : (
            "TRIAGE NOW"
          )}
        </Key>
        {leaf && (
          <Key
            tone="up"
            size="lg"
            onClick={() =>
              useTerminal.getState().toggle(assignment.id, leaf.id, true)
            }
            aria-label={`Mark ${leaf.title} complete`}
          >
            FILL ✓
          </Key>
        )}
      </div>
    </section>
  );
}
