import type { TerminalState } from "@/types";
import { priorityScore } from "@/lib/engine";

export interface CalendarExportOptions {
  includeStudyBlocks?: boolean;
  includeAlarms?: boolean;
  includeCompleted?: boolean;
  courseId?: string | null;
}

export interface CalendarItemPreview {
  id: string;
  type: "deadline" | "focus" | "event";
  courseCode: string;
  title: string;
  start: Date;
  end: Date;
  details: string;
}

export function formatIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

export function escapeIcs(text: string): string {
  if (!text) return "";
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n|\r|\n/g, "\\n");
}

export function foldIcs(line: string, maxBytes = 75): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= maxBytes) {
    return line;
  }
  const chunks: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = maxBytes;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (curBytes + chBytes > limit) {
      chunks.push(cur);
      cur = " " + ch;
      curBytes = 1 + chBytes;
      limit = maxBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.join("\r\n");
}

export function googleCalendarUrl(params: {
  title: string;
  description?: string;
  start: Date | string | number;
  end?: Date | string | number;
  location?: string;
}): string {
  const startDate = new Date(params.start);
  const endDate = params.end
    ? new Date(params.end)
    : new Date(startDate.getTime() + 45 * 60 * 1000);
  const fmt = (d: Date) => formatIcsUtc(d);

  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", params.title);
  url.searchParams.set("dates", `${fmt(startDate)}/${fmt(endDate)}`);
  if (params.description) {
    url.searchParams.set("details", params.description);
  }
  if (params.location) {
    url.searchParams.set("location", params.location);
  }
  return url.toString();
}

export function getCalendarPreviewItems(
  data: TerminalState,
  options: CalendarExportOptions = {},
  now = Date.now(),
): CalendarItemPreview[] {
  const {
    includeStudyBlocks = true,
    includeCompleted = false,
    courseId = null,
  } = options;

  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  let assignments = data.assignments;
  if (courseId) {
    assignments = assignments.filter((a) => a.course_id === courseId);
  }
  if (!includeCompleted) {
    assignments = assignments.filter((a) => !a.graded);
  }

  const items: CalendarItemPreview[] = [];

  for (const a of assignments) {
    const course = courseMap.get(a.course_id);
    const code = course?.course_code ?? a.course_code;
    const dueTime = a.due_at ? new Date(a.due_at).getTime() : now + 7 * 86400000;
    const startDate = new Date(dueTime);
    const endDate = new Date(dueTime + 30 * 60000);

    items.push({
      id: `deadline-${a.id}`,
      type: "deadline",
      courseCode: code,
      title: `${a.title} (${a.weight}%)`,
      start: startDate,
      end: endDate,
      details: `Target: ${course?.target_score ?? 90}% · Priority: ${priorityScore(a, now).toFixed(1)}`,
    });

    if (includeStudyBlocks && !a.graded && a.subtasks.length > 0) {
      const openSubtasks = a.subtasks.filter((st) => !st.is_completed);
      openSubtasks.forEach((st, idx) => {
        const daysPrior = Math.min(3, Math.max(1, openSubtasks.length - idx));
        const blockStart = new Date(dueTime - daysPrior * 86400000);
        blockStart.setUTCHours(18, idx * 45, 0, 0);
        if (blockStart.getTime() < now) {
          blockStart.setTime(now + 86400000);
          blockStart.setUTCHours(18, idx * 45, 0, 0);
        }
        const blockEnd = new Date(
          blockStart.getTime() + Math.max(25, st.estimated_minutes) * 60000,
        );

        items.push({
          id: `focus-${a.id}-${st.id}`,
          type: "focus",
          courseCode: code,
          title: `Focus: ${st.title}`,
          start: blockStart,
          end: blockEnd,
          details: `Study block for ${a.title} (${st.estimated_minutes} min)`,
        });
      });
    }
  }

  items.sort((x, y) => x.start.getTime() - y.start.getTime());
  return items;
}

export function generateClientIcsCalendar(
  data: TerminalState,
  options: CalendarExportOptions = {},
  now = Date.now(),
): string {
  const {
    includeStudyBlocks = true,
    includeAlarms = true,
    includeCompleted = false,
    courseId = null,
  } = options;

  const refDate = new Date(now);
  const dtstamp = formatIcsUtc(refDate);
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apex OS//Academic Terminal RFC5545//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Apex OS Academic Schedule",
    "X-WR-TIMEZONE:UTC",
  ];

  let assignments = data.assignments;
  if (courseId) {
    assignments = assignments.filter((a) => a.course_id === courseId);
  }
  if (!includeCompleted) {
    assignments = assignments.filter((a) => !a.graded);
  }

  // Sort by due date
  assignments = [...assignments].sort((a, b) => {
    const da = a.due_at ?? "9999-12-31";
    const db = b.due_at ?? "9999-12-31";
    return da.localeCompare(db);
  });

  for (let idx = 0; idx < assignments.length; idx++) {
    const a = assignments[idx];
    const course = courseMap.get(a.course_id);
    const code = course?.course_code ?? a.course_code;
    const courseName = course?.name ?? code;
    const dueTime = a.due_at ? new Date(a.due_at).getTime() : now + 7 * 86400000;
    const startDt = new Date(dueTime);
    const endDt = new Date(dueTime + 30 * 60000);

    const descParts = [
      `Course: ${code} - ${courseName}`,
      `Weight: ${a.weight}%`,
      `Points: ${a.graded && a.score != null ? a.score : "Pending"} / ${a.points_possible}`,
      `Status: ${a.status.toUpperCase()}`,
      `Priority Score: ${priorityScore(a, now).toFixed(1)}`,
    ];
    if (course && course.portfolio_margin != null) {
      descParts.push(
        `Course Margin: ${course.portfolio_margin > 0 ? "+" : ""}${course.portfolio_margin.toFixed(1)}% (Current: ${course.current_score ?? 0}%, Target: ${course.target_score}%)`,
      );
    }
    if (a.subtasks.length > 0) {
      descParts.push("\nRubric Subtasks:");
      for (const st of a.subtasks) {
        descParts.push(`  ${st.is_completed ? "[x]" : "[ ]"} ${st.title} (${st.estimated_minutes}m)`);
      }
    }

    const eventLines = [
      "BEGIN:VEVENT",
      `UID:apex-deadline-${a.id}@apex.terminal`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${formatIcsUtc(startDt)}`,
      `DTEND:${formatIcsUtc(endDt)}`,
      `SUMMARY:${escapeIcs(`[${code}] ${a.title} (${a.weight}%)`)}`,
      `DESCRIPTION:${escapeIcs(descParts.join("\n"))}`,
      `CATEGORIES:ACADEMIC,DEADLINE,${code}`,
      `PRIORITY:${idx < 2 ? 1 : idx < 5 ? 3 : 5}`,
      "STATUS:CONFIRMED",
    ];

    if (includeAlarms) {
      eventLines.push(
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        `DESCRIPTION:Apex 24h Warning: [${code}] ${escapeIcs(a.title)}`,
        "END:VALARM",
        "BEGIN:VALARM",
        "TRIGGER:-PT2H",
        "ACTION:DISPLAY",
        `DESCRIPTION:Apex 2h Urgent Warning: [${code}] ${escapeIcs(a.title)}`,
        "END:VALARM",
      );
    }
    eventLines.push("END:VEVENT");
    lines.push(...eventLines);

    if (includeStudyBlocks && !a.graded && a.subtasks.length > 0) {
      const openSubtasks = a.subtasks.filter((st) => !st.is_completed);
      openSubtasks.forEach((st, sIdx) => {
        const daysPrior = Math.min(3, Math.max(1, openSubtasks.length - sIdx));
        const blockStart = new Date(dueTime - daysPrior * 86400000);
        blockStart.setUTCHours(18, sIdx * 45, 0, 0);
        if (blockStart.getTime() < now) {
          blockStart.setTime(now + 86400000);
          blockStart.setUTCHours(18, sIdx * 45, 0, 0);
        }
        const blockEnd = new Date(
          blockStart.getTime() + Math.max(25, st.estimated_minutes) * 60000,
        );

        const studyLines = [
          "BEGIN:VEVENT",
          `UID:apex-focus-${a.id}-${st.id}@apex.terminal`,
          `DTSTAMP:${dtstamp}`,
          `DTSTART:${formatIcsUtc(blockStart)}`,
          `DTEND:${formatIcsUtc(blockEnd)}`,
          `SUMMARY:${escapeIcs(`[FOCUS] ${code}: ${st.title}`)}`,
          `DESCRIPTION:${escapeIcs(`Targeted focus block for ${a.title}\nEstimated: ${st.estimated_minutes}m\nCourse: ${courseName}`)}`,
          `CATEGORIES:STUDY,FOCUS,${code}`,
          "PRIORITY:3",
          "STATUS:CONFIRMED",
        ];

        if (includeAlarms) {
          studyLines.push(
            "BEGIN:VALARM",
            "TRIGGER:-PT15M",
            "ACTION:DISPLAY",
            `DESCRIPTION:Study Session Starting: [${code}] ${escapeIcs(st.title)}`,
            "END:VALARM",
          );
        }
        studyLines.push("END:VEVENT");
        lines.push(...studyLines);
      });
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map((l) => foldIcs(l)).join("\r\n") + "\r\n";
}

export function downloadCalendarIcs(
  data: TerminalState,
  options: CalendarExportOptions = {},
): void {
  const ics = generateClientIcsCalendar(data, options);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `apex-academic-schedule-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function getWebcalUrl(options: CalendarExportOptions = {}): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000";
  const params = new URLSearchParams();
  if (options.includeStudyBlocks === false) {
    params.set("include_study_blocks", "false");
  }
  if (options.includeAlarms === false) {
    params.set("include_alarms", "false");
  }
  if (options.includeCompleted === true) {
    params.set("include_completed", "true");
  }
  if (options.courseId) {
    params.set("course_id", options.courseId);
  }
  const qs = params.toString() ? `?${params.toString()}` : "";
  const httpUrl = `${origin}/api/v1/portfolio/calendar.ics${qs}`;
  return httpUrl.replace(/^https?:\/\//i, "webcal://");
}
