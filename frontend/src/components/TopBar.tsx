"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { inferenceLabel, useInference } from "@/store/inference";
import { Key, Spinner } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  assignmentVolatility,
  completionVelocity,
  deadlineLoad,
  isActive,
  portfolio,
  velocityByCourse,
  volatilityRegime,
} from "@/lib/engine";
import { clock, pct, signed } from "@/lib/format";
import { useTerminal } from "@/store/terminal";
import type { ConnectionMode, Course, DataOrigin } from "@/types";

function Clock() {
  const now = new Date(useNow(1000));
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "LOCAL";
  return (
    <div className="flex items-center gap-3 text-[12px]" aria-label="Clocks">
      <span>
        <span className="text-ink-3">UTC </span>
        <time className="text-ink">{clock(now, "UTC")}</time>
      </span>
      <span>
        <span className="text-ink-3">{zone.toUpperCase()} </span>
        <time className="text-ink">{clock(now)}</time>
      </span>
    </div>
  );
}

const SIMULATION = "[MODE: ISOLATED SIMULATION DESK]";

function EngineBadge() {
  const state = useInference();
  useEffect(() => {
    let active = true;
    void api
      .engine()
      .then((configuration) => {
        if (active) useInference.getState().configure(configuration);
      })
      .catch(() => {
        if (active && useInference.getState().status === "ready")
          useInference.getState().finish(null, "unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  const telemetry = state.telemetry;
  return (
    <div
      role="status"
      className="border border-accent/40 px-1.5 py-0.5 text-[11px] text-accent"
      title={
        telemetry
          ? `Prompt: ${telemetry.prompt_tokens ?? "unreported"} tokens; completion: ${telemetry.completion_tokens ?? "unreported"} tokens. Throughput = completion tokens / full API round-trip seconds.`
          : "Meta Model API · Llama. Execute AI triage to measure inference."
      }
    >
      {inferenceLabel(state)}
    </div>
  );
}

interface Badge {
  text: string;
  tag?: string;
  detail: string;
  color: string;
}

function badgeFor(
  mode: ConnectionMode,
  origin: DataOrigin,
  pinned: boolean,
): Badge {
  switch (mode) {
    case "live":
      return {
        text: "CANVAS API: CONNECTED",
        detail: "Live Canvas data via the backend",
        color: "text-up",
      };
    case "backend-demo":
      return {
        text: SIMULATION,
        tag: "API",
        detail:
          "Backend online, serving the deterministic dataset (Canvas unreachable or demo mode)",
        color: "text-accent",
      };
    case "offline":
      if (origin === "backend") {
        return {
          text: "BACKEND DETACHED",
          tag: "EDITS QUEUE",
          detail:
            "Holding the last backend data; edits replay when the link returns",
          color: "text-accent",
        };
      }
      return {
        text: SIMULATION,
        tag: pinned ? "PINNED" : "LOCAL",
        detail: pinned
          ? "Pinned with Ctrl+Shift+D; the backend is not contacted"
          : "Canvas feed slow, erroring, or unreachable; running the local deterministic dataset",
        color: "text-accent",
      };
    case "connecting":
      return {
        text: "LINKING…",
        detail: "Contacting the backend",
        color: "text-ink-3",
      };
  }
}

function ConnectionBadge() {
  const mode = useTerminal((s) => s.mode);
  const origin = useTerminal((s) => s.origin);
  const pinned = useTerminal((s) => s.simulationPinned);
  const badge = badgeFor(mode, origin, pinned);
  return (
    <div
      role="status"
      title={`${badge.detail}. Ctrl+Shift+D toggles live Canvas / simulation.`}
      className={`flex h-[22px] items-center gap-1.5 border border-current/40 px-1.5 text-[11px] ${badge.color}`}
    >
      <span aria-hidden>{mode === "connecting" ? "○" : "●"}</span>
      <span>{badge.text}</span>
      {badge.tag && <span className="text-ink-3">· {badge.tag}</span>}
    </div>
  );
}

function MarginTag({ margin }: { margin: number | null }) {
  if (margin === null)
    return <span className="text-ink-3">[NO GRADE YET]</span>;
  const up = margin >= 0;
  return (
    <span className={up ? "text-up" : "text-down"}>
      {up ? "▲" : "▼"} [{signed(margin)}% MARGIN]
    </span>
  );
}

const velocityTone = (velocity: number | null) =>
  velocity === null ? "text-ink-3" : velocity >= 100 ? "text-up" : "text-down";

function TapeItem({
  course,
  velocity,
}: {
  course: Course;
  velocity: number | null;
}) {
  return (
    <span className="flex items-center gap-2 px-5">
      <span className="text-ink">{course.course_code}:</span>
      <span className="text-ink">
        {course.current_score === null ? "—" : pct(course.current_score)}
      </span>
      <MarginTag margin={course.portfolio_margin} />
      <span className="text-ink-3">VEL</span>
      <span className={velocityTone(velocity)}>
        {velocity === null ? "—" : pct(velocity)}
      </span>
    </span>
  );
}

/**
 * Pinned left of the tape so the selected course's velocity is always in
 * view; it flashes when a checkbox or time log in the execution deck moves it.
 */
function FocusVelocity() {
  const focus = useTerminal((s) => {
    const assignment = s.data?.assignments.find((a) => a.id === s.selectedId);
    return assignment
      ? s.data?.courses.find((c) => c.id === assignment.course_id)
      : undefined;
  });
  const assignments = useTerminal((s) => s.data?.assignments);
  const velocity = useMemo(
    () =>
      focus && assignments
        ? completionVelocity(
            assignments.filter((a) => a.course_id === focus.id),
          )
        : null,
    [focus, assignments],
  );
  if (!focus) return null;
  const label = velocity === null ? "NO FILLS" : pct(velocity);
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-r border-line bg-head px-3"
      title="Completion Velocity for the course in the execution deck: estimated ÷ logged minutes on finished tasks"
      aria-live="polite"
      aria-atomic
    >
      <span className="text-accent">{focus.course_code} VELOCITY</span>
      <span key={label} className={`tick-flash ${velocityTone(velocity)}`}>
        {label}
      </span>
    </div>
  );
}

function Tape() {
  const data = useTerminal((s) => s.data);
  const minute = useNow(60_000);
  const items = useMemo(() => {
    if (!data) return null;
    const { courses, assignments } = data;
    const book = portfolio(courses);
    const velocity = completionVelocity(assignments);
    const byCourse = velocityByCourse(assignments);
    const volatility = assignmentVolatility(deadlineLoad(assignments, minute));
    return (
      <>
        <span className="flex items-center gap-2 px-5">
          <span className="text-accent">PORTFOLIO</span>
          <span className="text-ink">
            {book.average === null ? "—" : pct(book.average)}
          </span>
          <MarginTag margin={book.margin} />
        </span>
        {courses.map((course) => (
          <TapeItem
            key={course.id}
            course={course}
            velocity={byCourse.get(course.id) ?? null}
          />
        ))}
        <span className="flex items-center gap-2 px-5">
          <span className="text-accent">VELOCITY</span>
          <span className={velocityTone(velocity)}>
            {velocity === null ? "NO FILLS" : pct(velocity)}
          </span>
        </span>
        <span className="flex items-center gap-2 px-5">
          <span className="text-accent">VOLATILITY</span>
          <span className="text-ink">{volatility.toFixed(0)}</span>
          <span className="text-ink-3">
            {volatilityRegime(volatility).toUpperCase()}
          </span>
        </span>
        <span className="flex items-center gap-2 px-5">
          <span className="text-accent">OPEN</span>
          <span className="text-ink">
            {assignments.filter(isActive).length}
          </span>
        </span>
      </>
    );
  }, [data, minute]);

  const count = (data?.courses.length ?? 0) + 4;
  return (
    <div className="flex h-6 border-b border-line bg-canvas text-[11px] whitespace-nowrap">
      <FocusVelocity />
      <div
        className="tape-window relative flex min-w-0 flex-1 items-center overflow-hidden"
        aria-label="Market tape"
        tabIndex={0}
      >
        <div
          className="tape flex w-max"
          style={{ ["--tape-duration" as string]: `${count * 7}s` }}
        >
          <div className="flex">{items}</div>
          <div className="flex" aria-hidden>
            {items}
          </div>
        </div>
      </div>
    </div>
  );
}

const subscribeNoop = () => () => {};

function useModifierLabel() {
  return useSyncExternalStore(
    subscribeNoop,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "CTRL+K"),
    () => "CTRL+K",
  );
}

export function TopBar() {
  const syncing = useTerminal((s) => s.syncing);
  const armed = useTerminal((s) => s.credentials !== null);
  const sync = useTerminal((s) => s.sync);
  const setTokenOpen = useTerminal((s) => s.setTokenOpen);
  const setPaletteOpen = useTerminal((s) => s.setPaletteOpen);
  const modifier = useModifierLabel();

  return (
    <header className="shrink-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-head px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="bg-accent px-1.5 text-[12px] font-bold text-canvas">
            APEX
          </span>
          <span className="text-[12px] tracking-wider text-ink-2">
            ACADEMIC TERMINAL
          </span>
        </div>
        <Clock />
        <EngineBadge />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <ConnectionBadge />
          <Key
            tone="accent"
            onClick={() => void sync()}
            disabled={syncing}
            aria-label="Sync now"
          >
            {syncing ? (
              <>
                SYNCING&nbsp;
                <Spinner />
              </>
            ) : (
              "SYNC NOW"
            )}
          </Key>
          <Key
            onClick={() => setTokenOpen(true)}
            aria-label="Configure Canvas API token"
          >
            TOKEN CONFIG
            {armed && <span className="ml-1 text-up">●</span>}
          </Key>
          <Key
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
          >
            {modifier}
          </Key>
        </div>
      </div>
      <Tape />
    </header>
  );
}
