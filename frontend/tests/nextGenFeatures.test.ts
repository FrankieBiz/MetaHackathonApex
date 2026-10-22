import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type TriageStreamEvent } from "@/lib/api";
import {
  clusterIndex,
  clusterWindow,
  congestionTier,
  courseClusters,
  detectCongestion,
  varianceInflation,
} from "@/lib/congestion";
import {
  COUNCIL_ROLES,
  LOCAL_COUNCIL_MODEL,
  floorNote,
  localDefenseCouncil,
  rubricConstraints,
} from "@/lib/defenseCouncil";
import { HOUR, reasoningTrace, triageContext } from "@/lib/engine";
import {
  breachCount,
  generateLocalMarginCall,
  marginCallMessage,
  normalizePhone,
  whatsappShareUrl,
} from "@/lib/marginCall";
import { createMockState } from "@/lib/mockData";
import { simulateLocally } from "@/lib/monteCarlo";
import { applyTraceEvent, useTerminal, type AgentTrace } from "@/store/terminal";
import { useCouncil } from "@/store/council";
import type { Assignment, Course, SubTaskNode, TerminalState } from "@/types";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

afterEach(() => vi.unstubAllGlobals());

function course(
  id: string,
  score: number | null = 95,
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
  id: string,
  courseId: string,
  dueInHours: number | null,
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    id,
    course_id: courseId,
    course_code: courseId.toUpperCase(),
    title: `Deliverable ${id}`,
    due_at: dueInHours === null ? null : at(dueInHours),
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

const leaf = (id: string, assignmentId: string, minutes = 30): SubTaskNode => ({
  id,
  assignment_id: assignmentId,
  parent_id: null,
  title: `Task ${id}`,
  estimated_minutes: minutes,
  actual_minutes: 0,
  is_completed: false,
  is_study_recommendation: false,
  children: [],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---------------------------------------------------------------- congestion

describe("detectCongestion mirrors backend detect_deadline_congestion", () => {
  it("needs two courses: one course's own pile-up is not congestion", () => {
    expect(
      detectCongestion(
        [assignment("a", "c1", 10), assignment("b", "c1", 20)],
        NOW,
      ),
    ).toEqual([]);
  });

  it("clusters cross-course deadlines inside 72 hours, sorted and scored", () => {
    const [cluster, ...rest] = detectCongestion(
      [assignment("z", "c2", 30), assignment("a", "c1", 10)],
      NOW,
    );
    expect(rest).toEqual([]);
    expect(cluster).toMatchObject({
      start_at: at(10),
      end_at: at(30),
      course_ids: ["c1", "c2"],
      assignment_ids: ["a", "z"],
      congestion_score: 0.25,
      variance_inflation: 1.25,
    });
  });

  it("includes exactly 72 hours and excludes anything later", () => {
    expect(
      detectCongestion([assignment("a", "c1", 0), assignment("b", "c2", 72)], NOW),
    ).toHaveLength(1);
    expect(
      detectCongestion(
        [assignment("a", "c1", 0), assignment("b", "c2", 72.001)],
        NOW,
      ),
    ).toEqual([]);
  });

  it("ignores settled, past-due, and undated work", () => {
    const book = [
      assignment("open", "c1", 10),
      assignment("done", "c2", 12, { status: "completed" }),
      assignment("graded", "c2", 12, { graded: true }),
      assignment("late", "c2", -1),
      assignment("undated", "c2", null),
    ];
    expect(detectCongestion(book, NOW)).toEqual([]);
  });

  it("keeps maximal windows: overlaps are reported, subsets are skipped", () => {
    const clusters = detectCongestion(
      [
        assignment("a", "c1", 0),
        assignment("b", "c2", 48),
        assignment("c", "c1", 100),
      ],
      NOW,
    );
    expect(clusters.map((c) => c.assignment_ids)).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);

    const nested = detectCongestion(
      [
        assignment("a", "c1", 0),
        assignment("b", "c2", 10),
        assignment("c", "c1", 20),
      ],
      NOW,
    );
    expect(nested).toHaveLength(1);
    expect(nested[0]).toMatchObject({
      assignment_ids: ["a", "b", "c"],
      congestion_score: 0.5,
    });
  });

  it("caps pressure at 1 (variance ×2)", () => {
    const book = Array.from({ length: 7 }, (_, i) =>
      assignment(`a${i}`, `c${i % 2}`, i),
    );
    expect(detectCongestion(book, NOW)[0]).toMatchObject({
      congestion_score: 1,
      variance_inflation: 2,
    });
  });

  it("prices overlapping windows by the worst one, never compounded", () => {
    const clusters = detectCongestion(
      [
        assignment("a", "c1", 0),
        assignment("b", "c2", 48),
        assignment("c", "c1", 100),
        assignment("d", "c2", 101),
      ],
      NOW,
    );
    // [a,b] scores 0.25; [b,c,d] scores 0.5.
    const inflation = varianceInflation(clusters);
    expect(inflation.get("a")).toBe(1.25);
    expect(inflation.get("b")).toBe(1.5);
    expect(clusterIndex(clusters).get("b")?.assignment_ids).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(courseClusters(clusters, "c1").map((c) => c.congestion_score)).toEqual(
      [0.5, 0.25],
    );
    expect(courseClusters(clusters, "c9")).toEqual([]);
  });

  it("names tiers and windows", () => {
    expect(congestionTier(0.25)).toBe("watch");
    expect(congestionTier(0.5)).toBe("elevated");
    expect(congestionTier(0.75)).toBe("critical");
    const [cluster] = detectCongestion(
      [assignment("a", "c1", 1), assignment("b", "c2", 2)],
      NOW,
    );
    expect(clusterWindow(cluster)).toMatch(/^[A-Z]{3} \d{1,2}$/);
    expect(
      clusterWindow({ ...cluster, end_at: at(50) }),
    ).toMatch(/^[A-Z]{3} \d{1,2} – [A-Z]{3} \d{1,2}$/);
  });
});

describe("Monte Carlo prices congestion", () => {
  const book = (otherDue: number): Pick<TerminalState, "courses" | "assignments"> => ({
    courses: [course("c1", 88, 90), course("c2", 92, 90)],
    assignments: [
      assignment("exam", "c1", 24, { weight: 40 }),
      assignment("lab", "c2", otherDue, { weight: 30 }),
    ],
  });

  it("widens the spread of clustered work and reports the matrix", () => {
    const calm = simulateLocally({ course_id: "c1", iterations: 4000 }, book(500), NOW);
    const jammed = simulateLocally({ course_id: "c1", iterations: 4000 }, book(48), NOW);
    expect(calm.congestion_matrix).toEqual([]);
    expect(jammed.congestion_matrix).toHaveLength(1);
    expect(jammed.congestion_matrix![0].variance_inflation).toBe(1.25);
    const width = (r: typeof calm) =>
      r.courses[0].percentiles!.p90 - r.courses[0].percentiles!.p10;
    expect(width(jammed)).toBeGreaterThan(width(calm));
    expect(jammed.courses[0].var_90!).toBeGreaterThan(calm.courses[0].var_90!);
  });

  it("only reports clusters that touch the requested course", () => {
    const state = {
      courses: [course("c1"), course("c2"), course("c3")],
      assignments: [
        assignment("x", "c2", 10),
        assignment("y", "c3", 20),
        assignment("z", "c1", 500),
      ],
    };
    expect(
      simulateLocally({ course_id: "c1", iterations: 100 }, state, NOW)
        .congestion_matrix,
    ).toEqual([]);
    expect(
      simulateLocally({ iterations: 100 }, state, NOW).congestion_matrix,
    ).toHaveLength(1);
  });

  it("reads the backend's congestion_matrix, and drops a malformed one", async () => {
    const state = book(48);
    const base = {
      iterations: 100,
      courses: [
        {
          course_id: "c1",
          target_score: 90,
          percentiles: null,
          var_90: null,
          probability_of_target: null,
          sensitivity_matrix: [],
        },
      ],
    };
    const cluster = {
      id: "6f1c",
      start_at: at(24),
      end_at: at(48),
      course_ids: ["c1", "c2"],
      assignment_ids: ["exam", "lab"],
      congestion_score: 0.25,
      variance_inflation: 1.25,
    };
    vi.stubGlobal("fetch", async () =>
      json({ ...base, congestion_matrix: [cluster] }),
    );
    const sent = await api.simulateMonteCarlo({ course_id: "c1" }, state);
    expect(sent.source).toBe("backend");
    expect(sent.response.congestion_matrix).toEqual([cluster]);

    vi.stubGlobal("fetch", async () =>
      json({ ...base, congestion_matrix: [{ ...cluster, variance_inflation: 9 }] }),
    );
    const malformed = await api.simulateMonteCarlo({ course_id: "c1" }, state);
    expect(malformed.source).toBe("backend");
    expect(malformed.response.congestion_matrix).toBeUndefined();

    vi.stubGlobal("fetch", async () => json(base));
    const older = await api.simulateMonteCarlo({ course_id: "c1" }, state);
    expect(older.source).toBe("backend");
    expect(older.response.congestion_matrix).toBeUndefined();
  });
});

// ------------------------------------------------------------ defense council

const RUBRIC =
  "Build the system. Rubric: Design 30%, Implementation 60% (tests   pass), Report 10%. Late work loses 10%.";

describe("local defense council mirrors backend _local_defense_council", () => {
  const state = (overrides: Partial<Assignment> = {}, score: number | null = 88) => {
    const target = assignment("proj", "c1", 48, {
      weight: 25,
      description: RUBRIC,
      ...overrides,
    });
    const other = assignment("other", "c2", 24, {
      subtasks: [leaf("o1", "other", 45), leaf("o2", "other", 30)],
    });
    return {
      target,
      book: {
        courses: [course("c1", score, 90), course("c2")],
        assignments: [target, other],
      },
    };
  };

  it("formats rubric constraints highest weight first", () => {
    expect(
      rubricConstraints({ description: RUBRIC, points_possible: 100 }),
    ).toEqual([
      "Implementation 60% (60 pts): tests pass",
      "Design 30% (30 pts)",
      "Report 10% (10 pts)",
    ]);
    expect(
      rubricConstraints({ description: "Rubric: Essay 50%", points_possible: 15 }),
    ).toEqual(["Essay 50% (7.5 pts)"]);
    expect(rubricConstraints({ description: null, points_possible: 10 })).toEqual([]);
  });

  it("seats Professor, Student, and Arbitrator in order on computed facts", () => {
    const { target, book } = state();
    const council = localDefenseCouncil(target, book, NOW);
    expect(council.members.map((m) => m.role)).toEqual([...COUNCIL_ROLES]);
    const [professor, student, arbitrator] = council.members;

    expect(professor.position).toBe(
      "Evaluate the stated rubric and require evidence for each criterion.",
    );
    expect(professor.priorities[0]).toBe("Implementation 60% (60 pts): tests pass");

    const context = triageContext(book, target, NOW);
    expect(context.queued).toBe(75);
    expect(student.position).toBe(
      reasoningTrace(target, context, target.subtasks, {
        engine: "x",
        latency_ms: 0,
      })[1].summary,
    );
    expect(student.priorities[0]).toBe(
      "Account for 75 queued minutes before this deadline",
    );

    // Floor at 88 current, 90 target, 25% weight: 88 + 2 × 4 = 96.
    expect(arbitrator.priorities[0]).toBe("The protective score is 96.0%.");
    expect(council.verdict).toBe(
      "Secure the highest-weighted stated rubric criteria first, check each deliverable, then submit within the available capacity. The protective score is 96.0%. ",
    );
    expect(arbitrator.position).toBe(council.verdict);
    expect(council.source).toBe("local");
    expect(council.telemetry).toMatchObject({
      model_used: LOCAL_COUNCIL_MODEL,
      prompt_tokens: null,
      tokens_per_sec: null,
    });
  });

  it("flags an unreachable floor and an unknown one", () => {
    expect(floorNote(120)).toBe(
      "The protective score is 120.0%. It exceeds 100%; this assignment alone cannot restore the target.",
    );
    expect(floorNote(null)).toBe(
      "The protective score is unknown without a posted grade and positive assignment weight.",
    );
    const { target, book } = state({}, null);
    expect(localDefenseCouncil(target, book, NOW).verdict).toContain(
      "unknown without a posted grade",
    );
  });

  it("falls back to reading the brief when the prompt has no rubric", () => {
    const { target, book } = state({ description: "Write it up." });
    expect(localDefenseCouncil(target, book, NOW).members[0].priorities).toEqual([
      "Read the brief and identify the stated deliverables",
    ]);
  });

  it("keeps an existing tree, and plans one when there is none", () => {
    const tree = [leaf("t1", "proj")];
    const { target, book } = state({ subtasks: tree });
    expect(localDefenseCouncil(target, book, NOW).subtasks).toBe(tree);
    const fresh = state();
    const planned = localDefenseCouncil(fresh.target, fresh.book, NOW).subtasks;
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((n) => n.assignment_id === "proj")).toBe(true);
  });
});

describe("api.defenseCouncil", () => {
  const book = {
    courses: [course("c1", 88, 90)],
    assignments: [assignment("proj", "c1", 48, { description: RUBRIC })],
  };
  const deliberation = (overrides: Record<string, unknown> = {}) => ({
    assignment_id: "proj",
    members: COUNCIL_ROLES.map((role) => ({
      role,
      position: `${role} position`,
      priorities: [`${role} priority`],
    })),
    verdict: "Ship the implementation first.",
    subtasks: [leaf("srv-1", "proj", 40)],
    source: "ai",
    telemetry: {
      model_used: "Llama-3.3-70B-Instruct",
      latency_ms: 812.4,
      prompt_tokens: 900,
      completion_tokens: 300,
      tokens_per_sec: 369.3,
    },
    ...overrides,
  });

  it("convenes the local council without touching the network offline", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const run = await api.defenseCouncil("proj", book, { offline: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(run.source).toBe("local");
    expect(run.deliberation.members).toHaveLength(3);
    if (run.source === "local") expect(run.cause.kind).toBe("network");
  });

  it("posts to the council endpoint and reads the deliberation", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      return json(deliberation());
    });
    const run = await api.defenseCouncil("proj", book);
    expect(calls).toEqual(["POST /api/v1/triage/proj/council"]);
    expect(run.source).toBe("backend");
    expect(run.deliberation.verdict).toBe("Ship the implementation first.");
    expect(run.deliberation.telemetry.latency_ms).toBe(812);
    expect(run.deliberation.subtasks.map((n) => n.title)).toEqual(["Task srv-1"]);
  });

  it.each([
    ["seats out of order", { members: [...deliberation().members].reverse() }],
    ["a different deliverable", { assignment_id: "other" }],
    ["a missing verdict", { verdict: "  " }],
  ])("falls back to the local council on %s", async (_, overrides) => {
    vi.stubGlobal("fetch", async () => json(deliberation(overrides)));
    const run = await api.defenseCouncil("proj", book);
    expect(run.source).toBe("local");
    if (run.source === "local") expect(run.cause.kind).toBe("parse");
  });

  it("falls back on an unreachable or failing backend", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const down = await api.defenseCouncil("proj", book);
    expect(down.source === "local" && down.cause.kind).toBe("network");

    vi.stubGlobal("fetch", async () => json({ detail: "boom" }, 500));
    const failing = await api.defenseCouncil("proj", book);
    expect(failing.source === "local" && failing.cause.status).toBe(500);
  });

  it("rejects an id the book does not hold", async () => {
    await expect(
      api.defenseCouncil("ghost", book, { offline: true }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("council turns from the triage stream", () => {
  const empty: AgentTrace = {
    steps: [],
    events: [],
    tokens: "",
    council: [],
    source: null,
    telemetry: null,
  };

  it("folds each seat once, the latest turn winning", () => {
    let trace = applyTraceEvent(empty, {
      type: "council_turn",
      member: { role: "Professor", position: "first", priorities: [] },
    });
    trace = applyTraceEvent(trace, {
      type: "council_turn",
      member: { role: "Student", position: "student", priorities: ["a"] },
    });
    trace = applyTraceEvent(trace, {
      type: "council_turn",
      member: { role: "Professor", position: "revised", priorities: [] },
    });
    expect(trace.council.map((m) => [m.role, m.position])).toEqual([
      ["Student", "student"],
      ["Professor", "revised"],
    ]);
  });

  it("parses council_turn frames and skips malformed ones", async () => {
    const frames = [
      `event: council_turn\ndata: ${JSON.stringify({ role: "Professor", position: "Hold the rubric.", priorities: ["Evidence"], source: "ai" })}\n\n`,
      `event: council_turn\ndata: ${JSON.stringify({ role: "Dean", position: "x" })}\n\n`,
      `event: complete\ndata: ${JSON.stringify({
        subtasks: [leaf("s1", "proj")],
        source: "ai",
        telemetry: {
          model_used: "m",
          latency_ms: 1,
          prompt_tokens: null,
          completion_tokens: null,
          tokens_per_sec: null,
        },
        agent_reasoning_trace: null,
      })}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(frames, { headers: { "content-type": "text/event-stream" } }),
    );
    const events: TriageStreamEvent[] = [];
    await api.streamTriage("proj", (event) => events.push(event));
    expect(events).toEqual([
      {
        type: "council_turn",
        member: {
          role: "Professor",
          position: "Hold the rubric.",
          priorities: ["Evidence"],
        },
      },
    ]);
  });
});

describe("council store", () => {
  it("convenes offline against the book on screen", async () => {
    const data = createMockState(NOW);
    useTerminal.setState({ data, mode: "offline", simulationPinned: false });
    const id = data.assignments[0].id;
    const pending = useCouncil.getState().convene(id);
    expect(useCouncil.getState().convening[id]).toBeTypeOf("number");
    await pending;
    expect(useCouncil.getState().convening[id]).toBeUndefined();
    expect(useCouncil.getState().runs[id]).toMatchObject({ source: "local" });
    useCouncil.getState().setTab("council");
    expect(useCouncil.getState().tab).toBe("council");
  });

  it("ignores an id the book does not hold", async () => {
    useTerminal.setState({ data: createMockState(NOW), mode: "offline" });
    await useCouncil.getState().convene("ghost");
    expect(useCouncil.getState().runs.ghost).toBeUndefined();
  });
});

// --------------------------------------------------------------- margin call

describe("local margin call mirrors backend generate_margin_call", () => {
  it("stays quiet for a book above target", () => {
    const report = generateLocalMarginCall(
      { courses: [course("c1", 96, 90)], assignments: [] },
      NOW,
    );
    expect(report).toMatchObject({
      triggered: false,
      academic_stance: "MAXIMAL_AGGRESSION",
      liquidation_deficit: 0,
      breached_courses: [],
      restoration_order: [],
      webhook_payload: null,
    });
  });

  it("calls a book in critical intervention and orders the restoration", () => {
    const report = generateLocalMarginCall(
      {
        courses: [course("c1", 84, 90), course("c2", 87, 90), course("c3", 99, 90)],
        assignments: [
          assignment("small", "c1", 48, { weight: 10 }),
          assignment("big", "c1", 96, { weight: 30, title: "Final exam" }),
          assignment("tie-late", "c2", 200, { weight: 20 }),
          assignment("tie-soon", "c2", 20, { weight: 20 }),
          assignment("graded", "c1", null, { weight: 20, graded: true }),
          assignment("done", "c2", 10, { status: "completed" }),
          assignment("safe", "c3", 10, { weight: 50 }),
        ],
      },
      NOW,
    );
    expect(report.triggered).toBe(true);
    expect(report.academic_stance).toBe("CRITICAL_INTERVENTION");
    expect(report.breached_courses.map((c) => [c.course_code, c.deficit])).toEqual([
      ["C1", 6],
      ["C2", 3],
    ]);
    expect(report.restoration_order.map((a) => a.assignment_id)).toEqual([
      "big",
      "small",
      "tie-soon",
      "tie-late",
    ]);
    const [big] = report.restoration_order;
    // c1's open weight is 40, so the denominator is 100: impact 0.3.
    expect(big.marginal_impact).toBeCloseTo(0.3);
    // 84 − (84 − 90) × 100 / 30 = 104.
    expect(big.required_score).toBeCloseTo(104);
    expect(report.webhook_payload).toEqual({
      messaging_product: "whatsapp",
      type: "text",
      text: {
        body: [
          "ACADEMIC MARGIN CALL",
          `Stance: CRITICAL_INTERVENTION; portfolio deficit: ${report.liquidation_deficit.toFixed(2)} percentage points.`,
          "C1: 84% / target 90%",
          "C2: 87% / target 90%",
          "Restore first: Final exam.",
          "This assignment alone cannot restore the target; review other recovery options.",
        ].join("\n"),
      },
    });
  });

  it("triggers on a deficit over five points and notes no open work", () => {
    const report = generateLocalMarginCall(
      { courses: [course("c1", 80, 90)], assignments: [] },
      NOW,
    );
    expect(report.liquidation_deficit).toBe(10);
    expect(report.triggered).toBe(true);
    expect(report.restoration_order).toEqual([]);
    expect(report.webhook_payload?.text.body.split("\n").at(-1)).toBe(
      "No open weighted work can restore the target; review recovery options with the instructor.",
    );
  });

  it("prices the required score and formats scores like Python's :g", () => {
    const text = marginCallMessage(
      {
        academic_stance: "ACTIVE_PROTECTION",
        liquidation_deficit: 1.005,
        breached_courses: [
          {
            course_id: "c1",
            course_code: "C1",
            current_score: 89.25,
            target_score: 90,
            deficit: 0.75,
          },
        ],
      },
      [],
    );
    expect(text).toContain("C1: 89.25% / target 90%");
    const report = generateLocalMarginCall(
      {
        courses: [course("c1", 84, 90)],
        assignments: [assignment("huge", "c1", 300, { weight: 100 })],
      },
      NOW,
    );
    expect(report.triggered).toBe(true);
    // Sole open work at full weight: 84 − (84 − 90) × 100 / 100 = 90.
    expect(report.restoration_order[0].required_score).toBeCloseTo(90);
  });

  it("counts breaches cheaply for the top bar", () => {
    expect(
      breachCount({
        courses: [course("a", 80, 90), course("b", 95, 90), course("c", null, 90)],
      }),
    ).toBe(1);
  });

  it("builds click-to-chat links without sending anything", () => {
    expect(normalizePhone("+1 (555) 010-2030")).toBe("15550102030");
    expect(normalizePhone("12")).toBeNull();
    expect(whatsappShareUrl("A & B\nC")).toBe("https://wa.me/?text=A%20%26%20B%0AC");
    expect(whatsappShareUrl("hi", "+44 20 7946 0000")).toBe(
      "https://wa.me/442079460000?text=hi",
    );
    expect(whatsappShareUrl("hi", "nope")).toBe("https://wa.me/?text=hi");
  });
});

describe("api.marginCall", () => {
  const book = { courses: [course("c1", 80, 90)], assignments: [] };
  const sent = {
    triggered: true,
    academic_stance: "CRITICAL_INTERVENTION",
    liquidation_deficit: 10,
    breached_courses: [
      {
        course_id: "c1",
        course_code: "C1",
        current_score: 80,
        target_score: 90,
        deficit: 10,
      },
    ],
    restoration_order: [],
    webhook_payload: {
      messaging_product: "whatsapp",
      type: "text",
      text: { body: "ACADEMIC MARGIN CALL" },
    },
  };

  it("computes locally offline", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const run = await api.marginCall(book, { offline: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(run.source).toBe("local");
    expect(run.report.triggered).toBe(true);
  });

  it("posts to the margin call endpoint and reads the report", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      return json(sent);
    });
    const run = await api.marginCall(book);
    expect(calls).toEqual(["POST /api/v1/portfolio/margin-call"]);
    expect(run).toEqual({ source: "backend", report: sent });
  });

  it("falls back on a malformed or failing answer", async () => {
    vi.stubGlobal("fetch", async () =>
      json({ ...sent, academic_stance: "PANIC" }),
    );
    const malformed = await api.marginCall(book);
    expect(malformed.source === "local" && malformed.cause.kind).toBe("parse");

    vi.stubGlobal("fetch", async () => json({}, 503));
    const failing = await api.marginCall(book);
    expect(failing.source === "local" && failing.cause.status).toBe(503);
    expect(failing.report.breached_courses).toHaveLength(1);
  });
});
