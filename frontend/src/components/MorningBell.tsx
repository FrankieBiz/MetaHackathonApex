"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { Key, useEscape, useRestoreFocus } from "@/components/ui";
import { playBell, soundEnabled } from "@/lib/feedback";
import {
  BELL_LEAD_MS,
  BELL_OPENS,
  briefingScript,
  composeBriefing,
  markRung,
  pickVoice,
  speakLines,
  speechEngine,
  type MorningBriefing,
  type SpeechRun,
} from "@/lib/morningBell";
import { useTerminal } from "@/store/terminal";

export type BellOutcome = "spoken" | "stopped" | "voiceless" | "muted";

interface MorningBellStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  briefing: MorningBriefing | null;
  /** The segment on air: -1 while the bell rings, null when idle. */
  active: number | null;
  outcome: BellOutcome | null;
  /** The voice reading the briefing; null for the engine default. */
  voice: string | null;
  /** Rings the bell, then dispatches the briefing to the voice; transcript only while muted. */
  ring: (options?: { auto?: boolean }) => void;
  stop: () => void;
}

let lead: ReturnType<typeof setTimeout> | null = null;
let speech: SpeechRun | null = null;

/** Rung from the top bar, the command palette, the B hotkey, and the first click of the morning. */
export const useMorningBell = create<MorningBellStore>()((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  briefing: null,
  active: null,
  outcome: null,
  voice: null,

  ring: ({ auto = false } = {}) => {
    const { data, logEvent } = useTerminal.getState();
    if (!data) return;
    get().stop();
    const now = new Date();
    const briefing = composeBriefing(data, now.getTime());
    // A bell rung by hand counts as this morning's.
    markRung(now);
    if (!soundEnabled()) {
      set({ briefing, active: null, outcome: "muted", voice: null });
      logEvent(
        "info",
        "SYS // MORNING BELL · audio muted · briefing composed as transcript only (Shift+M unmutes)",
      );
      return;
    }
    set({ briefing, active: -1, outcome: null });
    playBell();
    logEvent(
      "info",
      `SYS // MORNING BELL · ${auto ? "first open of the day" : "rung"} · ${briefing.segments.length} segments dispatched to voice`,
    );
    lead = setTimeout(() => {
      lead = null;
      // Read at speaking time: some browsers load their voices late.
      const engine = speechEngine();
      set({
        voice: engine
          ? (pickVoice(engine.synth.getVoices())?.name ?? null)
          : null,
      });
      speech = speakLines(
        briefing.segments.map((segment) => segment.text),
        {
          onLine: (index) => set({ active: index }),
          onDone: (completed) => {
            speech = null;
            set({ active: null, outcome: completed ? "spoken" : "stopped" });
          },
        },
      );
      if (!speech) set({ active: null, outcome: "voiceless" });
    }, BELL_LEAD_MS);
  },

  stop: () => {
    if (lead) {
      clearTimeout(lead);
      lead = null;
      set({ active: null, outcome: "stopped" });
    }
    speech?.cancel();
    speech = null;
  },
}));

/** Opens the transcript and rings, or only opens it while a briefing is on air. */
export function openMorningBell() {
  const bell = useMorningBell.getState();
  bell.setOpen(true);
  if (bell.active === null) bell.ring();
}

export function BellKey() {
  const active = useMorningBell((s) => s.active);
  const onAir = active !== null;
  return (
    <Key
      tone={onAir ? "accent" : "default"}
      active={onAir}
      onClick={openMorningBell}
      title={`Morning bell: a struck bell, then the book read aloud (hotkey B). Silent with SND OFF; with SND ON it also rings on the first click after ${String(BELL_OPENS).padStart(2, "0")}:00 each morning.`}
      aria-label={
        onAir
          ? "Morning bell on air: open the transcript"
          : "Ring the morning bell"
      }
    >
      {onAir ? (
        <>
          <span aria-hidden className="halt-pulse mr-1">
            ◉
          </span>
          ON AIR
        </>
      ) : (
        "BELL"
      )}
    </Key>
  );
}

export function MorningBellModal() {
  const open = useMorningBell((s) => s.open);
  const setOpen = useMorningBell((s) => s.setOpen);
  if (!open) return null;
  return <BellDialog onClose={() => setOpen(false)} />;
}

function statusLine(
  active: number | null,
  outcome: BellOutcome | null,
  total: number,
  voice: string | null,
): { text: string; tone: string } {
  if (active === -1) return { text: "● BELL RINGING", tone: "text-accent" };
  if (active !== null)
    return {
      text: `◉ ON AIR · ${active + 1}/${total}${voice ? ` · ${voice}` : ""}`,
      tone: "text-accent",
    };
  switch (outcome) {
    case "spoken":
      return { text: "✓ BRIEFING COMPLETE", tone: "text-up" };
    case "stopped":
      return { text: "■ STOPPED", tone: "text-ink-3" };
    case "voiceless":
      return {
        text: "VOICE UNAVAILABLE IN THIS BROWSER · TRANSCRIPT ONLY",
        tone: "text-down",
      };
    case "muted":
      return {
        text: "AUDIO MUTED · SHIFT+M UNMUTES · TRANSCRIPT ONLY",
        tone: "text-accent",
      };
    default:
      return { text: "READY", tone: "text-ink-3" };
  }
}

function BellDialog({ onClose }: { onClose: () => void }) {
  useRestoreFocus();
  useEscape(onClose);
  const briefing = useMorningBell((s) => s.briefing);
  const active = useMorningBell((s) => s.active);
  const outcome = useMorningBell((s) => s.outcome);
  const ring = useMorningBell((s) => s.ring);
  const stop = useMorningBell((s) => s.stop);
  const voice = useMorningBell((s) => s.voice);
  const soundOn = useTerminal((s) => s.soundOn);
  const [copied, setCopied] = useState<"script" | "blocked" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const segments = briefing?.segments ?? [];
  const status = statusLine(active, outcome, segments.length, voice);
  const onAir = active !== null;

  const copy = async () => {
    if (!briefing) return;
    try {
      await navigator.clipboard.writeText(briefingScript(briefing));
      setCopied("script");
    } catch {
      setCopied("blocked");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 px-4 pt-[8vh] pb-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="morning-bell-title"
        onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
        className="w-full max-w-[680px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <h2
          id="morning-bell-title"
          className="flex items-center justify-between border-b border-line bg-head px-2.5 py-1 text-[11px] tracking-wider text-accent uppercase"
        >
          <span>MORNING BELL // VOICE BRIEFING</span>
          <span className="text-ink-3">ESC</span>
        </h2>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-[10px] tracking-wider uppercase">
          <span role="status" className={status.tone}>
            {status.text}
          </span>
          {briefing && (
            <span className="ml-auto text-ink-3">
              Composed{" "}
              {new Date(briefing.generated_at).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              })}{" "}
              · {segments.length} segments
            </span>
          )}
        </div>

        {!briefing ? (
          <p className="px-3 py-8 text-center text-[11px] text-ink-3">
            NO BRIEFING YET · ring the bell to compose one from the book
          </p>
        ) : (
          <ol
            aria-label="Briefing transcript"
            className="max-h-[60vh] overflow-auto py-1"
          >
            {segments.map((segment, index) => {
              const live = active === index;
              const spoken = active !== null && active > index;
              return (
                <li
                  key={segment.id}
                  aria-current={live ? "true" : undefined}
                  className={`flex gap-3 px-3 py-1.5 ${
                    live
                      ? "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]"
                      : ""
                  }`}
                >
                  <span
                    className={`w-[13ch] shrink-0 pt-px text-[10px] tracking-wider uppercase ${
                      live ? "text-accent" : "text-ink-3"
                    }`}
                  >
                    {segment.label}
                  </span>
                  <span
                    className={`min-w-0 flex-1 text-[12px] leading-relaxed break-words ${
                      live
                        ? "text-ink"
                        : spoken || !onAir
                          ? "text-ink-2"
                          : "text-ink-3"
                    }`}
                  >
                    {segment.text}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          <span
            aria-live="polite"
            className={`text-[10px] tracking-wider uppercase ${
              copied === "blocked"
                ? "text-down"
                : copied
                  ? "text-up"
                  : "text-ink-3"
            }`}
            title="Auto-ring follows terminal audio (Shift+M)"
          >
            {copied === "script"
              ? "SCRIPT COPIED"
              : copied === "blocked"
                ? "CLIPBOARD BLOCKED"
                : `Auto-ring ${soundOn ? "armed" : "off"} · first click after ${String(BELL_OPENS).padStart(2, "0")}:00${soundOn ? "" : " with SND ON"}`}
          </span>
          <span className="ml-auto flex flex-wrap gap-1.5">
            {onAir ? (
              <Key tone="down" onClick={stop}>
                ■ STOP
              </Key>
            ) : (
              <Key tone="accent" onClick={() => ring()}>
                {briefing ? "RING AGAIN" : "RING"}
              </Key>
            )}
            <Key disabled={!briefing} onClick={() => void copy()}>
              COPY SCRIPT
            </Key>
            <Key onClick={onClose}>CLOSE</Key>
          </span>
        </div>
      </div>
    </div>
  );
}
