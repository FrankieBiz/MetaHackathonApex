// FastAPI client. Responses are normalized leniently: a malformed field falls
// back to its schema default instead of taking the whole terminal down.

import { z } from "zod";
import { createMockState } from "@/lib/mockData";
import { useInference, type InferenceTelemetry } from "@/store/inference";
import type {
  AgentReasoningStep,
  Assignment,
  Course,
  SubTaskNode,
  StudyBlock,
  StudyTriagePlan,
  StudyTriageRequest,
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
      (error instanceof DOMException && error.name === "TimeoutError") ||
      (error instanceof Error && error.name === "TimeoutError");
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
  course_id: id.nullable().optional().catch(null),
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
  score: z.number().finite().nonnegative().nullable().catch(null),
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
        course_id: node.course_id,
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
  return {
    courses,
    assignments,
    metrics,
    study_recommendations: buildTree(body.study_recommendations, "study"),
  };
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

const Telemetry = z.object({
  model_used: z.string(),
  latency_ms: z.number().int().nonnegative(),
  prompt_tokens: z.number().int().nonnegative().nullable(),
  completion_tokens: z.number().int().nonnegative().nullable(),
  tokens_per_sec: z.number().finite().nonnegative().nullable(),
});

const TraceStep = z.object({
  step: z.number().int().min(1).max(4),
  title: z.string(),
  status: z.enum(["pass", "watch", "risk"]),
  summary: z.string(),
  evidence: z.array(z.string()).catch([]),
  engine: z.string().catch("unknown"),
  latency_ms: z.number().finite().nonnegative().catch(0),
});

export interface TriageResult {
  subtasks: SubTaskNode[];
  source: "ai" | "local" | "cached";
  telemetry: InferenceTelemetry;
  trace: AgentReasoningStep[] | null;
}

/** A model call can run long; past this the terminal gives up on the planner. */
const TRIAGE_DEADLINE_MS = 90_000;

const Decomposed = z.object({
  source: z.enum(["ai", "local", "cached"]),
  telemetry: z.object({
    model_used: z.string(),
    latency_ms: z.number().finite().nonnegative(),
    // Usage the provider didn't report is unmeasured, never zero.
    prompt_tokens: z.number().int().nonnegative().nullable().catch(null),
    completion_tokens: z.number().int().nonnegative().nullable().catch(null),
    tokens_per_sec: z.number().finite().nonnegative().nullable().catch(null),
  }),
  // A backend without the agent (or a malformed trace) leaves the terminal to build one.
  agent_reasoning_trace: z.array(TraceStep).length(4).nullable().catch(null),
});

/** A `DecomposeResponse`, from POST /api/decompose or the stream's final event. */
function decomposed(raw: unknown, assignmentId: string): TriageResult {
  const result = Decomposed.parse(raw);
  const subtasks = normalizeTriage(raw, assignmentId);
  useInference.getState().finish(result.telemetry, result.source);
  return {
    subtasks,
    source: result.source,
    telemetry: result.telemetry,
    trace: result.agent_reasoning_trace ?? null,
  };
}

// ---------------------------------------------------------- triage stream

/** What the agent emits while it works, in the order it happened. */
export type TriageStreamEvent =
  | { type: "log"; message: string }
  | { type: "tool_call"; name: string; arguments: unknown; result: unknown }
  | { type: "token"; text: string }
  | { type: "step"; step: AgentReasoningStep };

/** The backend answered the stream with an in-band `error` event: the agent itself failed. */
export class TriageStreamError extends ApiError {
  constructor(detail: string) {
    super(detail, "http");
    this.name = "TriageStreamError";
  }
}

export const triageStreamPath = (assignmentId: string) =>
  `/api/v1/triage/${encodeURIComponent(assignmentId)}/stream`;

/** Splits a server-sent event stream into `{ event, data }` frames. */
export async function* sseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string | null; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frame = (block: string) => {
    let event: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return data.length ? { event, data: data.join("\n") } : null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r\n\r\n|\n\n|\r\r/);
      buffer = done ? "" : blocks.pop()!;
      for (const block of blocks) {
        const parsed = frame(block);
        if (parsed) yield parsed;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Runs triage over GET /api/v1/triage/{id}/stream, handing every live event
 * to `onEvent` as it lands and resolving with the final plan. Each frame is
 * named by its `event:` line or a JSON `type` field. Rejects with
 * TriageStreamError when the agent reports a failure, and with a plain
 * ApiError when the stream itself is unavailable (callers fall back to
 * POST /api/decompose).
 */
export async function streamTriage(
  assignmentId: string,
  onEvent: (event: TriageStreamEvent) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<TriageResult> {
  const path = triageStreamPath(assignmentId);
  const deadline = AbortSignal.timeout(TRIAGE_DEADLINE_MS);
  const controller = new AbortController();
  const abort = () => controller.abort();
  deadline.addEventListener("abort", abort);
  signal?.addEventListener("abort", abort);
  const fail = (error: unknown): never => {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw new ApiError("Triage stream cancelled", "parse");
    if (deadline.aborted) {
      throw new ApiError(
        `No plan from ${API_BASE} within ${TRIAGE_DEADLINE_MS / 1000}s`,
        "timeout",
      );
    }
    // fetch and body reads fail with TypeError; anything else is a bad payload.
    throw error instanceof TypeError
      ? new ApiError(`Cannot reach ${API_BASE}`, "network")
      : new ApiError(`${path} sent a malformed plan`, "parse");
  };

  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        cache: "no-store",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
    } catch (error) {
      return fail(error);
    }
    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status}`, "http", response.status);
    }
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      throw new ApiError(`${path} did not answer with a stream`, "parse");
    }

    try {
      for await (const { event, data } of sseFrames(response.body)) {
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          payload = data;
        }
        const body = (
          payload && typeof payload === "object" ? payload : {}
        ) as Record<string, unknown>;
        switch (event ?? text(body.type)) {
          case "log": {
            const message = text(body.message) || text(payload);
            if (message) onEvent({ type: "log", message });
            break;
          }
          case "tool_call":
            onEvent({
              type: "tool_call",
              name: text(body.name) || "tool",
              arguments: body.arguments ?? null,
              result: body.result ?? null,
            });
            break;
          case "token": {
            const token = text(body.text) || text(payload);
            if (token) onEvent({ type: "token", text: token });
            break;
          }
          case "step": {
            // The step itself, or wrapped as { step: {...} }.
            const step = TraceStep.safeParse(
              typeof body.step === "object" ? body.step : payload,
            );
            if (step.success) onEvent({ type: "step", step: step.data });
            break;
          }
          case "done":
          case "complete":
            return decomposed(payload, assignmentId);
          case "error":
            throw new TriageStreamError(
              text(body.detail) || text(payload) || "Agent failed",
            );
        }
      }
    } catch (error) {
      return fail(error);
    }
    throw new ApiError(`${path} ended before the plan arrived`, "parse");
  } finally {
    deadline.removeEventListener("abort", abort);
    signal?.removeEventListener("abort", abort);
  }
}

const StudyPlan = z.object({
  course_id: z.string().min(1),
  detected_triggers: z.array(z.string()),
  focus_topics: z.array(z.string().trim().min(1).max(500)).length(3),
  recommended_blocks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        estimated_minutes: z.literal(25),
      }),
    )
    .min(2)
    .max(3),
  inference_telemetry: Telemetry,
  source: z.enum(["ai", "local"]),
});

/** A dropped syllabus image or document, base64-encoded for JSON transport. */
export interface SyllabusFile {
  name: string;
  mime_type: string;
  data_base64: string;
}

export interface SyllabusIngestInput {
  text?: string;
  file?: SyllabusFile;
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

  engine: async () =>
    z
      .object({ provider: z.string(), model: z.string() })
      .parse(await request("/api/engine")),

  studyTriage: async (body: StudyTriageRequest): Promise<StudyTriagePlan> => {
    const plan = StudyPlan.parse(
      await request(
        "/api/v1/triage/study",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        90_000,
      ),
    );
    if (plan.course_id !== body.course_id) {
      throw new ApiError("Study triage returned a different course", "parse");
    }
    return plan;
  },

  insertStudy: async (courseId: string, blocks: StudyBlock[]) =>
    normalizeState(
      await request(
        "/api/v1/triage/study/insert",
        {
          method: "POST",
          body: JSON.stringify({
            course_id: courseId,
            recommended_blocks: blocks,
          }),
        },
        15_000,
      ),
    ),

  // The measured endpoint returns the same tree plus inference usage and the agent trace.
  triage: async (assignmentId: string): Promise<TriageResult> =>
    decomposed(
      await request(
        "/api/decompose",
        {
          method: "POST",
          body: JSON.stringify({ assignment_id: assignmentId }),
        },
        TRIAGE_DEADLINE_MS,
      ),
      assignmentId,
    ),

  streamTriage,

  /** Extracts courses, weights, and deliverables from a syllabus; answers with the updated state. */
  ingestSyllabus: async ({
    text,
    file,
  }: SyllabusIngestInput): Promise<TerminalState> => {
    const syllabusText = text?.trim();
    if (!syllabusText && !file) {
      throw new ApiError("Attach a syllabus file or paste its text", "parse");
    }
    // Images travel only as `file`: the backend attaches image_base64 as a second copy.
    return normalizeState(
      await request(
        "/api/v1/syllabus/ingest",
        {
          method: "POST",
          body: JSON.stringify({
            ...(syllabusText ? { syllabus_text: syllabusText } : {}),
            ...(file ? { file } : {}),
          }),
        },
        90_000,
      ),
    );
  },

  patchSubtask: (
    subtaskId: string,
    patch: { is_completed?: boolean; actual_minutes?: number },
  ) =>
    request(`/api/v1/subtasks/${encodeURIComponent(subtaskId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
