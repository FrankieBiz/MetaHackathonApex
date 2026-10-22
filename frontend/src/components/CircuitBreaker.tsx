"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Key } from "@/components/ui";
import { api } from "@/lib/api";
import {
  LEVEL_STYLE,
  evaluateCircuitBreaker,
  type BreakerLevel,
  type CircuitBreakerStatus,
  type HaltState,
} from "@/lib/circuitBreaker";
import { minutes } from "@/lib/format";
import { isRemote, useTerminal } from "@/store/terminal";
import type { TerminalState } from "@/types";

export interface BreakerReading {
  status: CircuitBreakerStatus;
  source: "backend" | "local";
}

/** The backend's reading at the last sync, and the book it read. */
const useBreakerCheck = create<{
  checked: { data: TerminalState; status: CircuitBreakerStatus } | null;
}>(() => ({ checked: null }));

/**
 * Mounted once, in the top bar: after each sync a linked desk asks the
 * backend, whose reading stands until the book on screen changes.
 */
export function useBreakerSync() {
  const linked = useTerminal((s) => isRemote(s.mode) && !s.simulationPinned);
  const syncedAt = useTerminal((s) => s.data?.metrics.last_synced_at);
  useEffect(() => {
    const snapshot = useTerminal.getState().data;
    if (!linked || !snapshot) return;
    let active = true;
    void api.circuitBreaker(snapshot).then((run) => {
      if (active && run.source === "backend")
        useBreakerCheck.setState({
          checked: { data: snapshot, status: run.status },
        });
    });
    return () => {
      active = false;
    };
  }, [linked, syncedAt]);
}

/**
 * The breaker for the book on screen. The local evaluator mirrors the
 * backend's, so it answers instantly and on every edit; the backend's reading
 * replaces it while it describes the same book.
 */
export function useCircuitBreaker(): BreakerReading | null {
  const data = useTerminal((s) => s.data);
  const checked = useBreakerCheck((s) => s.checked);
  const local = useMemo(
    () => (data ? evaluateCircuitBreaker(data) : null),
    [data],
  );
  return useMemo<BreakerReading | null>(() => {
    if (!data || !local) return null;
    return checked?.data === data
      ? { status: checked.status, source: "backend" }
      : { status: local, source: "local" };
  }, [data, local, checked]);
}

const LEVEL_TONE: Record<
  Exclude<BreakerLevel, "NORMAL">,
  { frame: string; chip: string; text: string }
> = {
  LEVEL_1_CAUTION: {
    frame: "border-accent/50 bg-accent/5",
    chip: "border-accent/70 text-accent",
    text: "text-accent",
  },
  LEVEL_2_RESTRICTION: {
    frame: "border-down/50 bg-down/10",
    chip: "border-down/70 text-down",
    text: "text-down",
  },
  LEVEL_3_HALT: {
    frame: "border-down bg-down/15",
    chip: "border-down bg-down text-canvas",
    text: "text-down",
  },
};

const ackKey = (status: CircuitBreakerStatus) =>
  [
    status.level,
    status.halted_course_ids.join(","),
    status.protected_assignment_ids.join(","),
  ].join("|");

/**
 * Docked over the order book while the breaker is tripped: the level, why,
 * which courses are paused, what is protected, and the time that can move.
 * ACK folds it to one line until the reading changes.
 */
export function CircuitBreakerBanner({
  status,
  source,
  codes,
  onNegotiate,
}: BreakerReading & {
  codes: ReadonlyMap<string, string>;
  /** Opens the negotiator on the top protected deliverable; omitted when there is none. */
  onNegotiate?: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  if (status.level === "NORMAL") return null;
  const tone = LEVEL_TONE[status.level];
  const { label } = LEVEL_STYLE[status.level];
  const key = ackKey(status);
  const halted = status.halted_course_ids.map((id) => codes.get(id) ?? id);
  const pulse = status.level !== "LEVEL_1_CAUTION";

  if (acknowledged === key) {
    return (
      <section
        aria-label="Circuit breaker"
        className={`flex shrink-0 items-center gap-2 border-b px-2.5 py-1 text-[10px] tracking-wider uppercase ${tone.frame}`}
      >
        <span aria-hidden className={tone.text}>
          ●
        </span>
        <span className={tone.text}>Breaker {label}</span>
        <span className="text-ink-3">· acknowledged</span>
        <Key className="ml-auto" onClick={() => setAcknowledged(null)}>
          SHOW
        </Key>
      </section>
    );
  }

  return (
    <section
      aria-label="Circuit breaker"
      className={`flex shrink-0 flex-col gap-1 border-b px-2.5 py-1.5 ${tone.frame}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden
          className={`${tone.text} ${pulse ? "halt-pulse" : ""}`}
        >
          ●
        </span>
        <span className={`text-[10px] tracking-wider uppercase ${tone.text}`}>
          Circuit breaker
        </span>
        <span
          className={`border px-1 text-[10px] leading-[14px] tracking-wider ${tone.chip}`}
        >
          {label}
        </span>
        <span className="min-w-0 flex-1 text-[11px] text-ink-2">
          {status.reason}
        </span>
        <span
          className={`shrink-0 text-[10px] tracking-wider uppercase ${source === "backend" ? "text-up" : "text-ink-3"}`}
          title={
            source === "backend"
              ? "Evaluated by POST /api/v1/portfolio/circuit-breaker at the last sync"
              : "Evaluated in the terminal; mirrors the backend's thresholds"
          }
        >
          ● {source === "backend" ? "Backend" : "Local mirror"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] tracking-wider text-ink-3 uppercase">
        <span>
          Halted{" "}
          <span className={halted.length ? "text-ink" : "text-ink-3"}>
            {halted.length ? halted.join(" · ") : "none"}
          </span>
        </span>
        <span>
          Protected{" "}
          <span
            className={
              status.protected_assignment_ids.length ? tone.text : "text-ink"
            }
          >
            {status.protected_assignment_ids.length}
          </span>
        </span>
        <span title="Remaining estimated minutes on halted work, proposed for protected deliverables. Nothing is moved automatically.">
          Reallocate{" "}
          <span className="text-ink">
            {status.reallocated_minutes
              ? minutes(status.reallocated_minutes)
              : "—"}
          </span>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5 normal-case">
          {status.recommendations.length > 0 && (
            <details className="group relative">
              <summary className="flex h-[22px] cursor-pointer list-none items-center border border-line-strong px-1.5 text-[11px] text-ink-2 uppercase hover:text-ink [&::-webkit-details-marker]:hidden">
                <span aria-hidden>[</span>PLAN {status.recommendations.length}
                <span
                  aria-hidden
                  className="ml-1 inline-block group-open:rotate-180"
                >
                  ▾
                </span>
                <span aria-hidden>]</span>
              </summary>
              <ol className="absolute right-0 z-20 mt-1 w-[min(420px,80vw)] border border-line-strong bg-panel p-2 text-[11px] tracking-normal text-ink-2 shadow-2xl shadow-black">
                {status.recommendations.map((item, index) => (
                  <li key={index} className="flex gap-2 py-0.5">
                    <span className="shrink-0 text-accent tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0 break-words">{item}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {onNegotiate && (
            <Key
              tone="accent"
              onClick={onNegotiate}
              title="Draft an office hours petition for the top protected deliverable"
            >
              ☎ NEGOTIATE
            </Key>
          )}
          <Key
            onClick={() => setAcknowledged(key)}
            title="Fold the banner until the breaker reading changes"
          >
            ACK
          </Key>
        </span>
      </div>
    </section>
  );
}

const ALARM_TONE: Record<Exclude<BreakerLevel, "NORMAL">, string> = {
  LEVEL_1_CAUTION: "border-accent/60 text-accent",
  LEVEL_2_RESTRICTION: "border-down/70 bg-down/10 text-down",
  LEVEL_3_HALT: "border-down bg-down text-canvas",
};

/** The top bar's alarm while the breaker is tripped; nothing at NORMAL. */
export function BreakerAlarm() {
  const breaker = useCircuitBreaker();
  const level = breaker?.status.level ?? "NORMAL";
  if (!breaker || level === "NORMAL") return null;
  const { status } = breaker;
  const { rank, label } = LEVEL_STYLE[level];
  return (
    <div
      role="status"
      aria-label={`Circuit breaker ${label}: ${status.reason}`}
      title={[`${label} · ${status.reason}`, ...status.recommendations].join(
        "\n",
      )}
      className={`flex h-[22px] items-center gap-1.5 border px-1.5 text-[11px] tracking-wider ${ALARM_TONE[level]}`}
    >
      <span aria-hidden className={rank > 1 ? "halt-pulse" : ""}>
        ●
      </span>
      <span aria-hidden>[</span>CIRCUIT BREAKER: LEVEL {rank}
      <span aria-hidden>]</span>
    </div>
  );
}

const HALT_TONE: Record<HaltState, string> = {
  halted: "border-line-strong bg-hover text-ink-3",
  protected: "border-down/60 text-down",
};

/** Marks a deliverable the breaker pauses, or protects as critical path. */
export function HaltBadge({
  state,
  level,
  courseCode,
}: {
  state: HaltState;
  level: BreakerLevel;
  courseCode: string;
}) {
  const { label } = LEVEL_STYLE[level];
  const detail =
    state === "halted"
      ? `Halted by the circuit breaker (${label}): ${courseCode} is at or above target, so its open work is paused and its remaining minutes are proposed for protected deliverables. Confirm course requirements first.`
      : `Protected by the circuit breaker (${label}): weighted work in a below-target or ungraded course. Work it first.`;
  return (
    <span
      title={detail}
      className={`shrink-0 border px-1 text-[9px] leading-[14px] tracking-wider ${HALT_TONE[state]}`}
    >
      <span aria-hidden>[</span>
      {state === "halted" ? "HALTED" : "PROTECTED"}
      <span aria-hidden>]</span>
      <span className="sr-only">. {detail}</span>
    </span>
  );
}
