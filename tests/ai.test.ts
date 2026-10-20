import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decompose, engineConfiguration, InferenceError } from "../server/ai";
beforeEach(() => {
  vi.stubEnv("META_API_KEY", "");
  vi.stubEnv("META_BASE_URL", "");
  vi.stubEnv("META_MODEL", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_MODEL", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("task deconstructor", () => {
  it("explicitly labels plans generated without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await decompose("Write a research paper");
    expect(result.source).toBe("local");
    expect(result.tasks).toHaveLength(3);
    expect(result.telemetry).toMatchObject({
      model_used: "local-starter-plan",
      prompt_tokens: 0,
      completion_tokens: 0,
    });
  });
  it("uses structured responses and validates the result", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    const data = {
      title: "Research paper",
      tasks: [
        { title: "Outline the topic", minutes: 20 },
        { title: "Draft the evidence", minutes: 45 },
        { title: "Edit the draft", minutes: 25 },
      ],
    };
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gpt-4.1-mini",
          usage: { input_tokens: 90, output_tokens: 60 },
          output: [
            {
              content: [{ type: "output_text", text: JSON.stringify(data) }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await decompose("Write a research paper");
    expect(result.source).toBe("ai");
    expect(result.telemetry).toMatchObject({
      model_used: "gpt-4.1-mini",
      prompt_tokens: 90,
      completion_tokens: 60,
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.properties.tasks.minItems).toBe(3);
  });

  const plan = {
    title: "Project",
    tasks: [
      { title: "Plan", minutes: 15 },
      { title: "Build", minutes: 45 },
      { title: "Review", minutes: 20 },
    ],
  };
  const metaResponse = (extra = {}) =>
    new Response(
      JSON.stringify({
        model: "Llama-3.3-70B-Instruct",
        choices: [{ message: { content: JSON.stringify(plan) } }],
        ...extra,
      }),
    );

  it("prefers Meta, calls the compatible endpoint, and measures real output throughput", async () => {
    vi.stubEnv("META_API_KEY", "meta-test-fixture");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-fixture");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        metaResponse({ usage: { prompt_tokens: 240, completion_tokens: 100 } }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValue(600);
    const result = await decompose("Build my assignment");
    expect(engineConfiguration().provider).toBe("meta");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.llama.com/compat/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer meta-test-fixture",
        }),
        redirect: "error",
      }),
    );
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.model).toBe("Llama-3.3-70B-Instruct");
    expect(request.messages[1]).toEqual({
      role: "user",
      content: "Build my assignment",
    });
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(result.telemetry).toEqual({
      model_used: "Llama-3.3-70B-Instruct",
      latency_ms: 500,
      prompt_tokens: 240,
      completion_tokens: 100,
      tokens_per_sec: 200,
    });
  });

  it("supports a custom base URL and the 8B model, and reports the served model", async () => {
    vi.stubEnv("META_API_KEY", "test-fixture");
    vi.stubEnv("META_BASE_URL", "https://llama.example.com/v1/");
    vi.stubEnv("META_MODEL", "Llama-3.1-8B-Instruct");
    const fetch = vi
      .fn()
      .mockResolvedValue(metaResponse({ model: "served-llama-8b" }));
    vi.stubGlobal("fetch", fetch);
    const result = await decompose("Build my assignment");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://llama.example.com/v1/chat/completions",
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe(
      "Llama-3.1-8B-Instruct",
    );
    expect(result.telemetry).toMatchObject({
      model_used: "served-llama-8b",
      prompt_tokens: null,
      completion_tokens: null,
      tokens_per_sec: null,
    });
  });

  it.each([undefined, { prompt_tokens: -1, completion_tokens: 2.5 }])(
    "does not fabricate missing or invalid usage: %s",
    async (usage) => {
      vi.stubEnv("META_API_KEY", "test-fixture");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(metaResponse({ usage })),
      );
      const result = await decompose("Build my assignment");
      expect(result.telemetry).toMatchObject({
        prompt_tokens: null,
        completion_tokens: null,
        tokens_per_sec: null,
      });
    },
  );

  it("includes attempted model and measured latency when upstream inference fails", async () => {
    vi.stubEnv("META_API_KEY", "test-fixture");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("upstream failure")),
    );
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValue(850);
    await expect(decompose("Build my assignment")).rejects.toMatchObject({
      telemetry: {
        model_used: "Llama-3.3-70B-Instruct",
        latency_ms: 750,
        completion_tokens: null,
        tokens_per_sec: null,
      },
    });
  });

  it.each([
    "not json",
    JSON.stringify({ title: "Bad", tasks: null }),
    JSON.stringify({ title: "Bad", tasks: [null, null, null] }),
  ])(
    "rejects malformed Meta plans without losing telemetry",
    async (content) => {
      vi.stubEnv("META_API_KEY", "test-fixture");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            metaResponse({
              choices: [{ message: { content } }],
              usage: { prompt_tokens: 30, completion_tokens: 15 },
            }),
          ),
      );
      await expect(decompose("Build my assignment")).rejects.toBeInstanceOf(
        InferenceError,
      );
    },
  );
  it("rejects invalid AI outputs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ title: "Bad", tasks: [] }),
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );
    await expect(decompose("Build an app")).rejects.toThrow("invalid plan");
  });
});
