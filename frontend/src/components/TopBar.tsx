"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import {
  inferenceLabel,
  inferencePill,
  useInference,
  type InferencePill,
} from "@/store/inference";
import { Key, Spinner } from "@/components/ui";
import {
  SyllabusIngestModal,
  useSyllabusIngest,
} from "@/components/SyllabusIngestModal";
import { BreakerAlarm, useBreakerSync } from "@/components/CircuitBreaker";
import { MarginCallModal, useMarginCall } from "@/components/MarginCallModal";
import {
  BellKey,
  MorningBellModal,
  useMorningBell,
} from "@/components/MorningBell";
import { NegotiationModal } from "@/components/NegotiationModal";
import { MonteCarloModal, useMonteCarlo } from "@/components/MonteCarloModal";
import {
  CalendarExportModal,
  useCalendarExport,
} from "@/components/CalendarExportModal";
import {
  EfficientFrontierModal,
  useEfficientFrontier,
} from "@/components/EfficientFrontierModal";
import {
  PortfolioReportModal,
  useDossier,
} from "@/components/PortfolioReportModal";
import { useNow } from "@/hooks/useNow";
import {
  assignmentVolatility,
  completionVelocity,
  deadlineLoad,
  isActive,
  portfolio,
  velocityByCourse,
  velocityTier,
  volatilityRegime,
  type VelocityTier,
} from "@/lib/engine";
import { clock, pct, signed } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { breachCount } from "@/lib/marginCall";
import { isRemote, useTerminal } from "@/store/terminal";
import { startTour } from "@/lib/tour";
import { armStartupChime, playAlert } from "@/lib/feedback";
import { armMorningBell } from "@/lib/morningBell";
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

const PILL_TONE: Record<
  InferencePill["tone"],
  { frame: string; detail: string }
> = {
  measured: { frame: "border-up/50 bg-up/10", detail: "text-up" },
  running: { frame: "border-accent/60 bg-accent/10", detail: "text-accent" },
  idle: { frame: "border-accent/40", detail: "text-accent" },
  offline: { frame: "border-line-strong", detail: "text-ink-3" },
};

/** Meta Llama telemetry: measured throughput and round-trip latency of the last triage. */
function EngineBadge() {
  const state = useInference();
  const remote = useTerminal((s) => isRemote(s.mode));
  // Probes on mount and again whenever the backend link drops or returns.
  useEffect(() => {
    // The pinned simulation desk never contacts the backend.
    if (useTerminal.getState().simulationPinned) return;
    let active = true;
    void api
      .engine()
      .then((configuration) => {
        if (!active) return;
        const inference = useInference.getState();
        inference.configure(configuration);
        // Marked unavailable while the backend was unreachable; it answers again.
        if (inference.status === "unavailable")
          useInference.setState({ status: "ready" });
      })
      .catch(() => {
        if (active && useInference.getState().status === "ready")
          useInference.getState().finish(null, "unavailable");
      });
    return () => {
      active = false;
    };
  }, [remote]);
  const telemetry = state.telemetry;
  const pill = inferencePill(state);
  const tone = PILL_TONE[pill.tone];
  return (
    <div
      role="status"
      aria-label={`Meta Llama engine: ${inferenceLabel(state)}`}
      className={`flex h-[22px] items-center gap-1.5 border px-1.5 text-[11px] ${tone.frame}`}
      title={
        telemetry
          ? `Meta Model API. Prompt: ${telemetry.prompt_tokens ?? "unreported"} tokens; completion: ${telemetry.completion_tokens ?? "unreported"} tokens. Throughput = completion tokens / full API round-trip seconds.`
          : pill.tone === "offline"
            ? "Meta Model API · no model inference ran for the current plan."
            : "Meta Model API · Llama. Execute AI triage to measure inference."
      }
    >
      {pill.tone === "running" ? (
        <Spinner />
      ) : (
        <span aria-hidden className={tone.detail}>
          ●
        </span>
      )}
      <span className="font-semibold text-ink">{pill.model}</span>
      <span aria-hidden className="text-ink-3">
        {"//"}
      </span>
      <span
        key={pill.detail}
        className={`${tone.detail} ${pill.tone === "measured" ? "tick-flash" : ""}`}
      >
        {pill.detail}
      </span>
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
    <span
      className={up ? "text-up" : "text-down"}
      title={GLOSSARY.marginOfSafety}
    >
      {up ? "▲" : "▼"} [{signed(margin)}% MARGIN]
    </span>
  );
}

const VELOCITY_TONE: Record<VelocityTier, string> = {
  ahead: "text-up",
  pace: "text-accent",
  overrun: "text-down",
};

const velocityTone = (velocity: number | null) =>
  velocity === null ? "text-ink-3" : VELOCITY_TONE[velocityTier(velocity)];

export function academicStance(
  margin: number | null,
  velocity: number | null,
  volatility: number,
): "BULLISH ACCELERATION" | "DEFENSIVE BUFFER" | "VOLATILITY ALERT" {
  if (volatilityRegime(volatility) === "high") return "VOLATILITY ALERT";
  if (margin !== null && margin >= 0 && velocity !== null && velocity >= 100)
    return "BULLISH ACCELERATION";
  return "DEFENSIVE BUFFER";
}

function MarketStance({
  margin,
  velocity,
  volatility,
}: {
  margin: number | null;
  velocity: number | null;
  volatility: number;
}) {
  const stance = academicStance(margin, velocity, volatility);
  const studentMode = useTerminal((s) => s.studentMode);
  const previous = useRef(stance);
  useEffect(() => {
    if (previous.current !== stance && stance !== "BULLISH ACCELERATION")
      playAlert();
    previous.current = stance;
  }, [stance]);
  const tone = stance === "VOLATILITY ALERT" ? "text-down"
    : stance === "BULLISH ACCELERATION" ? "text-up" : "text-accent";
  const displayLabel = studentMode
    ? stance === "VOLATILITY ALERT"
      ? "GRADE AT RISK"
      : stance === "BULLISH ACCELERATION"
        ? "HONORS SPRINT"
        : "DEFENDING TARGET"
    : stance;
  return (
    <div
      role="status"
      aria-atomic="true"
      className={`flex shrink-0 items-center gap-2 border-r border-line bg-head px-2 ${tone}`}
      title={
        studentMode
          ? `Student Mode: ${stance} — ${displayLabel}. Volunteer or triage to lift grade buffer.`
          : "Academic stance: volatility ≥200 triggers an alert; grade margin ≥0 and completion velocity ≥100% signal acceleration; otherwise protect the grade buffer. Updates with grades, task fills, time logs, and deadlines."
      }
    >
      <span className="hidden text-ink-3 xl:inline">
        {studentMode ? "POSTURE" : "STANCE"}
      </span>
      <span>{displayLabel}</span>
    </div>
  );
}

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
      className="hidden shrink-0 items-center gap-2 border-r border-line bg-head px-3 md:flex"
      title="Completion Velocity for the course in the execution deck: estimated ÷ actual minutes on finished tasks (unlogged finished tasks count as on budget)"
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
  const metrics = useMemo(() => data ? {
    book: portfolio(data.courses),
    velocity: completionVelocity(data.assignments),
    volatility: assignmentVolatility(deadlineLoad(data.assignments, minute)),
  } : null, [data, minute]);
  const items = useMemo(() => {
    if (!data || !metrics) return null;
    const { courses, assignments } = data;
    const { book, velocity, volatility } = metrics;
    const byCourse = velocityByCourse(assignments);
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
        <span
          className="flex items-center gap-2 px-5"
          title={GLOSSARY.volatility}
        >
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
  }, [data, metrics]);

  const count = (data?.courses.length ?? 0) + 4;
  return (
    <div className="flex h-6 border-b border-line bg-canvas text-[11px] whitespace-nowrap">
      {metrics && (
        <MarketStance margin={metrics.book.margin} velocity={metrics.velocity} volatility={metrics.volatility} />
      )}
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

/** Lets the startup chime finish before the first-of-the-morning bell. */
const AUTO_BELL_DELAY_MS = 500;

export function TopBar() {
  useEffect(() => armStartupChime(), []);
  useBreakerSync();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disarm = armMorningBell(() => {
      timer = setTimeout(
        () => useMorningBell.getState().ring({ auto: true }),
        AUTO_BELL_DELAY_MS,
      );
    });
    return () => {
      disarm();
      clearTimeout(timer);
    };
  }, []);
  const syncing = useTerminal((s) => s.syncing);
  const armed = useTerminal((s) => s.credentials !== null);
  const sync = useTerminal((s) => s.sync);
  const soundOn = useTerminal((s) => s.soundOn);
  const toggleSound = useTerminal((s) => s.toggleSound);
  const studentMode = useTerminal((s) => s.studentMode);
  const toggleStudentMode = useTerminal((s) => s.toggleStudentMode);
  const setTokenOpen = useTerminal((s) => s.setTokenOpen);
  const setPaletteOpen = useTerminal((s) => s.setPaletteOpen);
  const setSyllabusOpen = useSyllabusIngest((s) => s.setOpen);
  const setMonteCarloOpen = useMonteCarlo((s) => s.setOpen);
  const setDossierOpen = useDossier((s) => s.setOpen);
  const setMarginCallOpen = useMarginCall((s) => s.setOpen);
  const breaches = useTerminal((s) => (s.data ? breachCount(s.data) : 0));
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
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <BreakerAlarm />
          <ConnectionBadge />
          <EngineBadge />
          <Key
            onClick={() => void startTour()}
            title="Start automated judge demonstration tour"
            aria-label="Start demo tour"
          >
            ▶ TOUR
          </Key>
          <Key
            tone={studentMode ? "accent" : undefined}
            onClick={() => toggleStudentMode()}
            title={`Toggle Student Mode: plain-English subtitles vs Wall St density (hotkey U)`}
            aria-label="Toggle student mode"
          >
            {studentMode ? "🎓 STUDENT" : "🏛️ WALL ST"}
          </Key>
          <Key
            onClick={() => toggleSound()}
            title={`Toggle terminal audio effects (${soundOn ? "ON" : "OFF"}, hotkey Shift+M)`}
            aria-label="Toggle audio effects"
          >
            SND {soundOn ? "ON" : "OFF"}
          </Key>
          <BellKey />
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
            tone="up"
            onClick={() => setSyllabusOpen(true)}
            title="Drop a syllabus photo or document, or paste its text, to load courses without a Canvas token"
            aria-label="Ingest a syllabus"
          >
            + SYLLABUS
          </Key>
          <Key
            caps={false}
            onClick={() => setMonteCarloOpen(true)}
            title="Monte Carlo what-if desk: final-grade quantiles, 90% value at risk, leverage ranking, and score shocks"
            aria-label="Open the Monte Carlo what-if and value-at-risk desk"
          >
            WHAT-IF // VaR
          </Key>
          <Key
            onClick={() => setDossierOpen(true)}
            title="Academic standing dossier: executive memo and audit metrics (hotkey R)"
            aria-label="Open the academic standing dossier"
          >
            DOSSIER // MEMO
          </Key>
          <Key
            onClick={() => useCalendarExport.getState().setOpen(true)}
            title="Academic Calendar export: download RFC 5545 .ics schedule or copy live webcal:// feed (hotkey C)"
            aria-label="Open calendar export desk"
          >
            CAL // .ICS
          </Key>
          <Key
            onClick={() => useEfficientFrontier.getState().setOpen(true)}
            title="Academic Efficient Frontier & Pareto study hour allocator (hotkey E)"
            aria-label="Open academic efficient frontier"
          >
            FRONTIER
          </Key>
          <Key
            tone={breaches ? "down" : "default"}
            onClick={() => setMarginCallOpen(true)}
            title={`Margin call desk: breached courses, restoration order, and a WhatsApp alert preview (hotkey M)${
              breaches
                ? ` · ${breaches} course${breaches === 1 ? "" : "s"} under target`
                : ""
            }`}
            aria-label={`Open the margin call desk${breaches ? `, ${breaches} courses under target` : ""}`}
          >
            MARGIN CALL
            {breaches > 0 && <span className="ml-1">● {breaches}</span>}
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
      <SyllabusIngestModal />
      <MonteCarloModal />
      <PortfolioReportModal />
      <MarginCallModal />
      <NegotiationModal />
      <MorningBellModal />
      <CalendarExportModal />
      <EfficientFrontierModal />
    </header>
  );
}
