import { z } from "zod";

const id = z.string().min(1).max(2048);
const date = z
  .string()
  .max(64)
  .refine((v) => Number.isFinite(Date.parse(v)), "Invalid date");
const title = z.string().trim().min(1).max(500);
const category = z.enum([
  "Software",
  "Academics",
  "Finance",
  "Athletics",
  "Personal",
]);
const widget = z.enum([
  "macro",
  "sprint",
  "canvas",
  "timeline",
  "deconstructor",
  "scratchpad",
]);
const task = z.object({
  id,
  title,
  completed: z.boolean(),
  minutes: z.number().int().min(1).max(240),
  targetDate: date.optional(),
});
const goal = z.object({
  id,
  title,
  category,
  kind: z.enum(["macro", "sprint"]),
  targetDate: date,
  createdAt: date,
  parentId: id.optional(),
  assignmentId: id.optional(),
  archived: z.boolean().optional(),
  subGoals: z.array(task).max(1000),
  milestones: z.array(task).max(1000),
});
const assignment = z.object({
  id,
  title,
  course: z.string().max(500),
  courseId: z.number().optional(),
  color: z.enum(["violet", "cyan", "amber", "emerald", "rose", "muted"]),
  dueAt: date,
  points: z.number().nullable(),
  description: z.string().max(2_000_000),
  completed: z.boolean(),
  source: z.enum(["sample", "canvas", "ical"]),
  url: z.string().max(8192).optional(),
  rubric: z
    .array(z.object({ title: z.string().max(5000), points: z.number() }))
    .max(1000),
  attachments: z
    .array(z.object({ title: z.string().max(5000), url: z.string().max(8192) }))
    .max(1000),
});
const event = z
  .object({
    id,
    title,
    start: date,
    end: date,
    category,
    type: z.enum(["commitment", "focus", "assignment"]),
    goalId: id.optional(),
  })
  .refine(
    (v) => Date.parse(v.end) > Date.parse(v.start),
    "Event must end after it starts",
  );
const layout = z
  .object({
    i: widget,
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(1_000_000),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(10000),
    minW: z.number().int().min(1).max(12).optional(),
    minH: z.number().int().min(1).max(10000).optional(),
  })
  .refine((v) => v.x + v.w <= 12, "Panel is outside the grid");
const uniqueIds = <T extends { id: string }>(items: T[]) =>
  new Set(items.map((v) => v.id)).size === items.length;
export const workspaceSchema = z.object({
  goals: z.array(goal).max(10000).refine(uniqueIds, "Duplicate goal IDs"),
  assignments: z
    .array(assignment)
    .max(20000)
    .refine(uniqueIds, "Duplicate assignment IDs"),
  events: z.array(event).max(20000).refine(uniqueIds, "Duplicate event IDs"),
  layouts: z
    .array(layout)
    .max(6)
    .refine(
      (v) => new Set(v.map((l) => l.i)).size === v.length,
      "Duplicate panels",
    ),
  visible: z.array(widget).max(6),
  collapsed: z.array(widget).max(6),
  locked: z.boolean(),
  preset: z.enum(["overview", "execution", "focus"]),
  scratchpad: z.string().max(2_000_000),
  sessions: z
    .array(
      z.object({
        id,
        completedAt: date,
        minutes: z.number().int().min(1).max(240),
        goalId: id.optional(),
      }),
    )
    .max(100000),
  activity: z
    .array(
      z.object({
        id,
        title: z.string().max(1000),
        timestamp: date,
        type: z.enum(["goal", "task", "sync", "focus"]),
      }),
    )
    .max(100),
  connection: z.object({
    domain: z.string().max(256),
    lastSynced: date.nullable(),
    kind: z.enum(["none", "sample", "canvas", "ical"]),
  }),
  name: z.string().trim().min(1).max(30),
  onboardingComplete: z.boolean().default(true),
});
export type WorkspaceData = z.infer<typeof workspaceSchema>;
const backupSchema = z.object({
  app: z.literal("apex-os"),
  version: z.literal(1),
  exportedAt: date,
  workspace: workspaceSchema,
});
export function parseBackup(text: string): WorkspaceData {
  if (text.length > 10_000_000)
    throw new Error("Maximum backup size is 10 MB.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Choose a valid Apex OS JSON backup.");
  }
  const result = backupSchema.safeParse(raw);
  if (!result.success)
    throw new Error(
      "This backup is invalid or uses an unsupported version. Your workspace has not changed.",
    );
  const data = result.data.workspace;
  const macros = new Set(
    data.goals.filter((g) => g.kind === "macro").map((g) => g.id),
  );
  data.goals = data.goals.map((g) => ({
    ...g,
    parentId: g.parentId && macros.has(g.parentId) ? g.parentId : undefined,
  }));
  return data;
}
export function serializeBackup(state: unknown) {
  return JSON.stringify(
    {
      app: "apex-os",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: workspaceSchema.parse(state),
    },
    null,
    2,
  );
}
export function downloadFile(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
