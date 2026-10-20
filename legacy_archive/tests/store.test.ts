import { IDBFactory } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { goalProgress } from "../src/lib/goals";
import { parseBackup, serializeBackup } from "../src/lib/workspace";
let workspace: typeof import("../src/store").useWorkspace;
beforeAll(async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  vi.stubGlobal("indexedDB", new IDBFactory());
  workspace = (await import("../src/store")).useWorkspace;
  await workspace.persist.rehydrate();
});
beforeEach(() => workspace.getState().initialize("Frankie", true));
describe("everyday workspace actions", () => {
  it("archives sprint history without changing its contribution to parent progress", () => {
    const state = workspace.getState();
    const sprint = state.goals.find((g) => g.kind === "sprint" && g.parentId)!;
    const macro = state.goals.find((g) => g.id === sprint.parentId)!;
    const before = goalProgress(macro, state.goals);
    state.archiveGoal(sprint.id);
    expect(
      workspace.getState().goals.find((g) => g.id === sprint.id)?.archived,
    ).toBe(true);
    expect(goalProgress(macro, workspace.getState().goals)).toBe(before);
    state.archiveGoal(sprint.id);
    expect(
      workspace.getState().goals.find((g) => g.id === sprint.id)?.archived,
    ).toBe(false);
  });
  it("unlinks child sprints when deleting a macro and keeps their checkpoints", () => {
    const state = workspace.getState();
    const child = state.goals.find((g) => g.kind === "sprint" && g.parentId)!;
    state.deleteGoal(child.parentId!);
    expect(workspace.getState().goals.find((g) => g.id === child.id)).toEqual({
      ...child,
      parentId: undefined,
    });
  });
  it("edits time blocks by ID, deletes them, and resets a restored timer safely", () => {
    const event = workspace.getState().events[0];
    const count = workspace.getState().events.length;
    workspace.getState().addEvent({ ...event, title: "Updated session" });
    expect(workspace.getState().events).toHaveLength(count);
    expect(workspace.getState().events[0].title).toBe("Updated session");
    workspace.getState().startFocus(25);
    workspace
      .getState()
      .restore(parseBackup(serializeBackup(workspace.getState())));
    expect(workspace.getState().focus.running).toBe(false);
    workspace.getState().deleteEvent(event.id);
    expect(workspace.getState().events).toHaveLength(count - 1);
  });
  it("records a paused session once and lets users clear its linked goal", () => {
    vi.useFakeTimers();
    try {
      workspace.getState().startFocus(25, "sprint-portfolio");
      vi.advanceTimersByTime(60_000);
      workspace.getState().pauseFocus();
      workspace.getState().finishFocus();
      expect(workspace.getState().sessions).toHaveLength(1);
      expect(workspace.getState().sessions[0].minutes).toBe(1);
      workspace.getState().finishFocus();
      expect(workspace.getState().sessions).toHaveLength(1);
      workspace.getState().startFocus(undefined, null);
      expect(workspace.getState().focus.goalId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  it("creates a truly empty workspace and makes repeated pause calls harmless", () => {
    workspace.getState().initialize("Frankie", false);
    expect(workspace.getState().goals).toEqual([]);
    expect(workspace.getState().assignments).toEqual([]);
    expect(workspace.getState().events).toEqual([]);
    expect(workspace.getState().connection.kind).toBe("none");
    workspace.getState().pauseFocus();
    expect(workspace.getState().focus.remaining).toBe(1500);
  });
});
