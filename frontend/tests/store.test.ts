import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findNode, leaves, velocityByCourse } from "@/lib/engine";
import { createMockState } from "@/lib/mockData";
import { SAMPLE_COURSE_ID, sampleSyllabusState } from "@/lib/sampleSyllabus";
import type { AgentReasoningStep, SubTaskNode, TerminalState } from "@/types";

/** The backend agent's four steps, as /api/decompose returns them. */
const BACKEND_TRACE: AgentReasoningStep[] = [
  "INGEST & AUDIT",
  "CAPACITY CHECK",
  "CRITICAL PATH",
  "VERIFICATION",
].map((title, index) => ({
  step: index + 1,
  title,
  status: index === 0 ? "risk" : "pass",
  summary: `${title} summary`,
  evidence: [`${title} evidence`],
  engine: index === 2 ? "Llama-3.3-70B-Instruct" : "capacity-engine",
  latency_ms: index === 2 ? 500 : 0,
}));

/** In-memory stand-in for the FastAPI backend, shaped like its real responses. */
function fakeBackend() {
  const state: TerminalState = createMockState(Date.now());
  const backend = {
    state,
    down: false,
    /** Status for GET /api/state and POST /api/sync; anything but 200 is a feed failure. */
    feedStatus: 200,
    /** Feed requests never answer; only their abort signal ends them. */
    hang: false,
    triageStatus: 200,
    /** False: answer /api/decompose like a backend that predates the agent trace. */
    trace: true,
    /** When set, GET /api/state snapshots immediately but answers only after this resolves. */
    gate: null as Promise<void> | null,
    /** When set, PATCH answers only after this resolves. */
    patchGate: null as Promise<void> | null,
    calls: [] as string[],
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const { pathname } = new URL(url);
    backend.calls.push(`${method} ${pathname}`);
    if (backend.down) throw new TypeError("fetch failed");
    const feed = pathname === "/api/state" || pathname === "/api/sync";
    if (feed && backend.hang) {
      await new Promise((_, reject) => {
        const signal = init.signal!;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    }
    if (feed && backend.feedStatus !== 200) {
      return reply({ detail: "Canvas unavailable" }, backend.feedStatus);
    }

    if (method === "GET" && pathname === "/api/state") {
      const snapshot = JSON.stringify(backend.state);
      if (backend.gate) await backend.gate;
      return reply(JSON.parse(snapshot));
    }
    if (method === "POST" && pathname === "/api/sync")
      return reply(backend.state);
    if (method === "PATCH" && pathname.startsWith("/api/v1/subtasks/")) {
      if (backend.patchGate) await backend.patchGate;
      const id = decodeURIComponent(pathname.split("/").pop()!);
      const patch = JSON.parse(String(init.body));
      const node = backend.state.assignments
        .flatMap((a) => leaves(a.subtasks))
        .find((n) => n.id === id);
      if (!node) return reply({ detail: "Subtask not found" }, 404);
      Object.assign(node, patch);
      return reply(backend.state);
    }
    if (method === "POST" && pathname === "/api/decompose") {
      if (backend.triageStatus !== 200) {
        return reply({ detail: "Llama-3 unavailable" }, backend.triageStatus);
      }
      const assignmentId = JSON.parse(String(init.body)).assignment_id;
      const existing = backend.state.assignments.find(
        (a) => a.id === assignmentId,
      )!.subtasks;
      // Like the backend: a tree with recorded work comes back unchanged, never replaced.
      if (
        leaves(existing).some((n) => n.is_completed || n.actual_minutes > 0)
      ) {
        return reply({
          subtasks: existing,
          source: "cached",
          telemetry: {
            model_used: "cached-plan",
            latency_ms: 0,
            prompt_tokens: null,
            completion_tokens: null,
            tokens_per_sec: null,
          },
        });
      }
      const tree: SubTaskNode[] = [
        {
          id: `${assignmentId}-remote-1`,
          assignment_id: assignmentId,
          parent_id: null,
          title: "Remote task",
          estimated_minutes: 30,
          actual_minutes: 0,
          is_completed: false,
          is_study_recommendation: false,
          children: [],
        },
      ];
      return reply({
        subtasks: tree,
        source: "ai",
        telemetry: {
          model_used: "Llama-3.3-70B-Instruct",
          latency_ms: 500,
          prompt_tokens: 240,
          completion_tokens: 100,
          tokens_per_sec: 200,
        },
        ...(backend.trace ? { agent_reasoning_trace: BACKEND_TRACE } : {}),
      });
    }
    if (method === "POST" && pathname === "/api/v1/syllabus/ingest") {
      // Like the backend: the extracted course joins the book and the full state comes back.
      backend.state.courses.push({
        id: "syllabus:bio-2200",
        course_code: "BIO 2200",
        name: "Cell Biology",
        current_score: null,
        target_score: 90,
        portfolio_margin: null,
        grade_history: [],
      });
      backend.state.assignments.push({
        id: "syllabus:bio-2200:midterm",
        course_id: "syllabus:bio-2200",
        course_code: "BIO 2200",
        title: "Midterm Exam",
        due_at: new Date(Date.now() + 9 * 86_400_000).toISOString(),
        points_possible: 100,
        weight: 30,
        description: null,
        status: "pending",
        graded: false,
        priority_score: 0,
        subtasks: [],
      });
      return reply(backend.state);
    }
    return reply({ detail: "Not Found" }, 404);
  };
  return { backend, fetch };
}

async function loadStore() {
  vi.resetModules();
  return (await import("@/store/terminal")).useTerminal;
}

/** Runs a triage through its streaming windows on fake timers. */
async function triageNow(
  store: Awaited<ReturnType<typeof loadStore>>,
  assignmentId: string,
) {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const run = store.getState().triage(assignmentId);
  await vi.advanceTimersByTimeAsync(5000);
  await run;
  vi.useRealTimers();
}

const RAFT = "cs3801-raft";
/** Ships without a task tree. */
const UNTRIAGED = "math4102-queue";
const openLeaves = (state: TerminalState | null, assignmentId: string) =>
  leaves(
    state!.assignments.find((a) => a.id === assignmentId)!.subtasks,
  ).filter((leaf) => !leaf.is_completed);

let fake: ReturnType<typeof fakeBackend>;

beforeEach(() => {
  fake = fakeBackend();
  vi.stubGlobal("fetch", fake.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("terminal store against the backend", () => {
  it("leaves the tree untouched when backend triage fails instead of showing an unsaveable local plan", async () => {
    const store = await loadStore();
    await store.getState().boot();
    expect(store.getState().mode).toBe("backend-demo");

    fake.backend.triageStatus = 500;
    await store.getState().triage(UNTRIAGED);

    const state = store.getState();
    expect(
      state.data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks,
    ).toEqual([]);
    expect(state.triaging).toEqual({});
    expect(state.events[0]).toMatchObject({ level: "error" });
    expect(state.mode).toBe("backend-demo");
  });

  it("uses the backend's tree when triage succeeds", async () => {
    const store = await loadStore();
    await store.getState().boot();
    await triageNow(store, UNTRIAGED);
    const subtasks = store
      .getState()
      .data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks;
    expect(subtasks.map((n) => n.id)).toEqual([`${UNTRIAGED}-remote-1`]);
  });

  it("plays a /decompose trace into the store step by step before revealing the tree", async () => {
    const store = await loadStore();
    await store.getState().boot();
    const { TRIAGE_STREAM_MS, TRACE_STEP_MS } =
      await import("@/store/terminal");
    const tree = () =>
      store.getState().data!.assignments.find((a) => a.id === UNTRIAGED)!
        .subtasks;
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const run = store.getState().triage(UNTRIAGED);
    expect(store.getState().triaging[UNTRIAGED]).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(TRIAGE_STREAM_MS);
    // No stream on this backend: the first step is on screen; the tree waits for all four.
    expect(store.getState().traces[UNTRIAGED]).toMatchObject({
      steps: BACKEND_TRACE.slice(0, 1),
      source: "ai",
      telemetry: expect.objectContaining({ tokens_per_sec: 200 }),
    });
    expect(tree()).toEqual([]);
    await vi.advanceTimersByTimeAsync(TRACE_STEP_MS * 3);
    expect(store.getState().traces[UNTRIAGED].steps).toEqual(BACKEND_TRACE);
    expect(tree()).toEqual([]);
    await vi.advanceTimersByTimeAsync(TRACE_STEP_MS);
    await run;
    expect(tree()).toHaveLength(1);
    expect(store.getState().triaging).toEqual({});
    // A risk step keeps the completion line amber rather than green.
    expect(store.getState().events[0]).toMatchObject({ level: "warn" });
    expect(store.getState().events[0].text).toMatch(/flagged 1 risk step/);
  });

  it("discards a run whose dataset is swapped mid-stream", async () => {
    const store = await loadStore();
    await store.getState().boot();
    const { TRIAGE_STREAM_MS, TRACE_STEP_MS } =
      await import("@/store/terminal");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const run = store.getState().triage(UNTRIAGED);
    await vi.advanceTimersByTimeAsync(TRIAGE_STREAM_MS);
    expect(store.getState().traces[UNTRIAGED]).toBeDefined();
    // Ctrl+Shift+D while the trace streams: the backend tree must not land in the sandbox.
    await store.getState().toggleSimulation();
    await vi.advanceTimersByTimeAsync(TRACE_STEP_MS * 4);
    await run;
    const state = store.getState();
    expect(state.origin).toBe("sandbox");
    expect(
      state.data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks,
    ).toEqual([]);
    expect(state.traces[UNTRIAGED]).toBeUndefined();
    expect(state.triaging).toEqual({});
    expect(state.events[0].text).toMatch(/discarded: the dataset changed/);
  });

  it("builds the trace itself when the backend predates the agent", async () => {
    fake.backend.trace = false;
    const store = await loadStore();
    await store.getState().boot();
    await triageNow(store, UNTRIAGED);
    const trace = store.getState().traces[UNTRIAGED];
    expect(trace.steps.map((step) => step.title)).toEqual([
      "INGEST & AUDIT",
      "CAPACITY CHECK",
      "CRITICAL PATH",
      "VERIFICATION",
    ]);
    expect(trace.steps[2]).toMatchObject({
      engine: "Llama-3.3-70B-Instruct",
      latency_ms: 500,
    });
    expect(trace.source).toBe("ai");
  });

  it("says the saved plan was kept when the backend won't replace a tree with logged work", async () => {
    const store = await loadStore();
    await store.getState().boot();
    const tree = () =>
      store.getState().data!.assignments.find((a) => a.id === RAFT)!.subtasks;
    const before = tree();
    await triageNow(store, RAFT);
    expect(tree()).toEqual(before);
    expect(store.getState().traces[RAFT]).toMatchObject({
      source: "cached",
      telemetry: null,
    });
    expect(store.getState().events[0]).toMatchObject({ level: "info" });
    expect(store.getState().events[0].text).toMatch(/kept the saved plan/i);
  });

  it("moves course velocity before the backend answers, then persists through PATCH /api/v1", async () => {
    const store = await loadStore();
    await store.getState().boot();
    // "Advance commitIndex on majority match": 30m budget, 15m logged, open.
    const leaf = `${RAFT}-2.2`;
    const velocity = () =>
      velocityByCourse(store.getState().data!.assignments).get("cs3801");
    // Raft 130/135 + Midterm 45/40.
    expect(velocity()).toBeCloseTo(100);

    let release!: () => void;
    fake.backend.patchGate = new Promise<void>(
      (resolve) => (release = resolve),
    );
    store.getState().toggle(RAFT, leaf, true);
    expect(velocity()).toBeCloseTo((205 / 190) * 100);
    expect(store.getState().pendingWrites).toBe(1);

    release();
    await vi.waitFor(() => expect(store.getState().pendingWrites).toBe(0));
    expect(fake.backend.calls).toContain(`PATCH /api/v1/subtasks/${leaf}`);
    const remote = fake.backend.state.assignments.find((a) => a.id === RAFT)!;
    expect(findNode(remote.subtasks, leaf)?.is_completed).toBe(true);
    // The backend's answer replaced the optimistic copy without moving it.
    expect(velocity()).toBeCloseTo((205 / 190) * 100);
  });

  it("queues edits while the backend is down and replays them on reconnect", async () => {
    const store = await loadStore();
    await store.getState().boot();
    const [first, second] = openLeaves(store.getState().data, RAFT);

    fake.backend.down = true;
    store.getState().toggle(RAFT, first.id, true);
    await vi.waitFor(() => expect(store.getState().mode).toBe("offline"));
    store.getState().logTime(RAFT, second.id, 15);
    expect(store.getState().queuedEdits).toBe(2);

    fake.backend.down = false;
    expect(await store.getState().refresh()).toBe(true);

    const remote = fake.backend.state.assignments.find(
      (a) => a.id === RAFT,
    )!.subtasks;
    expect(findNode(remote, first.id)?.is_completed).toBe(true);
    expect(findNode(remote, second.id)?.actual_minutes).toBe(
      second.actual_minutes + 15,
    );
    const local = store
      .getState()
      .data!.assignments.find((a) => a.id === RAFT)!.subtasks;
    expect(findNode(local, first.id)?.is_completed).toBe(true);
    expect(store.getState().queuedEdits).toBe(0);
    expect(store.getState().mode).toBe("backend-demo");
  });

  it("ignores a refresh that started before a newer edit", async () => {
    const store = await loadStore();
    await store.getState().boot();
    const [leaf] = openLeaves(store.getState().data, RAFT);

    let release!: () => void;
    fake.backend.gate = new Promise<void>((resolve) => (release = resolve));
    const refresh = store.getState().refresh();
    await vi.waitFor(() =>
      expect(fake.backend.calls.at(-1)).toBe("GET /api/state"),
    );

    fake.backend.gate = null;
    store.getState().toggle(RAFT, leaf.id, true);
    await vi.waitFor(() => expect(store.getState().pendingWrites).toBe(0));
    release();
    await refresh;

    const local = store
      .getState()
      .data!.assignments.find((a) => a.id === RAFT)!.subtasks;
    expect(findNode(local, leaf.id)?.is_completed).toBe(true);
  });

  it("stays connected when a refresh fails with an HTTP error", async () => {
    const store = await loadStore();
    await store.getState().boot();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    expect(await store.getState().refresh()).toBe(false);
    expect(store.getState().mode).toBe("backend-demo");
  });
});

describe("terminal store without a backend", () => {
  it("boots the sandbox and triages locally", async () => {
    fake.backend.down = true;
    const store = await loadStore();
    await store.getState().boot();
    expect(store.getState().mode).toBe("offline");
    // The footer headline is the sandbox status, not the unreachable-API cause.
    const { SANDBOX_READY, TRIAGE_STREAM_MS } =
      await import("@/store/terminal");
    const [headline, cause] = store.getState().events;
    expect(headline).toMatchObject({ level: "ok", text: SANDBOX_READY });
    expect(cause).toMatchObject({ level: "info" });
    expect(cause.text).toMatch(/cannot reach/i);
    await store.getState().sync();
    expect(store.getState().events[0].text).toBe(SANDBOX_READY);
    expect(store.getState().events.some((e) => e.level === "warn")).toBe(false);

    await triageNow(store, UNTRIAGED);

    const subtasks = store
      .getState()
      .data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks;
    expect(subtasks.length).toBeGreaterThan(0);
    expect(subtasks[0].id).toMatch(/^local-/);
    expect(store.getState().queuedEdits).toBe(0);
    // The local planner is audited too, with no model throughput claimed.
    const trace = store.getState().traces[UNTRIAGED];
    expect(trace).toMatchObject({ source: "local", telemetry: null });
    expect(trace.steps[2].engine).toBe("local-planner");
    // Planning time only; the log's display delay is not reported as latency.
    expect(trace.steps[2].latency_ms).toBeLessThan(TRIAGE_STREAM_MS);
    // Below-target MATH 4102 cannot reach 90 on this project alone: amber, never red.
    expect(trace.steps[0].status).toBe("risk");
    expect(store.getState().events[0].level).toBe("warn");
    expect(store.getState().events.some((e) => e.level === "error")).toBe(
      false,
    );
  });
});

describe("terminal store when the backend returns mid-triage", () => {
  it("drops the local plan instead of grafting local ids onto backend data", async () => {
    fake.backend.down = true;
    const store = await loadStore();
    await store.getState().boot();
    const { TRIAGE_STREAM_MS, TRACE_STEP_MS } =
      await import("@/store/terminal");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const run = store.getState().triage(UNTRIAGED);
    await vi.advanceTimersByTimeAsync(TRIAGE_STREAM_MS);
    expect(store.getState().traces[UNTRIAGED].source).toBe("local");
    fake.backend.down = false;
    expect(await store.getState().refresh()).toBe(true);
    expect(store.getState().mode).toBe("backend-demo");
    await vi.advanceTimersByTimeAsync(TRACE_STEP_MS * 4);
    await run;
    const subtasks = store
      .getState()
      .data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks;
    expect(subtasks).toEqual([]);
    expect(store.getState().triaging).toEqual({});
  });
});

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: (index) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
}

/** Every feed deadline expires immediately; records the deadline asked for. */
function expireDeadlines() {
  const deadlines: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    deadlines.push(ms);
    return AbortSignal.abort(
      new DOMException("signal timed out", "TimeoutError"),
    );
  });
  return deadlines;
}

describe("isolated simulation desk", () => {
  let session: Storage;

  beforeEach(() => {
    session = memoryStorage();
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      sessionStorage: session,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const expectDesk = (
    state: ReturnType<Awaited<ReturnType<typeof loadStore>>["getState"]>,
  ) => {
    expect(state.mode).toBe("offline");
    expect(state.origin).toBe("sandbox");
    expect(state.data!.assignments).toHaveLength(12);
    expect(state.data!.courses.map((c) => c.course_code)).toEqual([
      "CS 3801",
      "MATH 4102",
      "ENG 2001",
      "FIN 3100",
    ]);
  };

  it("silently serves the deterministic dataset when the feed answers non-200", async () => {
    fake.backend.feedStatus = 503;
    const store = await loadStore();
    await store.getState().boot();
    expectDesk(store.getState());
    expect(store.getState().events.every((e) => e.level !== "error")).toBe(
      true,
    );
  });

  it("falls over once the feed exceeds its 2.5s deadline", async () => {
    const deadlines = expireDeadlines();
    fake.backend.hang = true;
    const store = await loadStore();
    await store.getState().boot();
    expect(deadlines).toEqual([2500]);
    expectDesk(store.getState());
  });

  it("holds the last good backend data when a background poll times out", async () => {
    const store = await loadStore();
    await store.getState().boot();
    const before = store.getState().data;

    expireDeadlines();
    fake.backend.hang = true;
    expect(await store.getState().refresh()).toBe(false);
    expect(store.getState().mode).toBe("backend-demo");
    expect(store.getState().origin).toBe("backend");
    expect(store.getState().data).toBe(before);
  });

  it("toggles between live and a pinned desk that never touches the network", async () => {
    const store = await loadStore();
    await store.getState().boot();
    expect(store.getState().mode).toBe("backend-demo");

    await store.getState().toggleSimulation();
    expect(store.getState().simulationPinned).toBe(true);
    expectDesk(store.getState());
    expect(session.getItem("apex-terminal:simulation-pinned")).toBe("1");

    const calls = fake.backend.calls.length;
    expect(await store.getState().refresh()).toBe(false);
    await store.getState().sync();
    const [leaf] = openLeaves(store.getState().data, RAFT);
    store.getState().toggle(RAFT, leaf.id, true);
    expect(fake.backend.calls).toHaveLength(calls);

    await store.getState().toggleSimulation();
    expect(store.getState().simulationPinned).toBe(false);
    expect(fake.backend.calls.slice(calls)).toEqual(["POST /api/sync"]);
    expect(store.getState().mode).toBe("backend-demo");
    expect(store.getState().origin).toBe("backend");
    expect(session.getItem("apex-terminal:simulation-pinned")).toBeNull();
  });

  it("reloads straight onto a pinned desk without contacting the backend", async () => {
    session.setItem("apex-terminal:simulation-pinned", "1");
    const store = await loadStore();
    await store.getState().boot();
    expect(fake.backend.calls).toEqual([]);
    expect(store.getState().simulationPinned).toBe(true);
    expectDesk(store.getState());
  });

  it("keeps a desk pinned during boot when the backend answers late", async () => {
    let release!: () => void;
    fake.backend.gate = new Promise<void>((resolve) => (release = resolve));
    const store = await loadStore();
    const booting = store.getState().boot();
    await vi.waitFor(() =>
      expect(fake.backend.calls).toEqual(["GET /api/state"]),
    );

    await store.getState().toggleSimulation();
    release();
    await booting;
    expect(store.getState().simulationPinned).toBe(true);
    expectDesk(store.getState());
  });

  it("stays on the desk when switching back to live fails", async () => {
    const store = await loadStore();
    await store.getState().boot();
    await store.getState().toggleSimulation();

    fake.backend.feedStatus = 500;
    await store.getState().toggleSimulation();
    expect(store.getState().simulationPinned).toBe(false);
    expectDesk(store.getState());
  });
});

describe("syllabus ingest", () => {
  const SYLLABUS = "BIO 2200 Cell Biology. Grading: Midterm 30%, Final 40%.";

  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage(),
    });
  });

  async function ingest(store: Awaited<ReturnType<typeof loadStore>>) {
    const { api } = await import("@/lib/api");
    await store
      .getState()
      .hydrateFromSyllabus(await api.ingestSyllabus({ text: SYLLABUS }));
  }

  it("hydrates the book and focuses the extracted course", async () => {
    const store = await loadStore();
    await store.getState().boot();
    await ingest(store);

    const state = store.getState();
    expect(fake.backend.calls).toContain("POST /api/v1/syllabus/ingest");
    expect(state.data!.courses.map((c) => c.course_code)).toContain(
      "BIO 2200",
    );
    expect(state.activeCourseId).toBe("syllabus:bio-2200");
    expect(state.selectedId).toBe("syllabus:bio-2200:midterm");
    expect(state.origin).toBe("backend");
    expect(state.events[0]).toMatchObject({ level: "ok" });
    expect(state.events[0].text).toMatch(/SYLLABUS INGESTED · BIO 2200 added/);
  });

  it("leaves a pinned desk for the backend's answer", async () => {
    const store = await loadStore();
    await store.getState().boot();
    await store.getState().toggleSimulation();
    expect(store.getState().origin).toBe("sandbox");

    await ingest(store);
    const state = store.getState();
    expect(state.simulationPinned).toBe(false);
    expect(state.origin).toBe("backend");
    expect(state.mode).toBe("backend-demo");
    expect(state.activeCourseId).toBe("syllabus:bio-2200");
  });

  it("relinks a sandbox session once the backend is back", async () => {
    fake.backend.down = true;
    const store = await loadStore();
    await store.getState().boot();
    expect(store.getState().mode).toBe("offline");

    fake.backend.down = false;
    await ingest(store);
    const state = store.getState();
    expect(state.origin).toBe("backend");
    expect(state.mode).toBe("backend-demo");
    expect(state.data!.assignments).toHaveLength(13);
  });

  it("changes nothing when extraction fails", async () => {
    fake.backend.down = true;
    const store = await loadStore();
    await store.getState().boot();
    const before = store.getState().data;

    await expect(ingest(store)).rejects.toMatchObject({ kind: "network" });
    expect(store.getState().data).toBe(before);
    expect(store.getState().origin).toBe("sandbox");
  });
});

describe("sample syllabus on the offline sandbox", () => {
  let session: Storage;

  beforeEach(() => {
    session = memoryStorage();
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      sessionStorage: session,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sample = () => sampleSyllabusState(Date.now());

  it("replaces the book with CS-101 and pins the offline desk", async () => {
    const store = await loadStore();
    await store.getState().boot();
    expect(store.getState().mode).toBe("backend-demo");

    const book = sample();
    store.getState().loadSampleSyllabus(book);

    const state = store.getState();
    expect(state.mode).toBe("offline");
    expect(state.origin).toBe("sandbox");
    expect(state.simulationPinned).toBe(true);
    expect(session.getItem("apex-terminal:simulation-pinned")).toBe("1");
    expect(state.data).toEqual(book);
    expect(state.data!.courses.map((c) => c.course_code)).toEqual(["CS-101"]);
    expect(state.activeCourseId).toBe(SAMPLE_COURSE_ID);
    expect(state.data!.assignments.map((a) => a.id)).toContain(
      state.selectedId,
    );
  });

  it("clears the previous session's plans and traces", async () => {
    const store = await loadStore();
    await store.getState().boot();
    store.setState({ studyErrors: { x: "boom" }, traces: {} });

    store.getState().loadSampleSyllabus(sample());
    expect(store.getState().studyErrors).toEqual({});
    expect(store.getState().studyPlans).toEqual({});
  });

  it("stays off the network, so a poll cannot replace the sample", async () => {
    const store = await loadStore();
    await store.getState().boot();
    store.getState().loadSampleSyllabus(sample());

    const calls = fake.backend.calls.length;
    expect(await store.getState().refresh()).toBe(false);
    await store.getState().sync();
    expect(fake.backend.calls).toHaveLength(calls);
    expect(store.getState().data!.courses).toHaveLength(1);
  });

  it("keeps editing local to the sandbox", async () => {
    const store = await loadStore();
    await store.getState().boot();
    store.getState().loadSampleSyllabus(sample());

    const calls = fake.backend.calls.length;
    const lab = store
      .getState()
      .data!.assignments.find((a) => a.subtasks.length > 0)!;
    store.getState().toggle(lab.id, lab.subtasks[0].id, true);
    expect(fake.backend.calls).toHaveLength(calls);
    expect(
      store
        .getState()
        .data!.assignments.find((a) => a.id === lab.id)!
        .subtasks.find((t) => t.id === lab.subtasks[0].id)!.is_completed,
    ).toBe(true);
  });

  it("survives a reload while pinned", async () => {
    const store = await loadStore();
    await store.getState().boot();
    store.getState().loadSampleSyllabus(sample());

    const reloaded = await loadStore();
    await reloaded.getState().boot();
    expect(reloaded.getState().simulationPinned).toBe(true);
    expect(reloaded.getState().data!.courses.map((c) => c.course_code)).toEqual(
      ["CS-101"],
    );
  });

  it("returns to live data on Ctrl+Shift+D", async () => {
    const store = await loadStore();
    await store.getState().boot();
    store.getState().loadSampleSyllabus(sample());

    await store.getState().toggleSimulation();
    const state = store.getState();
    expect(state.simulationPinned).toBe(false);
    expect(state.mode).toBe("backend-demo");
    expect(state.origin).toBe("backend");
    expect(state.data!.courses.some((c) => c.id === SAMPLE_COURSE_ID)).toBe(
      false,
    );
  });

  it("works on a desk that was already offline", async () => {
    fake.backend.down = true;
    const store = await loadStore();
    await store.getState().boot();
    expect(store.getState().mode).toBe("offline");

    store.getState().loadSampleSyllabus(sample());
    expect(store.getState().data!.courses).toHaveLength(1);
    expect(store.getState().simulationPinned).toBe(true);
  });

  it("logs what loaded and how to get back", async () => {
    const store = await loadStore();
    await store.getState().boot();
    store.getState().loadSampleSyllabus(sample());

    const [latest] = store.getState().events;
    expect(latest.level).toBe("ok");
    expect(latest.text).toContain("SAMPLE SYLLABUS");
    expect(latest.text).toContain("CS-101");
    expect(latest.text).toContain("Ctrl+Shift+D");
  });
});
