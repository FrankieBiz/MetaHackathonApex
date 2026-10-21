// Automated ~10 second demo for judges. It walks the trading-desk loop:
// pick an untriaged deliverable, run live triage on it, fill one of the
// freshly planned atomic tasks, then simulate a grade.
// Any key press, pointer press, or stopTour() aborts it and hands control
// back to the user.

import { useTerminal } from "@/store/terminal";
import { isUntriaged, leaves, rankQueue } from "@/lib/engine";
import { playFill } from "@/lib/feedback";

/**
 * The what-if simulator keeps its scores in local state, so the tour announces
 * the scenario on this window event instead of calling a store action.
 */
export const WHAT_IF_EVENT = "apex:what-if";

const DEMO_SCORE = 95;
/** Longest the tour waits on a triage before moving on; a live model call can run long. */
const TRIAGE_WAIT_MS = 9000;

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

const onAbort = () => stopTour();

function attach() {
  window.addEventListener("keydown", onAbort);
  window.addEventListener("pointerdown", onAbort);
}

function detach() {
  window.removeEventListener("keydown", onAbort);
  window.removeEventListener("pointerdown", onAbort);
}

function teardown() {
  running = false;
  detach();
  if (armTimer !== null) window.clearTimeout(armTimer);
  armTimer = null;
  cancelPause = null;
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
    const store = useTerminal.getState();
    const queue = store.data
      ? rankQueue(store.data.assignments, Date.now()).map((e) => e.assignment)
      : [];
    // Triage on a plan with logged work keeps the saved plan (CACHED-PLAN), so
    // the tour prefers the highest-priority deliverable that has no plan yet.
    const untriaged = queue.find(isUntriaged);
    const top = untriaged ?? queue[0];
    if (!top) {
      log("SYS // DEMO TOUR: No active deliverable to demonstrate.");
      return;
    }

    // Step 1: select the deliverable to triage.
    store.select(top.id);
    log(
      untriaged
        ? `SYS // DEMO TOUR: Selecting untriaged deliverable ${top.course_code} "${top.title}"...`
        : "SYS // DEMO TOUR: Every deliverable is planned; selecting the top of the order book...",
    );
    await pause(1200);
    if (!live()) return;

    // Step 2: run triage; its 4-stage Meta Llama trace streams into the
    // inspector and the new work breakdown lands in the execution deck.
    log("SYS // DEMO TOUR: Running Meta Llama 4-stage agentic triage...");
    const triaged = useTerminal.getState().triage(top.id);
    await Promise.race([triaged, pause(TRIAGE_WAIT_MS)]);
    // Clears the wait timer when triage finished first.
    cancelPause?.();
    if (!live()) return;
    await pause(600);
    if (!live()) return;

    // Step 3: check off the first open atomic task.
    const assignment = useTerminal
      .getState()
      .data?.assignments.find((a) => a.id === top.id);
    const leaf = assignment
      ? leaves(assignment.subtasks).find((node) => !node.is_completed)
      : undefined;
    if (leaf) {
      useTerminal.getState().toggle(top.id, leaf.id, true);
      playFill();
      log(
        "SYS // DEMO TOUR: Executed atomic task fill -> live velocity & margin recomputation!",
      );
    } else {
      log(
        "SYS // DEMO TOUR: No open atomic task on this deliverable; skipping fill.",
      );
    }
    await pause(1500);
    if (!live()) return;

    // Step 4: project a 95% score through the grade curve.
    useTerminal.getState().setScenarioScore(top.id, DEMO_SCORE);
    window.dispatchEvent(
      new CustomEvent(WHAT_IF_EVENT, {
        detail: { assignmentId: top.id, score: DEMO_SCORE },
      }),
    );
    log(
      `SYS // DEMO TOUR: Simulating ${DEMO_SCORE}% score -> projected grade curve updated.`,
    );
    await pause(1500);
    if (!live()) return;

    log("SYS // DEMO TOUR: Tour complete. Terminal is fully interactive.");
  } finally {
    if (live()) teardown();
  }
}
