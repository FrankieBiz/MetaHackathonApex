"use client";

import { useEffect } from "react";
import { Key } from "@/components/ui";
import { TOUR_BEATS, useTourStore } from "@/store/tourStore";
import { stopTour } from "@/lib/tour";

export function JudgeTourHUD() {
  const running = useTourStore((s) => s.running);
  const beatIndex = useTourStore((s) => s.beatIndex);
  const nextBeat = useTourStore((s) => s.nextBeat);
  const prevBeat = useTourStore((s) => s.prevBeat);
  const stop = useTourStore((s) => s.stop);

  const beat = TOUR_BEATS[beatIndex] ?? TOUR_BEATS[0];

  useEffect(() => {
    if (!running) return;

    // Pulse highlight target panel
    const selector =
      beat.panel === "order-book"
        ? '[data-tour="order-book"]'
        : beat.panel === "task-tree"
          ? '[data-tour="task-tree"]'
          : beat.panel === "equity-curve"
            ? '[data-tour="equity-curve"]'
            : beat.panel === "nba"
              ? '[data-tour="nba"]'
              : null;

    if (selector) {
      const el = document.querySelector(selector);
      el?.classList.add("ring-2", "ring-accent", "ring-offset-1", "ring-offset-canvas");
      return () => {
        el?.classList.remove("ring-2", "ring-accent", "ring-offset-1", "ring-offset-canvas");
      };
    }
  }, [running, beat.panel]);

  if (!running) return null;

  return (
    <aside
      aria-label="Judge Demo Tour HUD"
      className="fixed bottom-6 left-1/2 z-50 flex w-[94%] max-w-[780px] -translate-x-1/2 flex-col gap-2 border-2 border-accent bg-head/95 p-3.5 shadow-2xl shadow-black backdrop-blur-md transition-all duration-200"
    >
      {/* Progress Line */}
      <div className="flex h-1 w-full gap-1 overflow-hidden bg-line">
        {TOUR_BEATS.map((b, idx) => (
          <div
            key={b.id}
            className={`h-full flex-1 transition-all duration-300 ${
              idx <= beatIndex ? "bg-accent" : "bg-line-strong"
            }`}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex items-center gap-2">
          <span className="bg-accent px-1.5 py-0.5 text-[10px] font-bold text-canvas uppercase">
            {beat.badge}
          </span>
          <span className="text-[12px] font-semibold tracking-wider text-ink uppercase">
            {beat.title}
          </span>
        </div>
        <span className="text-[10px] text-ink-3 tabular-nums">
          BEAT {beatIndex + 1} OF {TOUR_BEATS.length}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-[12px]">
        <p className="font-medium text-ink">{beat.summary}</p>
        <p className="text-[11px] leading-relaxed text-ink-2">{beat.narrative}</p>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1.5">
          <Key
            onClick={prevBeat}
            disabled={beatIndex === 0}
            title="Previous demo beat"
          >
            ◀ PREV
          </Key>
          <Key
            onClick={nextBeat}
            tone="accent"
            title="Next demo beat"
          >
            {beatIndex === TOUR_BEATS.length - 1 ? "FINISH TOUR" : "NEXT BEAT ▶"}
          </Key>
        </div>

        <Key
          tone="down"
          onClick={() => {
            stop();
            stopTour();
          }}
          title="Exit demo tour and return to fully interactive terminal"
        >
          ⏹ EXIT TOUR (ESC)
        </Key>
      </div>
    </aside>
  );
}
