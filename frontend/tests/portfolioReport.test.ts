import { afterEach, describe, expect, it, vi } from "vitest";
import { api, portfolioReport } from "@/lib/api";
import { createMockState } from "@/lib/mockData";
import {
  LOCAL_TELEMETRY_MODEL,
  generateLocalReport,
  gradePoints,
  parseInline,
  parseMemo,
  reportFilename,
  stanceLabel,
  type PortfolioReport,
} from "@/lib/portfolioReport";
import type { Assignment, Course, TerminalState } from "@/types";

const NOW = Date.parse("2026-10-21T22:42:00Z");

afterEach(() => vi.unstubAllGlobals());

function course(
  id = "course",
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
  id = "open",
  courseId = "course",
  weight = 25,
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    id,
    course_id: courseId,
    course_code: courseId.toUpperCase(),
    title: `Deliverable ${id}`,
    due_at: null,
    points_possible: 100,
    weight,
    description: null,
    status: "pending",
    graded: false,
    score: null,
    priority_score: 0,
    subtasks: [],
    ...overrides,
  };
}

type Book = Pick<TerminalState, "courses" | "assignments">;
const report = (courses: Course[], assignments: Assignment[] = []) =>
  generateLocalReport({ courses, assignments }, NOW);

// The backend suite (backend/tests/test_portfolio_report.py), run against the local synthesizer.
describe("generateLocalReport mirrors the backend report model", () => {
  it("aggregates the graded book", () => {
    const result = report([course("a", 95, 90), course("b", 85, 80)]);
    expect(result.generated_at).toBe("2026-10-21T22:42:00.000Z");
    expect(result.portfolio_score).toBe(90);
    expect(result.target_score).toBe(85);
    expect(result.margin).toBe(5);
    expect(result.projected_gpa).toBe(3.5);
    expect(result.academic_stance).toBe("MAXIMAL_AGGRESSION");
    expect(result.downside_var_90).toBe(0);
    expect(result.high_leverage_actions).toEqual([]);
    expect(result.course_breakdown.map((c) => c.status)).toEqual(["AHEAD", "AHEAD"]);
    expect(result.executive_summary).toContain("not an official GPA");
    expect(result.telemetry?.model).toBe(LOCAL_TELEMETRY_MODEL);
    expect(result.telemetry?.tokens_per_second).toBeNull();
  });

  it.each([
    [96, "AHEAD", "MAXIMAL_AGGRESSION"],
    [92, "AHEAD", "MAINTAIN_FLOOR"],
    [90, "AT_TARGET", "MAINTAIN_FLOOR"],
    [84, "AT_RISK", "CRITICAL_INTERVENTION"],
    [null, "AT_RISK", "MAINTAIN_FLOOR"],
  ] as const)("rates a %s course %s → %s", (score, status, stance) => {
    const result = report([course("course", score)]);
    expect(result.academic_stance).toBe(stance);
    expect(result.course_breakdown[0].status).toBe(status);
  });

  it("protects a course behind target even when the mean clears it", () => {
    const result = report(
      [course("course", 89), course("healthy", 99)],
      [assignment("open", "course", 100)],
    );
    expect(result.margin).toBe(4);
    expect(result.course_breakdown[0].status).toBe("BEHIND");
    expect(result.academic_stance).toBe("ACTIVE_PROTECTION");
  });

  it("escalates a course with no chance of target", () => {
    const result = report([course("course", 89)]);
    expect(result.course_breakdown[0].probability_of_target).toBe(0);
    expect(result.academic_stance).toBe("CRITICAL_INTERVENTION");
  });

  it("keeps ungraded courses out of the mean and off aggression", () => {
    const result = report(
      [course(), course("ungraded", null)],
      [assignment("open", "ungraded")],
    );
    expect(result.portfolio_score).toBe(95);
    expect(result.target_score).toBe(90);
    expect(result.academic_stance).toBe("MAINTAIN_FLOOR");
    const ungraded = result.course_breakdown[1];
    expect(ungraded.current_score).toBeNull();
    expect(ungraded.var_90).toBeNull();
    expect(ungraded.probability_of_target).toBeNull();
  });

  it("reports zero placeholders for an empty book", () => {
    const result = report([]);
    expect([result.portfolio_score, result.target_score, result.margin]).toEqual([0, 0, 0]);
    expect([result.projected_gpa, result.downside_var_90]).toEqual([0, 0]);
    expect(result.course_breakdown).toEqual([]);
    expect(result.high_leverage_actions).toEqual([]);
    expect(result.executive_summary).toContain("no posted grades yet");
  });

  it("ranks the top ten remaining weighted deliverables by leverage", () => {
    const assignments = [
      ...Array.from({ length: 12 }, (_, i) =>
        assignment(`a${String(i + 1).padStart(2, "0")}`, "course", i + 1),
      ),
      assignment("graded", "course", 100, { graded: true }),
      assignment("zero", "course", 0),
    ];
    const state: Book = { courses: [course()], assignments };
    const before = structuredClone(state);
    const result = generateLocalReport(state, NOW);
    const actions = result.high_leverage_actions;
    expect(actions).toHaveLength(10);
    expect(actions.map((a) => a.assignment_id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `a${String(12 - i).padStart(2, "0")}`),
    );
    expect(actions[0].marginal_impact).toBe(0.12);
    expect(actions[0].due_at).toBeNull();
    expect(result.course_breakdown[0].remaining_weight).toBe(78);
    expect(state).toEqual(before);
  });

  it("normalizes excess weight and breaks leverage ties by priority", () => {
    const due = "2026-12-01T00:00:00.000Z";
    const actions = report(
      [course()],
      [
        assignment("a", "course", 100, { priority_score: 1 }),
        assignment("b", "course", 100, { priority_score: 2, due_at: due }),
      ],
    ).high_leverage_actions;
    expect(actions.map((a) => a.assignment_id)).toEqual(["b", "a"]);
    expect(actions[0].marginal_impact).toBe(0.5);
    expect(actions[0].due_at).toBe(due);
  });

  it("diversifies the book VaR across independent course paths", () => {
    const result = report(
      [course("a", 80, 75), course("b", 80, 75)],
      [assignment("a-open", "a", 100), assignment("b-open", "b", 100)],
    );
    const meanVar =
      result.course_breakdown.reduce((sum, c) => sum + c.var_90!, 0) / 2;
    expect(result.downside_var_90).toBeGreaterThan(0);
    expect(result.downside_var_90).toBeLessThan(meanVar);
  });

  it.each([
    [100, 4],
    [93, 4],
    [90, 3.7],
    [87, 3.3],
    [83, 3],
    [80, 2.7],
    [77, 2.3],
    [73, 2],
    [70, 1.7],
    [67, 1.3],
    [63, 1],
    [60, 0.7],
    [59.9, 0],
  ])("maps %s%% to %s grade points", (score, points) => {
    expect(gradePoints(score)).toBe(points);
  });

  it("is deterministic apart from measured latency", () => {
    const state = createMockState(NOW);
    const strip = ({ telemetry, ...rest }: PortfolioReport) => {
      void telemetry;
      return rest;
    };
    expect(strip(generateLocalReport(state, NOW))).toEqual(
      strip(generateLocalReport(state, NOW)),
    );
  });
});

describe("executive memo", () => {
  const memo = generateLocalReport(createMockState(NOW), NOW).executive_summary;

  it("files a dossier with stance, book, positions, and actions", () => {
    const blocks = parseMemo(memo);
    expect(blocks[0]).toEqual({
      type: "heading",
      level: 1,
      text: "ACADEMIC STANDING DOSSIER",
    });
    const headings = blocks.flatMap((b) => (b.type === "heading" ? [b.text] : []));
    expect(headings.slice(1)).toEqual([
      expect.stringMatching(/^Stance: /),
      "Book",
      "Positions",
      "High-leverage actions",
    ]);
    const table = blocks.find((b) => b.type === "table");
    expect(table?.type === "table" && table.rows).toHaveLength(
      createMockState(NOW).courses.length,
    );
    const actions = blocks.find((b) => b.type === "list" && b.ordered);
    expect(actions?.type === "list" && actions.items.length).toBeGreaterThan(0);
  });

  it("escapes pipes in course codes and titles inside the table", () => {
    const result = report([course("a|b")], [assignment("x", "a|b", 50, { title: "Lab | 1" })]);
    const table = parseMemo(result.executive_summary).find((b) => b.type === "table");
    expect(table?.type === "table" && table.rows[0][0]).toBe("A|B");
    expect(table?.type === "table" && table.rows[0]).toHaveLength(7);
  });

  it("parses headings, lists, tables, and paragraphs", () => {
    expect(
      parseMemo(
        "## Portfolio\n\nProtect the\ncourse target.\n\n- one\n- **two**\n\n1. first\n2. second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
      ),
    ).toEqual([
      { type: "heading", level: 2, text: "Portfolio" },
      { type: "paragraph", text: "Protect the course target." },
      { type: "list", ordered: false, items: ["one", "**two**"] },
      { type: "list", ordered: true, items: ["first", "second"] },
      { type: "table", header: ["A", "B"], rows: [["1", "2"]] },
    ]);
  });

  it("keeps markup it does not know as plain text", () => {
    expect(parseMemo("<script>alert(1)</script>\n| lone row |")).toEqual([
      { type: "paragraph", text: "<script>alert(1)</script>" },
      { type: "paragraph", text: "| lone row |" },
    ]);
  });

  it("splits bold, emphasis, and code spans", () => {
    expect(parseInline("Hold **92.4%** vs _target_ via `make check` now")).toEqual([
      { text: "Hold ", style: "plain" },
      { text: "92.4%", style: "strong" },
      { text: " vs ", style: "plain" },
      { text: "target", style: "em" },
      { text: " via ", style: "plain" },
      { text: "make check", style: "code" },
      { text: " now", style: "plain" },
    ]);
    expect(parseInline("snake_case_name stays")).toEqual([
      { text: "snake_case_name stays", style: "plain" },
    ]);
  });

  it("labels stances and names downloads by date", () => {
    expect(stanceLabel("CRITICAL_INTERVENTION")).toBe("CRITICAL INTERVENTION");
    expect(reportFilename({ generated_at: "2026-10-21T22:42:00+00:00" })).toBe(
      "apex-dossier-2026-10-21.md",
    );
  });
});

describe("api.portfolioReport", () => {
  const backendReport = {
    generated_at: "2026-10-21T22:42:00+00:00",
    executive_summary: "## Portfolio\n\nProtect the course target.",
    academic_stance: "ACTIVE_PROTECTION",
    projected_gpa: 3.84,
    portfolio_score: 87.5,
    target_score: 90,
    margin: -2.5,
    downside_var_90: 6.8,
    course_breakdown: [
      {
        course_id: "cs3801",
        course_code: "CS 3801",
        name: "Distributed Systems",
        current_score: 88,
        target_score: 90,
        status: "BEHIND",
        var_90: 4.5,
        probability_of_target: 0.65,
        remaining_weight: 40,
      },
    ],
    high_leverage_actions: [
      {
        assignment_id: "cs3801-p3",
        course_code: "CS 3801",
        title: "Raft Consensus Implementation",
        weight: 25,
        marginal_impact: 0.25,
        due_at: "2026-10-28T23:59:00Z",
        priority_score: 0.88,
      },
    ],
    telemetry: {
      model_used: "muse-spark-1.3",
      latency_ms: 420,
      prompt_tokens: 200,
      completion_tokens: 100,
      tokens_per_sec: 38.5,
      model: "muse-spark-1.3",
      provider: "meta",
      tokens_per_second: 38.5,
    },
  };

  function backend(body: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }

  const book = (): Book => ({
    courses: [course()],
    assignments: [assignment()],
  });

  it("is exposed on the api client", () => {
    expect(api.portfolioReport).toBe(portfolioReport);
  });

  it("posts the markdown format and returns the backend dossier", async () => {
    const calls = backend(backendReport);
    const run = await portfolioReport(book());
    expect(calls[0].url).toMatch(/\/api\/v1\/portfolio\/report$/);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ format: "markdown" });
    expect(run.source).toBe("backend");
    expect(run.report.academic_stance).toBe("ACTIVE_PROTECTION");
    expect(run.report.telemetry).toEqual({
      model: "muse-spark-1.3",
      provider: "meta",
      tokens_per_second: 38.5,
      latency_ms: 420,
    });
  });

  it("reads the backend's InferenceTelemetry-only shape", async () => {
    backend({
      ...backendReport,
      telemetry: {
        model_used: "local-portfolio-report",
        latency_ms: 0,
        prompt_tokens: null,
        completion_tokens: null,
        tokens_per_sec: null,
      },
    });
    const run = await portfolioReport(book());
    expect(run.report.telemetry).toEqual({
      model: "local-portfolio-report",
      provider: null,
      tokens_per_second: null,
      latency_ms: 0,
    });
  });

  it("synthesizes locally without contacting an offline backend", async () => {
    const calls = backend(backendReport);
    const run = await portfolioReport(book(), { offline: true });
    expect(calls).toHaveLength(0);
    expect(run.source).toBe("local");
    expect(run.report.telemetry?.model).toBe(LOCAL_TELEMETRY_MODEL);
  });

  it.each([
    ["unreachable", new TypeError("fetch failed"), 200, "network"],
    ["missing", { detail: "Not Found" }, 404, "http"],
    ["rejecting", { detail: "bad format" }, 422, "http"],
    ["empty", { ...backendReport, executive_summary: "  " }, 200, "parse"],
    ["off-contract", { ...backendReport, academic_stance: "YOLO" }, 200, "parse"],
    ["out of range", { ...backendReport, projected_gpa: 7 }, 200, "parse"],
  ])("falls back to the local synthesizer when the backend is %s", async (_, body, status, kind) => {
    backend(body, status);
    const run = await portfolioReport(book());
    expect(run.source).toBe("local");
    if (run.source !== "local") return;
    expect(run.cause.kind).toBe(kind);
    expect(run.report.course_breakdown.map((c) => c.course_id)).toEqual(["course"]);
  });
});
