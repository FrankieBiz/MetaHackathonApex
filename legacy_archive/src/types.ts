export type Category =
  | "Software"
  | "Academics"
  | "Finance"
  | "Athletics"
  | "Personal";
export interface SubGoal {
  id: string;
  title: string;
  completed: boolean;
  minutes: number;
  targetDate?: string;
}
export interface Goal {
  id: string;
  title: string;
  category: Category;
  kind: "macro" | "sprint";
  targetDate: string;
  createdAt: string;
  parentId?: string;
  assignmentId?: string;
  archived?: boolean;
  subGoals: SubGoal[];
  milestones: SubGoal[];
}
export interface CanvasAssignment {
  id: string;
  title: string;
  course: string;
  courseId?: number;
  color: string;
  dueAt: string;
  points: number | null;
  description: string;
  completed: boolean;
  source: "sample" | "canvas" | "ical";
  url?: string;
  rubric: { title: string; points: number }[];
  attachments: { title: string; url: string }[];
}
export type WidgetId =
  | "macro"
  | "sprint"
  | "canvas"
  | "timeline"
  | "deconstructor"
  | "scratchpad";
export interface WidgetLayout {
  i: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}
export interface WorkspacePreset {
  id: "overview" | "execution" | "focus";
  name: string;
  layouts: WidgetLayout[];
  visible: WidgetId[];
}
export interface ScheduleEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  category: Category;
  type: "commitment" | "focus" | "assignment";
  goalId?: string;
}
export interface FocusSession {
  id: string;
  completedAt: string;
  minutes: number;
  goalId?: string;
}
export interface Activity {
  id: string;
  title: string;
  timestamp: string;
  type: "goal" | "task" | "sync" | "focus";
}
export interface Connection {
  domain: string;
  lastSynced: string | null;
  kind: "none" | "sample" | "canvas" | "ical";
}
export interface Breakdown {
  title: string;
  tasks: { title: string; minutes: number }[];
  source: "ai" | "local";
  telemetry?: InferenceTelemetry;
}
export interface InferenceTelemetry {
  model_used: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  tokens_per_sec: number | null;
}
export interface EngineConfiguration {
  provider: "meta" | "openai" | "local";
  model: string;
}
