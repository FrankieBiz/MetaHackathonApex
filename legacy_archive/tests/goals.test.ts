import { describe, it, expect } from "vitest";
import { completion, goalProgress, localBreakdown } from "../src/lib/goals";
import type { Goal, SubGoal } from "../src/types";
const task = (id: string, completed: boolean): SubGoal => ({
  id,
  title: id,
  completed,
  minutes: 25,
});
const macro: Goal = {
  id: "macro",
  title: "Launch",
  category: "Software",
  kind: "macro",
  targetDate: "2027-01-01",
  createdAt: "2026-01-01",
  subGoals: [],
  milestones: [task("m1", true), task("m2", false)],
};
const sprint: Goal = {
  ...macro,
  id: "sprint",
  kind: "sprint",
  parentId: "macro",
  milestones: [],
  subGoals: [task("s1", true), task("s2", true)],
};
describe("goal mathematics", () => {
  it("handles empty, partial, and completed checkpoints", () => {
    expect(completion([])).toBe(0);
    expect(
      completion([task("1", true), task("2", false), task("3", false)]),
    ).toBe(33);
    expect(completion([task("1", true)])).toBe(100);
  });
  it("derives macro progress from milestones and linked sprint checkpoints", () => {
    expect(goalProgress(macro, [macro, sprint])).toBe(75);
    expect(goalProgress({ ...macro, milestones: [] }, [sprint])).toBe(100);
  });
  it("recalculates parent progress when a child checkpoint reopens", () => {
    expect(
      goalProgress(macro, [
        macro,
        { ...sprint, subGoals: [task("s1", false), task("s2", true)] },
      ]),
    ).toBe(50);
  });
  it("does not count unrelated sprint tasks toward a macro goal", () => {
    expect(
      goalProgress(macro, [macro, { ...sprint, parentId: "another" }]),
    ).toBe(50);
  });
  it("makes exactly three bounded, actionable starter tasks", () => {
    const plan = localBreakdown(
      "Build a portfolio app. Include accessible project cards.",
    );
    expect(plan.source).toBe("local");
    expect(plan.title).toBe("Build a portfolio app");
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks.every((t) => t.minutes >= 15 && t.minutes <= 45)).toBe(
      true,
    );
    expect(plan.tasks[1].title).toContain("Build");
  });
});
