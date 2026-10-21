import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  courseStatus,
  dossierStance,
  generateLocalReport,
  gradePoints,
  parseMemo,
  reportFilename,
  type CourseStanding,
} from "@/lib/portfolioReport";
import type { Assignment, Course, TerminalState } from "@/types";

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    course_code: "CS 3801",
    name: "Distributed Systems",
    current_score: 92,
    target_score: 90,
    portfolio_margin: 2,
    grade_history: [{ at: "2026-10-01T00:00:00Z", score: 92 }],
    ...overrides,
  };
}

function assignment(
  id: string,
  weight: number,
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    id,
    course_id: "course-1",
    course_code: "CS 3801",
    title: `Deliverable ${id}`,
    due_at: "2026-11-01T00:00:00Z",
    weight,
    description: null,
    status: "pending",
    graded: false,
    score: null,
    points_possible: 100,
    priority_score: 0.8,
    subtasks: [],
    ...overrides,
  };
}

describe("portfolio report helpers and rules", () => {
  it("gradePoints converts numerical grades to US 4.0 scale accurately", () => {
    expect(gradePoints(100)).toBe(4.0);
    expect(gradePoints(93)).toBe(4.0);
    expect(gradePoints(90)).toBe(3.7);
    expect(gradePoints(87)).toBe(3.3);
    expect(gradePoints(83)).toBe(3.0);
    expect(gradePoints(80)).toBe(2.7);
    expect(gradePoints(77)).toBe(2.3);
    expect(gradePoints(73)).toBe(2.0);
    expect(gradePoints(70)).toBe(1.7);
    expect(gradePoints(67)).toBe(1.3);
    expect(gradePoints(63)).toBe(1.0);
    expect(gradePoints(60)).toBe(0.7);
    expect(gradePoints(59.9)).toBe(0);
    expect(gradePoints(0)).toBe(0);
  });

  it("courseStatus classifies standing based on margin and target probability", () => {
    // AT_RISK when margin is null (ungraded)
    expect(courseStatus(null, null)).toBe("AT_RISK");
    // AT_RISK when margin < -5
    expect(courseStatus(-5.1, 0.5)).toBe("AT_RISK");
    // AT_RISK when probability < 0.25 even with small deficit
    expect(courseStatus(-2.0, 0.2)).toBe("AT_RISK");
    // BEHIND when deficit is mild (-5 to <0) and probability is fine
    expect(courseStatus(-2.0, 0.6)).toBe("BEHIND");
    // AT_TARGET when exactly 0
    expect(courseStatus(0, 0.8)).toBe("AT_TARGET");
    // AHEAD when positive
    expect(courseStatus(4.5, 0.95)).toBe("AHEAD");
  });

  it("dossierStance ladders from CRITICAL_INTERVENTION up to MAXIMAL_AGGRESSION", () => {
    // Graded course at risk triggers CRITICAL_INTERVENTION
    const criticalCourses: Pick<CourseStanding, "status" | "current_score">[] = [
      { status: "AT_RISK", current_score: 75 },
    ];
    expect(dossierStance(criticalCourses, -10)).toBe("CRITICAL_INTERVENTION");

    // Any behind course triggers ACTIVE_PROTECTION
    const behindCourses: Pick<CourseStanding, "status" | "current_score">[] = [
      { status: "BEHIND", current_score: 88 },
      { status: "AHEAD", current_score: 95 },
    ];
    expect(dossierStance(behindCourses, 1)).toBe("ACTIVE_PROTECTION");

    // Graded with buffer < 5 triggers MAINTAIN_FLOOR
    const bufferCourses: Pick<CourseStanding, "status" | "current_score">[] = [
      { status: "AHEAD", current_score: 93 },
    ];
    expect(dossierStance(bufferCourses, 3)).toBe("MAINTAIN_FLOOR");

    // Graded with buffer >= 5 triggers MAXIMAL_AGGRESSION
    expect(dossierStance(bufferCourses, 6)).toBe("MAXIMAL_AGGRESSION");
  });

  it("reportFilename formats standard ISO date string", () => {
    expect(reportFilename({ generated_at: "2026-10-21T18:00:00Z" })).toBe(
      "apex-dossier-2026-10-21.md",
    );
  });
});

describe("generateLocalReport synthesizer", () => {
  it("synthesizes valid dossier from state with metrics and markdown memo", () => {
    const state: Pick<TerminalState, "courses" | "assignments"> = {
      courses: [
        course({ id: "c1", current_score: 94, target_score: 90, portfolio_margin: 4 }),
        course({ id: "c2", current_score: 88, target_score: 85, portfolio_margin: 3 }),
      ],
      assignments: [
        assignment("a1", 40, { course_id: "c1", title: "Project Alpha" }),
        assignment("a2", 30, { course_id: "c2", title: "Midterm Exam" }),
      ],
    };

    const report = generateLocalReport(state);
    expect(report.course_breakdown).toHaveLength(2);
    expect(report.projected_gpa).toBeGreaterThan(0);
    expect(report.portfolio_score).toBe(91); // (94 + 88) / 2
    expect(report.target_score).toBe(87.5); // (90 + 85) / 2
    expect(report.margin).toBe(3.5);
    expect(report.high_leverage_actions.length).toBeGreaterThan(0);
    expect(report.executive_summary).toContain("ACADEMIC STANDING DOSSIER");
  });

  it("handles empty state gracefully without crashing", () => {
    const report = generateLocalReport({ courses: [], assignments: [] });
    expect(report.course_breakdown).toHaveLength(0);
    expect(report.projected_gpa).toBe(0);
    expect(report.portfolio_score).toBe(0);
    expect(report.target_score).toBe(0);
    expect(report.margin).toBe(0);
    expect(report.academic_stance).toBe("MAINTAIN_FLOOR");
  });
});

describe("parseMemo markdown parser", () => {
  it("parses headings, paragraphs, bullet lists, and tables", () => {
    const markdown = `
# EXECUTIVE DOSSIER

This is the portfolio executive memo.

- Focus on Project Alpha
- Complete Midterm preparation

| Course | Grade | Status |
|---|---|---|
| CS 3801 | 92.0% | AHEAD |
| BIO 2005 | 88.0% | BEHIND |
`;

    const blocks = parseMemo(markdown);
    expect(blocks.some((b) => b.type === "heading" && b.text === "EXECUTIVE DOSSIER")).toBe(true);
    expect(blocks.some((b) => b.type === "paragraph")).toBe(true);
    expect(blocks.some((b) => b.type === "list" && b.items.length === 2)).toBe(true);
    expect(blocks.some((b) => b.type === "table" && b.rows.length === 2)).toBe(true);
  });
});

describe("api.portfolioReport client", () => {
  it("falls back to local report when offline option is passed", async () => {
    const state: Pick<TerminalState, "courses" | "assignments"> = {
      courses: [course({ id: "c1", current_score: 95 })],
      assignments: [assignment("a1", 30, { course_id: "c1" })],
    };

    const run = await api.portfolioReport(state, { offline: true });
    expect(run.source).toBe("local");
    expect(run.report.course_breakdown[0].course_id).toBe("c1");
  });

  it("falls back to local engine when network fails", async () => {
    const state: Pick<TerminalState, "courses" | "assignments"> = {
      courses: [course({ id: "c1", current_score: 95 })],
      assignments: [assignment("a1", 30, { course_id: "c1" })],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network drop"));
    const run = await api.portfolioReport(state);
    expect(run.source).toBe("local");
    expect(run.report.course_breakdown[0].course_id).toBe("c1");
    fetchSpy.mockRestore();
  });
});
