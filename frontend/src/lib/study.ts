import type { Assignment } from "@/types";

export function studyOpportunity(
  assignments: Assignment[],
  courseId: string,
  now: number,
) {
  const open = assignments.filter(
    (a) => a.course_id === courseId && a.status !== "completed",
  );
  const exam = open.some(
    (a) =>
      /\b(exam|midterm|final)\b/i.test(a.title) &&
      a.due_at &&
      Date.parse(a.due_at) >= now &&
      Date.parse(a.due_at) <= now + 14 * 86_400_000,
  );
  if (exam) return "Upcoming exam · prepare a targeted sprint";
  const immediate = open.some(
    (a) => a.due_at && Date.parse(a.due_at) <= now + 7 * 86_400_000,
  );
  return immediate ? null : "No immediate due dates · use this study window";
}

export const studyTitleKey = (title: string) =>
  title.trim().replace(/\s+/g, " ").toLowerCase();
