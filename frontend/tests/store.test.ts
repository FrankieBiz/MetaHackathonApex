import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findNode, leaves, velocityByCourse } from "@/lib/engine";
import { createMockState } from "@/lib/mockData";
import type { SubTaskNode, TerminalState } from "@/types";

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
    if (method === "POST" && pathname.startsWith("/api/triage/")) {
      if (backend.triageStatus !== 200) {
        return reply({ detail: "Llama-3 unavailable" }, backend.triageStatus);
      }
      const assignmentId = pathname.split("/").pop()!;
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
      return reply(tree);
    }
    return reply({ detail: "Not Found" }, 404);
  };
  return { backend, fetch };
}

async function loadStore() {
  vi.resetModules();
  return (await import("@/store/terminal")).useTerminal;
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
    await store.getState().triage(UNTRIAGED);
    const subtasks = store
      .getState()
      .data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks;
    expect(subtasks.map((n) => n.id)).toEqual([`${UNTRIAGED}-remote-1`]);
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

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const run = store.getState().triage(UNTRIAGED);
    await vi.advanceTimersByTimeAsync(2000);
    await run;

    const subtasks = store
      .getState()
      .data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks;
    expect(subtasks.length).toBeGreaterThan(0);
    expect(subtasks[0].id).toMatch(/^local-/);
    expect(store.getState().queuedEdits).toBe(0);
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
