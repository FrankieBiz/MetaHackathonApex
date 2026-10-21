"use client";

// Terminal state. Every action applies locally first, then mirrors to the
// FastAPI backend when it is reachable.
//
// Two kinds of offline:
//   sandbox   the isolated simulation desk: the Canvas feed failed before any
//             backend data arrived (slow >2.5s, non-200, or unreachable), or
//             Ctrl+Shift+D pinned it. The deterministic mock dataset runs and
//             is saved in this browser.
//   detached  backend data is on screen but the backend dropped (e.g. a
//             uvicorn --reload restart); edits queue and replay on reconnect.
//             Background polls never swap datasets mid-session.

import { create } from "zustand";
import { useInference, type InferenceTelemetry } from "@/store/inference";
import {
  ApiError,
  api,
  normalizeState,
  type CanvasCredentials,
  type TriageResult,
} from "@/lib/api";
import {
  appendSnapshot,
  findNode,
  localTriage,
  logMinutes,
  rankQueue,
  reasoningTrace,
  rollup,
  setCompletion,
  triageContext,
  updateSubtasks,
  type Scenario,
} from "@/lib/engine";
import {
  playFill,
  playTick,
  soundEnabled,
  toggleSound as toggleFeedbackSound,
  triggerHaptic,
} from "@/lib/feedback";
import { minutes } from "@/lib/format";
import { createMockState } from "@/lib/mockData";
import { reanchor } from "@/lib/sandbox";
import type {
  AgentReasoningStep,
  ConnectionMode,
  DataOrigin,
  GradePoint,
  SubTaskNode,
  StudyTriagePlan,
  TerminalEvent,
  TerminalState,
} from "@/types";

const SANDBOX_KEY = "apex-terminal:sandbox:v2";
/** Session-scoped so a reload mid-demo stays on the desk, but a new tab starts live. */
const PIN_KEY = "apex-terminal:simulation-pinned";
const GRADES_KEY = "apex-terminal:grade-ledger:v1";
/** Footer headline while the local sandbox runs; the cause stays one line down in the log. */
export const SANDBOX_READY =
  "SYS // ISOLATED SANDBOX DESK ACTIVE · DETERMINISTIC ENGINE READY (CTRL+SHIFT+D TO TOGGLE LIVE API)";
/** The execution deck streams its triage log this long before a tree mounts. */
export const TRIAGE_STREAM_MS = 800;
/** Then each agent reasoning step lands this far apart before the tree is revealed. */
export const TRACE_STEP_MS = 320;

export interface AgentTrace {
  steps: AgentReasoningStep[];
  /** ai: the backend's model planned · local: a starter or offline plan · cached: a saved plan was kept. */
  source: "ai" | "local" | "cached";
  /** Measured inference for the planning step; null when no model ran. */
  telemetry: InferenceTelemetry | null;
}

type Patch = { is_completed?: boolean; actual_minutes?: number };

interface TerminalStore {
  data: TerminalState | null;
  mode: ConnectionMode;
  /** Where the on-screen data came from; decides persistence and replay. */
  origin: DataOrigin;
  /** Ctrl+Shift+D: stay on the simulation desk and stop contacting the backend. */
  simulationPinned: boolean;
  selectedId: string | null;
  activeCourseId: string | null;
  studyPlans: Record<string, StudyTriagePlan>;
  studying: Record<string, true>;
  insertingStudy: Record<string, true>;
  studyErrors: Record<string, string>;
  /** Assignment id → when its triage started (ms epoch). */
  triaging: Record<string, number>;
  /** The latest agent reasoning trace per assignment; session-only, never persisted. */
  traces: Record<string, AgentTrace>;
  syncing: boolean;
  /** Held in memory only — never persisted or written to storage. */
  credentials: CanvasCredentials | null;
  events: TerminalEvent[];
  pendingWrites: number;
  /** Edits made while detached, waiting to replay. */
  queuedEdits: number;
  paletteOpen: boolean;
  tokenOpen: boolean;
  soundOn: boolean;
  toggleSound: () => void;
  scenario: Scenario;
  setScenarioScore: (assignmentId: string, score: number | undefined) => void;
  resetScenario: (courseId?: string) => void;

  boot: () => Promise<void>;
  refresh: () => Promise<boolean>;
  sync: () => Promise<void>;
  select: (id: string | null) => void;
  selectCourse: (courseId: string) => void;
  generateStudyTriage: (courseId?: string) => Promise<void>;
  insertStudyBlocks: (courseId: string) => Promise<void>;
  triage: (assignmentId: string) => Promise<void>;
  toggle: (assignmentId: string, subtaskId: string, value: boolean) => void;
  logTime: (assignmentId: string, subtaskId: string, delta: number) => void;
  setCredentials: (credentials: CanvasCredentials | null) => void;
  resetSandbox: () => void;
  toggleSimulation: () => Promise<void>;
  setPaletteOpen: (open: boolean) => void;
  setTokenOpen: (open: boolean) => void;
}

const isRemote = (mode: ConnectionMode) =>
  mode === "live" || mode === "backend-demo";
const isNetwork = (error: unknown) =>
  error instanceof ApiError && error.kind === "network";
const message = (error: unknown) => (error as Error).message;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ids minted by the local planner; the backend has never seen them. */
const LOCAL_ID = /^local-/;

export function activeCourseOf(
  state: Pick<TerminalStore, "data" | "selectedId" | "activeCourseId">,
) {
  const selected = state.data?.assignments.find(
    (a) => a.id === state.selectedId,
  );
  return (
    state.data?.courses.find(
      (c) => c.id === (selected?.course_id ?? state.activeCourseId),
    ) ??
    state.data?.courses[0] ??
    null
  );
}

/** Course study work has no assignment and shares the normal checkbox/time-log path. */
const isStudyDeck = (id: string) => id.startsWith("study:");
const updateStudy = (
  data: TerminalState,
  update: (nodes: SubTaskNode[]) => SubTaskNode[],
) => ({
  ...data,
  study_recommendations: update(data.study_recommendations ?? []),
});

// ------------------------------------------------------------- storage

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full, blocked, or absent: the session still works in memory.
  }
}

function readPin(): boolean {
  try {
    return window.sessionStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}

function writePin(pinned: boolean) {
  try {
    if (pinned) window.sessionStorage.setItem(PIN_KEY, "1");
    else window.sessionStorage.removeItem(PIN_KEY);
  } catch {
    // Without storage the pin lasts until reload.
  }
}

function loadSandbox(now: number): TerminalState | null {
  const saved = readJson<{ anchoredAt: number; state: unknown }>(SANDBOX_KEY);
  if (!saved || typeof saved.anchoredAt !== "number") return null;
  try {
    return reanchor(normalizeState(saved.state), now - saved.anchoredAt);
  } catch {
    return null;
  }
}

/** Live Canvas data has no grade history; build one from this browser's syncs. */
function withLedger(state: TerminalState, now: number): TerminalState {
  const ledger = readJson<Record<string, GradePoint[]>>(GRADES_KEY) ?? {};
  const courses = state.courses.map((course) => {
    if (course.grade_history.length || course.current_score === null)
      return course;
    ledger[course.id] = appendSnapshot(
      ledger[course.id] ?? [],
      course.current_score,
      now,
    );
    return { ...course, grade_history: ledger[course.id] };
  });
  writeJson(GRADES_KEY, ledger);
  return { ...state, courses };
}

const topOfQueue = (state: TerminalState) =>
  rankQueue(state.assignments, Date.now())[0]?.assignment.id ?? null;

const titleOf = (state: TerminalState | null, id: string) => {
  const assignment = state?.assignments.find((a) => a.id === id);
  return assignment ? `${assignment.course_code} ${assignment.title}` : id;
};

// --------------------------------------------------------------- store

let eventId = 0;
let booted = false;
let writeChain: Promise<void> = Promise.resolve();
/** Bumped on every change to `data`; lets slow responses detect they are stale. */
let revision = 0;
let datasetVersion = 0;
/** Detached edits, merged per subtask so only the latest value replays. */
const queue = new Map<string, Patch>();

export const useTerminal = create<TerminalStore>()((set, get) => {
  const log = (level: TerminalEvent["level"], text: string) =>
    set((s) => ({
      events: [
        { id: ++eventId, at: new Date().toISOString(), level, text },
        ...s.events,
      ].slice(0, 40),
    }));

  /** Sets data; the sandbox (and only the sandbox) is saved so reloads keep edits. */
  const commit = (data: TerminalState) => {
    revision += 1;
    set({ data });
    if (get().origin === "sandbox" && !isRemote(get().mode)) {
      writeJson(SANDBOX_KEY, { anchoredAt: Date.now(), state: data });
    }
  };

  /** Keeps the selection when the new data has it (fixtures share IDs everywhere). */
  const keepSelection = (data: TerminalState) => {
    const { selectedId, activeCourseId } = get();
    if (
      !selectedId &&
      activeCourseId &&
      data.courses.some((c) => c.id === activeCourseId)
    ) {
      return (
        data.assignments.find(
          (a) => a.course_id === activeCourseId && a.status !== "completed",
        )?.id ?? null
      );
    }
    return selectedId && data.assignments.some((a) => a.id === selectedId)
      ? selectedId
      : topOfQueue(data);
  };

  const adopt = (state: TerminalState) => {
    if (
      get().origin !== "backend" ||
      get().data?.metrics.demo_mode !== state.metrics.demo_mode
    ) {
      datasetVersion += 1;
      set({ studyPlans: {}, studyErrors: {}, traces: {} });
    }
    revision += 1;
    const data = withLedger(state, Date.now());
    set({
      data,
      origin: "backend",
      mode: state.metrics.demo_mode ? "backend-demo" : "live",
      selectedId: keepSelection(data),
    });
  };

  /**
   * Puts the isolated simulation desk on screen: the saved simulation session
   * if there is one, else the deterministic mock dataset. Returns true when a
   * saved session was restored.
   */
  const simulate = (dataset: TerminalState) => {
    datasetVersion += 1;
    const restored = loadSandbox(Date.now());
    const local = restored ?? dataset;
    set({
      origin: "sandbox",
      mode: "offline",
      selectedId: keepSelection(local),
      studyPlans: {},
      studyErrors: {},
      traces: {},
    });
    commit(local);
    return restored !== null;
  };

  const enqueue = (subtaskId: string, patch: Patch) => {
    if (LOCAL_ID.test(subtaskId)) return;
    queue.set(subtaskId, { ...queue.get(subtaskId), ...patch });
    set({ queuedEdits: queue.size });
  };

  const goOffline = (reason: string) => {
    if (get().mode !== "offline") {
      log(
        "warn",
        get().origin === "backend"
          ? `${reason}. Working offline: edits queue and replay when the backend is back.`
          : `${reason}. Running on the local sandbox.`,
      );
    }
    set({ mode: "offline" });
  };

  /**
   * Back online after a detached stretch: replay queued edits in order,
   * then adopt the backend's answer. Returns false if the backend dropped
   * again (the rest of the queue is kept).
   */
  const replay = async (): Promise<unknown> => {
    let answer: unknown = undefined;
    let replayed = 0;
    for (const [subtaskId, patch] of [...queue]) {
      try {
        answer = await api.patchSubtask(subtaskId, patch);
        replayed += 1;
      } catch (error) {
        if (isNetwork(error)) throw error;
        log("error", `Queued edit not saved to backend: ${message(error)}`);
      }
      queue.delete(subtaskId);
      set({ queuedEdits: queue.size });
    }
    if (replayed) log("ok", `Replayed ${replayed} edits made while offline.`);
    return answer;
  };

  /** Brings a non-remote session onto backend data. */
  const reconnect = async (fresh: TerminalState) => {
    const wasDetached = get().origin === "backend";
    const answer = queue.size ? await replay() : undefined;
    let state = fresh;
    if (answer !== undefined) {
      try {
        state = normalizeState(answer);
      } catch {
        const feed = await api.state();
        if (feed.simulated) throw feed.cause;
        state = feed.state;
      }
    }
    adopt(state);
    log(
      "ok",
      wasDetached
        ? "Backend link restored."
        : "Backend link established. Showing backend data; your sandbox stays saved for offline use.",
    );
  };

  /**
   * Mirrors one write to the backend, in order, without blocking the UI.
   * PATCH answers with the full state; once the queue drains, the last answer
   * replaces the optimistic copy so backend-side propagation shows up.
   */
  let lastAnswer: unknown;
  const push = (label: string, subtaskId: string, patch: Patch) => {
    if (LOCAL_ID.test(subtaskId)) return;
    if (!isRemote(get().mode)) {
      if (get().origin === "backend") enqueue(subtaskId, patch);
      return;
    }
    set((s) => ({ pendingWrites: s.pendingWrites + 1 }));
    writeChain = writeChain
      .then(async () => {
        if (!isRemote(get().mode)) {
          enqueue(subtaskId, patch);
          return;
        }
        try {
          lastAnswer = await api.patchSubtask(subtaskId, patch);
        } catch (error) {
          if (isNetwork(error)) {
            enqueue(subtaskId, patch);
            goOffline(`Backend dropped during ${label}`);
          } else {
            log("error", `${label} not saved to backend: ${message(error)}`);
          }
        }
      })
      .finally(() => {
        set((s) => ({ pendingWrites: s.pendingWrites - 1 }));
        if (get().pendingWrites > 0 || lastAnswer === undefined) return;
        const answer = lastAnswer;
        lastAnswer = undefined;
        if (!isRemote(get().mode)) return;
        try {
          adopt(normalizeState(answer));
        } catch {
          // Not a state payload; the next poll reconciles.
        }
      });
  };

  /** True when nothing changed locally since `since` and no write is in flight. */
  const isFresh = (since: number) =>
    revision === since && get().pendingWrites === 0;

  return {
    data: null,
    mode: "connecting",
    origin: "sandbox",
    simulationPinned: false,
    selectedId: null,
    activeCourseId: null,
    studyPlans: {},
    studying: {},
    insertingStudy: {},
    studyErrors: {},
    triaging: {},
    traces: {},
    syncing: false,
    credentials: null,
    events: [],
    pendingWrites: 0,
    queuedEdits: 0,
    paletteOpen: false,
    tokenOpen: false,
    soundOn: soundEnabled(),
    scenario: {},

    toggleSound: () => {
      const next = toggleFeedbackSound();
      set({ soundOn: next });
    },

    setScenarioScore: (assignmentId, score) =>
      set((s) => {
        if (score === undefined) {
          const rest = { ...s.scenario };
          delete rest[assignmentId];
          return { scenario: rest };
        }
        return { scenario: { ...s.scenario, [assignmentId]: score } };
      }),

    resetScenario: (courseId) =>
      set((s) => {
        if (!courseId || !s.data) return { scenario: {} };
        const ids = new Set(
          s.data.assignments
            .filter((a) => a.course_id === courseId)
            .map((a) => a.id),
        );
        const kept = Object.fromEntries(
          Object.entries(s.scenario).filter(([id]) => !ids.has(id)),
        );
        return { scenario: kept };
      }),

    boot: async () => {
      // Hold the boot screen until the feed answers (a refused connection
      // fails instantly, a slow one after 2.5s) so a linked session never
      // flashes simulation data first.
      if (booted) return;
      booted = true;
      if (readPin()) {
        set({ simulationPinned: true });
        const restored = simulate(createMockState(Date.now()));
        log(
          "info",
          `Simulation desk pinned for this session${restored ? "; restored your saved simulation" : ""}. Ctrl+Shift+D returns to live Canvas.`,
        );
        return;
      }
      const feed = await api.state();
      // Ctrl+Shift+D during boot already put the desk on screen.
      if (get().simulationPinned) return;
      if (!feed.simulated) {
        adopt(feed.state);
        log("ok", "Backend link established.");
        return;
      }
      const restored = simulate(feed.state);
      log(
        "info",
        `${feed.cause.message}. Isolated simulation desk engaged${restored ? " with your saved session" : ""}.`,
      );
      log("ok", SANDBOX_READY);
    },

    refresh: async () => {
      if (get().simulationPinned) return false;
      const wasRemote = isRemote(get().mode);
      const since = revision;
      const feed = await api.state();
      if (get().simulationPinned) return false;
      if (feed.simulated) {
        // A background poll keeps whatever is on screen: last good backend
        // data stays up (detached if the link dropped) rather than flapping
        // to the simulation dataset and back.
        if (wasRemote) {
          if (isNetwork(feed.cause)) goOffline(feed.cause.message);
          else log("warn", `Refresh skipped: ${feed.cause.message}`);
        }
        return false;
      }
      try {
        if (!wasRemote) {
          await reconnect(feed.state);
        } else if (isFresh(since)) {
          adopt(feed.state);
        }
        return true;
      } catch {
        // The backend dropped again while replaying; the next probe retries.
        return false;
      }
    },

    sync: async () => {
      if (get().syncing) {
        log("info", "A sync is already running.");
        return;
      }
      if (get().simulationPinned) {
        log(
          "info",
          "Simulation desk is pinned, so there is nothing to sync. Ctrl+Shift+D returns to live Canvas.",
        );
        return;
      }
      set({ syncing: true });
      const { credentials } = get();
      const wasRemote = isRemote(get().mode);
      const since = revision;
      log("info", credentials ? "Syncing Canvas with your token…" : "Syncing…");
      try {
        const feed = await api.sync(credentials ?? undefined);
        if (get().simulationPinned) return;
        if (feed.simulated) {
          const { cause } = feed;
          if (isNetwork(cause)) {
            goOffline(cause.message);
            log(
              get().origin === "sandbox" ? "info" : "warn",
              `${cause.message}. Start the FastAPI backend on :8000, then sync again.`,
            );
          } else if (wasRemote) {
            log(
              "warn",
              `Sync failed: ${cause.message}. Holding the last good data.`,
            );
          } else {
            log(
              "info",
              `Sync failed: ${cause.message}. Staying on the simulation desk.`,
            );
          }
          if (get().origin === "sandbox") log("ok", SANDBOX_READY);
          return;
        }
        if (!wasRemote) {
          await reconnect(feed.state);
        } else if (isFresh(since)) {
          adopt(feed.state);
        } else if (get().pendingWrites === 0) {
          // An edit landed mid-sync; re-read so it isn't overwritten.
          const again = await api.state();
          if (!again.simulated) adopt(again.state);
        }
        const { data, mode } = get();
        log(
          "ok",
          `Sync complete: ${data?.courses.length ?? 0} courses, ${data?.assignments.length ?? 0} assignments${mode === "backend-demo" ? " (backend simulation desk)" : ""}.`,
        );
        if (credentials && mode === "backend-demo") {
          log(
            "warn",
            "The backend is still in demo mode, so it ignored the token. Set CANVAS_API_TOKEN and CANVAS_API_URL in the backend's environment and restart it.",
          );
        }
      } catch (error) {
        // Only reconnect's replay can throw here.
        if (isNetwork(error)) {
          goOffline(message(error));
        } else {
          log("error", `Sync failed: ${message(error)}`);
        }
      } finally {
        set({ syncing: false });
      }
    },

    select: (id) =>
      set({
        selectedId: id,
        activeCourseId:
          get().data?.assignments.find((a) => a.id === id)?.course_id ??
          get().activeCourseId,
      }),

    selectCourse: (courseId) => {
      if (!get().data?.courses.some((c) => c.id === courseId)) return;
      set({
        activeCourseId: courseId,
        selectedId:
          get().data?.assignments.find(
            (a) => a.course_id === courseId && a.status !== "completed",
          )?.id ?? null,
      });
    },

    generateStudyTriage: async (courseId) => {
      const course = courseId
        ? get().data?.courses.find((c) => c.id === courseId)
        : activeCourseOf(get());
      if (
        !course ||
        get().studying[course.id] ||
        useInference.getState().status === "running"
      )
        return;
      const fail = (text: string) => {
        set((s) => ({ studyErrors: { ...s.studyErrors, [course.id]: text } }));
        log("error", text);
      };
      if (!isRemote(get().mode)) {
        fail(
          "Connect to the backend to scan course materials and generate a study sprint.",
        );
        return;
      }
      const version = datasetVersion;
      set((s) => ({
        studying: { ...s.studying, [course.id]: true },
        studyErrors: { ...s.studyErrors, [course.id]: "" },
      }));
      useInference.getState().start();
      try {
        const assignments = get().data!.assignments.filter(
          (a) => a.course_id === course.id,
        );
        // Upcoming work first, then recent graded work, bounded by the API contract.
        assignments.sort(
          (a, b) =>
            Number(a.status === "completed") -
              Number(b.status === "completed") ||
            (a.status === "completed" ? -1 : 1) *
              ((Date.parse(a.due_at ?? "") || 0) -
                (Date.parse(b.due_at ?? "") || 0)),
        );
        const plan = await api.studyTriage({
          course_id: course.id,
          course_name: course.name,
          syllabus_text: (course.syllabus ?? "").slice(0, 100_000),
          recent_assignments: assignments.slice(0, 50).map((a) => ({
            title: a.title,
            description: (a.description ?? "").slice(0, 20_000),
            score: a.score ?? null,
            points_possible: a.points_possible,
            weight: a.weight,
            due_at: a.due_at,
            status: a.status,
          })),
        });
        if (version !== datasetVersion) {
          useInference.getState().finish(null, "unavailable");
          return;
        }
        set((s) => ({ studyPlans: { ...s.studyPlans, [course.id]: plan } }));
        useInference.getState().finish(plan.inference_telemetry, plan.source);
        log(
          "ok",
          `Study sprint ready for ${course.course_code}: ${plan.recommended_blocks.length} × 25m blocks.`,
        );
      } catch (error) {
        useInference.getState().finish(null, "unavailable");
        if (version === datasetVersion)
          fail(`Study triage failed: ${message(error)}`);
      } finally {
        set((s) => {
          const next = { ...s.studying };
          delete next[course.id];
          return { studying: next };
        });
      }
    },

    insertStudyBlocks: async (courseId) => {
      const plan = get().studyPlans[courseId];
      if (!plan || get().insertingStudy[courseId]) return;
      if (!isRemote(get().mode)) {
        set((s) => ({
          studyErrors: {
            ...s.studyErrors,
            [courseId]: "Reconnect to save these study blocks.",
          },
        }));
        return;
      }
      const version = datasetVersion;
      set((s) => ({
        insertingStudy: { ...s.insertingStudy, [courseId]: true },
        studyErrors: { ...s.studyErrors, [courseId]: "" },
        pendingWrites: s.pendingWrites + 1,
      }));
      writeChain = writeChain
        .then(async () => {
          if (version !== datasetVersion) return;
          const state = await api.insertStudy(
            courseId,
            plan.recommended_blocks,
          );
          if (version !== datasetVersion) return;
          adopt(state);
          log(
            "ok",
            `Study blocks saved to ${state.courses.find((c) => c.id === courseId)?.course_code ?? courseId}.`,
          );
        })
        .catch((error) => {
          if (version !== datasetVersion) return;
          const text = `Could not insert study blocks: ${message(error)}`;
          set((s) => ({ studyErrors: { ...s.studyErrors, [courseId]: text } }));
          log("error", text);
        })
        .finally(() => {
          set((s) => {
            const next = { ...s.insertingStudy };
            delete next[courseId];
            return { insertingStudy: next, pendingWrites: s.pendingWrites - 1 };
          });
        });
      await writeChain;
    },

    triage: async (assignmentId) => {
      const { triaging, data } = get();
      const assignment = data?.assignments.find((a) => a.id === assignmentId);
      if (
        triaging[assignmentId] ||
        !assignment ||
        useInference.getState().status === "running"
      )
        return;
      useInference.getState().start();
      const started = Date.now();
      const version = datasetVersion;
      set((s) => {
        const traces = { ...s.traces };
        delete traces[assignmentId];
        return {
          selectedId: assignmentId,
          triaging: { ...s.triaging, [assignmentId]: started },
          traces,
        };
      });
      const done = () =>
        set((s) => {
          const next = { ...s.triaging };
          delete next[assignmentId];
          return { triaging: next };
        });

      let result: TriageResult | null = null;
      if (isRemote(get().mode)) {
        try {
          result = await api.triage(assignmentId);
        } catch (error) {
          useInference.getState().finish(null, "unavailable");
          if (!isNetwork(error)) {
            // The backend is up; a local plan here could never be saved.
            log(
              "error",
              `Llama-3 triage failed: ${message(error)}. Nothing changed.`,
            );
            done();
            return;
          }
          goOffline(message(error));
        }
      }

      const local = !result;
      const planStarted = Date.now();
      const subtasks = result?.subtasks ?? localTriage(assignment);
      // Planner time only: not a failed round trip before it, nor the display delay after.
      const planned = Date.now() - planStarted;
      if (local) useInference.getState().finish(null, "local");
      /**
       * True when this plan no longer fits the screen: the dataset was swapped
       * (Ctrl+Shift+D, reset, reconnect) or the backend came back during a
       * local run. Checked after every wait, right before anything is written.
       */
      const stale = () => {
        if (version !== datasetVersion) {
          log(
            "info",
            `Triage of ${titleOf(data, assignmentId)} discarded: the dataset changed while it ran.`,
          );
        } else if (local && isRemote(get().mode)) {
          log(
            "info",
            "Backend came online during triage. Run triage again to use Llama-3.",
          );
        } else {
          return false;
        }
        done();
        return true;
      };
      // Let the decomposition log play out; an instant swap reads as a glitch.
      await wait(Math.max(0, TRIAGE_STREAM_MS - (Date.now() - started)));
      if (stale()) return;

      // Stream the agent's four steps into the deck, then reveal the tree.
      const steps =
        result?.trace ??
        reasoningTrace(
          assignment,
          triageContext(get().data ?? data!, assignment, Date.now()),
          subtasks,
          result
            ? {
                engine: result.telemetry.model_used,
                latency_ms: result.telemetry.latency_ms,
              }
            : { engine: "local-planner", latency_ms: planned },
        );
      set((s) => ({
        traces: {
          ...s.traces,
          [assignmentId]: {
            steps,
            source: result?.source ?? "local",
            telemetry: result?.source === "ai" ? result.telemetry : null,
          },
        },
      }));
      await wait(TRACE_STEP_MS * steps.length);
      if (stale()) return;

      const current = get().data;
      if (current?.assignments.some((a) => a.id === assignmentId)) {
        commit(updateSubtasks(current, assignmentId, () => subtasks));
      }
      done();
      const totals = rollup(subtasks);
      // This run's own answer: another triage may have started during the stream.
      const source = result?.source ?? "local";
      // The backend never replaces a tree that already has checked tasks or logged time.
      if (source === "cached") {
        log(
          "info",
          `Kept the saved plan for ${titleOf(get().data, assignmentId)}: work is already logged on it, so it was not replaced.`,
        );
        return;
      }
      const planner = source === "local" ? "starter plan" : "Llama-3";
      const risks = steps.filter((step) => step.status === "risk").length;
      log(
        risks ? "warn" : "ok",
        `Triage complete (${planner}): ${titleOf(get().data, assignmentId)} → ${totals.total} tasks, ${minutes(totals.estimated)} budget${risks ? `; agent flagged ${risks} risk ${risks === 1 ? "step" : "steps"}` : ""}.`,
      );
      if (local && get().origin === "backend") {
        log(
          "warn",
          "This local plan isn't saved to the backend and is replaced when it reconnects. Run triage again then.",
        );
      }
    },

    toggle: (assignmentId, subtaskId, value) => {
      const { data } = get();
      if (!data) return;
      const before = data.assignments.find(
        (a) => a.id === assignmentId,
      )?.status;
      const change = (nodes: SubTaskNode[]) =>
        setCompletion(nodes, subtaskId, value);
      const next = isStudyDeck(assignmentId)
        ? updateStudy(data, change)
        : updateSubtasks(data, assignmentId, change);
      commit(next);
      const after = next.assignments.find((a) => a.id === assignmentId)?.status;
      if (before !== "completed" && after === "completed") {
        playFill();
        triggerHaptic(18);
        log("ok", `Filled: ${titleOf(next, assignmentId)} marked completed.`);
      } else {
        playTick();
        triggerHaptic(10);
      }
      push("checkbox update", subtaskId, { is_completed: value });
    },

    logTime: (assignmentId, subtaskId, delta) => {
      const { data } = get();
      if (!data) return;
      const change = (nodes: SubTaskNode[]) =>
        logMinutes(nodes, subtaskId, delta);
      const next = isStudyDeck(assignmentId)
        ? updateStudy(data, change)
        : updateSubtasks(data, assignmentId, change);
      commit(next);
      const assignment = next.assignments.find((a) => a.id === assignmentId);
      const actual = isStudyDeck(assignmentId)
        ? findNode(next.study_recommendations ?? [], subtaskId)?.actual_minutes
        : assignment
          ? findNode(assignment.subtasks, subtaskId)?.actual_minutes
          : undefined;
      if (actual === undefined) return;
      push("time log", subtaskId, { actual_minutes: actual });
    },

    setCredentials: (credentials) => set({ credentials }),

    resetSandbox: () => {
      if (isRemote(get().mode)) return;
      datasetVersion += 1;
      set({ studyPlans: {}, studyErrors: {}, traces: {} });
      queue.clear();
      set({ origin: "sandbox", queuedEdits: 0 });
      const fresh = createMockState(Date.now());
      commit(fresh);
      set({ selectedId: topOfQueue(fresh) });
      log("info", "Simulation desk reset to the deterministic dataset.");
    },

    toggleSimulation: async () => {
      if (!get().simulationPinned) {
        writePin(true);
        set({ simulationPinned: true });
        const restored = simulate(createMockState(Date.now()));
        log(
          "info",
          `Simulation desk pinned (Ctrl+Shift+D); backend polling paused${restored ? ", saved simulation restored" : ""}.`,
        );
        return;
      }
      writePin(false);
      set({ simulationPinned: false });
      log("info", "Live Canvas mode requested.");
      await get().sync();
    },

    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setTokenOpen: (tokenOpen) => set({ tokenOpen }),
  };
});

export { isRemote };
