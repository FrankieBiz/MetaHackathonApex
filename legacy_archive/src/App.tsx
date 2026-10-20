import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Responsive, type Layout } from "react-grid-layout";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Target,
  Inbox,
  CalendarDays,
  Headphones,
  Settings2,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Plus,
  ArrowUpRight,
  LockKeyhole,
  LockKeyholeOpen,
  RotateCcw,
  SlidersHorizontal,
  Check,
  X,
  Command,
  ArrowRight,
  Activity,
  Layers,
  CircleHelp,
  Menu,
  CircleCheck,
  Clock3,
  Zap,
  PanelLeftClose,
} from "lucide-react";
import type { Goal, WidgetId } from "./types";
import { Onboarding } from "./components/Onboarding";
import { storageStatus } from "./lib/persistence";
import { useWorkspace } from "./store";
import { completion, goalProgress } from "./lib/goals";
import { dayKey, formatDate, formatTime, DAY } from "./lib/dates";
import { presets } from "./data/presets";
import { useNow } from "./hooks/useNow";
import { Badge, Modal, EmptyState } from "./components/ui";
import { MacroGoals, SprintGoals, GoalEditor } from "./components/Goals";
import { CanvasFeed } from "./components/CanvasFeed";
import { Timeline, ScheduleEditor } from "./components/Timeline";
import { FocusTimer, FocusModal } from "./components/Focus";
import { Scratchpad, Deconstructor } from "./components/Scratchpad";
import { Settings, type SyncResult } from "./components/Settings";
const Grid = Responsive;
type View = "overview" | "goals" | "canvas" | "schedule" | "focus";
const navItems = [
  { id: "overview" as const, title: "Command center", icon: LayoutDashboard },
  { id: "goals" as const, title: "Goals & sprints", icon: Target },
  { id: "canvas" as const, title: "Canvas inbox", icon: Inbox },
  { id: "schedule" as const, title: "Schedule", icon: CalendarDays },
  { id: "focus" as const, title: "Focus room", icon: Headphones },
];
const widgetNames: Record<WidgetId, string> = {
  macro: "Long-term goals",
  sprint: "Weekly sprint",
  canvas: "Canvas feed",
  timeline: "Unified schedule",
  deconstructor: "Task deconstructor",
  scratchpad: "Scratchpad",
};
function LiveClock() {
  const now = useNow();
  const goals = useWorkspace((s) => s.goals);
  const score = completion(
    goals
      .filter((g) => g.kind === "sprint" && !g.archived)
      .flatMap((g) => g.subGoals),
  );
  const timezone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return (
    <>
      <div className="header-productivity">
        <Zap size={12} />
        <span className="mono">{score}%</span>
        <span>Sprint</span>
      </div>
      <div className="live-clock">
        <span className="live-dot" />
        <span className="mono">
          {now.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}
        </span>
        <span className="timezone">{timezone}</span>
      </div>
    </>
  );
}
function Sparkline({
  color = "emerald",
  values,
}: {
  color?: string;
  values: number[];
}) {
  const max = Math.max(1, ...values);
  const path = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${1 + (i * 88) / Math.max(1, values.length - 1)} ${27 - (v / max) * 24}`,
    )
    .join(" ");
  return (
    <svg
      className={`sparkline ${color}`}
      width="90"
      height="30"
      viewBox="0 0 90 30"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`fade-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".13" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L89 30 L1 30Z`} fill={`url(#fade-${color})`} />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function Metrics({ onView }: { onView: (view: View) => void }) {
  const goals = useWorkspace((s) => s.goals),
    assignments = useWorkspace((s) => s.assignments),
    sessions = useWorkspace((s) => s.sessions),
    events = useWorkspace((s) => s.events);
  const tasks = goals
      .filter((g) => g.kind === "sprint" && !g.archived)
      .flatMap((g) => g.subGoals),
    score = completion(tasks),
    done = tasks.filter((t) => t.completed).length;
  const now = new Date(),
    due = assignments.filter(
      (a) =>
        !a.completed &&
        new Date(a.dueAt).getTime() >= now.getTime() &&
        new Date(a.dueAt).getTime() - now.getTime() <= 7 * DAY,
    );
  const minutes = sessions
    .filter((s) => dayKey(s.completedAt) === dayKey(now))
    .reduce((sum, s) => sum + s.minutes, 0);
  const focusBlocks = events.filter(
    (e) => e.type === "focus" && dayKey(e.start) === dayKey(now),
  ).length;
  const macros = goals.filter((g) => g.kind === "macro" && !g.archived);
  const recentFocus = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now);
    day.setDate(day.getDate() - 6 + i);
    return sessions
      .filter((s) => dayKey(s.completedAt) === dayKey(day))
      .reduce((sum, s) => sum + s.minutes, 0);
  });
  return (
    <div className="metrics-row">
      <button
        className="metric-card productivity"
        onClick={() => onView("goals")}
      >
        <div className="metric-top">
          <span>Sprint productivity</span>
          <div className="metric-icon emerald">
            <Zap size={15} />
          </div>
        </div>
        <div className="metric-main">
          <strong className="mono">
            {score}
            <span>%</span>
          </strong>
          <div
            className="mini-ring"
            style={{
              background: `conic-gradient(var(--green) ${score}%, #28322e 0)`,
            }}
          >
            <span>
              <ArrowUpRight size={14} />
            </span>
          </div>
        </div>
        <div className="metric-bottom">
          <span className="emerald">
            <CircleCheck size={11} />
            {done} checkpoints done
          </span>
          <span className="subtle">of {tasks.length}</span>
        </div>
      </button>
      <button className="metric-card" onClick={() => onView("goals")}>
        <div className="metric-top">
          <span>Active ambitions</span>
          <div className="metric-icon violet">
            <Target size={15} />
          </div>
        </div>
        <div className="metric-main">
          <strong className="mono">
            {macros.length.toString().padStart(2, "0")}
          </strong>
          <div className="macro-mini-bars">
            {macros.slice(0, 6).map((g) => (
              <span
                key={g.id}
                style={{ height: `${Math.max(15, goalProgress(g, goals))}%` }}
              />
            ))}
          </div>
        </div>
        <div className="metric-bottom">
          <span className="subtle">Long-term goals in motion</span>
          <ArrowUpRight size={13} />
        </div>
      </button>
      <button className="metric-card" onClick={() => onView("canvas")}>
        <div className="metric-top">
          <span>On your radar</span>
          <div className="metric-icon amber">
            <Inbox size={15} />
          </div>
        </div>
        <div className="metric-main">
          <strong className="mono">
            {due.length.toString().padStart(2, "0")}
          </strong>
          <div className="radar-dots">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} className={i < due.length ? "lit" : ""} />
            ))}
          </div>
        </div>
        <div className="metric-bottom">
          <span className="subtle">Assignments due this week</span>
          <span className="amber">
            {
              due.filter(
                (a) => new Date(a.dueAt).getTime() - now.getTime() < DAY,
              ).length
            }{" "}
            urgent
          </span>
        </div>
      </button>
      <button className="metric-card" onClick={() => onView("focus")}>
        <div className="metric-top">
          <span>Deep work today</span>
          <div className="metric-icon cyan">
            <Clock3 size={15} />
          </div>
        </div>
        <div className="metric-main">
          <strong className="mono">
            {Math.floor(minutes / 60)}
            <span>h </span>
            {minutes % 60}
            <span>m</span>
          </strong>
          <Sparkline color="cyan" values={recentFocus} />
        </div>
        <div className="metric-bottom">
          <span className="subtle">{focusBlocks} focus blocks scheduled</span>
          <ArrowUpRight size={13} />
        </div>
      </button>
    </div>
  );
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    void error;
    void info; /* Keep workspace data intact on component errors. */
  }
  render() {
    return this.state.error ? (
      <div className="app-error">
        <Target size={30} />
        <h1>The workspace needs a fresh start.</h1>
        <p>Your saved goals and notes are still on this device.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload workspace
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <Workspace />
    </ErrorBoundary>
  );
}
function Workspace() {
  const [view, setView] = useState<View>("overview"),
    [dialog, setDialog] = useState<
      | "settings"
      | "goal"
      | "sprint"
      | "schedule"
      | "focus"
      | "command"
      | "activity"
      | "help"
      | null
    >(null),
    [editGoal, setEditGoal] = useState<Goal>(),
    [customize, setCustomize] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false),
    [toastMessage, setToastMessage] = useState(""),
    [subscribedUrl, setSubscribedUrl] = useState("");
  const name = useWorkspace((s) => s.name),
    locked = useWorkspace((s) => s.locked),
    setLocked = useWorkspace((s) => s.setLocked),
    setPreset = useWorkspace((s) => s.setPreset),
    preset = useWorkspace((s) => s.preset),
    layouts = useWorkspace((s) => s.layouts),
    visible = useWorkspace((s) => s.visible),
    collapsed = useWorkspace((s) => s.collapsed),
    toggleWidget = useWorkspace((s) => s.toggleWidget),
    setLayouts = useWorkspace((s) => s.setLayouts),
    assignments = useWorkspace((s) => s.assignments),
    hydrated = useWorkspace((s) => s.hydrated),
    onboardingComplete = useWorkspace((s) => s.onboardingComplete),
    connection = useWorkspace((s) => s.connection);
  const saveStatus = useSyncExternalStore(
    storageStatus.subscribe,
    storageStatus.get,
  );
  const now = useNow(60_000);
  const gridContainer = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useLayoutEffect(() => {
    const node = gridContainer.current;
    if (!node) return;
    const measure = () => setGridWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hydrated, onboardingComplete, view]);
  const toast = useCallback((message: string) => setToastMessage(message), []);
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(""), 3500);
    return () => clearTimeout(timer);
  }, [toastMessage]);
  useEffect(() => {
    if (saveStatus === "error")
      toast(
        "Storage is unavailable. Export a backup from Settings to keep your changes.",
      );
  }, [saveStatus, toast]);
  const onView = useCallback((v: View) => {
    const state = useWorkspace.getState();
    const required: Partial<Record<View, WidgetId[]>> = {
      goals: ["macro", "sprint"],
      canvas: ["canvas"],
      schedule: ["timeline"],
    };
    required[v]?.forEach((id) => {
      if (!state.visible.includes(id)) state.toggleWidget(id);
    });
    setView(v);
    setMobileMenu(false);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!useWorkspace.getState().onboardingComplete) return;
      const input =
        e.target instanceof HTMLElement &&
        e.target.closest("input,textarea,select,[contenteditable]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog((d) => (d === "command" ? null : "command"));
      } else if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        onView(navItems[Number(e.key) - 1].id);
      } else if (!input && !dialog && e.key === "n") {
        e.preventDefault();
        setEditGoal(undefined);
        setDialog("sprint");
      } else if (!input && !dialog && e.key === "?") {
        setDialog("help");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onView, dialog]);
  useEffect(() => {
    if (!subscribedUrl) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: subscribedUrl }),
          signal: AbortSignal.timeout(55_000),
        });
        if (!response.ok) throw new Error();
        const data: SyncResult = await response.json();
        useWorkspace.getState().importData(data.assignments, data.events, {
          domain: "",
          kind: "ical",
          lastSynced: new Date().toISOString(),
        });
      } catch {
        toast("Calendar refresh failed. Check your connection in Settings.");
      }
    }, 15 * 60_000);
    return () => clearInterval(timer);
  }, [subscribedUrl, toast]);
  const openEdit = useCallback((goal: Goal) => {
    setEditGoal(goal);
    setDialog(goal.kind === "macro" ? "goal" : "sprint");
  }, []);
  const openNew = (kind: "goal" | "sprint") => {
    setEditGoal(undefined);
    setDialog(kind);
  };
  const openSprint = useCallback(() => {
    onView("goals");
  }, [onView]);
  const openFocus = useCallback((goalId?: string) => {
    if (goalId) useWorkspace.getState().startFocus(25, goalId);
    setDialog("focus");
  }, []);
  const visibleIds = useMemo(
    () =>
      (view === "goals"
        ? (["macro", "sprint", "deconstructor"] as WidgetId[])
        : view === "canvas"
          ? (["canvas", "deconstructor"] as WidgetId[])
          : view === "schedule"
            ? (["timeline", "scratchpad"] as WidgetId[])
            : visible
      ).filter((id) => visible.includes(id)),
    [view, visible],
  );
  const gridLayouts = useMemo(() => {
    let filtered = layouts.filter((l) => visibleIds.includes(l.i));
    if (view !== "overview")
      filtered = visibleIds.map((i, index) => ({
        ...(filtered.find((l) => l.i === i) ??
          presets[0].layouts.find((l) => l.i === i)!),
        x: index === 1 ? 7 : 0,
        y: index > 1 ? 16 : 0,
        w: index === 1 ? 5 : 7,
        h: 16,
      }));
    filtered = filtered.map((l) =>
      collapsed.includes(l.i) ? { ...l, h: 2, minH: 2, maxH: 2 } : l,
    );
    const stack = filtered.map((l, i) => ({
      ...l,
      x: 0,
      y: i * 18,
      w: 1,
      minW: 1,
    }));
    const tablet = filtered.map((l, i) => ({
      ...l,
      x: 0,
      y: i * 18,
      w: 6,
      minW: 3,
    }));
    return { lg: filtered, md: filtered, sm: tablet, xs: stack, xxs: stack };
  }, [layouts, visibleIds, collapsed, view]);
  const layoutChange = useCallback(
    (next: Layout[]) => {
      if (view !== "overview" || locked || gridWidth < 900) return;
      const updated = next.map((l) => ({
        i: l.i as WidgetId,
        x: l.x,
        y: l.y,
        w: l.w,
        h: collapsed.includes(l.i as WidgetId)
          ? layouts.find((old) => old.i === l.i)!.h
          : l.h,
        minW: l.minW,
        minH: collapsed.includes(l.i as WidgetId) ? 6 : l.minH,
      }));
      if (
        updated.some((l) => {
          const old = layouts.find((o) => o.i === l.i);
          return (
            !old ||
            old.x !== l.x ||
            old.y !== l.y ||
            old.w !== l.w ||
            old.h !== l.h
          );
        })
      )
        setLayouts(updated);
    },
    [view, locked, collapsed, layouts, setLayouts, gridWidth],
  );
  const renderWidget = (id: WidgetId) => {
    if (id === "macro")
      return <MacroGoals onAdd={() => openNew("goal")} onEdit={openEdit} />;
    if (id === "sprint")
      return (
        <SprintGoals
          onAdd={() => openNew("sprint")}
          onEdit={openEdit}
          toast={toast}
        />
      );
    if (id === "canvas")
      return (
        <CanvasFeed
          onConnect={() => setDialog("settings")}
          toast={toast}
          onOpenSprint={openSprint}
        />
      );
    if (id === "timeline")
      return (
        <Timeline
          onAdd={() => setDialog("schedule")}
          onFocus={openFocus}
          toast={toast}
        />
      );
    if (id === "deconstructor")
      return <Deconstructor toast={toast} onOpenSprint={openSprint} />;
    return <Scratchpad />;
  };
  const viewTitle =
    view === "overview"
      ? "Your ambition. In motion."
      : view === "goals"
        ? "Big goals. Small steps."
        : view === "canvas"
          ? "Stay one step ahead."
          : view === "schedule"
            ? "Make room for what matters."
            : "A little space to focus.";
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";
  if (!hydrated)
    return (
      <div className="loading-screen">
        <div className="apex-mark">A</div>
        <span className="mono">
          OPENING YOUR WORKSPACE<span className="loading-dots">…</span>
        </span>
      </div>
    );
  if (!onboardingComplete) return <Onboarding />;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onView("overview");
          }}
        >
          <div className="apex-mark">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m4 19 8-15 8 15h-5l-3-6-3 6H4Z" fill="currentColor" />
            </svg>
          </div>
          <span>
            APEX<span className="brand-os"> OS</span>
          </span>
          <span className="brand-beta">1.0</span>
        </a>
        <div className="workspace-switch">
          <div className="workspace-avatar">
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>Personal workspace</strong>
            <span>
              <span className="tiny-dot emerald" />
              All systems ready
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="Workspace settings"
            onClick={() => setDialog("settings")}
          >
            <ChevronsUpDown size={13} />
          </button>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav>
          {navItems.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => onView(item.id)}
            >
              <item.icon size={17} />
              <span>{item.title}</span>
              {item.id === "canvas" ? (
                <span className="nav-count">
                  {assignments.filter((a) => !a.completed).length}
                </span>
              ) : item.id === "overview" ? (
                <span className="nav-shortcut">⌘ 1</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-label modules-label">
          <span>YOUR MODULES</span>
          <button
            className="icon-button"
            aria-label="Customize modules"
            onClick={() => setCustomize(!customize)}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="module-nav">
          {[
            {
              id: "macro",
              title: "Long-term goals",
              color: "emerald",
              view: "goals",
            },
            {
              id: "sprint",
              title: "Weekly sprint",
              color: "violet",
              view: "goals",
            },
            {
              id: "deconstructor",
              title: "AI deconstructor",
              color: "cyan",
              view: "overview",
            },
            {
              id: "scratchpad",
              title: "Scratchpad",
              color: "amber",
              view: "overview",
            },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                const state = useWorkspace.getState();
                if (!state.visible.includes(item.id as WidgetId))
                  state.toggleWidget(item.id as WidgetId);
                onView(item.view as View);
                setTimeout(
                  () =>
                    document
                      .querySelector(`[data-widget="${item.id}"]`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                  120,
                );
              }}
            >
              <span className={`module-dot ${item.color}`} />
              {item.title}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <FocusTimer compact onOpen={() => setDialog("focus")} toast={toast} />
          <button
            className="sidebar-settings"
            onClick={() => setDialog("settings")}
          >
            <Settings2 size={16} />
            Settings & integrations
          </button>
          <button
            className="sidebar-settings"
            onClick={() => setDialog("help")}
          >
            <CircleHelp size={16} />
            Keyboard shortcuts<span className="key-hint">?</span>
          </button>
          <div className="sidebar-profile">
            <div className="profile-avatar">
              {name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{name}’s workspace</strong>
              <span>Personal plan</span>
            </div>
            <button
              className="icon-button"
              aria-label="Edit profile"
              onClick={() => setDialog("settings")}
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="sidebar-status">
            <span>
              <span className="live-dot" />
              SYSTEM ONLINE
            </span>
            <span className="mono">v1.0</span>
          </div>
        </div>
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        >
          <PanelLeftClose size={18} />
        </button>
      </aside>
      {mobileMenu && (
        <div
          className="mobile-sidebar-overlay"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-button mobile-menu-toggle"
              aria-label="Open navigation"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={19} />
            </button>
            <LayoutDashboard size={15} />
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{navItems.find((n) => n.id === view)?.title}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="search-trigger"
              aria-label="Search workspace"
              onClick={() => setDialog("command")}
            >
              <Search size={15} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <div className="topbar-separator" />
            <LiveClock />
            <button
              className="notification-button icon-button"
              aria-label="Open recent activity"
              onClick={() => setDialog("activity")}
            >
              <Activity size={17} />
              <span className="notification-dot" />
            </button>
            <div className="topbar-avatar">
              {name.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>
        <main>
          <div className="page-intro">
            <div>
              <div className="intro-eyebrow">
                <span className="tiny-dot emerald" />
                {greeting}, {name}
                <span className="greeting-line">— let’s make it count.</span>
              </div>
              <h1>
                {view === "overview" ? (
                  <>
                    Your ambition.{" "}
                    <span className="intro-accent">In motion.</span>
                  </>
                ) : (
                  viewTitle
                )}
              </h1>
              <p>
                {formatDate(now, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                <span className="dot-separator">/</span>
                <span className="intro-edition">PERSONAL OPERATING SYSTEM</span>
              </p>
            </div>
            <div className="intro-actions">
              <span className="save-status">
                <Check size={12} />
                {saveStatus === "error"
                  ? "Changes need a backup"
                  : saveStatus === "saving"
                    ? "Saving…"
                    : "Saved on this browser"}
              </span>
              <div>
                <button
                  className="button secondary"
                  onClick={() => openNew("goal")}
                >
                  <Target size={14} />
                  New goal
                </button>
                <button
                  className="button primary"
                  aria-label="Quick add"
                  onClick={() => openNew("sprint")}
                >
                  <Plus size={15} />
                  Quick add<span className="button-key">N</span>
                </button>
              </div>
            </div>
          </div>
          <Metrics onView={onView} />
          <div className="workspace-toolbar">
            <div className="workspace-view-label">
              <span className="toolbar-grid-icon">
                <LayoutDashboard size={14} />
              </span>
              <strong>
                {view === "overview"
                  ? "Workspace overview"
                  : view === "goals"
                    ? "Goal workspace"
                    : view === "canvas"
                      ? "Coursework workspace"
                      : view === "schedule"
                        ? "Planning workspace"
                        : "Focus workspace"}
              </strong>
              <Badge color="muted">
                {view === "focus" ? "LIVE" : `${visibleIds.length} modules`}
              </Badge>
            </div>
            <div className="layout-controls">
              <button
                className={`lock-button ${!locked ? "unlocked" : ""}`}
                onClick={() => {
                  setLocked(!locked);
                  toast(
                    locked
                      ? "Layout unlocked. Drag panel headers or resize corners."
                      : "Layout locked",
                  );
                }}
                title={
                  locked ? "Unlock to drag and resize panels" : "Lock layout"
                }
              >
                {locked ? (
                  <LockKeyhole size={12} />
                ) : (
                  <LockKeyholeOpen size={12} />
                )}
                <span>{locked ? "Layout locked" : "Editing layout"}</span>
              </button>
              <button
                className="icon-button reset-layout"
                aria-label="Reset workspace layout"
                title="Reset layout"
                onClick={() => {
                  setPreset("overview");
                  toast("Default layout restored");
                }}
              >
                <RotateCcw size={13} />
              </button>
              <div className="preset-select">
                <Layers size={13} />
                <select
                  aria-label="Preset layout"
                  value={preset}
                  onChange={(e) => {
                    setPreset(e.target.value);
                    setView("overview");
                    toast(
                      `${presets.find((p) => p.id === e.target.value)?.name} applied`,
                    );
                  }}
                >
                  {presets.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </div>
              <div className="customize-wrapper">
                <button
                  className={`button customize-button ${customize ? "selected" : ""}`}
                  onClick={() => setCustomize(!customize)}
                >
                  <SlidersHorizontal size={13} />
                  <span>Customize</span>
                </button>
                {customize && (
                  <>
                    <div
                      className="popover-dismiss"
                      onClick={() => setCustomize(false)}
                    />
                    <div className="popover customize-menu">
                      <div className="popover-label">VISIBLE MODULES</div>
                      {Object.entries(widgetNames).map(([id, title]) => (
                        <button
                          key={id}
                          onClick={() => toggleWidget(id as WidgetId)}
                        >
                          <span
                            className={`customize-check ${visible.includes(id as WidgetId) ? "selected" : ""}`}
                          >
                            {visible.includes(id as WidgetId) && (
                              <Check size={10} />
                            )}
                          </span>
                          {title}
                        </button>
                      ))}
                      <div className="popover-footnote">
                        Unlock the layout to drag and resize.
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          {view === "focus" ? (
            <div className="focus-view">
              <FocusTimer toast={toast} />
            </div>
          ) : (
            <div ref={gridContainer} className="workspace-grid-container">
              <Grid
                width={gridWidth || 1}
                className={`workspace-grid ${locked ? "layout-locked" : "layout-editing"}`}
                layouts={gridLayouts}
                breakpoints={{ lg: 1200, md: 900, sm: 640, xs: 360, xxs: 0 }}
                cols={{ lg: 12, md: 12, sm: 6, xs: 1, xxs: 1 }}
                rowHeight={14}
                margin={[16, 16]}
                containerPadding={[0, 0]}
                isDraggable={!locked}
                isResizable={!locked}
                draggableHandle=".draggable"
                draggableCancel="button, input, select"
                onLayoutChange={layoutChange}
                onDragStop={(next) => layoutChange(next)}
                onResizeStop={(next) => layoutChange(next)}
                useCSSTransforms
              >
                {visibleIds.map((id) => (
                  <div key={id} data-widget={id}>
                    {renderWidget(id)}
                  </div>
                ))}
              </Grid>
            </div>
          )}
          {!visibleIds.length && (
            <EmptyState
              icon={LayoutDashboard}
              title="A workspace that’s yours"
              description="Use Customize to choose the modules you want to see."
              action={
                <button
                  className="button primary"
                  onClick={() => setCustomize(true)}
                >
                  Add a module
                </button>
              }
            />
          )}
          <footer className="page-footer">
            <span>
              <span className="apex-footer-mark">△</span>APEX OS
              <span className="dot-separator">·</span>Built for your next
              chapter.
            </span>
            <button onClick={() => setDialog("help")}>
              Small steps. Extraordinary outcomes.
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
          >
            <CircleCheck size={16} />
            {toastMessage}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToastMessage("")}
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {dialog === "settings" && (
        <Settings
          onClose={() => setDialog(null)}
          toast={toast}
          onSubscribe={setSubscribedUrl}
        />
      )}
      {(dialog === "goal" || dialog === "sprint") && (
        <GoalEditor
          key={editGoal?.id ?? dialog}
          initial={editGoal}
          kind={dialog === "goal" ? "macro" : "sprint"}
          onClose={() => {
            setDialog(null);
            setEditGoal(undefined);
          }}
          toast={toast}
        />
      )}
      {dialog === "schedule" && (
        <ScheduleEditor onClose={() => setDialog(null)} toast={toast} />
      )}
      {dialog === "focus" && (
        <FocusModal onClose={() => setDialog(null)} toast={toast} />
      )}
      {dialog === "command" && (
        <CommandPalette
          onClose={() => setDialog(null)}
          onSelect={openEdit}
          onAction={(action) => {
            setDialog(null);
            if (action === "goal" || action === "sprint") openNew(action);
            else if (
              action === "focus" ||
              action === "settings" ||
              action === "schedule"
            )
              setDialog(action);
          }}
          onView={onView}
        />
      )}
      {dialog === "activity" && (
        <ActivityModal onClose={() => setDialog(null)} />
      )}
      {dialog === "help" && (
        <Modal
          title="Your keyboard, your command center"
          onClose={() => setDialog(null)}
        >
          <div className="form-body shortcut-list">
            {[
              ["Search & commands", "⌘ / Ctrl + K"],
              ["Quick add a sprint", "N"],
              ["Add a checkpoint", "Enter"],
              ["Complete focused checkpoint", "⌘ / Ctrl + Enter"],
              ["Break down a task", "⌘ / Ctrl + Enter"],
              ["Close dialog", "Esc"],
              ["Show shortcuts", "?"],
            ].map(([title, key]) => (
              <div key={title}>
                <span>{title}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
            <p className="input-help">
              All controls are keyboard accessible. Use Tab to move between
              controls and Space to toggle checkpoints.
            </p>
          </div>
        </Modal>
      )}
      {connection.kind === "sample" && (
        <span className="sr-only">
          This workspace contains editable sample goals, assignments, and
          calendar events.
        </span>
      )}
    </div>
  );
}
function CommandPalette({
  onClose,
  onSelect,
  onAction,
  onView,
}: {
  onClose: () => void;
  onSelect: (goal: Goal) => void;
  onAction: (action: string) => void;
  onView: (view: View) => void;
}) {
  const [query, setQuery] = useState("");
  const goals = useWorkspace((s) => s.goals),
    assignments = useWorkspace((s) => s.assignments);
  const results = goals
    .filter((g) => g.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5);
  return (
    <Modal title="Search your workspace" onClose={onClose}>
      <div className="command-search">
        <Search size={18} />
        <input
          autoFocus
          placeholder="Goals, assignments, or commands…"
          aria-label="Search goals and commands"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="command-results">
        {!query && (
          <>
            <span className="eyebrow">QUICK ACTIONS</span>
            {[
              { id: "sprint", title: "Create a sprint goal", icon: Plus },
              { id: "goal", title: "Create a long-term goal", icon: Target },
              { id: "schedule", title: "Add a time block", icon: CalendarDays },
              { id: "focus", title: "Enter focus mode", icon: Headphones },
              {
                id: "settings",
                title: "Connect Canvas or calendar",
                icon: Settings2,
              },
            ].map((a) => (
              <button key={a.id} onClick={() => onAction(a.id)}>
                <a.icon size={16} />
                <span>{a.title}</span>
                <ArrowRight size={14} />
              </button>
            ))}
          </>
        )}
        <span className="eyebrow">GOALS</span>
        {results.map((g) => (
          <button key={g.id} onClick={() => onSelect(g)}>
            <Target size={16} />
            <span>{g.title}</span>
            <Badge>{g.kind === "macro" ? "Long-term" : "Sprint"}</Badge>
          </button>
        ))}
        {query && (
          <>
            <span className="eyebrow">ASSIGNMENTS</span>
            {assignments
              .filter((a) =>
                a.title.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 4)
              .map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    onView("canvas");
                    onClose();
                  }}
                >
                  <Inbox size={16} />
                  <span>{a.title}</span>
                  <Badge color={a.color}>{a.course}</Badge>
                </button>
              ))}
          </>
        )}
      </div>
      <div className="command-footer">
        <Command size={12} />
        Your next move, one search away.
      </div>
    </Modal>
  );
}
function ActivityModal({ onClose }: { onClose: () => void }) {
  const activity = useWorkspace((s) => s.activity);
  return (
    <Modal title="Workspace activity" onClose={onClose}>
      <div className="activity-list">
        {activity.length ? (
          activity.map((a) => (
            <div className="activity-row" key={a.id}>
              <span
                className={`activity-icon ${a.type === "task" ? "emerald" : "cyan"}`}
              >
                {a.type === "task" ? (
                  <Check size={14} />
                ) : a.type === "sync" ? (
                  <Inbox size={14} />
                ) : a.type === "focus" ? (
                  <Clock3 size={14} />
                ) : (
                  <Target size={14} />
                )}
              </span>
              <div>
                <p>{a.title}</p>
                <span>
                  {formatDate(a.timestamp)} · {formatTime(a.timestamp)}
                </span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            icon={Activity}
            title="Every small step leaves a trace"
            description="Your completed checkpoints, goals, syncs, and focus sessions will appear here."
          />
        )}
      </div>
    </Modal>
  );
}
