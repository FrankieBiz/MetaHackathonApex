import { afterEach, describe, expect, it, vi } from "vitest";
import { portfolioCsv, exportPortfolio } from "@/lib/portfolioExport";
import { priorityScore, rollup } from "@/lib/engine";
import { createMockState } from "@/lib/mockData";

const NOW = Date.parse("2026-10-19T12:00:00Z");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("portfolio CSV", () => {
  it("exports every assignment including fills, with current grades and leaf time totals", () => {
    const data = createMockState(NOW);
    data.assignments[0].status = "completed";
    const csv = portfolioCsv(data, NOW);
    expect(csv.split("\r\n")).toHaveLength(data.assignments.length + 2);
    for (const assignment of data.assignments) {
      expect(csv).toContain(`"${assignment.id}"`);
    }
    expect(csv).toContain('"completed"');
    const course = data.courses[0];
    expect(csv).toContain(`"${course.current_score}","${course.target_score}","${course.portfolio_margin}"`);
    const assignment = data.assignments[0];
    const totals = rollup(assignment.subtasks);
    expect(csv).toContain(`"${priorityScore(assignment, NOW)}","${totals.estimated}","${totals.actual}","${totals.done}","${totals.total}"`);
  });

  it("preserves commas, quotes, Unicode and newlines, and guards formula text", () => {
    const data = createMockState(NOW);
    data.assignments[0].title = 'Résumé, "draft"\nsecond line';
    data.assignments[1].title = '  =HYPERLINK("https://example.com")';
    data.courses[0].course_code = "+SUM(A1:A2)";
    const csv = portfolioCsv(data, NOW);
    expect(csv).toContain('"Résumé, ""draft""\nsecond line"');
    expect(csv).toContain('"\'  =HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"\'+SUM(A1:A2)"');
  });

  it("keeps unknown grades and undated work blank and includes courses without assignments", () => {
    const data = createMockState(NOW);
    data.courses[0].current_score = null;
    data.courses[0].portfolio_margin = null;
    data.assignments[0].due_at = null;
    data.assignments[0].score = null;
    data.assignments = [data.assignments[0]];
    const csv = portfolioCsv(data, NOW);
    expect(csv).toContain(`"","${data.courses[0].target_score}",""`);
    expect(csv).not.toContain('"null"');
    expect(csv).not.toContain('"undefined"');
    expect(csv.split("\r\n")).toHaveLength(data.courses.length + 2);
    for (const row of csv.trim().split("\r\n")) {
      expect(row.split(",")).toHaveLength(18);
    }
  });

  it("downloads a dated UTF-8 CSV and revokes the temporary URL after dispatch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { appendChild: vi.fn() },
    });
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:portfolio");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    exportPortfolio(createMockState(NOW));
    expect(link.download).toBe("apex-portfolio-2026-10-19.csv");
    expect(link.href).toBe("blob:portfolio");
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([239, 187, 191]));
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:portfolio");
  });
});
