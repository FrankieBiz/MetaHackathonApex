import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Goal,
  WidgetLayout,
  WidgetId,
  CanvasAssignment,
  ScheduleEvent,
  FocusSession,
  Activity,
  Connection,
  Breakdown,
} from "./types";
import { persistence, preserveRecovery } from "./lib/persistence";
import { workspaceSchema, type WorkspaceData } from "./lib/workspace";
import { seedGoals, seedAssignments, seedEvents } from "./data/seed";
import { presets } from "./data/presets";
import { dateAfter } from "./lib/dates";
import { localBreakdown } from "./lib/goals";
const id = () => crypto.randomUUID();
export interface WorkspaceState {
  goals: Goal[];
  assignments: CanvasAssignment[];
  events: ScheduleEvent[];
  layouts: WidgetLayout[];
  visible: WidgetId[];
  collapsed: WidgetId[];
  locked: boolean;
  preset: string;
  scratchpad: string;
  sessions: FocusSession[];
  activity: Activity[];
  connection: Connection;
  name: string;
  hydrated: boolean;
  onboardingComplete: boolean;
  initialize: (name: string, demo: boolean) => void;
  restore: (data: WorkspaceData) => void;
  archiveGoal: (goalId: string) => void;
  deleteGoal: (goalId: string) => void;
  deleteEvent: (eventId: string) => void;
  focus: {
    running: boolean;
    endAt: number | null;
    remaining: number;
    duration: number;
    goalId?: string;
  };
  saveGoal: (goal: Goal) => void;
  toggleTask: (goalId: string, taskId: string, milestone?: boolean) => void;
  addTask: (goalId: string, title: string, minutes?: number) => void;
  setLayouts: (layouts: WidgetLayout[]) => void;
  setLocked: (locked: boolean) => void;
  setPreset: (preset: string) => void;
  toggleWidget: (widget: WidgetId) => void;
  toggleCollapse: (widget: WidgetId) => void;
  setScratchpad: (value: string) => void;
  setName: (value: string) => void;
  convertAssignment: (assignmentId: string) => string | undefined;
  addBreakdown: (breakdown: Breakdown, parentId?: string) => string;
  toggleAssignment: (assignmentId: string) => void;
  importData: (
    assignments: CanvasAssignment[],
    events: ScheduleEvent[],
    connection: Connection,
  ) => void;
  addEvent: (event: ScheduleEvent) => void;
  startFocus: (minutes?: number, goalId?: string | null) => void;
  pauseFocus: () => void;
  resetFocus: (minutes?: number) => void;
  finishFocus: () => void;
}
const activity = (title: string, type: Activity["type"]): Activity => ({
  id: id(),
  title,
  type,
  timestamp: new Date().toISOString(),
});
export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      goals: [],
      assignments: [],
      events: [],
      layouts: presets[0].layouts,
      visible: presets[0].visible,
      collapsed: [],
      locked: true,
      preset: "overview",
      scratchpad: "",
      sessions: [],
      activity: [],
      connection: { domain: "", lastSynced: null, kind: "none" },
      name: "You",
      hydrated: false,
      onboardingComplete: false,
      focus: { running: false, endAt: null, remaining: 25 * 60, duration: 25 },
      initialize: (name, demo) =>
        set({
          name: name.trim() || "You",
          onboardingComplete: true,
          layouts: presets[0].layouts,
          visible: presets[0].visible,
          collapsed: [],
          locked: true,
          preset: "overview",
          sessions: [],
          activity: [],
          focus: { running: false, endAt: null, remaining: 1500, duration: 25 },
          goals: demo ? seedGoals() : [],
          assignments: demo ? seedAssignments() : [],
          events: demo ? seedEvents() : [],
          connection: {
            domain: "",
            lastSynced: null,
            kind: demo ? "sample" : "none",
          },
          scratchpad: demo
            ? "## Today’s intention\n\nMake one small, meaningful step forward."
            : "",
        }),
      restore: (data) =>
        set({
          ...workspaceSchema.parse(data),
          onboardingComplete: true,
          focus: {
            running: false,
            endAt: null,
            remaining: 25 * 60,
            duration: 25,
          },
        }),
      archiveGoal: (goalId) =>
        set((s) => ({
          goals: s.goals.map((g) =>
            g.id === goalId ? { ...g, archived: !g.archived } : g,
          ),
        })),
      deleteGoal: (goalId) =>
        set((s) => ({
          goals: s.goals
            .filter((g) => g.id !== goalId)
            .map((g) =>
              g.parentId === goalId ? { ...g, parentId: undefined } : g,
            ),
          events: s.events.map((e) =>
            e.goalId === goalId
              ? { ...e, goalId: undefined, type: "commitment" }
              : e,
          ),
          focus:
            s.focus.goalId === goalId
              ? { ...s.focus, goalId: undefined }
              : s.focus,
        })),
      deleteEvent: (eventId) =>
        set((s) => ({ events: s.events.filter((e) => e.id !== eventId) })),
      saveGoal: (goal) =>
        set((s) => ({
          goals: s.goals.some((g) => g.id === goal.id)
            ? s.goals.map((g) => (g.id === goal.id ? goal : g))
            : [...s.goals, goal],
          activity: [
            activity(`Saved “${goal.title}”`, "goal"),
            ...s.activity,
          ].slice(0, 100),
        })),
      toggleTask: (goalId, taskId, milestone = false) =>
        set((s) => {
          const goal = s.goals.find((g) => g.id === goalId);
          const field = milestone ? "milestones" : "subGoals";
          const task = goal?.[field].find((t) => t.id === taskId);
          return {
            goals: s.goals.map((g) =>
              g.id === goalId
                ? {
                    ...g,
                    [field]: g[field].map((t) =>
                      t.id === taskId ? { ...t, completed: !t.completed } : t,
                    ),
                  }
                : g,
            ),
            activity: task
              ? [
                  activity(
                    `${task.completed ? "Reopened" : "Completed"} “${task.title}”`,
                    "task",
                  ),
                  ...s.activity,
                ].slice(0, 100)
              : s.activity,
          };
        }),
      addTask: (goalId, title, minutes = 25) => {
        if (!title.trim()) return;
        set((s) => ({
          goals: s.goals.map((g) =>
            g.id === goalId
              ? {
                  ...g,
                  [g.kind === "macro" ? "milestones" : "subGoals"]: [
                    ...(g.kind === "macro" ? g.milestones : g.subGoals),
                    {
                      id: id(),
                      title: title.trim(),
                      minutes,
                      completed: false,
                    },
                  ],
                }
              : g,
          ),
        }));
      },
      setLayouts: (layouts) =>
        set((s) => ({
          layouts: [
            ...s.layouts.filter((l) => !layouts.some((n) => n.i === l.i)),
            ...layouts,
          ],
        })),
      setLocked: (locked) => set({ locked }),
      setPreset: (preset) => {
        const p = presets.find((p) => p.id === preset);
        if (p)
          set({
            preset,
            layouts: p.layouts,
            visible: p.visible,
            collapsed: [],
          });
      },
      toggleWidget: (widget) =>
        set((s) => ({
          visible: s.visible.includes(widget)
            ? s.visible.filter((i) => i !== widget)
            : [...s.visible, widget],
          layouts: s.layouts.some((l) => l.i === widget)
            ? s.layouts
            : [
                ...s.layouts,
                {
                  ...presets[0].layouts.find((l) => l.i === widget)!,
                  y: Math.max(0, ...s.layouts.map((l) => l.y + l.h)),
                },
              ],
        })),
      toggleCollapse: (widget) =>
        set((s) => ({
          collapsed: s.collapsed.includes(widget)
            ? s.collapsed.filter((i) => i !== widget)
            : [...s.collapsed, widget],
        })),
      setScratchpad: (scratchpad) => set({ scratchpad }),
      setName: (name) => set({ name }),
      convertAssignment: (assignmentId) => {
        const s = get();
        const existing = s.goals.find((g) => g.assignmentId === assignmentId);
        if (existing) {
          if (existing.archived) get().archiveGoal(existing.id);
          return existing.id;
        }
        const assignment = s.assignments.find((a) => a.id === assignmentId);
        if (!assignment) return;
        const goalId = get().addBreakdown(
          localBreakdown(assignment.title + ". " + assignment.description),
        );
        set((s) => ({
          goals: s.goals.map((g) =>
            g.id === goalId
              ? {
                  ...g,
                  assignmentId,
                  title: assignment.title,
                  category: "Academics",
                  targetDate: assignment.dueAt,
                }
              : g,
          ),
        }));
        return goalId;
      },
      addBreakdown: (breakdown, parentId) => {
        const goalId = id();
        const parent = get().goals.find((g) => g.id === parentId);
        get().saveGoal({
          id: goalId,
          title: breakdown.title,
          kind: "sprint",
          category: parent?.category ?? "Personal",
          targetDate: dateAfter(6),
          createdAt: new Date().toISOString(),
          parentId,
          milestones: [],
          subGoals: breakdown.tasks.map((t) => ({
            ...t,
            id: id(),
            completed: false,
          })),
        });
        return goalId;
      },
      toggleAssignment: (assignmentId) =>
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.id === assignmentId ? { ...a, completed: !a.completed } : a,
          ),
        })),
      importData: (assignments, events, connection) =>
        set((s) => ({
          assignments: [
            ...s.assignments.filter(
              (a) => a.source !== connection.kind && a.source !== "sample",
            ),
            ...assignments.map((a) => ({
              ...a,
              completed:
                a.completed ||
                s.assignments.find((old) => old.id === a.id)?.completed ||
                false,
            })),
          ],
          events: [
            ...s.events.filter(
              (e) => !e.id.startsWith(`import-${connection.kind}`),
            ),
            ...events,
          ],
          connection,
          activity: [
            activity(
              `Synced ${assignments.length} assignments and ${events.length} calendar events`,
              "sync",
            ),
            ...s.activity,
          ].slice(0, 100),
        })),
      addEvent: (event) =>
        set((s) => ({
          events: s.events.some((e) => e.id === event.id)
            ? s.events.map((e) => (e.id === event.id ? event : e))
            : [...s.events, event],
          activity: [
            activity(`Scheduled “${event.title}”`, "goal"),
            ...s.activity,
          ].slice(0, 100),
        })),
      startFocus: (minutes, goalId) =>
        set((s) => {
          const remaining = minutes ? minutes * 60 : s.focus.remaining;
          return {
            focus: {
              ...s.focus,
              duration: minutes ?? s.focus.duration,
              goalId: goalId === null ? undefined : (goalId ?? s.focus.goalId),
              remaining,
              endAt: Date.now() + remaining * 1000,
              running: true,
            },
          };
        }),
      pauseFocus: () => {
        if (!get().focus.running) return;
        set((s) => ({
          focus: {
            ...s.focus,
            running: false,
            remaining: Math.max(
              0,
              Math.ceil(((s.focus.endAt ?? Date.now()) - Date.now()) / 1000),
            ),
            endAt: null,
          },
        }));
      },
      resetFocus: (minutes = 25) =>
        set({
          focus: {
            running: false,
            endAt: null,
            remaining: minutes * 60,
            duration: minutes,
          },
        }),
      finishFocus: () => {
        if (
          !get().focus.running &&
          get().focus.remaining === get().focus.duration * 60
        )
          return;
        set((s) => {
          const remaining = Math.max(
            0,
            s.focus.running
              ? Math.ceil(((s.focus.endAt ?? Date.now()) - Date.now()) / 1000)
              : s.focus.remaining,
          );
          const minutes = Math.min(
            s.focus.duration,
            Math.max(0, Math.round(s.focus.duration - remaining / 60)),
          );
          return {
            sessions:
              minutes > 0
                ? [
                    ...s.sessions,
                    {
                      id: id(),
                      completedAt: new Date().toISOString(),
                      minutes,
                      goalId: s.focus.goalId,
                    },
                  ]
                : s.sessions,
            focus: {
              ...s.focus,
              running: false,
              endAt: null,
              remaining: s.focus.duration * 60,
            },
            activity:
              minutes > 0
                ? [
                    activity(
                      `Completed ${minutes} minutes of deep work`,
                      "focus",
                    ),
                    ...s.activity,
                  ].slice(0, 100)
                : s.activity,
          };
        });
      },
    }),
    {
      name: "apex-os-workspace-v1",
      version: 1,
      storage: createJSONStorage(() => persistence),
      partialize: (s) => {
        const { hydrated: _hydrated, ...rest } = s;
        void _hydrated;
        return rest;
      },
      merge: (persisted, current) => {
        const result = workspaceSchema.safeParse(persisted);
        if (!result.success) {
          if (persisted) preserveRecovery(persisted);
          return current;
        }
        const saved = persisted as { focus?: WorkspaceState["focus"] };
        const focus = saved.focus;
        const validFocus =
          focus &&
          typeof focus.running === "boolean" &&
          Number.isFinite(focus.duration) &&
          focus.duration >= 1 &&
          focus.duration <= 240 &&
          Number.isFinite(focus.remaining) &&
          focus.remaining >= 0 &&
          focus.remaining <= 14400 &&
          (!focus.running ||
            (typeof focus.endAt === "number" && Number.isFinite(focus.endAt)));
        return {
          ...current,
          ...result.data,
          focus: validFocus ? focus : current.focus,
        };
      },
      onRehydrateStorage: () => () => useWorkspace.setState({ hydrated: true }),
    },
  ),
);
