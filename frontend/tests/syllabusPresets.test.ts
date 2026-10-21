import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  api,
  getSyllabusPresets,
  loadSyllabusPreset,
} from "@/lib/api";
import { createMockState } from "@/lib/mockData";
import {
  LOCAL_SYLLABUS_PRESETS,
  mergeSyllabusState,
  presetState,
} from "@/lib/syllabusPresets";
import { SYLLABUS_MIN_CHARS } from "@/lib/syllabus";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const IDS = [
  "mit-6-033",
  "stanford-cs229",
  "harvard-stat110",
  "columbia-bio-c2005",
];

afterEach(() => vi.unstubAllGlobals());

/** Answers every fetch with `body`, or rejects like an unreachable host. */
function backend(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

describe("local syllabus presets", () => {
  it("bundles one sample per university under the backend's IDs", () => {
    expect(LOCAL_SYLLABUS_PRESETS.map((p) => p.id)).toEqual(IDS);
    expect(LOCAL_SYLLABUS_PRESETS.map((p) => p.university)).toEqual([
      "MIT",
      "Stanford",
      "Harvard",
      "Columbia",
    ]);
  });

  it("carries a full syllabus whose grade weights sum to 100%", () => {
    for (const preset of LOCAL_SYLLABUS_PRESETS) {
      expect(preset.syllabus_text!.length).toBeGreaterThanOrEqual(
        SYLLABUS_MIN_CHARS,
      );
      expect(preset.syllabus_text).toContain(preset.course_code);
      const total = preset.deliverables!.reduce((sum, d) => sum + d.weight, 0);
      expect(total).toBe(100);
    }
  });

  it("builds a local-only course book with future due dates", () => {
    const preset = LOCAL_SYLLABUS_PRESETS[1];
    const state = presetState(preset, NOW);
    expect(state.courses).toHaveLength(1);
    const [course] = state.courses;
    expect(course).toMatchObject({
      id: "local-preset:stanford-cs229",
      course_code: "CS229",
      current_score: null,
      portfolio_margin: null,
    });
    expect(state.assignments).toHaveLength(preset.deliverables!.length);
    for (const assignment of state.assignments) {
      expect(assignment.course_id).toBe(course.id);
      expect(assignment.id.startsWith(`${course.id}:`)).toBe(true);
      expect(Date.parse(assignment.due_at!)).toBeGreaterThan(NOW);
    }
    expect(new Set(state.assignments.map((a) => a.id)).size).toBe(
      state.assignments.length,
    );
  });

  it("merges a course into an existing book and replaces it on reload", () => {
    const base = createMockState(NOW);
    const sample = presetState(LOCAL_SYLLABUS_PRESETS[0], NOW);
    const once = mergeSyllabusState(base, sample);
    expect(once.courses).toHaveLength(base.courses.length + 1);
    expect(once.assignments).toHaveLength(
      base.assignments.length + sample.assignments.length,
    );
    const twice = mergeSyllabusState(once, sample);
    expect(twice.courses).toHaveLength(once.courses.length);
    expect(twice.assignments).toHaveLength(once.assignments.length);
    expect(twice.metrics).toBe(base.metrics);
  });
});

describe("getSyllabusPresets", () => {
  it("reads the backend list and keeps local deliverables for known IDs", async () => {
    const calls = backend([
      {
        id: "mit-6-033",
        university: "MIT",
        course_code: "6.033",
        name: "Computer System Engineering (backend)",
        term: "Spring",
        description: "From the API",
      },
      { id: "broken", university: "Yale", course_code: "X" },
    ]);
    const presets = await getSyllabusPresets();
    expect(calls[0].url).toMatch(/\/api\/v1\/syllabus\/presets$/);
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe("Computer System Engineering (backend)");
    expect(presets[0].deliverables?.length).toBeGreaterThan(0);
  });

  it("accepts a { presets } envelope", async () => {
    backend({
      presets: [
        { id: "harvard-stat110", university: "Harvard", course_code: "STAT 110" },
      ],
    });
    expect((await api.syllabusPresets()).map((p) => p.id)).toEqual([
      "harvard-stat110",
    ]);
  });

  it("falls back to the bundled presets when the backend is down or empty", async () => {
    backend(new TypeError("fetch failed"));
    expect((await getSyllabusPresets()).map((p) => p.id)).toEqual(IDS);
    backend({ detail: "Not Found" }, 404);
    expect((await getSyllabusPresets()).map((p) => p.id)).toEqual(IDS);
    backend([]);
    expect((await getSyllabusPresets()).map((p) => p.id)).toEqual(IDS);
  });
});

describe("loadSyllabusPreset", () => {
  it("posts to the preset's load route and returns the backend state", async () => {
    const calls = backend(createMockState(NOW));
    const load = await loadSyllabusPreset("columbia-bio-c2005");
    expect(calls[0].url).toMatch(
      /\/api\/v1\/syllabus\/presets\/columbia-bio-c2005\/load$/,
    );
    expect(calls[0].init.method).toBe("POST");
    expect(load.source).toBe("backend");
    expect(load.preset?.university).toBe("Columbia");
    expect(load.state.courses.length).toBeGreaterThan(0);
  });

  it("encodes the ID into the path", async () => {
    const calls = backend(createMockState(NOW));
    await api.loadSyllabusPreset("a/b c");
    expect(calls[0].url).toMatch(/\/presets\/a%2Fb%20c\/load$/);
  });

  it("builds the course locally when the backend is unreachable", async () => {
    backend(new TypeError("fetch failed"));
    const load = await loadSyllabusPreset("harvard-stat110");
    expect(load.source).toBe("local");
    if (load.source !== "local") return;
    expect(load.cause).toBeInstanceOf(ApiError);
    expect(load.cause.kind).toBe("network");
    expect(load.state.courses[0].course_code).toBe("STAT 110");
    expect(load.state.assignments.map((a) => a.title)).toContain("Final Exam");
  });

  it("falls back locally on an HTTP failure or a non-state answer", async () => {
    backend({ detail: "Not Found" }, 404);
    const missing = await loadSyllabusPreset("mit-6-033");
    expect(missing).toMatchObject({
      source: "local",
      cause: { kind: "http", status: 404 },
    });
    backend({ ok: true });
    expect(await loadSyllabusPreset("mit-6-033")).toMatchObject({
      source: "local",
      cause: { kind: "parse" },
    });
  });

  it("rejects an unknown preset the backend cannot load", async () => {
    backend({ detail: "Unknown preset" }, 404);
    await expect(loadSyllabusPreset("nope")).rejects.toMatchObject({
      kind: "http",
      status: 404,
    });
  });
});

describe("hydrateLocalSyllabus", () => {
  beforeEach(() => {
    const memory = () => {
      const items = new Map<string, string>();
      return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      };
    };
    vi.stubGlobal("window", {
      localStorage: memory(),
      sessionStorage: memory(),
    });
  });

  it("puts the sample on the book, focuses it, and logs a notification", async () => {
    vi.resetModules();
    const { useTerminal } = await import("@/store/terminal");
    const sample = presetState(LOCAL_SYLLABUS_PRESETS[0], Date.now());

    useTerminal.getState().hydrateLocalSyllabus(sample, "backend unavailable");
    const state = useTerminal.getState();
    expect(state.data!.courses.map((c) => c.course_code)).toContain("6.033");
    expect(state.activeCourseId).toBe("local-preset:mit-6-033");
    expect(state.selectedId).toBe(sample.assignments[0].id);
    expect(state.events[0]).toMatchObject({ level: "ok" });
    expect(state.events[0].text).toMatch(
      /SAMPLE SYLLABUS LOADED LOCALLY · 6\.033 added/,
    );

    const courses = state.data!.courses.length;
    useTerminal.getState().hydrateLocalSyllabus(sample, "backend unavailable");
    expect(useTerminal.getState().data!.courses).toHaveLength(courses);
    expect(useTerminal.getState().events[0].text).toMatch(/6\.033 refreshed/);
  });
});
