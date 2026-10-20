import { describe, it, expect } from "vitest";
import { parseCalendar } from "../src/lib/calendar";
const calendar = (events: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apex//EN\r\n${events}\r\nEND:VCALENDAR`;
describe("iCalendar import", () => {
  it("preserves UTC deadlines, unfolds long lines, and extracts Canvas course tags", () => {
    const data = parseCalendar(
      calendar(
        "BEGIN:VEVENT\r\nUID:assignment-1\r\nDTSTART:20261012T180000Z\r\nDTEND:20261012T183000Z\r\nSUMMARY:Assignment due [CS 301]\r\nDESCRIPTION:Build a program and\r\n  test it.\r\nURL:https://school.instructure.com/courses/1/assignments/1\r\nEND:VEVENT",
      ),
      new Date("2026-10-11T12:00:00Z"),
    );
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0].dueAt).toBe("2026-10-12T18:00:00.000Z");
    expect(data.assignments[0].course).toBe("CS 301");
    expect(data.assignments[0].description).toContain("test it.");
    expect(data.events).toHaveLength(0);
  });
  it("expands recurring commitments in the import horizon", () => {
    const data = parseCalendar(
      calendar(
        "BEGIN:VEVENT\r\nUID:weekly-1\r\nDTSTART:20261012T090000Z\r\nDTEND:20261012T100000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Team meeting\r\nEND:VEVENT",
      ),
      new Date("2026-10-11T12:00:00Z"),
    );
    expect(data.events).toHaveLength(3);
    expect(data.events[1].start).toBe("2026-10-19T09:00:00.000Z");
    expect(new Set(data.events.map((e) => e.id)).size).toBe(3);
  });
  it("honors recurrence exceptions and exclusion dates", () => {
    const data = parseCalendar(
      calendar(
        "BEGIN:VEVENT\r\nUID:r1\r\nDTSTART:20261012T090000Z\r\nDTEND:20261012T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261013T090000Z\r\nSUMMARY:Morning session\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:r1\r\nRECURRENCE-ID:20261014T090000Z\r\nDTSTART:20261014T110000Z\r\nDTEND:20261014T120000Z\r\nSUMMARY:Moved session\r\nEND:VEVENT",
      ),
      new Date("2026-10-11T12:00:00Z"),
    );
    expect(data.events).toHaveLength(2);
    expect(data.events[1].title).toBe("Moved session");
    expect(data.events[1].start).toBe("2026-10-14T11:00:00.000Z");
  });
  it("skips cancelled entries and rejects invalid files", () => {
    expect(
      parseCalendar(
        calendar(
          "BEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20261012T090000Z\r\nSUMMARY:Cancelled meeting\r\nSTATUS:CANCELLED\r\nEND:VEVENT",
        ),
      ).events,
    ).toHaveLength(0);
    expect(() => parseCalendar("hello")).toThrow("valid .ics");
    expect(() => parseCalendar("x".repeat(2_000_001))).toThrow("too large");
  });
});
