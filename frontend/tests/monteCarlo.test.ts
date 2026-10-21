import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  SENSITIVITY_BUMP,
  leverageTable,
  quantileCurve,
  shockRequest,
  simulateCourse,
  simulateLocally,
  type CourseSimulation,
  type ScorePercentiles,
} from "@/lib/monteCarlo";
import type { Assignment, Course, TerminalState } from "@/types";

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    course_code: "TEST 101",
    name: "Test Course",
    current_score: 80,
    target_score: 85,
    portfolio_margin: -5,
    grade_history: [
      { at: "2026-10-01T00:00:00Z", score: 75 },
      { at: "2026-10-15T00:00:00Z", score: 85 },
    ],
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
    course_code: "TEST 101",
    title: `Deliverable ${id}`,
    due_at: "2026-11-01T00:00:00Z",
    weight,
    description: null,
    status: "pending",
    graded: false,
    score: null,
    points_possible: 100,
    priority_score: 0.5,
    subtasks: [],
    ...overrides,
  };
}

describe("monte carlo desk helpers", () => {
  it("shockRequest filters overrides to eligible remaining weighted assignments", () => {
    const assignments: Assignment[] = [
      assignment("open-1", 30),
      assignment("open-2", 20),
      assignment("zero-weight", 0),
      assignment("graded-1", 50, { graded: true, score: 90 }),
    ];

    const req = shockRequest(
      "course-1",
      assignments,
      {
        "open-1": 95,
        "open-2": 80,
        "zero-weight": 100,
        "graded-1": 100,
        "non-existent": 50,
      },
      500,
    );

    expect(req.course_id).toBe("course-1");
    expect(req.iterations).toBe(500);
    expect(req.shock_overrides).toEqual({
      "open-1": 95,
      "open-2": 80,
    });
  });

  it("quantileCurve maps ScorePercentiles into ordered chart coordinates", () => {
    const percentiles: ScorePercentiles = {
      p10: 72.5,
      p25: 78.0,
      p50: 82.3,
      p75: 86.1,
      p90: 91.4,
    };
    const points = quantileCurve(percentiles);
    expect(points).toHaveLength(5);
    expect(points.map((p) => p.q)).toEqual([10, 25, 50, 75, 90]);
    expect(points.map((p) => p.grade)).toEqual([72.5, 78.0, 82.3, 86.1, 91.4]);
  });

  it("leverageTable ranks deliverable sensitivity and computes lift and share", () => {
    const simulation: CourseSimulation = {
      course_id: "course-1",
      target_score: 85,
      percentiles: { p10: 70, p25: 75, p50: 80, p75: 85, p90: 90 },
      var_90: 10,
      probability_of_target: 0.5,
      sensitivity_matrix: [
        { assignment_id: "a1", weight: 20, marginal_impact: 0.2 },
        { assignment_id: "a2", weight: 40, marginal_impact: 0.4 },
        { assignment_id: "a3", weight: 10, marginal_impact: 0.1 },
      ],
    };
    const assignments: Assignment[] = [
      assignment("a1", 20, { title: "Midterm Exam" }),
      assignment("a2", 40, { title: "Final Project" }),
      assignment("a3", 10, { title: "Homework Set" }),
    ];

    const table = leverageTable(simulation, assignments);
    expect(table).toHaveLength(3);
    expect(table[0].assignment_id).toBe("a2");
    expect(table[0].title).toBe("Final Project");
    expect(table[0].rank).toBe(1);
    expect(table[0].lift).toBeCloseTo(0.4 * SENSITIVITY_BUMP);
    expect(table[0].share).toBe(1);

    expect(table[1].assignment_id).toBe("a1");
    expect(table[1].rank).toBe(2);
    expect(table[1].share).toBeCloseTo(0.5);

    expect(table[2].assignment_id).toBe("a3");
    expect(table[2].rank).toBe(3);
    expect(table[2].share).toBeCloseTo(0.25);
  });
});

describe("simulateLocally engine", () => {
  it("produces ordered percentiles, VaR, and hit probability matching theoretical range", () => {
    const c = course({ current_score: 80, target_score: 85 });
    const a = assignment("final", 50);
    const sim = simulateCourse(c, [a], 1000, {});

    expect(sim.course_id).toBe("course-1");
    expect(sim.percentiles).not.toBeNull();
    if (!sim.percentiles) throw new Error("Expected percentiles");

    const { p10, p25, p50, p75, p90 } = sim.percentiles;
    expect(p10).toBeLessThanOrEqual(p25);
    expect(p25).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p75);
    expect(p75).toBeLessThanOrEqual(p90);

    expect(sim.var_90).not.toBeNull();
    expect(sim.var_90).toBeGreaterThanOrEqual(0);
    expect(sim.probability_of_target).not.toBeNull();
    expect(sim.probability_of_target).toBeGreaterThanOrEqual(0);
    expect(sim.probability_of_target).toBeLessThanOrEqual(1);
  });

  it("returns null percentiles when course has no earned score and no complete shocks", () => {
    const c = course({ current_score: null, grade_history: [] });
    const a = assignment("final", 100);
    const sim = simulateCourse(c, [a], 100, {});
    expect(sim.percentiles).toBeNull();
    expect(sim.var_90).toBeNull();
    expect(sim.probability_of_target).toBeNull();
  });

  it("runs full terminal state locally across all courses", () => {
    const state: Pick<TerminalState, "courses" | "assignments"> = {
      courses: [
        course({ id: "c1", current_score: 85 }),
        course({ id: "c2", current_score: 92 }),
      ],
      assignments: [
        assignment("a1", 40, { course_id: "c1" }),
        assignment("a2", 30, { course_id: "c2" }),
      ],
    };

    const res = simulateLocally({ iterations: 200 }, state);
    expect(res.iterations).toBe(200);
    expect(res.courses).toHaveLength(2);
    expect(res.courses[0].course_id).toBe("c1");
    expect(res.courses[1].course_id).toBe("c2");
  });

  it("respects shock overrides deterministically", () => {
    const c = course({ current_score: 80, target_score: 85 });
    const a = assignment("exam", 100);
    // 100% weight with fixed 100% score override should yield 100% final grade
    const sim = simulateCourse(c, [a], 500, { exam: 100 });
    expect(sim.percentiles?.p10).toBeCloseTo(100);
    expect(sim.percentiles?.p50).toBeCloseTo(100);
    expect(sim.percentiles?.p90).toBeCloseTo(100);
    expect(sim.probability_of_target).toBe(1.0);
    expect(sim.var_90).toBeCloseTo(0);
  });
});

describe("api.simulateMonteCarlo client", () => {
  it("falls back to local simulation when offline is requested", async () => {
    const state: Pick<TerminalState, "courses" | "assignments"> = {
      courses: [course({ id: "c1", current_score: 88 })],
      assignments: [assignment("a1", 50, { course_id: "c1" })],
    };

    const run = await api.simulateMonteCarlo(
      { course_id: "c1", iterations: 250 },
      state,
      { offline: true },
    );

    expect(run.source).toBe("local");
    expect(run.response.courses[0].course_id).toBe("c1");
    expect(run.response.iterations).toBe(250);
  });

  it("falls back to local engine with error attached when server fails", async () => {
    const state: Pick<TerminalState, "courses" | "assignments"> = {
      courses: [course({ id: "c1", current_score: 88 })],
      assignments: [assignment("a1", 50, { course_id: "c1" })],
    };

    // Simulate network failure by intercepting fetch
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network drop"));

    const run = await api.simulateMonteCarlo(
      { course_id: "c1", iterations: 200 },
      state,
    );

    expect(run.source).toBe("local");
    expect(run.response.courses[0].course_id).toBe("c1");
    fetchSpy.mockRestore();
  });
});
