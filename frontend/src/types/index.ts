// Mirrors the FastAPI Pydantic models in backend/models.py.

export type AssignmentStatus = "pending" | "in_progress" | "completed";

export interface SubTaskNode {
  id: string;
  assignment_id: string;
  parent_id: string | null;
  title: string;
  estimated_minutes: number;
  actual_minutes: number;
  is_completed: boolean;
  is_study_recommendation: boolean;
  children: SubTaskNode[];
}

export interface Assignment {
  id: string;
  course_id: string;
  course_code: string;
  title: string;
  due_at: string | null;
  points_possible: number;
  /** Percent of the final grade, 0–100. */
  weight: number;
  description: string | null;
  status: AssignmentStatus;
  /**
   * Scored or excused by Canvas, so already settled in current_score. Work that
   * is submitted, or whose tasks are all checked, is completed but not graded.
   */
  graded: boolean;
  priority_score: number;
  subtasks: SubTaskNode[];
}

export interface GradePoint {
  at: string;
  score: number;
}

export interface Course {
  id: string;
  course_code: string;
  name: string;
  /** Null until Canvas has posted a grade. */
  current_score: number | null;
  target_score: number;
  /** current_score − target_score; null when there is no grade yet. */
  portfolio_margin: number | null;
  syllabus?: string;
  /** Optional extension; without it the terminal builds history from its own sync snapshots. */
  grade_history: GradePoint[];
}

export interface TerminalMetrics {
  completion_velocity: number;
  assignment_volatility: number;
  total_budgeted_minutes: number;
  total_actual_minutes: number;
  last_synced_at: string;
  demo_mode: boolean;
}

export interface TerminalState {
  courses: Course[];
  assignments: Assignment[];
  metrics: TerminalMetrics;
}

/**
 * live          backend reachable, real Canvas data
 * backend-demo  backend reachable, serving its simulation dataset
 * offline       backend unreachable, slow, or erroring; or Ctrl+Shift+D pinned
 *               the local simulation desk
 */
export type ConnectionMode = "connecting" | "live" | "backend-demo" | "offline";

/** sandbox: the local simulation desk · backend: data the backend served. */
export type DataOrigin = "sandbox" | "backend";

export interface StudyRecommendation {
  course_id: string;
  title: string;
  reason: string;
  estimated_minutes: number;
  source_assignment_id: string | null;
}

export interface TerminalEvent {
  id: number;
  at: string;
  level: "info" | "ok" | "warn" | "error";
  text: string;
}
