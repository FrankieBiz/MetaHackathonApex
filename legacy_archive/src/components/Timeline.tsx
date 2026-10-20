import { useMemo, useState } from "react";
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Clock3,
  Pencil,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "../store";
import { useNow } from "../hooks/useNow";
import type { ScheduleEvent, Category } from "../types";
import { dayKey, formatDate, formatTime, DAY } from "../lib/dates";
import { Widget, categoryColor, Badge, Modal, EmptyState } from "./ui";
export function Timeline({
  onAdd,
  onFocus,
  toast,
}: {
  onAdd: () => void;
  onFocus: (goalId?: string) => void;
  toast: (message: string) => void;
}) {
  const events = useWorkspace((s) => s.events),
    assignments = useWorkspace((s) => s.assignments);
  const [view, setView] = useState<"day" | "week" | "timeline">("day"),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ScheduleEvent>();
  const [editing, setEditing] = useState(false);
  const now = useNow(60_000);
  const selectedDay = new Date(now);
  selectedDay.setDate(selectedDay.getDate() + offset);
  selectedDay.setHours(0, 0, 0, 0);
  const merged = useMemo(
    () =>
      [
        ...events,
        ...assignments
          .filter((a) => !a.completed)
          .map((a) => ({
            id: a.id,
            title: a.title,
            start: a.dueAt,
            end: new Date(
              new Date(a.dueAt).getTime() + 30 * 60_000,
            ).toISOString(),
            category: "Academics" as const,
            type: "assignment" as const,
          })),
      ].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      ),
    [events, assignments],
  );
  const dayEvents = merged.filter(
    (e) => dayKey(e.start) === dayKey(selectedDay),
  );
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(selectedDay);
    d.setDate(d.getDate() + i);
    return d;
  });
  return (
    <>
      <Widget id="timeline" title="Your day, connected" icon={CalendarDays}>
        <div className="timeline-toolbar">
          <div className="segmented">
            {(["day", "week", "timeline"] as const).map((v) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {v === "day"
                  ? "Daily flow"
                  : v === "week"
                    ? "7-day"
                    : "Timeline"}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label="Add calendar event"
            onClick={onAdd}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="schedule-date">
          <span>
            {offset === 0
              ? "Today"
              : formatDate(selectedDay, { weekday: "short" })}
            <span className="dot-separator"> · </span>
            {formatDate(selectedDay, { month: "long", day: "numeric" })}
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="Previous day"
              onClick={() => setOffset(offset - (view === "week" ? 7 : 1))}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              className="icon-button"
              aria-label="Go to today"
              onClick={() => setOffset(0)}
            >
              <span className="today-button">Today</span>
            </button>
            <button
              className="icon-button"
              aria-label="Next day"
              onClick={() => setOffset(offset + (view === "week" ? 7 : 1))}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
        {view === "day" && (
          <div className="daily-flow">
            {dayEvents.map((event, i) => {
              const start = new Date(event.start),
                end = new Date(event.end),
                past = end < now,
                active = start <= now && end > now,
                color = categoryColor[event.category];
              return (
                <div
                  className={`flow-item ${past ? "past" : ""} ${active ? "now" : ""}`}
                  key={event.id}
                >
                  <div className="flow-time mono">
                    {formatTime(event.start).replace(/ AM| PM/, "")}
                    <small>
                      {formatTime(event.start).includes("PM") ? "PM" : "AM"}
                    </small>
                  </div>
                  <div className="flow-track">
                    <span className={`flow-dot ${color}`} />
                    {i < dayEvents.length - 1 && <div className="flow-line" />}
                  </div>
                  <button
                    className={`flow-content ${active ? "active" : ""}`}
                    onClick={() => setSelected(event)}
                  >
                    <h3>{event.title}</h3>
                    <div>
                      <span className={`category-label ${color}`}>
                        {event.type === "focus"
                          ? "Deep work"
                          : event.type === "assignment"
                            ? "Assignment due"
                            : event.category}
                      </span>
                      <span className="dot-separator">·</span>
                      <span>
                        {Math.round((end.getTime() - start.getTime()) / 60_000)}{" "}
                        min
                      </span>
                      {active && <Badge color="emerald">Now</Badge>}
                    </div>
                  </button>
                </div>
              );
            })}
            {!dayEvents.length && (
              <EmptyState
                icon={CalendarDays}
                title="A little space in your day"
                description="Add a commitment or block time for a goal."
              />
            )}
          </div>
        )}
        {view === "week" && (
          <div className="week-grid">
            {weekDays.map((day) => (
              <div
                className={`week-day ${dayKey(day) === dayKey(now) ? "today" : ""}`}
                key={day.toISOString()}
              >
                <div className="week-day-title">
                  {formatDate(day, { weekday: "short" })}
                  <strong className="mono">{day.getDate()}</strong>
                </div>
                {merged
                  .filter((e) => dayKey(e.start) === dayKey(day))
                  .map((e) => (
                    <button
                      className={`week-event ${categoryColor[e.category]}`}
                      key={e.id}
                      onClick={() => setSelected(e)}
                    >
                      <span className="mono">{formatTime(e.start)}</span>
                      {e.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
        {view === "timeline" && (
          <div className="gantt">
            <div className="gantt-hours">
              {[8, 10, 12, 14, 16, 18, 20].map((h) => (
                <span className="mono" key={h}>
                  {h}:00
                </span>
              ))}
            </div>
            <div className="gantt-body">
              {dayEvents.map((e) => {
                const d = new Date(e.start),
                  h = d.getHours() + d.getMinutes() / 60;
                return (
                  <div className="gantt-row" key={e.id}>
                    <span>{e.title}</span>
                    <div className="gantt-lane">
                      <button
                        aria-label={e.title}
                        className={`gantt-bar ${categoryColor[e.category]}`}
                        style={{
                          left: `${Math.max(0, Math.min(95, ((h - 8) / 12) * 100))}%`,
                          width: `${Math.max(5, Math.min(100, ((new Date(e.end).getTime() - d.getTime()) / (12 * 3600_000)) * 100))}%`,
                        }}
                        onClick={() => setSelected(e)}
                      />
                    </div>
                  </div>
                );
              })}
              {offset === 0 && now.getHours() >= 8 && now.getHours() <= 20 && (
                <div
                  className="gantt-now"
                  style={{
                    left: `calc(37% + ${((now.getHours() + now.getMinutes() / 60 - 8) / 12) * 63}%)`,
                  }}
                />
              )}
            </div>
          </div>
        )}
        <div className="widget-footer">
          <span>
            <span className="live-dot" />
            {offset === 0 ? "Live schedule" : "Your unified schedule"}
          </span>
          <button className="text-link" onClick={onAdd}>
            Time block
            <ArrowUpRight size={12} />
          </button>
        </div>
      </Widget>
      {selected && editing ? (
        <ScheduleEditor
          initial={selected}
          onClose={() => {
            setSelected(undefined);
            setEditing(false);
          }}
          toast={toast}
        />
      ) : (
        selected && (
          <Modal
            title="Scheduled session"
            onClose={() => setSelected(undefined)}
          >
            <div className="form-body">
              <Badge color={categoryColor[selected.category]}>
                {selected.category}
              </Badge>
              <h3>{selected.title}</h3>
              <p className="subtle">
                {formatDate(selected.start, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <p className="mono">
                {formatTime(selected.start)} – {formatTime(selected.end)}
              </p>
              <div className="modal-footer">
                <button
                  className="button secondary"
                  onClick={() => setSelected(undefined)}
                >
                  Close
                </button>
                {events.some((e) => e.id === selected.id) &&
                  !selected.id.startsWith("import-") && (
                    <button
                      className="button secondary"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil size={13} />
                      Edit block
                    </button>
                  )}
                {selected.type === "focus" && (
                  <button
                    className="button primary"
                    onClick={() => {
                      onFocus(selected.goalId);
                      setSelected(undefined);
                    }}
                  >
                    <Clock3 size={14} />
                    Start focus session
                  </button>
                )}
              </div>
            </div>
          </Modal>
        )
      )}
    </>
  );
}
export function ScheduleEditor({
  initial,
  onClose,
  toast,
}: {
  initial?: ScheduleEvent;
  onClose: () => void;
  toast: (message: string) => void;
}) {
  const goals = useWorkspace((s) => s.goals),
    addEvent = useWorkspace((s) => s.addEvent),
    deleteEvent = useWorkspace((s) => s.deleteEvent);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timeValue = (value: string) => {
    const d = new Date(value);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const [title, setTitle] = useState(initial?.title ?? ""),
    [date, setDate] = useState(dayKey(initial?.start ?? new Date())),
    [start, setStart] = useState(initial ? timeValue(initial.start) : "09:00"),
    [end, setEnd] = useState(initial ? timeValue(initial.end) : "10:00"),
    [category, setCategory] = useState<Category>(
      initial?.category ?? "Software",
    ),
    [goalId, setGoalId] = useState(initial?.goalId ?? "");
  const valid = end > start;
  return (
    <Modal
      title={initial ? "Edit your time block" : "Make time for what matters"}
      onClose={onClose}
    >
      <form
        className="form-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !title.trim()) return;
          addEvent({
            id: initial?.id ?? crypto.randomUUID(),
            title: title.trim(),
            start: new Date(`${date}T${start}`).toISOString(),
            end: new Date(`${date}T${end}`).toISOString(),
            category,
            type: goalId ? "focus" : "commitment",
            goalId: goalId || undefined,
          });
          toast(
            initial
              ? "Time block updated"
              : "Time block added to your schedule",
          );
          onClose();
        }}
      >
        <p className="form-intro">
          Protect a focused session or add a fixed commitment.
        </p>
        <label>
          Session title
          <input
            required
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A focused block of progress"
          />
        </label>
        <label>
          Date
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Start
            <input
              required
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End
            <input
              required
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        {!valid && (
          <p className="form-error">End time must be after start time.</p>
        )}
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {Object.keys(categoryColor).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Linked sprint
          <select
            value={goalId}
            onChange={(e) => {
              setGoalId(e.target.value);
              const goal = goals.find((g) => g.id === e.target.value);
              if (goal) {
                setCategory(goal.category);
                if (!title) setTitle(goal.title + " · Deep work");
              }
            }}
          >
            <option value="">Fixed commitment</option>
            {goals
              .filter(
                (g) => g.kind === "sprint" && (!g.archived || g.id === goalId),
              )
              .map((g) => (
                <option value={g.id} key={g.id}>
                  {g.title}
                </option>
              ))}
          </select>
        </label>
        {initial && (
          <div className="goal-management">
            <span className="input-help">Keep your schedule flexible.</span>
            <button
              type="button"
              className="text-link rose"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} />
              Delete time block
            </button>
          </div>
        )}
        {confirmDelete && initial && (
          <div className="restore-confirm" role="alert">
            <p>Remove “{initial.title}” from your schedule?</p>
            <div className="confirmation-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Keep block
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  deleteEvent(initial.id);
                  toast("Time block deleted");
                  onClose();
                }}
              >
                Delete block
              </button>
            </div>
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!valid || !title.trim()}>
            {initial ? "Save changes" : "Create time block"}
            <Plus size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export const weekFocusMinutes = (events: ScheduleEvent[], now = new Date()) =>
  events
    .filter(
      (e) =>
        e.type === "focus" &&
        new Date(e.start).getTime() - now.getTime() < 7 * DAY &&
        new Date(e.start) > now,
    )
    .reduce(
      (sum, e) =>
        sum +
        (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000,
      0,
    );
