import ICAL from "ical.js";
import type { CanvasAssignment, ScheduleEvent } from "../types.js";
import { DAY } from "./dates.js";
export function parseCalendar(
  text: string,
  now = new Date(),
): { assignments: CanvasAssignment[]; events: ScheduleEvent[] } {
  if (text.length > 2_000_000)
    throw new Error("Calendar is too large. Maximum file size is 2 MB.");
  if (!text.includes("BEGIN:VCALENDAR"))
    throw new Error("This is not a valid .ics calendar.");
  const root = new ICAL.Component(ICAL.parse(text));
  root.getAllSubcomponents("vtimezone").forEach((c) => {
    const tzid = String(c.getFirstPropertyValue("tzid"));
    ICAL.TimezoneService.register(
      new ICAL.Timezone({ component: c, tzid }),
      tzid,
    );
  });
  const assignments: CanvasAssignment[] = [],
    events: ScheduleEvent[] = [];
  const lower = now.getTime() - 7 * DAY,
    upper = now.getTime() + 90 * DAY;
  const components = root.getAllSubcomponents("vevent");
  const exceptions = components.filter((c) => c.hasProperty("recurrence-id"));
  components
    .filter((c) => !c.hasProperty("recurrence-id"))
    .forEach((component) => {
      const event = new ICAL.Event(component);
      if (
        !event.startDate ||
        component.getFirstPropertyValue("status") === "CANCELLED"
      )
        return;
      exceptions
        .filter((c) => c.getFirstPropertyValue("uid") === event.uid)
        .forEach((c) => event.relateException(new ICAL.Event(c)));
      const occurrences: { start: Date; end: Date; event: ICAL.Event }[] = [];
      if (event.isRecurring()) {
        const iterator = event.iterator();
        for (let i = 0; i < 10_000; i++) {
          const next = iterator.next();
          if (!next) break;
          const occurrence = event.getOccurrenceDetails(next);
          const start = occurrence.startDate.toJSDate(),
            end = occurrence.endDate.toJSDate();
          if (start.getTime() > upper) break;
          if (start.getTime() >= lower)
            occurrences.push({ start, end, event: occurrence.item });
          if (occurrences.length >= 200) break;
        }
      } else {
        const start = event.startDate.toJSDate();
        if (Number.isNaN(start.getTime())) return;
        occurrences.push({ start, end: event.endDate.toJSDate(), event });
      }
      occurrences.forEach(({ start, end, event: e }) => {
        const uid = event.uid || `${e.summary}-${start.toISOString()}`;
        const id = `import-ical-${uid}-${start.toISOString()}`;
        const title =
          String(e.summary || "Untitled event")
            .trim()
            .slice(0, 500) || "Untitled event";
        const description = String(e.description || "");
        const url = String(e.component.getFirstPropertyValue("url") || "");
        const course = title.match(/\[([^\]]+)\]/)?.[1] || "Calendar";
        const assignment = /assignment|quiz|due|exam|\/assignments\//i.test(
          `${title} ${description} ${url}`,
        );
        if (assignment)
          assignments.push({
            id,
            title:
              title.replace(/\s*\[[^\]]+\]/, "").trim() ||
              "Untitled assignment",
            course,
            color: "violet",
            dueAt: start.toISOString(),
            points: null,
            description,
            completed: false,
            source: "ical",
            url: url || undefined,
            rubric: [],
            attachments: [],
          });
        else
          events.push({
            id,
            title,
            start: start.toISOString(),
            end: (end.getTime() > start.getTime()
              ? end
              : new Date(start.getTime() + 30 * 60_000)
            ).toISOString(),
            category: "Personal",
            type: "commitment",
          });
      });
    });
  return { assignments, events };
}
