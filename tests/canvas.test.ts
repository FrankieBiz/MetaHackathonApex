import { describe, expect, it, vi } from "vitest";
import { requestPublic } from "../server/network";
import { syncCanvas } from "../server/canvas";
vi.mock("../server/network.js", () => ({ requestPublic: vi.fn() }));
describe("Canvas assignment normalization", () => {
  it("keeps assignments when one attachment is malformed and skips unsafe links", async () => {
    vi.mocked(requestPublic).mockImplementation(async (url) => ({
      headers: {},
      text: JSON.stringify(
        url.includes("/courses?")
          ? [{ id: 1, name: "Computer Science", course_code: "CS101" }]
          : url.includes("upcoming_events")
            ? []
            : [
                {
                  id: 2,
                  name: "Final project",
                  due_at: "2026-12-01T18:00:00Z",
                  points_possible: 100,
                  description:
                    '<a href="https://[broken">Broken</a><a href="javascript:alert(1)">Unsafe</a><a href="/files/42">Project PDF</a>',
                  submission: { workflow_state: "submitted" },
                },
              ],
      ),
    }));
    const result = await syncCanvas("school.instructure.com", "test-fixture");
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].completed).toBe(true);
    expect(result.assignments[0].attachments).toEqual([
      { url: "https://school.instructure.com/files/42", title: "Project PDF" },
    ]);
  });
});
