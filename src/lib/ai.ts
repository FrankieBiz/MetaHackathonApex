import { create } from "zustand";
import type { EngineConfiguration, InferenceTelemetry } from "../types";

// Inference measurements belong to this session, never to workspace backups.
interface EngineState {
  configuration: EngineConfiguration | null;
  telemetry: InferenceTelemetry | null;
  status: "checking" | "ready" | "running" | "complete" | "error";
  configure: (configuration: EngineConfiguration) => void;
  start: () => void;
  finish: (telemetry: InferenceTelemetry | null, failed?: boolean) => void;
}
export const useAIEngine = create<EngineState>((set) => ({
  configuration: null,
  telemetry: null,
  status: "checking",
  configure: (configuration) =>
    set((s) => ({
      configuration,
      status: s.status === "checking" ? "ready" : s.status,
    })),
  start: () => set({ status: "running", telemetry: null }),
  finish: (telemetry, failed = false) =>
    set({ telemetry, status: failed ? "error" : "complete" }),
}));

export function engineBadgeLabel({
  configuration,
  telemetry,
  status,
}: Pick<EngineState, "configuration" | "telemetry" | "status">) {
  const model =
    telemetry?.model_used && telemetry.model_used !== "none"
      ? telemetry.model_used
      : configuration?.model;
  const local = model === "local-starter-plan";
  const meta = configuration?.provider === "meta" || /llama/i.test(model ?? "");
  const identity = local
    ? "LOCAL STARTER"
    : model
      ? `${meta ? "META " : ""}${model
          .replace(/^meta-llama\//i, "")
          .replace(/-Instruct$/i, "")
          .toUpperCase()}`
      : "CHECKING";
  const detail =
    status === "running"
      ? "INFERENCING…"
      : status === "error"
        ? "UNAVAILABLE"
        : local
          ? "NO INFERENCE"
          : telemetry
            ? `⚡ ${telemetry.tokens_per_sec?.toFixed(1) ?? "—"} tok/s | ${telemetry.latency_ms}ms`
            : "AWAITING INFERENCE";
  return `ENGINE: ${identity} [${detail}]`;
}
