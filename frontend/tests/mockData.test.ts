import { describe, expect, it } from "vitest";
import { HOUR, DAY, leaves } from "@/lib/engine";
import { createMockState } from "@/lib/mockData";
import type { SubTaskNode } from "@/types";

const NOW = Date.parse("2026-10-19T22:00:00Z");

const walk = (nodes: SubTaskNode[]): SubTaskNode[] =>
  nodes.flatMap((node) => [node, ...walk(node.children)]);

describe("simulation fixtures", () => {
  it("match the demo brief", () => {
    const { courses, assignments, metrics } = createMockState(NOW);
    expect(courses.map((c) => `${c.course_code}: ${c.name}`)).toEqual([
      "CS 3801: Distributed Systems",
      "MATH 4102: Stochastic Modeling",
      "ENG 2001: Technical Writing",
      "FIN 3100: Quantitative Analysis",
    ]);
    expect(metrics.demo_mode).toBe(true);
    expect(assignments).toHaveLength(12);
    expect(new Set(assignments.map((a) => a.id)).size).toBe(12);
    for (const assignment of assignments) {
      expect(assignment.weight).toBeGreaterThanOrEqual(10);
      expect(assignment.weight).toBeLessThanOrEqual(30);
      expect(assignment.points_possible).toBeGreaterThanOrEqual(50);
      expect(assignment.points_possible).toBeLessThanOrEqual(200);
      const due = Date.parse(assignment.due_at!) - NOW;
      expect(due).toBeGreaterThanOrEqual(4 * HOUR);
      expect(due).toBeLessThanOrEqual(8 * DAY);
    }
    for (const course of courses) {
      expect(course.grade_history.at(-1)?.score).toBe(course.current_score);
    }
  });

  it("ship rolled-up task trees with logged time and study flags", () => {
    const { assignments } = createMockState(NOW);
    const triaged = assignments.filter((a) => a.subtasks.length);
    expect(triaged).toHaveLength(9);
    const nodes = walk(triaged.flatMap((a) => a.subtasks));
    expect(leaves(nodes).some((leaf) => leaf.actual_minutes > 0)).toBe(true);
    const study = nodes.filter((node) => node.is_study_recommendation);
    expect(study.some((node) => node.title.includes("Study Guide"))).toBe(true);
    expect(study.some((node) => /PDF, \d+ MB/.test(node.title))).toBe(true);
    for (const node of nodes.filter((n) => n.children.length)) {
      expect(node.estimated_minutes).toBe(
        node.children.reduce((sum, child) => sum + child.estimated_minutes, 0),
      );
      expect(node.is_completed).toBe(
        node.children.every((child) => child.is_completed),
      );
    }
    for (const assignment of triaged) {
      const started = walk(assignment.subtasks).some(
        (n) => n.is_completed || n.actual_minutes > 0,
      );
      expect(assignment.status).toBe(started ? "in_progress" : "pending");
    }
  });

  it("are deterministic: IDs stay put while timestamps follow now", () => {
    const first = createMockState(NOW);
    expect(createMockState(NOW)).toEqual(first);
    const later = createMockState(NOW + 3 * HOUR);
    const ids = (state: typeof first) =>
      state.assignments.flatMap((a) => walk(a.subtasks).map((n) => n.id));
    expect(ids(later)).toEqual(ids(first));
    expect(
      Date.parse(later.assignments[0].due_at!) -
        Date.parse(first.assignments[0].due_at!),
    ).toBe(3 * HOUR);
  });
});
