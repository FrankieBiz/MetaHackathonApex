import { create } from "zustand";

export interface InferenceTelemetry {
  model_used: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  tokens_per_sec: number | null;
}
interface InferenceState {
  configuration: { provider: string; model: string } | null;
  telemetry: InferenceTelemetry | null;
  status: "ready" | "running" | "ai" | "local" | "cached" | "unavailable";
  configure: (configuration: { provider: string; model: string }) => void;
  start: () => void;
  finish: (
    telemetry: InferenceTelemetry | null,
    source: "ai" | "local" | "cached" | "unavailable",
  ) => void;
}
// Session measurements must never enter persisted task or grade data.
export const useInference = create<InferenceState>((set) => ({
  configuration: null,
  telemetry: null,
  status: "ready",
  configure: (configuration) => set({ configuration }),
  start: () => set({ telemetry: null, status: "running" }),
  finish: (telemetry, status) => set({ telemetry, status }),
}));

/** The backend's default Meta model, shown until /api/engine names the served one. */
const DEFAULT_MODEL = "Llama-3.3-70B-Instruct";

export interface InferencePill {
  model: string;
  detail: string;
  /** measured: a real round-trip; idle: nothing measured; offline: no model ran. */
  tone: "measured" | "running" | "idle" | "offline";
}

/** Measured numbers only: local and saved plans never report model throughput. */
export function inferencePill(
  state: Pick<InferenceState, "status" | "configuration" | "telemetry">,
): InferencePill {
  const model = (
    state.telemetry?.model_used ??
    state.configuration?.model ??
    DEFAULT_MODEL
  )
    .replace(/^meta-llama\//i, "")
    .replace(/-Instruct$/i, "")
    .toUpperCase();
  const { telemetry } = state;
  switch (state.status) {
    case "local":
      return { model, detail: "LOCAL PLANNER · NO INFERENCE", tone: "offline" };
    case "cached":
      return { model, detail: "SAVED PLAN · NO INFERENCE", tone: "offline" };
    case "unavailable":
      return { model, detail: "UNAVAILABLE", tone: "offline" };
    case "running":
      return { model, detail: "INFERENCING…", tone: "running" };
  }
  return telemetry
    ? {
        model,
        detail: `${telemetry.tokens_per_sec?.toFixed(1) ?? "—"} TOK/S · ${Math.round(telemetry.latency_ms)}MS`,
        tone: "measured",
      }
    : { model, detail: "— TOK/S · — MS", tone: "idle" };
}

export function inferenceLabel(
  state: Pick<InferenceState, "status" | "configuration" | "telemetry">,
) {
  const { model, detail } = inferencePill(state);
  return `${model} // ${detail}`;
}
