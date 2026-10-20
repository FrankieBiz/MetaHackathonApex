import { useState } from "react";
import {
  Inbox,
  ArrowUpRight,
  Plus,
  Clock3,
  CheckCheck,
  ExternalLink,
  FileText,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { useWorkspace } from "../store";
import type { CanvasAssignment } from "../types";
import { countdown, DAY, formatDate, formatTime } from "../lib/dates";
import { useNow } from "../hooks/useNow";
import { Widget, Badge, Modal, EmptyState } from "./ui";
import { TrajectoryChart } from "./TrajectoryChart";
export function CanvasFeed({
  onConnect,
  toast,
  onOpenSprint,
}: {
  onConnect: () => void;
  toast: (message: string) => void;
  onOpenSprint: () => void;
}) {
  const assignments = useWorkspace((s) => s.assignments),
    convert = useWorkspace((s) => s.convertAssignment),
    goals = useWorkspace((s) => s.goals),
    connection = useWorkspace((s) => s.connection);
  const [filter, setFilter] = useState("week"),
    [selected, setSelected] = useState<CanvasAssignment>(),
    [simulation, setSimulation] = useState<string | null>(null);
  const now = useNow(60_000);
  const active = assignments.filter((a) => !a.completed);
  const filtered = assignments
    .filter((a) => {
      if (filter === "done") return a.completed;
      if (a.completed) return false;
      const remaining = new Date(a.dueAt).getTime() - now.getTime();
      return filter === "overdue"
        ? remaining < 0
        : remaining >= 0 &&
            (filter === "all"
              ? remaining > 7 * DAY
              : remaining <= (filter === "day" ? DAY : 7 * DAY));
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const convertGoal = (assignment: CanvasAssignment) => {
    convert(assignment.id);
    toast("Assignment added to your weekly sprint");
    setSelected(undefined);
    onOpenSprint();
  };
  return (
    <>
      <Widget
        id="canvas"
        icon={Inbox}
        title="Canvas command feed"
        suffix={<span className="header-count">{active.length}</span>}
      >
        <div className="feed-toolbar">
          <div className="tabs">
            {[
              { id: "overdue", title: "Overdue" },
              { id: "day", title: "Next 24h" },
              { id: "week", title: "This week" },
              { id: "all", title: "Upcoming" },
              { id: "done", title: "Completed" },
            ].map((tab) => (
              <button
                className={filter === tab.id ? "active" : ""}
                onClick={() => setFilter(tab.id)}
                key={tab.id}
              >
                {tab.title}
                {tab.id === "day" && (
                  <span className="tab-count">
                    {
                      active.filter(
                        (a) =>
                          new Date(a.dueAt).getTime() >= now.getTime() &&
                          new Date(a.dueAt).getTime() - now.getTime() <= DAY,
                      ).length
                    }
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            title="Sync settings"
            aria-label="Canvas sync settings"
            onClick={onConnect}
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <button
          className="grade-simulator-launch"
          onClick={() => setSimulation("")}
        >
          <TrendingUp size={16} />
          <span>
            <strong>What-if grade simulator</strong>
            <span>Drag a score. See your margin of safety.</span>
          </span>
          <ArrowUpRight size={15} />
        </button>
        <div className="assignment-list">
          {filtered.map((a) => {
            const urgent = new Date(a.dueAt).getTime() - now.getTime() < DAY;
            const converted = goals.some((g) => g.assignmentId === a.id);
            return (
              <div className="assignment" key={a.id}>
                <div className={`assignment-marker ${a.color}`} />
                <button
                  className="assignment-main"
                  onClick={() => setSelected(a)}
                >
                  <h3>{a.title}</h3>
                  <div className="assignment-meta">
                    <Badge color={a.color}>{a.course}</Badge>
                    <span>
                      {a.points !== null ? `${a.points} pts` : "Calendar event"}
                    </span>
                    <span className="dot-separator">·</span>
                    <span>{formatDate(a.dueAt)}</span>
                  </div>
                </button>
                <div className="assignment-right">
                  {!a.completed && a.points !== null && a.points > 0 && (
                    <button
                      className="icon-button"
                      aria-label={`Simulate grade for ${a.title}`}
                      title="Simulate grade"
                      onClick={() => setSimulation(a.id)}
                    >
                      <TrendingUp size={14} />
                    </button>
                  )}
                  <span
                    className={`due-label mono ${a.completed ? "emerald" : urgent ? "amber" : ""}`}
                  >
                    {a.completed ? (
                      <CheckCheck size={12} />
                    ) : (
                      <Clock3 size={11} />
                    )}
                    {a.completed ? "Completed" : countdown(a.dueAt, now)}
                  </span>
                  <button
                    className={`assignment-convert ${converted ? "converted" : ""}`}
                    aria-label={`Add ${a.title} to sprint`}
                    title={
                      converted ? "Open weekly sprint" : "Add to weekly sprint"
                    }
                    onClick={() =>
                      converted ? onOpenSprint() : convertGoal(a)
                    }
                  >
                    {converted ? <CheckCheck size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
          {!filtered.length && (
            <EmptyState
              icon={CheckCheck}
              title={
                connection.kind === "none"
                  ? "Your coursework, connected"
                  : "You’re all caught up"
              }
              description={
                connection.kind === "none"
                  ? "Connect Canvas or import an .ics calendar to bring your deadlines here."
                  : "Nothing in this queue. A little breathing room."
              }
              action={
                connection.kind === "none" ? (
                  <button className="button secondary" onClick={onConnect}>
                    <Plus size={13} />
                    Connect calendar
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
        <div className="widget-footer">
          <span>
            <span
              className={`tiny-dot ${["sample", "none"].includes(connection.kind) ? "amber" : "emerald"}`}
            />
            {connection.kind === "none"
              ? "Ready to connect your calendar"
              : connection.kind === "sample"
                ? "Sample workspace · connect your Canvas"
                : `Last synced ${connection.lastSynced ? formatTime(connection.lastSynced) : "just now"}`}
          </span>
          <button className="text-link" onClick={onConnect}>
            {["sample", "none"].includes(connection.kind)
              ? "Connect"
              : "Manage"}
            <ArrowUpRight size={12} />
          </button>
        </div>
      </Widget>
      {simulation !== null && (
        <Modal
          title="What-if grade simulator"
          wide
          onClose={() => setSimulation(null)}
        >
          <TrajectoryChart
            assignments={assignments}
            initialAssignmentId={simulation || undefined}
          />
        </Modal>
      )}
      {selected && (
        <AssignmentModal
          assignment={assignments.find((a) => a.id === selected.id) ?? selected}
          onClose={() => setSelected(undefined)}
          onConvert={() => convertGoal(selected)}
        />
      )}
    </>
  );
}
function AssignmentModal({
  assignment: a,
  onClose,
  onConvert,
}: {
  assignment: CanvasAssignment;
  onClose: () => void;
  onConvert: () => void;
}) {
  const toggle = useWorkspace((s) => s.toggleAssignment);
  const safeUrl = (url: string) => {
    try {
      return ["https:", "http:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  };
  return (
    <Modal title="Assignment details" onClose={onClose}>
      <div className="form-body">
        <div className="assignment-detail-heading">
          <Badge color={a.color}>{a.course}</Badge>
          <h3>{a.title}</h3>
          <p>
            {formatDate(a.dueAt, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            · {formatTime(a.dueAt)} · {a.points ?? "—"} points
          </p>
        </div>
        <div className="detail-description">
          {a.description || "No description provided."}
        </div>
        {a.rubric.length > 0 && (
          <div className="rubric">
            <h4>Grading rubric</h4>
            {a.rubric.map((r, i) => (
              <div key={i}>
                <span>{r.title}</span>
                <span className="mono">{r.points} pts</span>
              </div>
            ))}
          </div>
        )}
        {a.attachments
          .filter((l) => safeUrl(l.url))
          .map((link, i) => (
            <a
              key={i}
              className="attachment"
              target="_blank"
              rel="noreferrer"
              href={link.url}
            >
              <FileText size={14} />
              {link.title}
              <ExternalLink size={12} />
            </a>
          ))}
        {a.url && safeUrl(a.url) && (
          <a
            className="text-link"
            href={a.url}
            target="_blank"
            rel="noreferrer"
          >
            Open in Canvas
            <ExternalLink size={13} />
          </a>
        )}
        <div className="modal-footer">
          <button className="button secondary" onClick={() => toggle(a.id)}>
            <CheckCheck size={14} />
            {a.completed ? "Reopen" : "Mark complete"}
          </button>
          <button className="button primary" onClick={onConvert}>
            <Plus size={14} />
            Add to sprint
          </button>
        </div>
      </div>
    </Modal>
  );
}
