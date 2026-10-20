// FastAPI client. Responses are normalized leniently: a malformed field falls
// back to its schema default instead of taking the whole terminal down.

import { z } from "zod";
import { createMockState } from "@/lib/mockData";
import type {
  Assignment,
  Course,
  SubTaskNode,
  TerminalMetrics,
  TerminalState,
} from "@/types";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

/** Canvas feed reads slower than this fall over to the simulation desk. */
export const FEED_DEADLINE_MS = 2500;

export class ApiError extends Error {
  constructor(
    message: string,
    /** network: unreachable · timeout: reachable but slow · http/parse: answered badly */
    readonly kind: "network" | "timeout" | "http" | "parse",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(
  path: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    throw timedOut
      ? new ApiError(
          `No response from ${API_BASE} within ${timeoutMs / 1000}s`,
          "timeout",
        )
      : new ApiError(`Cannot reach ${API_BASE}`, "network");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === "object" &&
        "detail" in body &&
        typeof body.detail === "string"
      ) {
        detail = `: ${body.detail}`;
      }
    } catch {
      // Error bodies are optional; the status code is enough.
    }
    throw new ApiError(
      `HTTP ${response.status}${detail}`,
      "http",
      response.status,
    );
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ApiError(`${path} returned malformed JSON`, "parse");
  }
}

// ------------------------------------------------------------ normalizing

const id = z.union([z.string(), z.number()]).transform(String);
// null and "" would coerce to 0 and slip past the fallback.
const num = (fallback: number) =>
  z
    .preprocess(
      (value) => (value === null || value === "" ? undefined : value),
      z.coerce.number(),
    )
    .refine(Number.isFinite)
    .catch(fallback);

const RawSubtask = z.object({
  id,
  assignment_id: id.optional().catch(undefined),
  parent_id: id.nullable().optional().catch(null),
  title: z.string().catch("Untitled task"),
  estimated_minutes: num(30),
  actual_minutes: num(0),
  is_completed: z.boolean().catch(false),
  is_study_recommendation: z.boolean().catch(false),
  position: z.number().optional().catch(undefined),
  // Validated recursively by buildTree, one node at a time.
  children: z.array(z.unknown()).catch([]),
});
type RawSubtask = z.infer<typeof RawSubtask>;

const RawAssignment = z.object({
  id,
  course_id: id,
  course_code: z.string().optional().catch(undefined),
  title: z.string().catch("Untitled deliverable"),
  due_at: z.string().nullable().catch(null),
  points_possible: num(0),
  weight: num(0),
  description: z.string().nullable().catch(null),
  status: z.enum(["pending", "in_progress", "completed"]).catch("pending"),
  graded: z.boolean().catch(false),
  priority_score: num(0),
  subtasks: z.array(z.unknown()).catch([]),
});

const RawCourse = z.object({
  id,
  course_code: z.string().catch("COURSE"),
  name: z.string().catch(""),
  current_score: z.number().nullable().catch(null),
  target_score: num(90),
  syllabus: z.string().optional().catch(undefined),
  grade_history: z
    .array(z.object({ at: z.string(), score: z.number() }))
    .catch([]),
});

const RawMetrics = z.object({
  completion_velocity: num(0),
  assignment_volatility: num(0),
  total_budgeted_minutes: num(0),
  total_actual_minutes: num(0),
  last_synced_at: z.string().catch(() => new Date().toISOString()),
  demo_mode: z.boolean().catch(false),
});

/** Parses each element on its own so one bad row drops only itself. */
function each<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Accepts nested `children`, a flat list linked by `parent_id`, or a mix,
 * and returns one consistent tree.
 */
export function buildTree(raw: unknown, assignmentId: string): SubTaskNode[] {
  const flat: (RawSubtask & { order: number })[] = [];
  const visit = (items: unknown, parent: string | null) => {
    for (const node of each(RawSubtask, items)) {
      flat.push({
        ...node,
        parent_id: node.parent_id ?? parent,
        order: flat.length,
      });
      visit(node.children, node.id);
    }
  };
  visit(raw, null);

  const unique = new Map(flat.map((node) => [node.id, node]));
  const childrenOf = new Map<string | null, typeof flat>();
  for (const node of unique.values()) {
    const parent =
      node.parent_id && unique.has(node.parent_id) ? node.parent_id : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node]);
  }

  const assemble = (parent: string | null, seen: Set<string>): SubTaskNode[] =>
    (childrenOf.get(parent) ?? [])
      .filter((node) => !seen.has(node.id))
      .sort((x, y) => (x.position ?? x.order) - (y.position ?? y.order))
      .map((node) => ({
        id: node.id,
        assignment_id: node.assignment_id ?? assignmentId,
        parent_id: parent,
        title: node.title,
        estimated_minutes: node.estimated_minutes,
        actual_minutes: node.actual_minutes,
        is_completed: node.is_completed,
        is_study_recommendation: node.is_study_recommendation,
        children: assemble(node.id, new Set(seen).add(node.id)),
      }));
  return assemble(null, new Set());
}

export function normalizeState(raw: unknown): TerminalState {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("/api/state returned no payload", "parse");
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.courses) && !Array.isArray(body.assignments)) {
    throw new ApiError(
      "/api/state payload has no courses or assignments",
      "parse",
    );
  }

  const courses: Course[] = each(RawCourse, body.courses).map((course) => ({
    ...course,
    portfolio_margin:
      course.current_score === null
        ? null
        : course.current_score - course.target_score,
  }));
  const codeOf = new Map(
    courses.map((course) => [course.id, course.course_code]),
  );

  const assignments: Assignment[] = each(RawAssignment, body.assignments).map(
    (assignment) => ({
      ...assignment,
      course_code:
        assignment.course_code ??
        codeOf.get(assignment.course_id) ??
        assignment.course_id,
      subtasks: buildTree(assignment.subtasks, assignment.id),
    }),
  );

  const parsedMetrics = RawMetrics.safeParse(body.metrics ?? {});
  const metrics: TerminalMetrics = parsedMetrics.success
    ? parsedMetrics.data
    : RawMetrics.parse({});
  return { courses, assignments, metrics };
}

/** Triage responses may be a bare node list or wrapped in an object. */
export function normalizeTriage(
  raw: unknown,
  assignmentId: string,
): SubTaskNode[] {
  const body = raw as Record<string, unknown> | null;
  const candidate = Array.isArray(raw)
    ? raw
    : (body?.subtasks ??
      body?.tree ??
      (body?.assignment as Record<string, unknown> | undefined)?.subtasks);
  const tree = buildTree(candidate, assignmentId);
  if (!tree.length) {
    throw new ApiError("Triage returned no subtasks", "parse");
  }
  return tree;
}

// ------------------------------------------------------- feed interceptor

/**
 * A Canvas feed read. It never rejects: a slow (> FEED_DEADLINE_MS), non-200,
 * unparseable, or unreachable answer is caught and the deterministic mock
 * dataset is served instead, flagged `simulated` with the cause attached.
 */
export type Feed =
  | { simulated: false; state: TerminalState }
  | { simulated: true; state: TerminalState; cause: ApiError };

async function intercept(read: () => Promise<TerminalState>): Promise<Feed> {
  try {
    return { simulated: false, state: await read() };
  } catch (error) {
    return {
      simulated: true,
      state: createMockState(Date.now()),
      cause:
        error instanceof ApiError
          ? error
          : new ApiError((error as Error).message, "parse"),
    };
  }
}

const readState = async () =>
  normalizeState(await request("/api/state", {}, FEED_DEADLINE_MS));

// ---------------------------------------------------------------- calls

export interface CanvasCredentials {
  token: string;
  baseUrl: string;
}

export const api = {
  state: () => intercept(readState),

  sync: (credentials?: CanvasCredentials) =>
    intercept(async () => {
      const raw = await request(
        "/api/sync",
        {
          method: "POST",
          body: JSON.stringify(
            credentials
              ? {
                  canvas_api_token: credentials.token,
                  canvas_api_url: credentials.baseUrl,
                }
              : {},
          ),
        },
        FEED_DEADLINE_MS,
      );
      try {
        return normalizeState(raw);
      } catch {
        // The sync answer carried no state; read it separately.
        return readState();
      }
    }),

  // A local Llama-3 can take a while on a cold model load.
  triage: async (assignmentId: string) =>
    normalizeTriage(
      await request(
        `/api/triage/${encodeURIComponent(assignmentId)}`,
        { method: "POST" },
        90_000,
      ),
      assignmentId,
    ),

  patchSubtask: (
    subtaskId: string,
    patch: { is_completed?: boolean; actual_minutes?: number },
  ) =>
    request(`/api/v1/subtasks/${encodeURIComponent(subtaskId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
