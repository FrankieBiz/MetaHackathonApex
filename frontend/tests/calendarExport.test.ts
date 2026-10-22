import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadCalendarIcs,
  escapeIcs,
  foldIcs,
  formatIcsUtc,
  generateClientIcsCalendar,
  getCalendarPreviewItems,
  getWebcalUrl,
  googleCalendarUrl,
} from "@/lib/calendarExport";
import { createMockState } from "@/lib/mockData";

const NOW = Date.parse("2026-10-19T12:00:00Z");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("calendar export utilities", () => {
  it("formats dates into RFC 5545 UTC compact format", () => {
    const d = new Date("2026-10-22T14:30:00Z");
    expect(formatIcsUtc(d)).toBe("20261022T143000Z");
  });

  it("escapes special characters per RFC 5545 section 3.3.11", () => {
    const raw = "Note: test, comma; semicolon \\ backslash\nNewline";
    const escaped = escapeIcs(raw);
    expect(escaped).toContain("\\,");
    expect(escaped).toContain("\\;");
    expect(escaped).toContain("\\\\");
    expect(escaped).toContain("\\n");
    expect(escaped).not.toContain("\n");
  });

  it("folds lines exceeding 75 octets with space continuation", () => {
    const short = "SUMMARY:Short line";
    expect(foldIcs(short)).toBe(short);

    const long = "DESCRIPTION:" + "A".repeat(150);
    const folded = foldIcs(long);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith(" ")).toBe(true);
    }
  });

  it("generates valid Google Calendar URL", () => {
    const url = googleCalendarUrl({
      title: "CS 101 Midterm",
      description: "Algorithms review",
      start: new Date("2026-11-01T15:00:00Z"),
      end: new Date("2026-11-01T17:00:00Z"),
      location: "Hall A",
    });
    expect(url).toContain("calendar.google.com/calendar/render");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("text=CS+101+Midterm");
    expect(url).toContain("20261101T150000Z%2F20261101T170000Z");
    expect(url).toContain("details=Algorithms+review");
    expect(url).toContain("location=Hall+A");
  });

  it("constructs webcal:// URLs with query parameters", () => {
    const url = getWebcalUrl({
      includeStudyBlocks: false,
      includeAlarms: true,
      includeCompleted: true,
      courseId: "course-123",
    });
    expect(url).toMatch(/^webcal:\/\//);
    expect(url).toContain("/api/v1/portfolio/calendar.ics");
    expect(url).toContain("include_study_blocks=false");
    expect(url).toContain("include_completed=true");
    expect(url).toContain("course_id=course-123");
  });
});

describe("calendar preview items", () => {
  it("extracts deadlines and focus blocks from state", () => {
    const data = createMockState(NOW);
    const items = getCalendarPreviewItems(data, {
      includeStudyBlocks: true,
      includeCompleted: false,
    }, NOW);

    expect(items.length).toBeGreaterThan(0);
    const deadlines = items.filter((i) => i.type === "deadline");
    const focusBlocks = items.filter((i) => i.type === "focus");

    expect(deadlines.length).toBeGreaterThan(0);
    expect(focusBlocks.length).toBeGreaterThan(0);
    expect(items[0].start.getTime()).toBeLessThanOrEqual(items[items.length - 1].start.getTime());
  });

  it("filters preview items by courseId", () => {
    const data = createMockState(NOW);
    const targetCourse = data.courses[0];
    const items = getCalendarPreviewItems(data, {
      courseId: targetCourse.id,
      includeStudyBlocks: true,
      includeCompleted: true,
    }, NOW);

    for (const item of items) {
      expect(item.courseCode).toBe(targetCourse.course_code);
    }
  });
});

describe("generateClientIcsCalendar", () => {
  it("generates compliant RFC 5545 iCalendar stream with VCALENDAR container", () => {
    const data = createMockState(NOW);
    const ics = generateClientIcsCalendar(data, {
      includeStudyBlocks: true,
      includeAlarms: true,
      includeCompleted: false,
    }, NOW);

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Apex OS//Academic Terminal RFC5545//EN");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("X-WR-CALNAME:Apex OS Academic Schedule");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:apex-deadline-");
    expect(ics).toContain("CATEGORIES:ACADEMIC,DEADLINE,");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("TRIGGER:-PT2H");
    expect(ics).toContain("UID:apex-focus-");
    expect(ics).toContain("CATEGORIES:STUDY,FOCUS,");
  });

  it("supports excluding alarms and study blocks", () => {
    const data = createMockState(NOW);
    const ics = generateClientIcsCalendar(data, {
      includeStudyBlocks: false,
      includeAlarms: false,
      includeCompleted: false,
    }, NOW);

    expect(ics).not.toContain("BEGIN:VALARM");
    expect(ics).not.toContain("UID:apex-focus-");
    expect(ics).toContain("UID:apex-deadline-");
  });

  it("triggers download without crashing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const data = createMockState(NOW);
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { appendChild: vi.fn() },
    });

    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:calendar-ics");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    downloadCalendarIcs(data);
    expect(link.download).toBe("apex-academic-schedule-2026-10-19.ics");
    expect(link.href).toBe("blob:calendar-ics");
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalled();

    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:calendar-ics");
  });
});
