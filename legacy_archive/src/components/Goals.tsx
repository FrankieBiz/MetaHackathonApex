import { useState } from "react";
import {
  Target,
  Plus,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Layers,
  Flag,
  Code2,
  GraduationCap,
  Activity,
  CircleDollarSign,
  Compass,
  CalendarDays,
  Archive,
  Trash2,
  Pencil,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { Goal, Category } from "../types";
import { useWorkspace } from "../store";
import { goalProgress, completion } from "../lib/goals";
import { dateAfter, daysUntil, dayKey, formatDate } from "../lib/dates";
import {
  Badge,
  CheckButton,
  Progress,
  Widget,
  Modal,
  EmptyState,
  categoryColor,
} from "./ui";
export const categoryIcons = {
  Software: Code2,
  Academics: GraduationCap,
  Athletics: Activity,
  Finance: CircleDollarSign,
  Personal: Compass,
};
export function MacroGoals({
  onAdd,
  onEdit,
}: {
  onAdd: () => void;
  onEdit: (goal: Goal) => void;
}) {
  const goals = useWorkspace((s) => s.goals);
  const [showArchived, setShowArchived] = useState(false);
  const macros = goals.filter(
    (g) => g.kind === "macro" && !!g.archived === showArchived,
  );
  return (
    <Widget
      id="macro"
      title="Long-term goals"
      icon={Target}
      suffix={<span className="header-count">{macros.length}</span>}
    >
      <div className="module-subheading">
        <button
          className="text-link archive-toggle"
          onClick={() => setShowArchived(!showArchived)}
        >
          <Archive size={12} />
          {showArchived ? "Back to active goals" : "Archived goals"}
        </button>
        <button className="text-link" onClick={onAdd}>
          <Plus size={13} />
          New goal
        </button>
      </div>
      <div className="macro-list">
        {macros.map((goal) => {
          const color = categoryColor[goal.category],
            Icon = categoryIcons[goal.category],
            progress = goalProgress(goal, goals);
          return (
            <button
              className="macro-goal"
              key={goal.id}
              onClick={() => onEdit(goal)}
            >
              <div className={`goal-icon ${color}`}>
                <Icon size={19} />
              </div>
              <div className="macro-goal-content">
                <div className="goal-title-row">
                  <h3>{goal.title}</h3>
                  <ArrowUpRight className="goal-arrow" size={15} />
                </div>
                <div className="goal-meta">
                  <span className={`category-label ${color}`}>
                    {goal.category}
                  </span>
                  <span className="dot-separator">·</span>
                  <span>{formatDate(goal.targetDate)}</span>
                  <span className="countdown-badge">
                    T{daysUntil(goal.targetDate) < 0 ? "+" : "−"}
                    {Math.abs(daysUntil(goal.targetDate))}d
                  </span>
                </div>
                <div className="goal-progress-row">
                  <Progress value={progress} color={color} />
                  <span className="mono">{progress}%</span>
                </div>
              </div>
            </button>
          );
        })}
        {!macros.length && (
          <EmptyState
            icon={Target}
            title="Give your ambition a destination"
            description="Create a long-term goal and start chipping away."
          />
        )}
      </div>
      <div className="widget-footer">
        <span>
          <span className="tiny-dot emerald" />
          Progress is built one checkpoint at a time
        </span>
        <Flag size={12} />
      </div>
    </Widget>
  );
}
export function SprintGoals({
  onAdd,
  onEdit,
  toast,
}: {
  onAdd: () => void;
  onEdit: (goal: Goal) => void;
  toast: (message: string) => void;
}) {
  const goals = useWorkspace((s) => s.goals),
    toggleTask = useWorkspace((s) => s.toggleTask),
    addTask = useWorkspace((s) => s.addTask);
  const [showArchived, setShowArchived] = useState(false);
  const sprints = goals.filter(
    (g) => g.kind === "sprint" && !!g.archived === showArchived,
  );
  const [expanded, setExpanded] = useState<string[]>(
    goals
      .filter((g) => g.kind === "sprint" && !g.archived)
      .slice(0, 1)
      .map((g) => g.id),
  );
  const [newTasks, setNewTasks] = useState<Record<string, string>>({});
  const tasks = sprints.flatMap((g) => g.subGoals),
    completed = tasks.filter((t) => t.completed).length;
  return (
    <Widget
      id="sprint"
      title="Weekly sprint"
      icon={Layers}
      suffix={
        <Badge color={showArchived ? "muted" : "emerald"}>
          {showArchived ? "Archive" : "Active"}
        </Badge>
      }
    >
      <div className="sprint-summary">
        <div>
          <span className="eyebrow">
            {showArchived ? "PAST SPRINTS" : "THIS WEEK’S MOMENTUM"}
          </span>
          <p>
            <strong>{completed}</strong>
            <span> / {tasks.length} checkpoints complete</span>
          </p>
        </div>
        <div className="sprint-score mono">
          {completion(tasks)}
          <small>%</small>
        </div>
      </div>
      <Progress value={completion(tasks)} />
      <div className="sprint-list">
        {sprints.map((goal) => {
          const open = expanded.includes(goal.id),
            progress = completion(goal.subGoals);
          return (
            <div
              className={`sprint-goal ${open ? "expanded" : ""}`}
              key={goal.id}
            >
              <div className="sprint-heading">
                <button
                  className="sprint-expand"
                  aria-label={`${open ? "Collapse" : "Expand"} ${goal.title}`}
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded(
                      open
                        ? expanded.filter((i) => i !== goal.id)
                        : [...expanded, goal.id],
                    )
                  }
                >
                  {open ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <span
                    className={`tiny-dot ${categoryColor[goal.category]}`}
                  />
                  <span>{goal.title}</span>
                </button>
                <button
                  className="sprint-percent mono"
                  title="Edit sprint"
                  aria-label={`Edit ${goal.title}`}
                  onClick={() => onEdit(goal)}
                >
                  {progress}% <Pencil size={10} />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="checkpoint-list"
                  >
                    {goal.subGoals.map((task) => (
                      <div
                        className={`checkpoint ${task.completed ? "completed" : ""}`}
                        key={task.id}
                      >
                        <CheckButton
                          checked={task.completed}
                          label={`Complete ${task.title}`}
                          onClick={() => toggleTask(goal.id, task.id)}
                        />
                        <span>{task.title}</span>
                        <span className="task-minutes mono">
                          {task.minutes}m
                        </span>
                      </div>
                    ))}
                    <form
                      className="add-checkpoint"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (newTasks[goal.id]?.trim()) {
                          addTask(goal.id, newTasks[goal.id]);
                          setNewTasks({ ...newTasks, [goal.id]: "" });
                          toast("Checkpoint added to your sprint");
                        }
                      }}
                    >
                      <Plus size={12} />
                      <input
                        aria-label={`Add checkpoint to ${goal.title}`}
                        placeholder="Add a checkpoint…"
                        maxLength={160}
                        value={newTasks[goal.id] ?? ""}
                        onChange={(e) =>
                          setNewTasks({
                            ...newTasks,
                            [goal.id]: e.target.value,
                          })
                        }
                      />
                      <span className="key-hint">↵</span>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {!sprints.length && (
          <EmptyState
            icon={Layers}
            title="A fresh sprint"
            description="Add your first goal for the next seven days."
          />
        )}
      </div>
      <div className="widget-footer">
        <button className="text-link" onClick={onAdd}>
          <Plus size={12} />
          Add sprint goal
        </button>
        <button
          className="text-link archive-toggle"
          onClick={() => setShowArchived(!showArchived)}
        >
          <Archive size={12} />
          {showArchived ? "Active sprints" : "Past sprints"}
        </button>
      </div>
    </Widget>
  );
}
export function GoalEditor({
  initial,
  kind = "sprint",
  onClose,
  toast,
}: {
  initial?: Goal;
  kind?: Goal["kind"];
  onClose: () => void;
  toast: (message: string) => void;
}) {
  const goals = useWorkspace((s) => s.goals),
    saveGoal = useWorkspace((s) => s.saveGoal),
    archiveGoal = useWorkspace((s) => s.archiveGoal),
    deleteGoal = useWorkspace((s) => s.deleteGoal);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? ""),
    [category, setCategory] = useState<Category>(
      initial?.category ?? "Software",
    );
  const [date, setDate] = useState(
    dayKey(initial?.targetDate ?? dateAfter(kind === "macro" ? 30 : 6)),
  );
  const [parentId, setParentId] = useState(initial?.parentId ?? "");
  const goalKind = initial?.kind ?? kind;
  const [items, setItems] = useState(
    initial
      ? goalKind === "macro"
        ? initial.milestones
        : initial.subGoals
      : [],
  );
  const [itemTitle, setItemTitle] = useState("");
  const addItem = () => {
    if (itemTitle.trim()) {
      setItems([
        ...items,
        {
          id: crypto.randomUUID(),
          title: itemTitle.trim(),
          completed: false,
          minutes: 25,
        },
      ]);
      setItemTitle("");
    }
  };
  return (
    <Modal
      title={
        initial
          ? "Goal details"
          : goalKind === "macro"
            ? "Create a long-term goal"
            : "Create a sprint goal"
      }
      onClose={onClose}
    >
      <form
        className="form-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const pending = itemTitle.trim()
            ? [
                ...items,
                {
                  id: crypto.randomUUID(),
                  title: itemTitle.trim(),
                  completed: false,
                  minutes: 25,
                },
              ]
            : items;
          saveGoal({
            id: initial?.id ?? crypto.randomUUID(),
            title: title.trim(),
            category,
            kind: goalKind,
            targetDate: new Date(date + "T23:59:00").toISOString(),
            createdAt: initial?.createdAt ?? new Date().toISOString(),
            parentId: parentId || undefined,
            assignmentId: initial?.assignmentId,
            archived: initial?.archived,
            milestones: goalKind === "macro" ? pending : [],
            subGoals: goalKind === "sprint" ? pending : [],
          });
          toast(initial ? "Goal updated" : "Your new goal is ready");
          onClose();
        }}
      >
        <p className="form-intro">
          {goalKind === "macro"
            ? "Set your north star. Milestones will bring it closer."
            : "Make the next seven days count. Start with small actions."}
        </p>
        <label>
          Goal title
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What do you want to achieve?"
          />
        </label>
        <div className="form-grid">
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {Object.keys(categoryIcons).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span>
              <CalendarDays size={12} />
              Target date
            </span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        {goalKind === "sprint" && (
          <label>
            Linked long-term goal
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Standalone sprint</option>
              {goals
                .filter(
                  (g) =>
                    g.kind === "macro" && (!g.archived || g.id === parentId),
                )
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          {goalKind === "macro" ? "Milestones" : "Micro checkpoints"}
          <span className="input-help">
            Press Enter to add. Edit actions and estimates to fit your day.
          </span>
        </label>
        <div className="editor-checkpoints">
          {items.map((item) => (
            <div className="checkpoint" key={item.id}>
              <CheckButton
                label={`Complete ${item.title}`}
                checked={item.completed}
                onClick={() =>
                  setItems(
                    items.map((t) =>
                      t.id === item.id ? { ...t, completed: !t.completed } : t,
                    ),
                  )
                }
              />
              <input
                className="checkpoint-title-input"
                aria-label={`Checkpoint title: ${item.title}`}
                value={item.title}
                maxLength={160}
                required
                onChange={(e) =>
                  setItems(
                    items.map((t) =>
                      t.id === item.id ? { ...t, title: e.target.value } : t,
                    ),
                  )
                }
              />
              {goalKind === "macro" ? (
                <input
                  className="milestone-date"
                  type="date"
                  aria-label={`Target date for ${item.title}`}
                  value={item.targetDate ? dayKey(item.targetDate) : ""}
                  onChange={(e) =>
                    setItems(
                      items.map((t) =>
                        t.id === item.id
                          ? {
                              ...t,
                              targetDate: e.target.value
                                ? new Date(
                                    e.target.value + "T23:59:00",
                                  ).toISOString()
                                : undefined,
                            }
                          : t,
                      ),
                    )
                  }
                />
              ) : (
                <select
                  className="checkpoint-duration"
                  aria-label={`Minutes for ${item.title}`}
                  value={item.minutes}
                  onChange={(e) =>
                    setItems(
                      items.map((t) =>
                        t.id === item.id
                          ? { ...t, minutes: Number(e.target.value) }
                          : t,
                      ),
                    )
                  }
                >
                  {[...new Set([15, 25, 30, 45, item.minutes])]
                    .sort((a, b) => a - b)
                    .map((v) => (
                      <option key={v} value={v}>
                        {v}m
                      </option>
                    ))}
                </select>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${item.title}`}
                onClick={() => setItems(items.filter((t) => t.id !== item.id))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="input-with-button">
          <input
            value={itemTitle}
            onChange={(e) => setItemTitle(e.target.value)}
            placeholder={
              goalKind === "macro"
                ? "Add a milestone…"
                : "Add a small, concrete action…"
            }
            aria-label="New checkpoint"
            maxLength={160}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Add checkpoint"
            onClick={addItem}
          >
            <Plus size={16} />
          </button>
        </div>
        {initial && (
          <div className="goal-management">
            <button
              type="button"
              className="text-link"
              onClick={() => {
                archiveGoal(initial.id);
                toast(
                  initial.archived
                    ? "Goal restored to your workspace"
                    : "Goal archived. Progress is kept in your history.",
                );
                onClose();
              }}
            >
              <Archive size={14} />
              {initial.archived ? "Restore goal" : "Archive goal"}
            </button>
            <button
              type="button"
              className="text-link rose"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              Delete goal
            </button>
          </div>
        )}
        {confirmDelete && initial && (
          <div className="restore-confirm" role="alert">
            <p>
              Delete “{initial.title}” and its checkpoints? Linked sprints stay
              in your workspace. This cannot be undone.
            </p>
            <div className="confirmation-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Keep goal
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  deleteGoal(initial.id);
                  toast("Goal deleted");
                  onClose();
                }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        )}
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={!title.trim()}
          >
            {initial ? "Save changes" : "Create goal"}
            <ArrowUpRight size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
