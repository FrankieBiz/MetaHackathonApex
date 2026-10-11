import { describe, expect, it } from "vitest";
import {
  parseBackup,
  serializeBackup,
  workspaceSchema,
} from "../src/lib/workspace";
import { presets } from "../src/data/presets";
import { seedGoals, seedAssignments, seedEvents } from "../src/data/seed";
export const fixture = () => ({
  goals: seedGoals(),
  assignments: seedAssignments(),
  events: seedEvents(),
  layouts: presets[0].layouts,
  visible: presets[0].visible,
  collapsed: [],
  locked: true,
  preset: "overview",
  scratchpad: "## Notes\nPersonal progress",
  sessions: [],
  activity: [],
  connection: { domain: "", lastSynced: null, kind: "sample" },
  name: "Frankie",
  onboardingComplete: true,
});
describe("workspace backups", () => {
  it("round-trips all workspace data without actions, live timers, or credentials", () => {
    const state = {
      ...fixture(),
      token: "test-fixture",
      calendarUrl: "private-url",
      focus: { running: true },
      saveGoal: () => {},
    };
    const json = serializeBackup(state);
    expect(parseBackup(json)).toEqual(workspaceSchema.parse(state));
    expect(json).not.toContain("test-fixture");
    expect(json).not.toContain("private-url");
    expect(JSON.parse(json).workspace).not.toHaveProperty("focus");
  });
  it("rejects invalid, future-version, oversized, and structurally unsafe backups", () => {
    expect(() => parseBackup("{broken")).toThrow("valid Apex OS");
    const backup = JSON.parse(serializeBackup(fixture()));
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, version: 2 })),
    ).toThrow("unsupported version");
    backup.workspace.goals[0].targetDate = "not a date";
    expect(() => parseBackup(JSON.stringify(backup))).toThrow("invalid");
    expect(() => parseBackup("x".repeat(10_000_001))).toThrow("10 MB");
    const duplicate = fixture();
    duplicate.goals.push(duplicate.goals[0]);
    expect(workspaceSchema.safeParse(duplicate).success).toBe(false);
  });
  it("normalizes dangling parent links and accepts existing version-one workspaces", () => {
    const state = fixture();
    state.goals[3].parentId = "deleted-parent";
    const restored = parseBackup(serializeBackup(state));
    expect(restored.goals[3].parentId).toBeUndefined();
    const { onboardingComplete: _onboarded, ...oldState } = fixture();
    void _onboarded;
    expect(workspaceSchema.parse(oldState).onboardingComplete).toBe(true);
  });
});
