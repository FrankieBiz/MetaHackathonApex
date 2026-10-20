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

export function inferenceLabel(
  state: Pick<InferenceState, "status" | "configuration" | "telemetry">,
) {
  const model = state.telemetry?.model_used ?? state.configuration?.model;
  if (state.status === "local")
    return "ENGINE: LOCAL STARTER [NO MODEL INFERENCE]";
  if (state.status === "cached")
    return "ENGINE: SAVED PLAN [NO MODEL INFERENCE]";
  const identity = model
    ? `${state.configuration?.provider === "meta" || /llama/i.test(model) ? "META " : ""}${model
        .replace(/^meta-llama\//i, "")
        .replace(/-Instruct$/i, "")
        .toUpperCase()}`
    : "LLAMA";
  const detail =
    state.status === "running"
      ? "INFERENCING…"
      : state.status === "unavailable"
        ? "UNAVAILABLE"
        : state.telemetry
          ? `⚡ ${state.telemetry.tokens_per_sec?.toFixed(1) ?? "—"} tok/s | ${state.telemetry.latency_ms}ms`
          : "AWAITING INFERENCE";
  return `ENGINE: ${identity} [${detail}]`;
}
