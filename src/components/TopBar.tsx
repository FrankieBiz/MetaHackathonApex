import { useEffect } from "react";
import { engineBadgeLabel, useAIEngine } from "../lib/ai";
import type { EngineConfiguration } from "../types";

export function MetaLlamaBadge() {
  const state = useAIEngine();
  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Engine status unavailable.");
        const data: { engine: EngineConfiguration } = await response.json();
        if (
          !data.engine ||
          typeof data.engine.model !== "string" ||
          !["meta", "openai", "local"].includes(data.engine.provider)
        )
          throw new Error("Engine status unavailable.");
        useAIEngine.getState().configure(data.engine);
      } catch {
        if (
          !controller.signal.aborted &&
          useAIEngine.getState().status === "checking"
        )
          useAIEngine.getState().finish(null, true);
      }
    };
    void check();
    return () => controller.abort();
  }, []);
  const telemetry = state.telemetry;
  const label = engineBadgeLabel(state);
  return (
    <div
      className={`engine-pill mono ${state.status === "error" ? "engine-error" : ""}`}
      role="status"
      title={
        telemetry
          ? `Last request: ${telemetry.model_used}. Prompt: ${telemetry.prompt_tokens ?? "unreported"} tokens; completion: ${telemetry.completion_tokens ?? "unreported"} tokens. Throughput is completion tokens / total API round-trip seconds. Missing usage is shown as —.`
          : "Meta Model API · Llama. Run the task deconstructor to measure inference."
      }
    >
      <span className={`engine-dot ${state.status}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
