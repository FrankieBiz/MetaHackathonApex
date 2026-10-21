import { afterEach, describe, expect, it } from "vitest";
import { inferenceLabel, useInference } from "@/store/inference";

afterEach(() =>
  useInference.setState({
    configuration: null,
    telemetry: null,
    status: "ready",
  }),
);
describe("inference badge", () => {
  const configuration = { provider: "meta", model: "Llama-3.3-70B-Instruct" };
  const telemetry = {
    model_used: configuration.model,
    latency_ms: 500,
    prompt_tokens: 240,
    completion_tokens: 100,
    tokens_per_sec: 200,
  };
  it("renders the served model and measured round-trip throughput", () => {
    expect(inferenceLabel({ configuration, telemetry, status: "ai" })).toBe(
      "LLAMA-3.3-70B // 200.0 TOK/S · 500MS",
    );
    expect(
      inferenceLabel({ configuration: null, telemetry: null, status: "ready" }),
    ).toBe("LLAMA-3.3-70B // — TOK/S · — MS");
  });
  it("distinguishes local and cached plans from model inference", () => {
    expect(
      inferenceLabel({ configuration, telemetry: null, status: "local" }),
    ).toContain("LOCAL PLANNER · NO INFERENCE");
    expect(
      inferenceLabel({ configuration, telemetry: null, status: "cached" }),
    ).toContain("SAVED PLAN · NO INFERENCE");
    expect(
      inferenceLabel({ configuration, telemetry, status: "unavailable" }),
    ).toContain("UNAVAILABLE");
  });
  it("clears stale measurements while a new request runs and represents missing usage", () => {
    useInference.getState().finish(telemetry, "ai");
    useInference.getState().start();
    expect(useInference.getState().telemetry).toBeNull();
    expect(inferenceLabel(useInference.getState())).toContain("INFERENCING");
    expect(
      inferenceLabel({
        configuration,
        telemetry: { ...telemetry, tokens_per_sec: null },
        status: "ai",
      }),
    ).toContain("— TOK/S · 500MS");
  });
});
