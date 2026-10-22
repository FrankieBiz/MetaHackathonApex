"use client";

import { useMemo, useState } from "react";
import { create } from "zustand";
import { Key, useEscape, useRestoreFocus } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  downloadCalendarIcs,
  getCalendarPreviewItems,
  getWebcalUrl,
  googleCalendarUrl,
  type CalendarExportOptions,
  type CalendarItemPreview,
} from "@/lib/calendarExport";
import { clock } from "@/lib/format";
import { useTerminal } from "@/store/terminal";

export const useCalendarExport = create<{
  open: boolean;
  courseId: string | null;
  setOpen: (open: boolean, courseId?: string | null) => void;
}>((set) => ({
  open: false,
  courseId: null,
  setOpen: (open, courseId = null) => set({ open, courseId }),
}));

export function CalendarExportModal() {
  const open = useCalendarExport((s) => s.open);
  const courseId = useCalendarExport((s) => s.courseId);
  const setOpen = useCalendarExport((s) => s.setOpen);

  if (!open) return null;
  return (
    <CalendarExportDialog
      initialCourseId={courseId}
      onClose={() => setOpen(false)}
    />
  );
}

function CalendarExportDialog({
  initialCourseId,
  onClose,
}: {
  initialCourseId: string | null;
  onClose: () => void;
}) {
  const data = useTerminal((s) => s.data);
  const [courseFilter, setCourseFilter] = useState<string | null>(initialCourseId);
  const [includeStudyBlocks, setIncludeStudyBlocks] = useState(true);
  const [includeAlarms, setIncludeAlarms] = useState(true);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [copied, setCopied] = useState(false);

  useRestoreFocus();
  useEscape(onClose);

  const options: CalendarExportOptions = useMemo(
    () => ({
      courseId: courseFilter,
      includeStudyBlocks,
      includeAlarms,
      includeCompleted,
    }),
    [courseFilter, includeStudyBlocks, includeAlarms, includeCompleted],
  );

  const now = useNow(60_000);
  const items = useMemo<CalendarItemPreview[]>(() => {
    if (!data) return [];
    return getCalendarPreviewItems(data, options, now);
  }, [data, options, now]);

  const deadlinesCount = items.filter((i) => i.type === "deadline").length;
  const focusCount = items.filter((i) => i.type === "focus").length;
  const webcalUrl = useMemo(() => getWebcalUrl(options), [options]);

  const copyWebcal = async () => {
    try {
      await navigator.clipboard.writeText(webcalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const nextItem = items[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-export-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col border border-line-strong bg-panel shadow-2xl shadow-black">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-head px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="bg-accent px-1.5 py-0.5 text-[10px] font-bold text-canvas uppercase">
              RFC 5545
            </span>
            <h2
              id="calendar-export-title"
              className="text-[13px] font-bold tracking-wider text-ink uppercase"
            >
              Academic Calendar Dispatch & Time-Block Feed
            </h2>
          </div>
          <Key onClick={onClose} aria-label="Close calendar export modal">
            ESC ✕
          </Key>
        </div>

        {/* Metrics Banner */}
        <div className="grid grid-cols-2 gap-2 border-b border-line bg-canvas/40 px-4 py-3 sm:grid-cols-4">
          <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
            <span className="text-[10px] text-ink-3 uppercase">Deadlines</span>
            <span className="text-[18px] font-bold text-accent tabular-nums">
              {deadlinesCount}
            </span>
            <span className="text-[9px] text-ink-3">Milestone VEVENTs</span>
          </div>
          <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
            <span className="text-[10px] text-ink-3 uppercase">Focus Blocks</span>
            <span className="text-[18px] font-bold text-up tabular-nums">
              {focusCount}
            </span>
            <span className="text-[9px] text-ink-3">Scheduled study sessions</span>
          </div>
          <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
            <span className="text-[10px] text-ink-3 uppercase">Alarms Armed</span>
            <span className="text-[18px] font-bold text-ink tabular-nums">
              {includeAlarms ? "24H + 2H" : "OFF"}
            </span>
            <span className="text-[9px] text-ink-3">VALARM notifications</span>
          </div>
          <div className="flex flex-col border border-line-strong bg-panel/60 p-2">
            <span className="text-[10px] text-ink-3 uppercase">Total Feed Events</span>
            <span className="text-[18px] font-bold text-ink tabular-nums">
              {items.length}
            </span>
            <span className="text-[9px] text-ink-3">RFC 5545 components</span>
          </div>
        </div>

        {/* Configuration Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeStudyBlocks}
                onChange={(e) => setIncludeStudyBlocks(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-ink-2">Include Focus Blocks</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAlarms}
                onChange={(e) => setIncludeAlarms(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-ink-2">Include 24h/2h Alarms</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeCompleted}
                onChange={(e) => setIncludeCompleted(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-ink-2">Include Graded Work</span>
            </label>
          </div>

          {data && data.courses.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-ink-3 uppercase">Course:</span>
              <select
                value={courseFilter ?? ""}
                onChange={(e) => setCourseFilter(e.target.value || null)}
                className="border border-line-strong bg-canvas px-2 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
                aria-label="Filter calendar by course"
              >
                <option value="">All Courses ({data.courses.length})</option>
                {data.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.course_code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Primary Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-head px-4 py-2.5">
          <Key
            tone="accent"
            onClick={() => data && downloadCalendarIcs(data, options)}
            disabled={!data || items.length === 0}
            title="Download .ics file to import into Apple Calendar, Google Calendar, or Outlook"
            aria-label="Download calendar .ics file"
          >
            📥 DOWNLOAD .ICS FILE
          </Key>

          <Key
            tone={copied ? "up" : "default"}
            onClick={() => void copyWebcal()}
            title="Copy live webcal:// subscription URL to automatically sync in Calendar"
            aria-label="Copy webcal subscription URL"
          >
            {copied ? "✓ LINK COPIED TO CLIPBOARD" : "🔗 COPY WEBCAL FEED LINK"}
          </Key>

          {nextItem && (
            <a
              href={googleCalendarUrl({
                title: `[${nextItem.courseCode}] ${nextItem.title}`,
                description: nextItem.details,
                start: nextItem.start,
                end: nextItem.end,
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center border border-line-strong px-2.5 py-1 text-[11px] font-bold text-ink transition-colors hover:border-accent hover:bg-hover hover:text-accent"
              title="Add next immediate deliverable to Google Calendar in a new tab"
            >
              📅 OPEN NEXT IN GOOGLE CALENDAR ↗
            </a>
          )}
        </div>

        {/* Feed Schedule Table Preview */}
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-ink-3 uppercase">
              Scheduled Calendar Events ({items.length})
            </span>
            <span className="text-[10px] text-ink-3">
              Standard RFC 5545 VEVENT stream
            </span>
          </div>

          {items.length === 0 ? (
            <div className="border border-line-strong p-8 text-center text-[12px] text-ink-3">
              No calendar events match the current filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto border border-line-strong">
              <table className="w-full text-left text-[11px] tabular-nums">
                <thead className="border-b border-line bg-head text-[10px] text-ink-3 uppercase">
                  <tr>
                    <th className="px-3 py-1.5">Date / Time (UTC)</th>
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5">Course</th>
                    <th className="px-3 py-1.5">Event Title</th>
                    <th className="px-3 py-1.5">Details</th>
                    <th className="px-2 py-1.5 text-right">Quick Add</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 bg-canvas/40">
                  {items.map((item) => {
                    const isDeadline = item.type === "deadline";
                    return (
                      <tr key={item.id} className="hover:bg-hover/50">
                        <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">
                          {clock(item.start, "UTC")}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {isDeadline ? (
                            <span className="border border-down/50 bg-down/10 px-1 py-0.5 text-[9px] font-bold text-down">
                              DEADLINE
                            </span>
                          ) : (
                            <span className="border border-up/50 bg-up/10 px-1 py-0.5 text-[9px] font-bold text-up">
                              FOCUS
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-bold text-ink">
                          {item.courseCode}
                        </td>
                        <td className="px-3 py-1.5 text-ink">
                          {item.title}
                        </td>
                        <td className="px-3 py-1.5 text-ink-3">
                          {item.details}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <a
                            href={googleCalendarUrl({
                              title: `[${item.courseCode}] ${item.title}`,
                              description: item.details,
                              start: item.start,
                              end: item.end,
                            })}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border border-line px-1.5 py-0.5 text-[10px] text-ink-3 transition-colors hover:border-accent hover:text-accent"
                            title="Add this event directly to Google Calendar"
                          >
                            +GCAL
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-head px-4 py-2 text-[10px] text-ink-3">
          <span>
            Universal support: Apple Calendar (macOS/iOS), Google Calendar, Microsoft Outlook
          </span>
          <span className="font-mono text-ink-2">{webcalUrl.slice(0, 45)}...</span>
        </div>
      </div>
    </div>
  );
}
