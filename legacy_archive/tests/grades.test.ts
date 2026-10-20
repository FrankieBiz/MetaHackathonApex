import { describe, expect, it } from "vitest";
import { gradableAssignments, projectTrajectory } from "../src/lib/grades";
import type { CanvasAssignment } from "../src/types";

const assignment = (
  id: string,
  overrides: Partial<CanvasAssignment> = {},
): CanvasAssignment => ({
  id,
  title: id,
  course: "CS 301",
  points: 100,
  color: "cyan",
  dueAt: "2026-10-25T12:00:00Z",
  description: "",
  completed: false,
  source: "sample",
  rubric: [],
  attachments: [],
  ...overrides,
});
const assumptions = { currentGrade: 85, gradedPoints: 300, targetGrade: 80 };
describe("what-if grade projections", () => {
  const assignments = [
    assignment("first"),
    assignment("last", { dueAt: "2026-10-30T12:00:00Z" }),
  ];
  it("updates the line and margin at 0% and 100% without changing assignments", () => {
    const before = structuredClone(assignments);
    const low = projectTrajectory(assignments, "first", 0, assumptions)!;
    const high = projectTrajectory(assignments, "first", 100, assumptions)!;
    [85, 63.75, 68].forEach((expected, i) =>
      expect(low.points[i].grade).toBeCloseTo(expected),
    );
    expect(low.marginOfSafety).toBe(-12);
    expect(high.finalGrade).toBe(88);
    expect(high.marginOfSafety).toBe(8);
    expect(low.assignmentWeight).toBe(20);
    expect(low.requiredScore).toBe(60);
    expect(assignments).toEqual(before);
  });
  it("uses point weights and never mixes courses or completed assignments", () => {
    const result = projectTrajectory(
      [
        assignment("active", { points: 50 }),
        assignment("other-course", { course: "ECON", points: 10000 }),
        assignment("completed", { completed: true, points: 10000 }),
      ],
      "active",
      100,
      assumptions,
    )!;
    expect(result.finalGrade).toBeCloseTo(87.142857);
    expect(result.courseAssignments.map((a) => a.id)).toEqual(["active"]);
  });
  it("applies a later assignment's score only from its due date onward", () => {
    const result = projectTrajectory(
      [...assignments].reverse(),
      "last",
      0,
      assumptions,
    )!;
    expect(result.points.map((p) => p.grade)).toEqual([85, 85, 68]);
  });
  it("handles no graded points and a zero target without division by zero", () => {
    const result = projectTrajectory([assignment("active")], "active", 0, {
      currentGrade: 85,
      gradedPoints: 0,
      targetGrade: 0,
    })!;
    expect(result.finalGrade).toBe(0);
    expect(result.marginOfSafety).toBe(0);
    expect(result.requiredScore).toBe(0);
  });
  it("excludes events and zero-point assignments, and handles empty or missing selections", () => {
    expect(
      gradableAssignments([
        assignment("event", { points: null }),
        assignment("zero", { points: 0 }),
      ]),
    ).toEqual([]);
    expect(projectTrajectory([], "missing", 85, assumptions)).toBeNull();
    expect(
      projectTrajectory(assignments, "missing", 85, assumptions),
    ).toBeNull();
    expect(
      projectTrajectory(assignments, "first", NaN, assumptions),
    ).toBeNull();
  });
  it("recalculates the buffer for a new target and identifies unreachable targets", () => {
    const result = projectTrajectory(assignments, "first", 100, {
      ...assumptions,
      targetGrade: 95,
    })!;
    expect(result.marginOfSafety).toBe(-7);
    expect(result.requiredScore).toBeGreaterThan(100);
  });
});
