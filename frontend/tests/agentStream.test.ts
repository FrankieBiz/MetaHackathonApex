import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  TriageStreamError,
  type TriageStreamEvent,
} from "@/lib/api";
import { leaves } from "@/lib/engine";
import { createMockState } from "@/lib/mockData";
import type { AgentReasoningStep, SubTaskNode, TerminalState } from "@/types";

/** The backend agent's four steps, as GET /api/v1/triage/{id}/stream sends them. */
const STEPS: AgentReasoningStep[] = [
  "INGEST & AUDIT",
  "CAPACITY CHECK",
  "CRITICAL PATH",
  "VERIFICATION",
].map((title, index) => ({
  step: index + 1,
  title,
  status: index === 1 ? "watch" : "pass",
  summary: `${title} summary`,
  evidence: [`${title} evidence`],
  engine: index === 2 ? "Llama-3.3-70B-Instruct" : "capacity-engine",
  latency_ms: index === 2 ? 640 : 0,
}));

const TELEMETRY = {
  model_used: "Llama-3.3-70B-Instruct",
  latency_ms: 640,
  prompt_tokens: 300,
  completion_tokens: 120,
  tokens_per_sec: 187.5,
};

const plan = (assignmentId: string): SubTaskNode[] => [
  {
    id: `${assignmentId}-streamed-1`,
    assignment_id: assignmentId,
    parent_id: null,
    title: "Streamed task",
    estimated_minutes: 45,
    actual_minutes: 0,
    is_completed: false,
    is_study_recommendation: false,
    children: [],
  },
];

const complete = (assignmentId: string) => ({
  subtasks: plan(assignmentId),
  source: "ai",
  telemetry: TELEMETRY,
  agent_reasoning_trace: STEPS,
});

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** An SSE body the test writes to by hand, one frame (or fragment) at a time. */
function sseBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  return {
    response: () =>
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    write: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    send: (event: string, data: unknown) =>
      controller.enqueue(encoder.encode(frame(event, data))),
    close: () => controller.close(),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function loadApi() {
  vi.resetModules();
  return import("@/lib/api");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sseFrames", () => {
  it("reassembles frames split across chunks, joins data lines, and skips comments", async () => {
    const { sseFrames } = await loadApi();
    const stream = sseBody();
    const frames: { event: string | null; data: string }[] = [];
    const reading = (async () => {
      for await (const f of sseFrames(stream.response().body!)) frames.push(f);
    })();
    stream.write(": keep-alive\n\nevent: tok");
    stream.write('en\r\ndata: {"text":"Hel');
    stream.write('lo"}\r\n\r\n');
    stream.write("data: line one\ndata: line two\n\n");
    stream.write('event: log\ndata: {"message":"tail"}');
    stream.close();
    await reading;
    expect(frames).toEqual([
      { event: "token", data: '{"text":"Hello"}' },
      { event: null, data: "line one\nline two" },
      { event: "log", data: '{"message":"tail"}' },
    ]);
  });
});

describe("api.streamTriage", () => {
  it("hands each live event over as it lands and resolves with the final plan", async () => {
    const { api, triageStreamPath } = await loadApi();
    const { useInference } = await import("@/store/inference");
    const stream = sseBody();
    const fetch = vi.fn(async () => stream.response());
    vi.stubGlobal("fetch", fetch);

    const events: unknown[] = [];
    const run = api.streamTriage("asg 1", (event) => events.push(event));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/triage\/asg%201\/stream$/);
    expect(triageStreamPath("asg 1")).toBe("/api/v1/triage/asg%201/stream");
    expect(init.method ?? "GET").toBe("GET");
    expect(new Headers(init.headers).get("accept")).toBe("text/event-stream");

    stream.send("tool_call", {
      name: "calculate_grade_floor",
      arguments: { assignment_id: "asg 1" },
      result: { floor: 82 },
    });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    // Live: the first event is out before the stream has finished.
    expect(events[0]).toEqual({
      type: "tool_call",
      name: "calculate_grade_floor",
      arguments: { assignment_id: "asg 1" },
      result: { floor: 82 },
    });

    stream.send("step", STEPS[0]);
    // Frames without an `event:` line are named by their JSON `type` field.
    stream.write(`data: ${JSON.stringify({ type: "token", text: "[{" })}\n\n`);
    stream.send("log", { message: "Sequencing the critical path" });
    stream.send("mystery", { ignored: true });
    stream.send("complete", complete("asg 1"));
    stream.close();

    const result = await run;
    expect(events.slice(1)).toEqual([
      { type: "step", step: STEPS[0] },
      { type: "token", text: "[{" },
      { type: "log", message: "Sequencing the critical path" },
    ]);
    expect(result.subtasks.map((node) => node.id)).toEqual([
      "asg 1-streamed-1",
    ]);
    expect(result).toMatchObject({ source: "ai", trace: STEPS });
    expect(useInference.getState()).toMatchObject({
      status: "ai",
      telemetry: TELEMETRY,
    });
  });

  it("accepts `done` as the final event name too", async () => {
    const { api } = await loadApi();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(frame("done", complete("asg")), {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }),
    );
    const result = await api.streamTriage("asg", () => {});
    expect(result.subtasks).toHaveLength(1);
  });

  it("rejects with TriageStreamError when the agent reports a failure in-band", async () => {
    const { api, TriageStreamError } = await loadApi();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          frame("error", {
            detail: "Assignment changed during triage; refresh and retry.",
            status: 409,
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const failure = api.streamTriage("asg", () => {});
    await expect(failure).rejects.toBeInstanceOf(TriageStreamError);
    await expect(failure).rejects.toThrow(/changed during triage/);
  });

  it("reports an unavailable stream as a plain ApiError", async () => {
    const { api, ApiError, TriageStreamError } = await loadApi();
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => json({ detail: "Not Found" }, 404), "http"],
      [() => json({ subtasks: [] }), "parse"],
      [
        () =>
          new Response(frame("log", { message: "half a run" }), {
            headers: { "content-type": "text/event-stream" },
          }),
        "parse",
      ],
      [
        () => {
          throw new TypeError("fetch failed");
        },
        "network",
      ],
    ];
    for (const [answer, kind] of cases) {
      vi.stubGlobal("fetch", async () => answer());
      const error = await api.streamTriage("asg", () => {}).catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(TriageStreamError);
      expect(error.kind).toBe(kind);
    }
  });
});

describe("applyTraceEvent", () => {
  it("keeps steps ordered and lets a re-sent step replace its earlier copy", async () => {
    vi.resetModules();
    const { applyTraceEvent } = await import("@/store/terminal");
    let trace = {
      steps: [],
      events: [],
      tokens: "",
      source: null,
      telemetry: null,
    } as Parameters<typeof applyTraceEvent>[0];
    trace = applyTraceEvent(trace, { type: "step", step: STEPS[1] });
    trace = applyTraceEvent(trace, { type: "step", step: STEPS[0] });
    trace = applyTraceEvent(trace, {
      type: "step",
      step: { ...STEPS[1], status: "risk" },
    });
    trace = applyTraceEvent(trace, { type: "token", text: "ab" });
    trace = applyTraceEvent(trace, { type: "token", text: "c" });
    trace = applyTraceEvent(trace, {
      type: "tool_call",
      name: "check_capacity",
      arguments: { assignment_id: "asg" },
      result: null,
    });
    expect(trace.steps.map((step) => [step.step, step.status])).toEqual([
      [1, "pass"],
      [2, "risk"],
    ]);
    expect(trace.tokens).toBe("abc");
    expect(trace.events).toEqual([
      {
        kind: "tool",
        name: "check_capacity",
        args: '{"assignment_id":"asg"}',
        result: null,
      },
    ]);
  });
});

// ------------------------------------------------------------- the store

/** Ships without a task tree. */
const UNTRIAGED = "math4102-queue";

/** A FastAPI stand-in: /api/state, a hand-driven triage stream, and /api/decompose. */
function fakeBackend() {
  const state: TerminalState = createMockState(Date.now());
  const backend = {
    state,
    /** null: the stream route 404s like a backend that predates it. */
    stream: null as ReturnType<typeof sseBody> | null,
    calls: [] as string[],
  };
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const { pathname } = new URL(url);
    backend.calls.push(`${method} ${pathname}`);
    if (method === "GET" && pathname === "/api/state") return json(state);
    if (method === "GET" && pathname.endsWith("/stream")) {
      return backend.stream?.response() ?? json({ detail: "Not Found" }, 404);
    }
    if (method === "POST" && pathname === "/api/decompose") {
      const assignmentId = JSON.parse(String(init.body)).assignment_id;
      return json(complete(assignmentId));
    }
    return json({ detail: "Not Found" }, 404);
  };
  return { backend, fetch };
}

let fake: ReturnType<typeof fakeBackend>;

beforeEach(() => {
  fake = fakeBackend();
  vi.stubGlobal("fetch", fake.fetch);
});

async function bootStore() {
  vi.resetModules();
  const store = (await import("@/store/terminal")).useTerminal;
  await store.getState().boot();
  expect(store.getState().mode).toBe("backend-demo");
  return store;
}

describe("terminal store streaming triage", () => {
  it("puts live events, tool calls, steps, and tokens into the store as they occur", async () => {
    const store = await bootStore();
    const stream = (fake.backend.stream = sseBody());
    const tree = () =>
      store.getState().data!.assignments.find((a) => a.id === UNTRIAGED)!
        .subtasks;
    const trace = () => store.getState().traces[UNTRIAGED];

    const run = store.getState().triage(UNTRIAGED);
    // The live trace exists from the first moment, naming the transport.
    expect(trace()).toMatchObject({ steps: [], tokens: "", source: null });
    expect(trace().events[0]).toMatchObject({
      kind: "log",
      from: "terminal",
      text: expect.stringMatching(/^GET .*\/api\/v1\/triage\/.+\/stream$/),
    });

    stream.send("tool_call", {
      name: "get_portfolio_state",
      arguments: { assignment_id: UNTRIAGED },
      result: { margin: -3.5 },
    });
    await vi.waitFor(() => expect(trace().events).toHaveLength(2));
    expect(trace().events[1]).toEqual({
      kind: "tool",
      name: "get_portfolio_state",
      args: JSON.stringify({ assignment_id: UNTRIAGED }),
      result: JSON.stringify({ margin: -3.5 }),
    });

    stream.send("step", STEPS[0]);
    stream.send("step", STEPS[1]);
    await vi.waitFor(() => expect(trace().steps).toHaveLength(2));
    stream.send("log", { message: "Calling the Meta model" });
    stream.send("token", { text: '{"subtasks": [' });
    stream.send("token", { text: '{"title": "Streamed task"}' });
    await vi.waitFor(() =>
      expect(trace().tokens).toBe('{"subtasks": [{"title": "Streamed task"}'),
    );
    expect(trace().events.at(-1)).toEqual({
      kind: "log",
      text: "Calling the Meta model",
      from: "agent",
    });
    // Still in flight: no tree, no verdict, inference running.
    expect(store.getState().triaging[UNTRIAGED]).toBeGreaterThan(0);
    expect(trace().source).toBeNull();
    expect(tree()).toEqual([]);

    stream.send("step", STEPS[2]);
    stream.send("step", STEPS[3]);
    stream.send("complete", complete(UNTRIAGED));
    stream.close();
    // No artificial replay window: the tree lands as soon as the plan does.
    await run;

    expect(tree().map((node) => node.id)).toEqual([`${UNTRIAGED}-streamed-1`]);
    expect(trace()).toMatchObject({
      steps: STEPS,
      source: "ai",
      telemetry: TELEMETRY,
    });
    expect(store.getState().triaging).toEqual({});
    expect(fake.backend.calls).not.toContain("POST /api/decompose");
    // A watch step is not a risk: the completion line stays green.
    expect(store.getState().events[0]).toMatchObject({ level: "ok" });
    expect(store.getState().events[0].text).toMatch(/Triage complete/);
  });

  it("falls back to POST /api/decompose when the stream is unavailable", async () => {
    const store = await bootStore();
    const { TRIAGE_STREAM_MS, TRACE_STEP_MS } =
      await import("@/store/terminal");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const run = store.getState().triage(UNTRIAGED);
    await vi.advanceTimersByTimeAsync(TRIAGE_STREAM_MS + TRACE_STEP_MS * 4);
    await run;

    const calls = fake.backend.calls.filter((call) => !call.endsWith("/state"));
    expect(calls).toEqual([
      `GET /api/v1/triage/${UNTRIAGED}/stream`,
      "POST /api/decompose",
    ]);
    const state = store.getState();
    expect(
      leaves(state.data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks)
        .length,
    ).toBe(1);
    expect(state.traces[UNTRIAGED]).toMatchObject({
      steps: STEPS,
      source: "ai",
    });
    expect(state.traces[UNTRIAGED].events.map((event) => event.kind)).toEqual([
      "log",
      "log",
    ]);
    expect(
      state.traces[UNTRIAGED].events.some(
        (event) =>
          event.kind === "log" &&
          /STREAM UNAVAILABLE.*\/api\/decompose/.test(event.text),
      ),
    ).toBe(true);
    expect(state.events.some((event) => event.level === "error")).toBe(false);
  });

  it("falls back to /decompose when the stream drops mid-run, discarding its partial trace", async () => {
    const store = await bootStore();
    const { TRIAGE_STREAM_MS, TRACE_STEP_MS } =
      await import("@/store/terminal");
    const stream = (fake.backend.stream = sseBody());
    const run = store.getState().triage(UNTRIAGED);
    stream.send("step", { ...STEPS[0], summary: "partial" });
    stream.send("token", { text: "half" });
    await vi.waitFor(() =>
      expect(store.getState().traces[UNTRIAGED].tokens).toBe("half"),
    );
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    stream.close();
    await vi.waitFor(() =>
      expect(fake.backend.calls).toContain("POST /api/decompose"),
    );
    await vi.advanceTimersByTimeAsync(TRIAGE_STREAM_MS + TRACE_STEP_MS * 4);
    await run;
    const trace = store.getState().traces[UNTRIAGED];
    expect(trace.steps).toEqual(STEPS);
    expect(trace.tokens).toBe("");
  });

  it("reports an in-band agent error without retrying or touching the tree", async () => {
    const store = await bootStore();
    const stream = (fake.backend.stream = sseBody());
    const run = store.getState().triage(UNTRIAGED);
    stream.send("step", STEPS[0]);
    stream.send("error", { detail: "Assignment changed during triage" });
    stream.close();
    await run;

    const state = store.getState();
    expect(fake.backend.calls).not.toContain("POST /api/decompose");
    expect(
      state.data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks,
    ).toEqual([]);
    expect(state.triaging).toEqual({});
    // An unfinished trace leaves with its run.
    expect(state.traces[UNTRIAGED]).toBeUndefined();
    expect(state.events[0]).toMatchObject({ level: "error" });
    expect(state.events[0].text).toMatch(/changed during triage/);
    expect(state.mode).toBe("backend-demo");
  });

  it("stops writing a stream's events once the dataset is swapped under it", async () => {
    const store = await bootStore();
    const stream = (fake.backend.stream = sseBody());
    const run = store.getState().triage(UNTRIAGED);
    stream.send("step", STEPS[0]);
    await vi.waitFor(() =>
      expect(store.getState().traces[UNTRIAGED].steps).toHaveLength(1),
    );
    // Ctrl+Shift+D mid-stream: nothing more from this run may reach the sandbox.
    await store.getState().toggleSimulation();
    stream.send("step", STEPS[1]);
    stream.send("complete", complete(UNTRIAGED));
    stream.close();
    await run;

    const state = store.getState();
    expect(state.origin).toBe("sandbox");
    expect(state.traces[UNTRIAGED]).toBeUndefined();
    expect(
      state.data!.assignments.find((a) => a.id === UNTRIAGED)!.subtasks,
    ).toEqual([]);
    expect(state.triaging).toEqual({});
    expect(fake.backend.calls).not.toContain("POST /api/decompose");
    expect(state.events[0].text).toMatch(/discarded: the dataset changed/);
  });
});

// ------------------------------------------- streamTriage client (merged suite)

function sseResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

describe("streamTriage client", () => {
  it("consumes step, tool_call, token, and complete SSE events", async () => {
    const events: TriageStreamEvent[] = [];
    const completePayload = {
      subtasks: [
        {
          id: "task-1",
          title: "Complete initial election test",
          estimated_minutes: 30,
          children: [],
        },
      ],
      telemetry: {
        model_used: "muse-spark-1.3",
        latency_ms: 120,
        prompt_tokens: 240,
        completion_tokens: 100,
        tokens_per_sec: 140,
      },
      source: "ai",
      agent_reasoning_trace: null,
    };

    const mockFetch = async () =>
      sseResponse([
        'event: tool_call\ndata: {"name": "calculate_grade_floor", "arguments": {"weight": 20}, "result": {"grade_floor_percent": 82.5}}\n\n',
        'event: step\ndata: {"step": 1, "title": "INGEST & AUDIT", "status": "pass", "summary": "Audited rubric", "engine": "rubric-parser", "latency_ms": 10, "evidence": ["Weight: 20%"]}\n\n',
        'event: token\ndata: {"text": "Sequencing "}\n\n',
        'event: token\ndata: {"text": "critical path"}\n\n',
        `event: complete\ndata: ${JSON.stringify(completePayload)}\n\n`,
      ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const result = await api.streamTriage("cs3801-raft", (e) =>
        events.push(e),
      );
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].title).toBe("Complete initial election test");
      expect(result.telemetry.model_used).toBe("muse-spark-1.3");
      expect(events).toEqual([
        {
          type: "tool_call",
          name: "calculate_grade_floor",
          arguments: { weight: 20 },
          result: { grade_floor_percent: 82.5 },
        },
        {
          type: "step",
          step: {
            step: 1,
            title: "INGEST & AUDIT",
            status: "pass",
            summary: "Audited rubric",
            engine: "rubric-parser",
            latency_ms: 10,
            evidence: ["Weight: 20%"],
          },
        },
        { type: "token", text: "Sequencing " },
        { type: "token", text: "critical path" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles server-sent error events", async () => {
    const mockFetch = async () =>
      sseResponse([
        'event: error\ndata: {"detail": "Assignment changed during triage; refresh and retry."}\n\n',
      ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      await expect(api.streamTriage("cs3801-raft", () => {})).rejects.toThrow(
        TriageStreamError,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws ApiError when the backend responds with non-SSE content-type", async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      await expect(api.streamTriage("cs3801-raft", () => {})).rejects.toThrow(
        ApiError,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
