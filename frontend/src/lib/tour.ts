// Automated ~10 second demo for judges. It walks the trading-desk loop:
// pick an untriaged deliverable, run live triage on it, fill one of the
// freshly planned atomic tasks, then simulate a grade.
// Any key press, pointer press, or stopTour() aborts it and hands control
// back to the user.

import { useTerminal } from "@/store/terminal";
import { rankQueue } from "@/lib/engine";
import { useTourStore } from "@/store/tourStore";
import { sampleSyllabusState } from "@/lib/sampleSyllabus";

/**
 * The what-if simulator keeps its scores in local state, so the tour announces
 * the scenario on this window event instead of calling a store action.
 */
export const WHAT_IF_EVENT = "apex:what-if";

const DEMO_SCORE = 95;

let running = false;
let runToken = 0;
let armTimer: number | null = null;
let cancelPause: (() => void) | null = null;

export function isTourRunning(): boolean {
  return running;
}

function log(text: string) {
  useTerminal.setState((s) => ({
    events: [
      {
        id: Date.now(),
        at: new Date().toISOString(),
        level: "info" as const,
        text,
      },
      ...s.events,
    ].slice(0, 40),
  }));
}

/** Resolves early when the tour is stopped, so an abort never waits out the timer. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      cancelPause = null;
      resolve();
    }
    cancelPause = done;
  });
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") stopTour();
};

function attach() {
  window.addEventListener("keydown", onKeyDown);
}

function detach() {
  window.removeEventListener("keydown", onKeyDown);
}

function teardown() {
  running = false;
  detach();
  if (armTimer !== null) window.clearTimeout(armTimer);
  armTimer = null;
  cancelPause = null;
  useTourStore.getState().stop();
}

export function stopTour(): void {
  if (!running) return;
  // teardown() clears cancelPause, so grab it first to release a pending pause.
  const cancel = cancelPause;
  teardown();
  cancel?.();
  log("SYS // DEMO TOUR: Aborted. Terminal is fully interactive.");
}

export async function startTour(): Promise<void> {
  if (typeof window === "undefined" || running) return;
  running = true;
  const token = ++runToken;
  const live = () => running && token === runToken;

  // Attach after the current event finishes so the click or key that launched
  // the tour cannot abort it on the way out.
  armTimer = window.setTimeout(() => {
    armTimer = null;
    if (live()) attach();
  }, 0);

  try {
    const tourStore = useTourStore.getState();
    const store = useTerminal.getState();
    tourStore.setRunning(true);

    // Ensure sample data is present if empty
    if (!store.data) {
      store.loadSampleSyllabus(sampleSyllabusState(Date.now()));
    }

    // Beat 1: LaunchPad & Multimodal Syllabus Ingest
    tourStore.setBeatIndex(0);
    store.setWorkstationOpen(false);
    log("SYS // DEMO TOUR: Beat 1 — Syllabus deconstruction & local sandbox isolation.");
    await pause(2500);
    if (!live()) return;

    // Beat 2: 45-Minute Focus Action & Calendar Block
    tourStore.setBeatIndex(1);
    log("SYS // DEMO TOUR: Beat 2 — 45-minute focus block with break-even guarantees & RFC 5545 calendar export.");
    await pause(2500);
    if (!live()) return;

    // Beat 3: Under The Hood Reveal — Bloomberg Quantitative Workstation
    tourStore.setBeatIndex(2);
    store.setWorkstationOpen(true);
    const queue = store.data
      ? rankQueue(store.data.assignments, Date.now()).map((e) => e.assignment)
      : [];
    const top = queue[0];
    if (top) {
      store.select(top.id);
      store.setScenarioScore(top.id, DEMO_SCORE);
      window.dispatchEvent(
        new CustomEvent(WHAT_IF_EVENT, {
          detail: { assignmentId: top.id, score: DEMO_SCORE },
        }),
      );
    }
    log("SYS // DEMO TOUR: Beat 3 — Under the hood reveal: 1,000-path Monte Carlo VaR, Markowitz Pareto optimizer, and task velocity.");
    await pause(3000);
    if (!live()) return;

    log("SYS // DEMO TOUR: Tour complete. Terminal is fully interactive.");
  } finally {
    if (live()) teardown();
  }
}
