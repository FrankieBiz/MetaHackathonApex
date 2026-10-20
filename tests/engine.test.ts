import { afterEach, describe, expect, it } from "vitest";
import { engineBadgeLabel, useAIEngine } from "../src/lib/ai";

afterEach(() =>
  useAIEngine.setState({
    configuration: null,
    telemetry: null,
    status: "checking",
  }),
);
describe("live engine telemetry", () => {
  const configuration = {
    provider: "meta",
    model: "Llama-3.3-70B-Instruct",
  } as const;
  const telemetry = {
    model_used: configuration.model,
    latency_ms: 500,
    prompt_tokens: 240,
    completion_tokens: 100,
    tokens_per_sec: 200,
  };
  it("shows measured throughput and latency with the actual model", () => {
    expect(
      engineBadgeLabel({ configuration, telemetry, status: "complete" }),
    ).toBe("ENGINE: META LLAMA-3.3-70B [⚡ 200.0 tok/s | 500ms]");
  });
  it("distinguishes configured, running, unavailable, and local states", () => {
    expect(
      engineBadgeLabel({ configuration, telemetry: null, status: "ready" }),
    ).toContain("AWAITING INFERENCE");
    expect(
      engineBadgeLabel({ configuration, telemetry, status: "running" }),
    ).toContain("INFERENCING");
    expect(
      engineBadgeLabel({ configuration, telemetry, status: "error" }),
    ).toContain("UNAVAILABLE");
    expect(
      engineBadgeLabel({
        configuration,
        telemetry: {
          ...telemetry,
          model_used: "local-starter-plan",
          completion_tokens: 0,
        },
        status: "complete",
      }),
    ).toContain("LOCAL STARTER [NO INFERENCE]");
  });
  it("shows unreported usage as a dash and clears stale measurements on a new call", () => {
    expect(
      engineBadgeLabel({
        configuration,
        telemetry: { ...telemetry, tokens_per_sec: null },
        status: "complete",
      }),
    ).toContain("— tok/s");
    useAIEngine.getState().finish(telemetry);
    useAIEngine.getState().start();
    expect(useAIEngine.getState().telemetry).toBeNull();
    useAIEngine.getState().configure(configuration);
    expect(useAIEngine.getState().status).toBe("running");
    useAIEngine.getState().finish(telemetry, true);
    expect(useAIEngine.getState().status).toBe("error");
  });
});
