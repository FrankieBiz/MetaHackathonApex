import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BreakerAlarm,
  CircuitBreakerBanner,
  HaltBadge,
} from "@/components/CircuitBreaker";
import { useNegotiator } from "@/components/NegotiationModal";
import { api, ApiError } from "@/lib/api";
import {
  BREAKER_LEVELS,
  LEVEL_STYLE,
  evaluateCircuitBreaker,
  haltIndex,
  type CircuitBreakerStatus,
} from "@/lib/circuitBreaker";
import { HOUR } from "@/lib/engine";
import { createMockState } from "@/lib/mockData";
import {
  LOCAL_NEGOTIATION_MODEL,
  PETITION_LABEL,
  PETITION_TYPES,
  STUDENT_REASON_LIMIT,
  addToReason,
  isEmail,
  localNegotiationPetition,
  mailtoUrl,
  negotiationCase,
  normalizeReason,
  pitchText,
  spokenSeconds,
  type NegotiationPetition,
} from "@/lib/negotiation";
import type { Assignment, Course, SubTaskNode } from "@/types";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function course(
  id = "critical",
  score: number | null = 80,
  target = 90,
  overrides: Partial<Course> = {},
): Course {
  return {
    id,
    course_code: id.toUpperCase(),
    name: `Course ${id}`,
    current_score: score,
    target_score: target,
    portfolio_margin: score === null ? null : score - target,
    grade_history: [],
    ...overrides,
  };
}

function assignment(
  id = "a",
  courseId = "critical",
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    id,
    course_id: courseId,
    course_code: courseId.toUpperCase(),
    title: `Assignment ${id}`,
    due_at: null,
    points_possible: 100,
    weight: 20,
    description: null,
    status: "pending",
    graded: false,
    score: null,
    priority_score: 0,
    subtasks: [],
    ...overrides,
  };
}

function leaf(
  id: string,
  assignmentId: string,
  overrides: Partial<SubTaskNode> = {},
): SubTaskNode {
  return {
    id,
    assignment_id: assignmentId,
    parent_id: null,
    title: `Task ${id}`,
    estimated_minutes: 40,
    actual_minutes: 0,
    is_completed: false,
    is_study_recommendation: false,
    children: [],
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ------------------------------------------------------------ circuit breaker

describe("evaluateCircuitBreaker mirrors backend evaluate_circuit_breaker", () => {
  // The backend's own threshold table, case for case.
  it.each<[string, Course[], string]>([
    ["empty book", [], "NORMAL"],
    ["ungraded", [course("critical", null)], "NORMAL"],
    ["above target", [course("critical", 95)], "NORMAL"],
    ["at target", [course("critical", 90)], "NORMAL"],
    ["exactly five under", [course("critical", 85)], "NORMAL"],
    ["just over five under", [course("critical", 84.999)], "LEVEL_1_CAUTION"],
    ["at 65", [course("critical", 65, 70)], "NORMAL"],
    ["under 65", [course("critical", 64.999, 70)], "LEVEL_2_RESTRICTION"],
    ["at 55", [course("critical", 55, 60)], "LEVEL_2_RESTRICTION"],
    ["under 55", [course("critical", 54.999, 60)], "LEVEL_3_HALT"],
    ["mean deficit 20", [course("critical", 70)], "LEVEL_3_HALT"],
    ["mean deficit under 20", [course("critical", 70.001)], "LEVEL_1_CAUTION"],
    [
      "two breaches",
      [course("critical", 89), course("two", 89)],
      "LEVEL_2_RESTRICTION",
    ],
    [
      "one deep breach",
      [course("critical", 80), course("two", 100)],
      "LEVEL_1_CAUTION",
    ],
    [
      "halt outranks a healthy course",
      [course("critical", 54), course("two", 150)],
      "LEVEL_3_HALT",
    ],
    ["halt with a zero target", [course("critical", 54, 0)], "LEVEL_3_HALT"],
  ])("%s → %s", (_, courses, level) => {
    const status = evaluateCircuitBreaker({ courses, assignments: [] });
    expect(status.level).toBe(level);
    expect(status.triggered).toBe(level !== "NORMAL");
    expect(status.reallocated_minutes).toBe(0);
  });

  it("restricts, keeps unknown grades protected, and counts only remaining leaves", () => {
    const parent: SubTaskNode = {
      ...leaf("parent", "elective", { estimated_minutes: 200 }),
      children: [
        leaf("leaf", "elective", { actual_minutes: 10 }),
        leaf("completed", "elective", { is_completed: true, actual_minutes: 10 }),
        leaf("overrun", "elective", { actual_minutes: 60 }),
      ],
    };
    const state = {
      courses: [
        course("critical", 64),
        course("healthy", 95),
        course("unknown", null),
      ],
      assignments: [
        assignment(),
        assignment("elective", "healthy", { subtasks: [parent] }),
        assignment("unknown", "unknown"),
        assignment("graded", "healthy", {
          graded: true,
          subtasks: [leaf("g", "graded")],
        }),
        assignment("submitted", "healthy", {
          status: "completed",
          subtasks: [leaf("s", "submitted")],
        }),
      ],
    };
    const before = structuredClone(state);
    const status = evaluateCircuitBreaker(state);
    expect(status.level).toBe("LEVEL_2_RESTRICTION");
    expect(status.halted_course_ids).toEqual(["healthy"]);
    expect(status.protected_assignment_ids).toEqual(["a", "unknown"]);
    expect(status.reallocated_minutes).toBe(30);
    expect(
      status.recommendations.some((r) => r.includes("missing course grades")),
    ).toBe(true);
    expect(state).toEqual(before);
    expect(evaluateCircuitBreaker(state)).toEqual(status);
  });

  it("cautions on zero-weight work without halting or reallocating", () => {
    const status = evaluateCircuitBreaker({
      courses: [course()],
      assignments: [assignment(), assignment("optional", "critical", { weight: 0 })],
    });
    expect(status.level).toBe("LEVEL_1_CAUTION");
    expect(status.protected_assignment_ids).toEqual(["a"]);
    expect(status.halted_course_ids).toEqual([]);
    expect(status.reallocated_minutes).toBe(0);
    expect(status.recommendations).toEqual([
      "Protect required rubric criteria in below-target courses first.",
      "Review low-yield subtasks for optional: Assignment optional; zero recorded weight may mean the grade weight is unknown.",
    ]);
  });

  it("defers zero-weight work at HALT without halting the protected course", () => {
    const status = evaluateCircuitBreaker({
      courses: [course("critical", 50)],
      assignments: [
        assignment(),
        assignment("optional", "critical", {
          weight: 0,
          subtasks: [leaf("x", "optional", { estimated_minutes: 25 })],
        }),
      ],
    });
    expect(status.level).toBe("LEVEL_3_HALT");
    expect(status.halted_course_ids).toEqual([]);
    expect(status.protected_assignment_ids).toEqual(["a"]);
    expect(status.reallocated_minutes).toBe(25);
    expect(status.recommendations.at(-1)).toBe(
      "Discuss a recovery plan with the instructor or academic adviser.",
    );
  });

  it("frees no time without a protected destination", () => {
    const status = evaluateCircuitBreaker({
      courses: [course("critical", 60), course("healthy", 95)],
      assignments: [assignment("b", "healthy")],
    });
    expect(status.level).toBe("LEVEL_2_RESTRICTION");
    expect(status.halted_course_ids).toEqual([]);
    expect(status.reallocated_minutes).toBe(0);
  });

  it("reads the simulation desk exactly as the backend reads its mock dataset", () => {
    // Captured from backend evaluate_circuit_breaker over build_mock_dataset.
    expect(evaluateCircuitBreaker(createMockState(NOW))).toEqual({
      level: "LEVEL_2_RESTRICTION",
      triggered: true,
      halted_course_ids: ["cs3801", "eng2001"],
      protected_assignment_ids: [
        "fin3100-factor",
        "fin3100-quiz",
        "fin3100-var",
        "math4102-exam",
        "math4102-hw7",
        "math4102-queue",
      ],
      reallocated_minutes: 620,
      reason: "Multiple courses are below target or a course is below 65%.",
      recommendations: [
        "Protect required rubric criteria in below-target courses first.",
        "Temporarily defer non-critical work and propose moving 620 remaining study minutes to protected assignments; confirm course requirements first.",
      ],
    });
  });
});

describe("haltIndex", () => {
  const status: CircuitBreakerStatus = {
    level: "LEVEL_2_RESTRICTION",
    triggered: true,
    halted_course_ids: ["healthy"],
    protected_assignment_ids: ["a"],
    reallocated_minutes: 0,
    reason: "r",
    recommendations: [],
  };

  it("marks open work paused in halted courses and named protected work", () => {
    const index = haltIndex(
      [
        assignment(),
        assignment("b", "healthy"),
        assignment("done", "healthy", { status: "completed" }),
        assignment("scored", "healthy", { graded: true }),
        assignment("other", "elsewhere"),
      ],
      status,
    );
    expect([...index]).toEqual([
      ["a", "protected"],
      ["b", "halted"],
    ]);
  });

  it("marks nothing at NORMAL", () => {
    expect(
      haltIndex([assignment()], {
        ...status,
        level: "NORMAL",
        triggered: false,
      }).size,
    ).toBe(0);
  });

  it("ranks every level", () => {
    expect(BREAKER_LEVELS.map((level) => LEVEL_STYLE[level].rank)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(LEVEL_STYLE.LEVEL_3_HALT.label).toBe("LEVEL 3 · HALT");
  });
});

describe("api.circuitBreaker", () => {
  const book = {
    courses: [course("critical", 64), course("healthy", 95)],
    assignments: [assignment(), assignment("b", "healthy")],
  };
  const sent: CircuitBreakerStatus = {
    level: "LEVEL_2_RESTRICTION",
    triggered: true,
    halted_course_ids: ["healthy"],
    protected_assignment_ids: ["a"],
    reallocated_minutes: 30,
    reason: "Multiple courses are below target or a course is below 65%.",
    recommendations: ["Protect required rubric criteria in below-target courses first."],
  };

  it("evaluates locally offline without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const run = await api.circuitBreaker(book, { offline: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(run.source).toBe("local");
    expect(run.status.level).toBe("LEVEL_2_RESTRICTION");
  });

  it("posts to the breaker endpoint and reads the status", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      return json({ ...sent, halted_course_ids: ["healthy"], reallocated_minutes: 30 });
    });
    const run = await api.circuitBreaker(book);
    expect(calls).toEqual(["POST /api/v1/portfolio/circuit-breaker"]);
    expect(run).toEqual({ source: "backend", status: sent });
  });

  it("falls back on a malformed, inconsistent, or failing answer", async () => {
    vi.stubGlobal("fetch", async () => json({ ...sent, level: "LEVEL_9" }));
    const malformed = await api.circuitBreaker(book);
    expect(malformed.source === "local" && malformed.cause.kind).toBe("parse");

    vi.stubGlobal("fetch", async () => json({ ...sent, triggered: false }));
    const inconsistent = await api.circuitBreaker(book);
    expect(inconsistent.source === "local" && inconsistent.cause.message).toBe(
      "Breaker level and trigger disagree",
    );

    vi.stubGlobal("fetch", async () => json({}, 503));
    const failing = await api.circuitBreaker(book);
    expect(failing.source === "local" && failing.cause.status).toBe(503);
    expect(failing.status.halted_course_ids).toEqual(["healthy"]);
  });

  it("tolerates missing recommendations", async () => {
    vi.stubGlobal("fetch", async () =>
      json({ ...sent, recommendations: "not a list" }),
    );
    const run = await api.circuitBreaker(book);
    expect(run.source).toBe("backend");
    expect(run.status.recommendations).toEqual([]);
  });
});

describe("circuit breaker banner and badges", () => {
  const status: CircuitBreakerStatus = {
    level: "LEVEL_2_RESTRICTION",
    triggered: true,
    halted_course_ids: ["healthy"],
    protected_assignment_ids: ["a", "b"],
    reallocated_minutes: 395,
    reason: "Multiple courses are below target or a course is below 65%.",
    recommendations: ["Protect required rubric criteria in below-target courses first."],
  };
  const codes = new Map([["healthy", "ENG 2001"]]);
  const render = (props: Parameters<typeof CircuitBreakerBanner>[0]) =>
    renderToStaticMarkup(createElement(CircuitBreakerBanner, props));

  it("names the level, reason, halted courses, protected count, and time to move", () => {
    const html = render({ status, source: "local", codes, onNegotiate: () => {} });
    expect(html).toContain('aria-label="Circuit breaker"');
    expect(html).toContain("LEVEL 2 · RESTRICTION");
    expect(html).toContain(status.reason);
    expect(html).toContain("ENG 2001");
    expect(html).toContain("6h 35m");
    expect(html).toContain("PLAN 1");
    expect(html).toContain("☎ NEGOTIATE");
    expect(html).toContain("Local mirror");
    expect(html).toContain("halt-pulse");
  });

  it("drops the negotiate key without a protected deliverable, and credits the backend", () => {
    const html = render({ status, source: "backend", codes });
    expect(html).not.toContain("NEGOTIATE");
    expect(html).toContain("Backend");
  });

  it("does not pulse at caution and renders nothing at NORMAL", () => {
    expect(
      render({ status: { ...status, level: "LEVEL_1_CAUTION" }, source: "local", codes }),
    ).not.toContain("halt-pulse");
    expect(
      render({
        status: { ...status, level: "NORMAL", triggered: false },
        source: "local",
        codes,
      }),
    ).toBe("");
  });

  it("badges halted and protected deliverables with their reasons", () => {
    const halted = renderToStaticMarkup(
      createElement(HaltBadge, {
        state: "halted",
        level: "LEVEL_2_RESTRICTION",
        courseCode: "ENG 2001",
      }),
    );
    expect(halted).toContain("HALTED");
    expect(halted).toContain("ENG 2001 is at or above target");
    const guarded = renderToStaticMarkup(
      createElement(HaltBadge, {
        state: "protected",
        level: "LEVEL_3_HALT",
        courseCode: "MATH 4102",
      }),
    );
    expect(guarded).toContain("PROTECTED");
    expect(guarded).toContain("LEVEL 3 · HALT");
  });

  it("keeps the top bar alarm quiet before a book loads", () => {
    expect(renderToStaticMarkup(createElement(BreakerAlarm))).toBe("");
  });
});

// ---------------------------------------------------------------- negotiator

describe("local petition mirrors backend _local_negotiation_draft", () => {
  const item = {
    id: "a",
    course_code: "CS 101",
    title: "Project\r\nBcc: someone@example.org",
  };

  it("drafts the backend's extension template word for word", () => {
    const petition = localNegotiationPetition(item, {
      petition_type: "extension",
      student_reason: "  Work conflict  ",
    });
    // Captured from backend _local_negotiation_draft with the same input.
    expect(petition).toMatchObject({
      assignment_id: "a",
      petition_type: "extension",
      instructor_name: "Instructor",
      email_subject: "Extension request: CS 101 — Project Bcc: someone@example.org",
      email_body:
        "Dear Instructor,\n\nI am writing about Project\r\nBcc: someone@example.org in CS 101.\n\n" +
        "My reason for requesting this discussion: Work conflict\n\n" +
        "Could we discuss whether an extension is possible and, if so, agree on a new deadline? " +
        "I understand that approval depends on the course policy.\n\n" +
        "I have not verified an applicable syllabus policy; please confirm the relevant policy " +
        "and available options.\n\nThank you for your time.",
      office_hours_pitch_60s: [
        "Thank you for meeting with me about Project\r\nBcc: someone@example.org.",
        "Could we discuss whether an extension is possible and, if so, agree on a new deadline? " +
          "I understand that approval depends on the course policy.",
        "Please help me confirm the applicable policy and agree on a concrete next step.",
      ],
      syllabus_clauses_cited: [],
      source: "local",
    });
    expect(petition.email_subject).not.toMatch(/[\r\n]/);
    expect(petition.telemetry).toMatchObject({
      model_used: LOCAL_NEGOTIATION_MODEL,
      prompt_tokens: null,
      completion_tokens: null,
      tokens_per_sec: null,
    });
    expect(petition.telemetry.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ["regrade", "Rubric review request", "rubric"],
    ["office_hours_script", "Office hours discussion", "office hours"],
  ] as const)("fits a %s petition without asking for an extension", (type, subject, phrase) => {
    const petition = localNegotiationPetition(
      { id: "a", course_code: "C", title: "Lab" },
      { petition_type: type, student_reason: null },
    );
    expect(petition.email_subject).toBe(`${subject}: C — Lab`);
    expect(petition.email_body).not.toContain("extension");
    expect(petition.email_body).not.toContain("My reason");
    expect(petition.email_body).toContain(phrase);
  });

  it("bounds the subject at 500 characters", () => {
    const petition = localNegotiationPetition(
      { id: "a", course_code: "C", title: "x".repeat(800) },
      { petition_type: "extension", student_reason: null },
    );
    expect(petition.email_subject).toHaveLength(500);
  });

  it("normalizes the reason as the backend validates it", () => {
    expect(normalizeReason("   ")).toBeNull();
    expect(normalizeReason(undefined)).toBeNull();
    expect(normalizeReason("  late shift  ")).toBe("late shift");
    expect(normalizeReason("y".repeat(5000))).toHaveLength(STUDENT_REASON_LIMIT);
  });

  it("labels every petition type", () => {
    expect(PETITION_TYPES.map((t) => PETITION_LABEL[t].label)).toEqual([
      "EXTENSION REQUEST",
      "REGRADE PETITION",
      "OFFICE HOURS PITCH",
    ]);
  });
});

describe("api.negotiatePetition", () => {
  const book = { assignments: [assignment()] };
  const petition = (overrides: Partial<NegotiationPetition> = {}) => ({
    assignment_id: "a",
    petition_type: "regrade",
    instructor_name: "Ada Example",
    email_subject: "Rubric review: A",
    email_body: "Dear Professor Example, …",
    office_hours_pitch_60s: ["Thanks for meeting.", "Could we review criterion 2?"],
    syllabus_clauses_cited: ["Regrade requests within 7 days."],
    source: "ai",
    telemetry: {
      model_used: "muse-spark-1.3",
      latency_ms: 812,
      prompt_tokens: 60,
      completion_tokens: 30,
      tokens_per_sec: 36.9,
    },
    ...overrides,
  });

  it("drafts locally offline without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const run = await api.negotiatePetition("a", "extension", "  bus strike ", book, {
      offline: true,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(run.source).toBe("local");
    expect(run.petition.email_body).toContain(
      "My reason for requesting this discussion: bus strike",
    );
  });

  it("posts the petition type and a trimmed reason, and reads the draft", async () => {
    const calls: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({
        path: `${init.method} ${new URL(url).pathname}`,
        body: JSON.parse(String(init.body)),
      });
      return json(petition());
    });
    const run = await api.negotiatePetition("a", "regrade", "  rubric line 2 ", book);
    expect(calls).toEqual([
      {
        path: "POST /api/v1/triage/a/negotiate",
        body: { petition_type: "regrade", student_reason: "rubric line 2" },
      },
    ]);
    expect(run).toEqual({ source: "backend", petition: petition() });
  });

  it("sends a blank reason as null, which the backend accepts", async () => {
    let body: unknown;
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return json(petition({ petition_type: "office_hours_script" }));
    });
    await api.negotiatePetition("a", "office_hours_script", "   ", book);
    expect(body).toEqual({ petition_type: "office_hours_script", student_reason: null });
  });

  it.each([
    ["a different deliverable", { assignment_id: "b" }, "Petition drafted for a different deliverable"],
    ["a different request", { petition_type: "extension" as const }, "Petition drafted for a different request"],
  ])("rejects a draft for %s", async (_, overrides, message) => {
    vi.stubGlobal("fetch", async () => json(petition(overrides)));
    const run = await api.negotiatePetition("a", "regrade", null, book);
    expect(run.source === "local" && run.cause.message).toBe(message);
    expect(run.petition.petition_type).toBe("regrade");
  });

  it("falls back on a malformed or failing answer", async () => {
    vi.stubGlobal("fetch", async () =>
      json(petition({ office_hours_pitch_60s: [] })),
    );
    const malformed = await api.negotiatePetition("a", "regrade", null, book);
    expect(malformed.source === "local" && malformed.cause.kind).toBe("parse");

    vi.stubGlobal("fetch", async () => json({ detail: "boom" }, 500));
    const failing = await api.negotiatePetition("a", "regrade", null, book);
    expect(failing.source === "local" && failing.cause.message).toBe(
      "HTTP 500: boom",
    );
    expect(failing.petition.telemetry.model_used).toBe(LOCAL_NEGOTIATION_MODEL);
  });

  it("rejects only an id the book does not hold", async () => {
    vi.stubGlobal("fetch", async () => json({}, 404));
    await expect(
      api.negotiatePetition("ghost", "regrade", null, book),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("negotiationCase", () => {
  const facts = (c: ReturnType<typeof negotiationCase>) =>
    Object.fromEntries(c.facts.map((f) => [f.id, f]));

  it("asks for a regrade on scored work", () => {
    const scored = assignment("a", "critical", {
      graded: true,
      score: 61,
      status: "completed",
      due_at: at(-48),
    });
    const result = negotiationCase(
      scored,
      { courses: [course()], assignments: [scored] },
      NOW,
    );
    expect(result.recommended).toBe("regrade");
    expect(facts(result).floor.detail).toBe("61 / 100 pts · 20.0% of the grade");
    expect(facts(result).deadline.detail).toMatch(/submitted$/);
  });

  it("asks for an extension on past-due work", () => {
    const late = assignment("a", "critical", { due_at: at(-5) });
    const result = negotiationCase(late, { courses: [course()], assignments: [late] }, NOW);
    expect(result.recommended).toBe("extension");
    expect(result.rationale).toMatch(/^Past due/);
    expect(facts(result).deadline).toMatchObject({ tone: "down" });
    expect(facts(result).deadline.detail).toMatch(/5h ago$/);
  });

  it("asks for an extension inside a cross-course pile-up, with a sentence to cite it", () => {
    const own = assignment("a", "critical", { due_at: at(10) });
    const state = {
      courses: [course(), course("two", 95), course("three", 95)],
      assignments: [
        own,
        assignment("b", "two", { due_at: at(20) }),
        assignment("c", "three", { due_at: at(30) }),
      ],
    };
    const result = negotiationCase(own, state, NOW);
    expect(result.recommended).toBe("extension");
    expect(result.rationale).toMatch(/pile-up/);
    const congestion = facts(result).congestion;
    expect(congestion.detail).toMatch(/^3 deliverables across CRITICAL, THREE, TWO due /);
    expect(congestion.reason).toMatch(
      /^This deadline falls in a 72-hour window with 2 other deliverables across THREE, TWO \(/,
    );
  });

  it("asks for an extension when open work outruns half the clock", () => {
    const crunch = assignment("a", "critical", {
      due_at: at(4),
      subtasks: [
        leaf("x", "a", { estimated_minutes: 90 }),
        leaf("y", "a", { estimated_minutes: 90 }),
      ],
    });
    const result = negotiationCase(
      crunch,
      { courses: [course()], assignments: [crunch] },
      NOW,
    );
    expect(result.recommended).toBe("extension");
    expect(result.rationale).toMatch(/half the clock/);
    expect(facts(result).workload).toMatchObject({
      detail: "3h 00m planned before this deadline · 4h left (75% of the clock)",
      tone: "down",
      reason:
        "I have about 3h 00m of planned coursework due before this deadline, with 4 hours remaining.",
    });
  });

  it("defaults to an office hours conversation and cites real progress", () => {
    const calm = assignment("a", "critical", {
      due_at: at(200),
      subtasks: [
        leaf("x", "a", { is_completed: true, actual_minutes: 50 }),
        leaf("y", "a"),
      ],
    });
    const result = negotiationCase(
      calm,
      { courses: [course("critical", 95)], assignments: [calm] },
      NOW,
    );
    expect(result.recommended).toBe("office_hours_script");
    const { standing, progress, deadline } = facts(result);
    expect(standing).toMatchObject({ tone: "up", reason: null });
    expect(standing.detail).toBe("CRITICAL 95.0% vs 90.0% target (+5.0)");
    expect(progress.reason).toBe(
      "I have completed 1 of 2 planned steps and logged 50m on it so far.",
    );
    expect(deadline.detail).toMatch(/in 8d 8h$/);
  });

  it("offers nothing to cite before the work is broken down", () => {
    const bare = assignment("a", "critical");
    const result = negotiationCase(
      bare,
      { courses: [course("critical", null)], assignments: [bare] },
      NOW,
    );
    const found = facts(result);
    expect(found.standing.detail).toBe("CRITICAL · no course grade posted yet");
    expect(found.deadline.detail).toBe("No due date published");
    expect(found.progress.reason).toBeNull();
    expect(found.workload).toBeUndefined();
    expect(result.facts.every((f) => f.reason === null)).toBe(true);
  });

  it("reports the breaker's mark on the deliverable", () => {
    const state = {
      courses: [course("critical", 85), course("other", 86), course("healthy", 95)],
      assignments: [
        assignment("a", "critical", { due_at: at(100) }),
        assignment("b", "healthy", { due_at: at(300) }),
      ],
    };
    const breaker = evaluateCircuitBreaker(state);
    const guarded = facts(negotiationCase(state.assignments[0], state, NOW, breaker));
    expect(guarded.breaker).toMatchObject({
      detail: "Protected · LEVEL 2 · RESTRICTION",
      reason: "My grade in CRITICAL is below my target, so this assignment is my priority.",
    });
    const paused = facts(negotiationCase(state.assignments[1], state, NOW, breaker));
    expect(paused.breaker).toMatchObject({ tone: "accent", reason: null });
    expect(paused.breaker.detail).toMatch(/^Paused · LEVEL 2/);

    const ungraded = {
      courses: [course("u", null), course("x", 80), course("y", 80)],
      assignments: [assignment("q", "u")],
    };
    const blind = facts(
      negotiationCase(ungraded.assignments[0], ungraded, NOW, evaluateCircuitBreaker(ungraded)),
    );
    expect(blind.breaker.reason).toBe(
      "U has no posted grade yet, so I am treating this assignment as a priority.",
    );
  });
});

describe("negotiator helpers", () => {
  it("adds a fact to the reason once, within the bound", () => {
    expect(addToReason("", "One.")).toBe("One.");
    expect(addToReason("One.  ", "Two.")).toBe("One. Two.");
    expect(addToReason("One. Two.", "Two.")).toBe("One. Two.");
    expect(addToReason("z".repeat(STUDENT_REASON_LIMIT), "More.")).toHaveLength(
      STUDENT_REASON_LIMIT,
    );
  });

  it("builds a mailto link the student sends themselves", () => {
    const url = mailtoUrl("Extension\nrequest", "Line one\nLine two", " prof@uni.edu ");
    expect(url).toBe(
      "mailto:prof%40uni.edu?subject=Extension%20request&body=Line%20one%0D%0ALine%20two",
    );
    expect(mailtoUrl("S", "B", "not an address")).toBe("mailto:?subject=S&body=B");
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("a b@c.d")).toBe(false);
  });

  it("times a pitch at speaking pace and numbers its beats", () => {
    expect(spokenSeconds("")).toBe(0);
    expect(spokenSeconds("Hi.")).toBe(1);
    expect(spokenSeconds(Array(150).fill("word").join(" "))).toBe(60);
    expect(pitchText(["Open.", "Ask."])).toBe("1. Open.\n2. Ask.");
  });

  it("opens and closes the negotiator on a deliverable", () => {
    useNegotiator.getState().open("a");
    expect(useNegotiator.getState().assignmentId).toBe("a");
    useNegotiator.getState().close();
    expect(useNegotiator.getState().assignmentId).toBeNull();
  });
});
