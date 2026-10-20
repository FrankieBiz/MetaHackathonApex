import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockState } from "@/lib/mockData";
import { studyOpportunity } from "@/lib/study";
import type { StudyTriagePlan } from "@/types";

const plan: StudyTriagePlan = {
  course_id: "cs3801",
  detected_triggers: [
    "Keyword: 'Study Guide'",
    "PDF: Midterm_Guide.pdf (4.2MB) — large PDF",
  ],
  focus_topics: ["Leader election", "Quorums", "Log replication"],
  recommended_blocks: [
    { title: "Trace a failed leader election", estimated_minutes: 25 },
    {
      title: "Prove quorum intersection for five nodes",
      estimated_minutes: 25,
    },
  ],
  source: "ai",
  inference_telemetry: {
    model_used: "Llama-3.3-70B-Instruct",
    latency_ms: 500,
    prompt_tokens: 240,
    completion_tokens: 100,
    tokens_per_sec: 200,
  },
};

function backend() {
  const state = createMockState(Date.now());
  state.courses.push({
    ...state.courses[0],
    id: "empty",
    course_code: "BIO 101",
    name: "Biology",
  });
  state.courses[0].syllabus = "Study Guide: Midterm_Guide.pdf (4.2MB)";
  const recent = state.assignments.find((a) => a.course_id === "cs3801")!;
  recent.score = 12;
  recent.points_possible = 20;
  const server = {
    state,
    scanGate: null as Promise<void> | null,
    failScan: false,
    failInsert: false,
    response: structuredClone(plan),
    calls: [] as { path: string; body: unknown }[],
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : null;
      server.calls.push({ path, body });
      if (path === "/api/state" || path === "/api/sync") return reply(state);
      if (path === "/api/v1/triage/study") {
        if (server.scanGate) await server.scanGate;
        if (server.failScan) return reply({ detail: "Unavailable" }, 503);
        return reply({ ...server.response, course_id: body.course_id });
      }
      if (path === "/api/v1/triage/study/insert") {
        if (server.failInsert) return reply({ detail: "Could not save" }, 503);
        state.study_recommendations ??= [];
        for (const [i, block] of body.recommended_blocks.entries()) {
          const id = `study-${body.course_id}-${i}`;
          if (state.study_recommendations.some((n) => n.id === id)) continue;
          state.study_recommendations.push({
            id,
            course_id: body.course_id,
            assignment_id: "study",
            parent_id: null,
            title: block.title,
            estimated_minutes: 25,
            actual_minutes: 0,
            is_completed: false,
            is_study_recommendation: true,
            children: [],
          });
        }
        return reply(state);
      }
      if (path.startsWith("/api/v1/subtasks/")) {
        const node = state.study_recommendations?.find(
          (n) => n.id === path.split("/").pop(),
        );
        if (!node) return reply({ detail: "Missing" }, 404);
        Object.assign(node, body);
        return reply(state);
      }
      return reply({ detail: "Missing" }, 404);
    }),
  );
  return server;
}

async function load() {
  vi.resetModules();
  const { useTerminal: store, activeCourseOf } = await import(
    "@/store/terminal"
  );
  const { useInference: inference } = await import("@/store/inference");
  await store.getState().boot();
  store.getState().selectCourse("cs3801");
  return { store, inference, activeCourseOf };
}

let server: ReturnType<typeof backend>;
beforeEach(() => {
  server = backend();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("study triage store and API integration", () => {
  it("sends only the active course context, previews without mutation, and records telemetry", async () => {
    const { store, inference } = await load();
    const before = structuredClone(store.getState().data);
    await store.getState().generateStudyTriage();
    const call = server.calls.find((c) => c.path === "/api/v1/triage/study")!;
    expect(call.body).toMatchObject({
      course_id: "cs3801",
      course_name: "Distributed Systems",
      syllabus_text: "Study Guide: Midterm_Guide.pdf (4.2MB)",
    });
    const body = call.body as {
      recent_assignments: { title: string; score: number | null }[];
    };
    expect(body.recent_assignments).toHaveLength(
      server.state.assignments.filter((a) => a.course_id === "cs3801").length,
    );
    expect(body.recent_assignments.some((a) => a.score === 12)).toBe(true);
    expect(store.getState().data).toEqual(before);
    expect(store.getState().studyPlans.cs3801).toEqual(plan);
    expect(inference.getState().telemetry).toEqual(plan.inference_telemetry);
    expect(inference.getState().status).toBe("ai");
    expect(store.getState().studying).toEqual({});
  });

  it("inserts without replacing assignment trees, and study blocks can be checked and timed", async () => {
    const { store } = await load();
    const assignments = structuredClone(store.getState().data!.assignments);
    await store.getState().generateStudyTriage();
    await store.getState().insertStudyBlocks("cs3801");
    await store.getState().insertStudyBlocks("cs3801");
    expect(store.getState().data!.assignments).toEqual(assignments);
    expect(store.getState().data!.study_recommendations).toHaveLength(2);
    const node = store.getState().data!.study_recommendations![0];
    store.getState().toggle("study:cs3801", node.id, true);
    await vi.waitFor(() => expect(store.getState().pendingWrites).toBe(0));
    store.getState().logTime("study:cs3801", node.id, 25);
    await vi.waitFor(() => expect(store.getState().pendingWrites).toBe(0));
    await store.getState().refresh();
    expect(store.getState().data!.study_recommendations![0]).toMatchObject({
      is_completed: true,
      actual_minutes: 25,
    });
    expect(store.getState().queuedEdits).toBe(0);
  });

  it("supports a course without assignments and keeps that selection after insertion and refresh", async () => {
    const { store, activeCourseOf } = await load();
    store.getState().selectCourse("empty");
    expect(store.getState().selectedId).toBeNull();
    await store.getState().generateStudyTriage();
    expect(server.calls.at(-1)!.body).toMatchObject({
      course_id: "empty",
      recent_assignments: [],
    });
    await store.getState().insertStudyBlocks("empty");
    await store.getState().refresh();
    expect(activeCourseOf(store.getState())?.id).toBe("empty");
    expect(store.getState().data!.study_recommendations![0].course_id).toBe(
      "empty",
    );
  });

  it("prevents double scans and scopes a late response to its original course", async () => {
    const { store, inference, activeCourseOf } = await load();
    let release!: () => void;
    server.scanGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = store.getState().generateStudyTriage();
    expect(inference.getState().status).toBe("running");
    await store.getState().generateStudyTriage();
    store.getState().selectCourse("empty");
    release();
    await running;
    expect(
      server.calls.filter((c) => c.path === "/api/v1/triage/study"),
    ).toHaveLength(1);
    expect(store.getState().studyPlans.cs3801).toEqual(plan);
    expect(store.getState().studyPlans.empty).toBeUndefined();
    expect(activeCourseOf(store.getState())?.id).toBe("empty");
  });

  it("discards responses when switching datasets and never contacts the backend from a pinned desk", async () => {
    const { store } = await load();
    let release!: () => void;
    server.scanGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = store.getState().generateStudyTriage();
    await store.getState().toggleSimulation();
    release();
    await running;
    expect(store.getState().studyPlans).toEqual({});
    const calls = server.calls.length;
    await store.getState().generateStudyTriage("cs3801");
    expect(server.calls).toHaveLength(calls);
    expect(store.getState().studyErrors.cs3801).toContain(
      "Connect to the backend",
    );
  });

  it("shows failures without mutating trees and clears the busy state", async () => {
    const { store, inference } = await load();
    const before = store.getState().data;
    server.failScan = true;
    await store.getState().generateStudyTriage();
    expect(store.getState().data).toBe(before);
    expect(store.getState().studyErrors.cs3801).toContain(
      "Study triage failed",
    );
    expect(store.getState().studying).toEqual({});
    expect(inference.getState().status).toBe("unavailable");
    expect(inference.getState().telemetry).toBeNull();
  });

  it("retains a preview for retry when insertion fails", async () => {
    const { store } = await load();
    await store.getState().generateStudyTriage();
    server.failInsert = true;
    await store.getState().insertStudyBlocks("cs3801");
    expect(store.getState().studyPlans.cs3801).toEqual(plan);
    expect(store.getState().data!.study_recommendations).toEqual([]);
    expect(store.getState().studyErrors.cs3801).toContain("Could not insert");
    expect(store.getState().pendingWrites).toBe(0);
    server.failInsert = false;
    await store.getState().insertStudyBlocks("cs3801");
    expect(store.getState().data!.study_recommendations).toHaveLength(2);
  });

  it("rejects non-atomic model blocks before publishing telemetry or a preview", async () => {
    const { store, inference } = await load();
    server.response.recommended_blocks[0].estimated_minutes = 90 as 25;
    await store.getState().generateStudyTriage();
    expect(store.getState().studyPlans.cs3801).toBeUndefined();
    expect(inference.getState().status).toBe("unavailable");
  });

  it("labels a backend fallback as local with no fabricated throughput", async () => {
    const { store, inference } = await load();
    server.response.source = "local";
    server.response.inference_telemetry = {
      ...plan.inference_telemetry,
      model_used: "local-starter-plan",
      tokens_per_sec: null,
      prompt_tokens: null,
      completion_tokens: null,
    };
    await store.getState().generateStudyTriage();
    expect(inference.getState().status).toBe("local");
    expect(inference.getState().telemetry!.tokens_per_sec).toBeNull();
  });
});

it("offers study windows and imminent exams without treating ordinary urgent work as an exam", () => {
  const now = Date.now();
  const state = createMockState(now);
  expect(studyOpportunity([], "empty", now)).toContain("study window");
  const assignment = {
    ...state.assignments[0],
    status: "pending" as const,
    due_at: new Date(now + 86_400_000).toISOString(),
  };
  expect(
    studyOpportunity(
      [{ ...assignment, title: "Problem set" }],
      assignment.course_id,
      now,
    ),
  ).toBeNull();
  expect(
    studyOpportunity(
      [{ ...assignment, title: "Final Exam" }],
      assignment.course_id,
      now,
    ),
  ).toContain("Upcoming exam");
});
