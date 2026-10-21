import { priorityScore, rollup } from "@/lib/engine";
import type { TerminalState } from "@/types";

/** Quote every field and keep spreadsheet formulas in imported text inert. */
function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? "" : String(value);
  const safe = typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text)
    ? `'${text}`
    : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Actual portfolio snapshot: includes filled and open work, independent of queue filters. */
export function portfolioCsv(data: TerminalState, now = Date.now()): string {
  const header = [
    "Course", "Course name", "Current grade (%)", "Target grade (%)", "Margin (%)",
    "Assignment ID", "Assignment", "Status", "Graded", "Score (points)",
    "Due (UTC)", "Points possible", "Weight (%)", "Priority", "Estimated minutes",
    "Logged minutes", "Completed tasks", "Total tasks",
  ];
  const rows = data.courses.flatMap((course) => {
    const own = data.assignments.filter((assignment) => assignment.course_id === course.id);
    const summary = [course.course_code, course.name, course.current_score,
      course.target_score, course.portfolio_margin];
    if (!own.length) return [[...summary, ...Array(13).fill("")]];
    return own.map((assignment) => {
      const tasks = rollup(assignment.subtasks);
      return [...summary, assignment.id, assignment.title, assignment.status,
        assignment.graded, assignment.score, assignment.due_at,
        assignment.points_possible, assignment.weight,
        priorityScore(assignment, now), tasks.estimated, tasks.actual, tasks.done, tasks.total];
    });
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function exportPortfolio(data: TerminalState): void {
  const now = Date.now();
  // UTF-8 BOM lets spreadsheet applications recognize course titles and names.
  const blob = new Blob(["\uFEFF", portfolioCsv(data, now)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `apex-portfolio-${new Date(now).toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Defer revocation until the browser has started consuming the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
