import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  ArrowUpRight,
  Headphones,
  Check,
  Timer,
} from "lucide-react";
import { useWorkspace } from "../store";
import { useNow } from "../hooks/useNow";
import { Modal, Badge } from "./ui";
export function FocusTimer({
  compact = false,
  onOpen,
  toast,
}: {
  compact?: boolean;
  onOpen?: () => void;
  toast: (message: string) => void;
}) {
  const focus = useWorkspace((s) => s.focus),
    start = useWorkspace((s) => s.startFocus),
    pause = useWorkspace((s) => s.pauseFocus),
    reset = useWorkspace((s) => s.resetFocus),
    finish = useWorkspace((s) => s.finishFocus),
    goals = useWorkspace((s) => s.goals);
  const now = useNow();
  const remaining =
    focus.running && focus.endAt
      ? Math.max(0, Math.ceil((focus.endAt - now.getTime()) / 1000))
      : focus.remaining;
  useEffect(() => {
    if (focus.running && remaining === 0) {
      finish();
      toast("Focus session complete. Well done.");
    }
  }, [remaining, focus.running, finish, toast]);
  const [goalId, setGoalId] = useState(focus.goalId ?? "");
  const label = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const toggle = () =>
    focus.running
      ? pause()
      : compact
        ? start()
        : start(undefined, goalId || null);
  if (compact)
    return (
      <div className={`sidebar-focus ${focus.running ? "running" : ""}`}>
        <div className="sidebar-focus-title">
          <span>
            <span className="tiny-dot emerald" />
            FOCUS MODE
          </span>
          <button
            className="icon-button"
            aria-label="Open focus room"
            onClick={onOpen}
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="sidebar-focus-clock">
          <span className="mono">{label}</span>
          <button
            className="focus-play"
            aria-label={
              focus.running ? "Pause focus timer" : "Start focus timer"
            }
            onClick={toggle}
          >
            {focus.running ? (
              <Pause size={14} />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
          </button>
        </div>
        <p>One task. Your full attention.</p>
      </div>
    );
  return (
    <div className="focus-room">
      <div className="focus-room-icon">
        <Headphones size={28} />
      </div>
      <Badge color="emerald">
        {focus.running ? "Focus session active" : "Find your flow"}
      </Badge>
      <h3>Give your ambition some quiet.</h3>
      <p>Close the noise. Make one meaningful step forward.</p>
      <div className="focus-duration">
        {[15, 25, 45, 60].map((m) => (
          <button
            disabled={focus.running}
            className={focus.duration === m ? "active" : ""}
            onClick={() => reset(m)}
            key={m}
          >
            {m} min
          </button>
        ))}
      </div>
      <div className="focus-big-clock mono">{label}</div>
      <div className="focus-progress">
        <div
          style={{ width: `${(1 - remaining / (focus.duration * 60)) * 100}%` }}
        />
      </div>
      <label>
        What are you working on?
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          disabled={focus.running}
        >
          <option value="">A little uninterrupted progress</option>
          {goals
            .filter((g) => g.kind === "sprint" && !g.archived)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
        </select>
      </label>
      <div className="focus-controls">
        <button
          className="button secondary"
          onClick={() => reset(focus.duration)}
          aria-label="Reset focus timer"
        >
          <RotateCcw size={16} />
        </button>
        <button className="button primary" onClick={toggle}>
          {focus.running ? <Pause size={16} /> : <Play size={16} />}{" "}
          {focus.running ? "Pause session" : "Begin focus session"}
        </button>
        {(focus.running || remaining < focus.duration * 60) && (
          <button
            className="button secondary"
            title="Record this as a completed session"
            onClick={() => {
              finish();
              toast("Focus session recorded");
            }}
          >
            <Check size={16} />
            Finish
          </button>
        )}
      </div>
      <span className="focus-tip">
        <Timer size={12} />A checkpoint at a time. That’s how big things happen.
      </span>
    </div>
  );
}
export function FocusModal({
  onClose,
  toast,
}: {
  onClose: () => void;
  toast: (message: string) => void;
}) {
  return (
    <Modal title="Deep work focus" onClose={onClose} wide>
      <FocusTimer toast={toast} />
    </Modal>
  );
}
