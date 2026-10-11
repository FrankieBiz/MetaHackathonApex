import { afterEach, describe, expect, it, vi } from "vitest";
import { decompose } from "../server/ai";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("task deconstructor", () => {
  it("explicitly labels plans generated without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await decompose("Write a research paper");
    expect(result.source).toBe("local");
    expect(result.tasks).toHaveLength(3);
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
          output: [
            {
              content: [{ type: "output_text", text: JSON.stringify(data) }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await decompose("Write a research paper")).source).toBe("ai");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.properties.tasks.minItems).toBe(3);
  });
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
