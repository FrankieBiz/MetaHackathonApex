"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Responsive,
  useContainerWidth,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { CommandPalette } from "@/components/CommandPalette";
import { EquityCurve } from "@/components/EquityCurve";
import { OrderBook } from "@/components/OrderBook";
import { TaskTree } from "@/components/TaskTree";
import { TokenModal } from "@/components/TokenModal";
import { TopBar } from "@/components/TopBar";
import { Key, Spinner } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { stamp } from "@/lib/format";
import {
  BREAKPOINTS,
  COLS,
  DEFAULT_LAYOUTS,
  FIT_ROWS,
  clearLayouts,
  loadLayouts,
  saveLayouts,
} from "@/lib/layout";
import { isRemote, useTerminal } from "@/store/terminal";
import { Velocity } from "@/components/Velocity";
import { rankQueue } from "@/lib/engine";
import { startTour } from "@/lib/tour";
import type { TerminalEvent } from "@/types";

const MARGIN = 6;
const REMOTE_POLL_MS = 60_000;
const OFFLINE_PROBE_MS = 30_000;

/** Keeps the terminal current: refreshes while linked, probes for the backend while offline. */
function useBackendLoop() {
  useEffect(() => {
    void useTerminal.getState().boot();
    let last = Date.now();
    const timer = setInterval(() => {
      const s = useTerminal.getState();
      if (document.visibilityState !== "visible" || s.mode === "connecting")
        return;
      if (s.simulationPinned) return;
      if (s.syncing || s.pendingWrites > 0 || Object.keys(s.triaging).length)
        return;
      if (
        Date.now() - last <
        (isRemote(s.mode) ? REMOTE_POLL_MS : OFFLINE_PROBE_MS)
      )
        return;
      last = Date.now();
      void s.refresh();
    }, 5_000);
    return () => clearInterval(timer);
  }, []);
}

function useHotkeys() {
  useEffect(() => {
    // If URL has ?tour=1, auto-trigger the guided judge demonstration tour after boot
    if (typeof window !== "undefined" && /[?&]tour=1\b/.test(window.location.search)) {
      const timer = setTimeout(() => {
        void startTour();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+Shift+D (Ctrl on every platform): live Canvas <-> simulation desk.
      if (
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        if (!event.repeat) void useTerminal.getState().toggleSimulation();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const { paletteOpen, setPaletteOpen, setTokenOpen } =
          useTerminal.getState();
        setTokenOpen(false);
        setPaletteOpen(!paletteOpen);
        return;
      }

      // Ignore single-key shortcuts while typing in inputs or when dialogs are open
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const state = useTerminal.getState();
      if (state.paletteOpen || state.tokenOpen) return;

      const key = event.key.toLowerCase();

      // Sound toggle (M)
      if (key === "m" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        state.toggleSound();
        return;
      }

      // Triage selected assignment (T)
      if (key === "t" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (state.selectedId) {
          event.preventDefault();
          void state.triage(state.selectedId);
        }
        return;
      }

      // Keyboard cheat-sheet / command palette (?)
      if (event.key === "?" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        state.setPaletteOpen(true);
        return;
      }

      // Order book navigation (J / K / G)
      if (state.data && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const queue = rankQueue(state.data.assignments, Date.now()).map(
          (e) => e.assignment.id,
        );
        if (!queue.length) return;
        const currentIdx = state.selectedId ? queue.indexOf(state.selectedId) : -1;

        if (key === "j") {
          event.preventDefault();
          const nextId = queue[Math.min(queue.length - 1, currentIdx + 1)] ?? queue[0];
          if (nextId) state.select(nextId);
        } else if (key === "k") {
          event.preventDefault();
          const prevId = queue[Math.max(0, currentIdx - 1)] ?? queue[0];
          if (prevId) state.select(prevId);
        } else if (key === "g") {
          event.preventDefault();
          if (queue[0]) state.select(queue[0]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

const LEVEL_COLOR: Record<TerminalEvent["level"], string> = {
  info: "text-ink-2",
  ok: "text-up",
  warn: "text-accent",
  error: "text-down",
};

/** `SYS //` system lines carry an amber prefix ahead of their level color. */
function EventText({ text }: { text: string }) {
  if (!text.startsWith("SYS // ")) return text;
  return (
    <>
      <span className="text-accent">SYS //</span> {text.slice(7)}
    </>
  );
}

function StatusBar() {
  const events = useTerminal((s) => s.events);
  const pending = useTerminal((s) => s.pendingWrites);
  const queued = useTerminal((s) => s.queuedEdits);
  const [open, setOpen] = useState(false);
  const latest = events[0];

  return (
    <footer className="relative shrink-0 border-t border-line bg-head text-[11px]">
      {open && (
        <div className="absolute right-0 bottom-full left-0 max-h-[40vh] overflow-auto border-t border-line-strong bg-panel py-1 shadow-2xl shadow-black">
          {events.map((event) => (
            <div key={event.id} className="flex gap-3 px-3 py-0.5">
              <time className="shrink-0 text-ink-3">{stamp(event.at)}</time>
              <span className={LEVEL_COLOR[event.level]}>
                <EventText text={event.text} />
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex h-6 items-center gap-3 px-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="shrink-0 text-ink-3">{open ? "▾" : "▸"} LOG</span>
          {latest ? (
            <span
              className={`truncate ${LEVEL_COLOR[latest.level]}`}
              role="status"
              aria-live="polite"
            >
              <EventText text={latest.text} />
            </span>
          ) : (
            <span className="text-ink-3">Ready.</span>
          )}
        </button>
        {pending > 0 && (
          <span className="shrink-0 text-accent">
            <Spinner /> SAVING {pending}
          </span>
        )}
        {queued > 0 && (
          <span
            className="shrink-0 text-accent"
            title="Edits made while the backend was unreachable; they replay on reconnect"
          >
            QUEUED {queued}
          </span>
        )}
        <span className="hidden shrink-0 text-ink-3 md:inline">
          API {API_BASE.replace(/^https?:\/\//, "")}
        </span>
        <span className="hidden shrink-0 text-ink-3 md:inline">
          ⌘/CTRL+K COMMANDS · ↑↓ QUEUE · CTRL+SHIFT+D SIM
        </span>
      </div>
    </footer>
  );
}

function Workstation() {
  const { width, containerRef, mounted } = useContainerWidth();
  const [height, setHeight] = useState(0);
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(() =>
    loadLayouts(),
  );
  const [generation, setGeneration] = useState(0);
  const lastSync = useTerminal((s) => s.data?.metrics.last_synced_at);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

  const stacked = width < BREAKPOINTS.md;
  const rowHeight = stacked
    ? 28
    : Math.max(
        18,
        Math.floor((height - 2 * MARGIN - (FIT_ROWS - 1) * MARGIN) / FIT_ROWS),
      );

  const resetLayout = useCallback(() => {
    clearLayouts();
    setLayouts(DEFAULT_LAYOUTS);
    setGeneration((g) => g + 1);
  }, []);

  const onLayoutChange = useCallback((_: Layout, all: ResponsiveLayouts) => {
    setLayouts(all);
    saveLayouts(all);
  }, []);

  const panels = useMemo(
    () => [
      <div key="orderbook">
        <OrderBook />
      </div>,
      <div key="tasktree">
        <TaskTree />
      </div>,
      <div key="equity">
        <EquityCurve />
      </div>,
      <div key="velocity">
        <Velocity />
      </div>,
    ],
    [],
  );

  return (
    <>
      <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-b border-line px-3 text-[10px] tracking-wider text-ink-3 uppercase">
        <span className="truncate">
          Workstation · drag panel headers to rearrange, drag corners to resize
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {lastSync && (
            <span className="hidden sm:inline">
              Last sync {stamp(lastSync)}
            </span>
          )}
          <Key onClick={resetLayout}>RESET LAYOUT</Key>
        </span>
      </div>
      <main
        ref={containerRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {mounted && height > 0 && (
          <Responsive
            key={generation}
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={rowHeight}
            margin={[MARGIN, MARGIN]}
            containerPadding={[MARGIN, MARGIN]}
            dragConfig={{
              enabled: !stacked,
              handle: ".panel-drag",
              cancel: ".no-drag, button, input",
            }}
            resizeConfig={{ enabled: !stacked }}
            onLayoutChange={onLayoutChange}
          >
            {panels}
          </Responsive>
        )}
      </main>
      <CommandPalette onResetLayout={resetLayout} />
    </>
  );
}

function BootScreen() {
  return (
    <div className="flex h-full items-center justify-center text-[12px] text-ink-2">
      <span>
        <span className="mr-2 bg-accent px-1.5 font-bold text-canvas">
          APEX
        </span>
        Linking to {API_BASE.replace(/^https?:\/\//, "")} <Spinner />
      </span>
    </div>
  );
}

export default function Terminal() {
  const ready = useTerminal((s) => s.data !== null);
  useBackendLoop();
  useHotkeys();

  if (!ready) return <BootScreen />;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <Workstation />
      <StatusBar />
      <TokenModal />
    </div>
  );
}
