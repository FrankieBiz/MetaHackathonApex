import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEED_DEADLINE_MS,
  api,
  buildTree,
  normalizeState,
  normalizeTriage,
} from "@/lib/api";
import { createMockState } from "@/lib/mockData";

describe("buildTree", () => {
  it("rebuilds a flat parent_id list into a tree, honouring position", () => {
    const tree = buildTree(
      [
        { id: "b", parent_id: "root", title: "B", position: 2 },
        { id: "root", parent_id: null, title: "Root" },
        { id: "a", parent_id: "root", title: "A", position: 1 },
      ],
      "asg",
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((child) => child.id)).toEqual(["a", "b"]);
    expect(tree[0].children[0].assignment_id).toBe("asg");
  });

  it("accepts nested children and promotes orphans to roots", () => {
    const tree = buildTree(
      [
        { id: 1, title: "One", children: [{ id: 2, title: "Two" }] },
        { id: 3, parent_id: "missing", title: "Orphan" },
        { title: "no id — dropped" },
      ],
      "asg",
    );
    expect(tree.map((n) => n.id)).toEqual(["1", "3"]);
    expect(tree[0].children[0].parent_id).toBe("1");
  });
});

describe("normalizeState", () => {
  it("fills defaults, derives margin, and resolves course codes", () => {
    const state = normalizeState({
      courses: [
        {
          id: "c1",
          course_code: "CS-401",
          name: "DS",
          current_score: 94.2,
          target_score: 90,
        },
      ],
      assignments: [
        {
          id: "a1",
          course_id: "c1",
          title: "Lab",
          due_at: null,
          points_possible: "100",
          status: "weird",
        },
        { course_id: "c1" },
      ],
    });
    expect(state.courses[0].portfolio_margin).toBeCloseTo(4.2);
    expect(state.courses[0].grade_history).toEqual([]);
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0]).toMatchObject({
      course_code: "CS-401",
      points_possible: 100,
      weight: 0,
      status: "pending",
    });
    expect(state.metrics.demo_mode).toBe(false);
  });

  it("keeps ungraded courses ungraded instead of scoring them zero", () => {
    const state = normalizeState({
      courses: [
        {
          id: "c1",
          course_code: "KINE-210",
          name: "Bio",
          current_score: null,
          target_score: 90,
          portfolio_margin: null,
        },
      ],
      assignments: [],
    });
    expect(state.courses[0].current_score).toBeNull();
    expect(state.courses[0].portfolio_margin).toBeNull();
  });

  it("falls back to defaults for null numbers instead of coercing them to zero", () => {
    const state = normalizeState({
      courses: [
        {
          id: "c1",
          course_code: "X",
          name: "X",
          current_score: 80,
          target_score: null,
        },
      ],
      assignments: [
        {
          id: "a1",
          course_id: "c1",
          title: "T",
          subtasks: [
            {
              id: "s1",
              title: "S",
              estimated_minutes: null,
              actual_minutes: null,
            },
          ],
        },
      ],
    });
    expect(state.courses[0].target_score).toBe(90);
    expect(state.courses[0].portfolio_margin).toBe(-10);
    expect(state.assignments[0].subtasks[0]).toMatchObject({
      estimated_minutes: 30,
      actual_minutes: 0,
    });
  });

  it("rejects payloads that are not terminal state", () => {
    expect(() => normalizeState({ detail: "Not Found" })).toThrow();
    expect(() => normalizeState(null)).toThrow();
  });
});

describe("normalizeTriage", () => {
  it("accepts a bare list or a wrapped object", () => {
    expect(normalizeTriage([{ id: "x", title: "X" }], "a")).toHaveLength(1);
    expect(
      normalizeTriage({ subtasks: [{ id: "x", title: "X" }] }, "a"),
    ).toHaveLength(1);
    expect(() => normalizeTriage({ ok: true }, "a")).toThrow();
  });
});

describe("feed interceptor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const backendState = () => {
    const state = createMockState(Date.now());
    return { ...state, metrics: { ...state.metrics, demo_mode: false } };
  };
  const answer =
    (body: unknown, status = 200) =>
    async () =>
      new Response(JSON.stringify(body), { status });

  it("passes a healthy backend answer through untouched", async () => {
    vi.stubGlobal("fetch", answer(backendState()));
    const feed = await api.state();
    expect(feed.simulated).toBe(false);
    expect(feed.state.metrics.demo_mode).toBe(false);
  });

  it.each([
    ["non-200", answer({ detail: "Canvas unavailable" }, 502), "http"],
    [
      "unreachable",
      async () => Promise.reject(new TypeError("fetch failed")),
      "network",
    ],
    ["unusable payload", answer({ unexpected: true }), "parse"],
  ] as const)(
    "serves the mock dataset when the feed is %s",
    async (_, fetch, kind) => {
      vi.stubGlobal("fetch", fetch);
      for (const feed of [await api.state(), await api.sync()]) {
        expect(feed.simulated).toBe(true);
        if (!feed.simulated) continue;
        expect(feed.cause.kind).toBe(kind);
        expect(feed.state.metrics.demo_mode).toBe(true);
        expect(feed.state.assignments).toHaveLength(12);
      }
    },
  );

  it("abandons state and sync reads after 2.5s", async () => {
    const deadlines: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      deadlines.push(ms);
      return AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
    });
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      throw init.signal!.reason;
    });
    const [state, sync] = [await api.state(), await api.sync()];
    expect(FEED_DEADLINE_MS).toBe(2500);
    expect(deadlines).toEqual([2500, 2500]);
    expect(state.simulated && state.cause.kind).toBe("timeout");
    expect(sync.simulated && sync.cause.kind).toBe("timeout");
  });
});

describe("api.triage", () => {
  afterEach(() => vi.unstubAllGlobals());

  const step = (index: number) => ({
    step: index + 1,
    title: [
      "INGEST & AUDIT",
      "CAPACITY CHECK",
      "CRITICAL PATH",
      "VERIFICATION",
    ][index],
    status: "pass",
    summary: "ok",
    evidence: ["LOAD 12% of the window with this plan"],
    engine: "velocity-auditor",
    latency_ms: 1,
  });
  const decompose = (extra: Record<string, unknown>) =>
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            subtasks: [{ id: "x", title: "X", estimated_minutes: 30 }],
            source: "ai",
            telemetry: {
              model_used: "muse-spark",
              latency_ms: 900,
              prompt_tokens: 300,
              completion_tokens: 120,
              tokens_per_sec: 133.3,
            },
            ...extra,
          }),
        ),
    );

  it("returns the tree, telemetry, and the four-step agent trace", async () => {
    decompose({ agent_reasoning_trace: [0, 1, 2, 3].map(step) });
    const result = await api.triage("a");
    expect(result.subtasks.map((n) => n.id)).toEqual(["x"]);
    expect(result.telemetry.model_used).toBe("muse-spark");
    expect(result.trace?.map((s) => s.title)).toEqual([
      "INGEST & AUDIT",
      "CAPACITY CHECK",
      "CRITICAL PATH",
      "VERIFICATION",
    ]);
  });

  it("keeps the tree when the trace is missing or malformed", async () => {
    decompose({});
    expect((await api.triage("a")).trace).toBeNull();
    decompose({ agent_reasoning_trace: [step(0)] });
    expect((await api.triage("a")).trace).toBeNull();
    decompose({ agent_reasoning_trace: "not a trace" });
    const result = await api.triage("a");
    expect(result.trace).toBeNull();
    expect(result.subtasks).toHaveLength(1);
  });
});
