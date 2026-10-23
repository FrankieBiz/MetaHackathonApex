import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addFocusBlockToCalendar,
  downloadCalendarIcs,
  escapeIcs,
  focusBlockGoogleUrl,
  focusBlockStart,
  foldIcs,
  formatIcsUtc,
  generateClientIcsCalendar,
  generateFocusBlockIcs,
  getCalendarPreviewItems,
  getWebcalUrl,
  googleCalendarUrl,
} from "@/lib/calendarExport";
import type { FocusBlock } from "@/lib/focusBlock";
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

describe("focus block calendar export", () => {
  const HOUR_MS = 3_600_000;
  const START = Date.parse("2026-10-19T12:07:00Z");
  const block = (overrides: Partial<FocusBlock> = {}): FocusBlock => ({
    assignment_id: "a-1",
    course_id: "c-1",
    course_code: "CS-101",
    assignment_title: "Binary Trees Lab",
    due_at: new Date(START + 72 * HOUR_MS).toISOString(),
    break_even_score: 71.5,
    points_locked_in: 4.2,
    downside_floor: 63.75,
    total_minutes: 45,
    tasks: [
      { id: "t1", title: "Sketch the node API", estimated_minutes: 20, is_completed: false },
      { id: "t2", title: "Write insert, delete", estimated_minutes: 25, is_completed: false },
    ],
    policy_reason: "HIGHEST GRADE YIELD · TOP OF QUEUE",
    ...overrides,
  });
  const unfold = (ics: string) => ics.replace(/\r\n /g, "");
  const alarms = (ics: string) =>
    unfold(ics)
      .split("BEGIN:VALARM")
      .slice(1)
      .map((part) => part.split("END:VALARM")[0]);

  it("starts a block on the current minute", () => {
    expect(focusBlockStart(Date.parse("2026-10-19T12:07:41.500Z"))).toBe(START);
    expect(focusBlockStart(START)).toBe(START);
  });

  it("writes one calendar holding exactly one 45 minute event", () => {
    const ics = generateFocusBlockIcs(block(), START, START);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART:20261019T120700Z");
    expect(ics).toContain("DTEND:20261019T125200Z");
    expect(ics).toContain("UID:apex-focus-block-a-1-20261019T120700Z@apex.terminal");
    // Every line break is CRLF: nothing is left once those are removed.
    expect(ics.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });

  it("names the course and deliverable and lists the tasks and grade math", () => {
    const text = unfold(generateFocusBlockIcs(block(), START, START));
    expect(text).toContain("SUMMARY:[FOCUS] CS-101: Binary Trees Lab");
    expect(text).toContain("CATEGORIES:STUDY,FOCUS,CS-101");
    expect(text).toContain("[ ] Sketch the node API (20m)");
    expect(text).toContain("[ ] Write insert\\, delete (25m)");
    expect(text).toContain("HIGHEST GRADE YIELD");
    expect(text).toContain("Break-even score: 71.5%");
    expect(text).toContain("Grade points locked in: +4.2");
  });

  it("escapes separators and newlines in titles", () => {
    const text = unfold(
      generateFocusBlockIcs(
        block({ assignment_title: "Lab 3; part, two\nfinal" }),
        START,
        START,
      ),
    );
    expect(text).toContain("SUMMARY:[FOCUS] CS-101: Lab 3\\; part\\, two\\nfinal");
  });

  it("folds every line to 75 octets", () => {
    const ics = generateFocusBlockIcs(
      block({ assignment_title: "Long ".repeat(60) }),
      START,
      START,
    );
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("warns 24 hours and 2 hours before the deadline", () => {
    const due = START + 72 * HOUR_MS;
    const found = alarms(generateFocusBlockIcs(block(), START, START));
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(
      `TRIGGER;VALUE=DATE-TIME:${formatIcsUtc(new Date(due - 24 * HOUR_MS))}`,
    );
    expect(found[0]).toContain("ACTION:DISPLAY");
    expect(found[0]).toContain("Apex 24h Warning: [CS-101] Binary Trees Lab");
    expect(found[1]).toContain(
      `TRIGGER;VALUE=DATE-TIME:${formatIcsUtc(new Date(due - 2 * HOUR_MS))}`,
    );
    expect(found[1]).toContain("Apex 2h Urgent Warning: [CS-101] Binary Trees Lab");
  });

  it("drops a warning that is already in the past", () => {
    const due = new Date(START + 5 * HOUR_MS).toISOString();
    const found = alarms(generateFocusBlockIcs(block({ due_at: due }), START, START));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Apex 2h Urgent Warning");
  });

  it("sets no alarm for an overdue, imminent, undated, or unparseable deadline", () => {
    for (const due_at of [
      new Date(START - HOUR_MS).toISOString(),
      new Date(START + HOUR_MS).toISOString(),
      null,
      "not a date",
    ]) {
      const ics = generateFocusBlockIcs(block({ due_at }), START, START);
      expect(ics).not.toContain("BEGIN:VALARM");
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    }
  });

  it("prefills a Google Calendar event for the same 45 minutes", () => {
    const url = new URL(focusBlockGoogleUrl(block(), START));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("[FOCUS] CS-101: Binary Trees Lab");
    expect(url.searchParams.get("dates")).toBe("20261019T120700Z/20261019T125200Z");
    expect(url.searchParams.get("details")).toContain("[ ] Sketch the node API (20m)");
  });

  describe("addFocusBlockToCalendar", () => {
    function stubBrowser(popup: { opener: unknown } | null) {
      vi.useFakeTimers();
      vi.setSystemTime(START + 41_500);
      const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
      vi.stubGlobal("document", {
        createElement: vi.fn(() => link),
        body: { appendChild: vi.fn() },
      });
      const open = vi.fn(() => popup);
      vi.stubGlobal("window", { open });
      const blobs: Blob[] = [];
      vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
        blobs.push(blob as Blob);
        return "blob:focus-ics";
      });
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      return { link, open, blobs };
    }

    it("downloads the .ics and opens the prefilled Google Calendar tab", async () => {
      const { link, open, blobs } = stubBrowser({ opener: "page" });
      const result = addFocusBlockToCalendar(block());
      expect(link.download).toBe("apex-focus-block-cs-101-2026-10-19.ics");
      expect(link.href).toBe("blob:focus-ics");
      expect(link.click).toHaveBeenCalledOnce();
      expect(link.remove).toHaveBeenCalledOnce();
      expect(blobs[0].type).toBe("text/calendar;charset=utf-8");
      expect(await blobs[0].text()).toBe(generateFocusBlockIcs(block(), START, START + 41_500));
      expect(open).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith(focusBlockGoogleUrl(block(), START), "_blank");
      expect(result).toEqual({ googleUrl: focusBlockGoogleUrl(block(), START), opened: true });
    });

    it("cuts the new tab's access to this page", () => {
      const popup = { opener: "page" as unknown };
      stubBrowser(popup);
      addFocusBlockToCalendar(block());
      expect(popup.opener).toBeNull();
    });

    it("still downloads and reports a blocked popup", () => {
      const { link } = stubBrowser(null);
      const result = addFocusBlockToCalendar(block());
      expect(link.click).toHaveBeenCalledOnce();
      expect(result.opened).toBe(false);
    });
  });
});
