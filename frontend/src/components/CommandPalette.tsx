"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEscape, useRestoreFocus } from "@/components/ui";
import { rankQueue } from "@/lib/engine";
import { startTour } from "@/lib/tour";
import { activeCourseOf, isRemote, useTerminal } from "@/store/terminal";

interface Command {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  run: () => void;
}

function scoreMatch(pattern: string, text: string): number {
  if (!pattern) return 1;
  const lowerPattern = pattern.toLowerCase();
  const lowerText = text.toLowerCase();
  let pIdx = 0;
  let score = 0;
  let prevMatch = -1;

  for (let tIdx = 0; tIdx < lowerText.length && pIdx < lowerPattern.length; tIdx++) {
    if (lowerText[tIdx] === lowerPattern[pIdx]) {
      score += 10;
      if (tIdx === prevMatch + 1) score += 15;
      if (tIdx === 0 || /[\s\-_/·]/.test(lowerText[tIdx - 1])) score += 25;
      prevMatch = tIdx;
      pIdx++;
    }
  }
  return pIdx === lowerPattern.length ? score : 0;
}

export function CommandPalette({
  onResetLayout,
}: {
  onResetLayout: () => void;
}) {
  const open = useTerminal((s) => s.paletteOpen);
  const setOpen = useTerminal((s) => s.setPaletteOpen);
  if (!open) return null;
  return (
    <PaletteDialog
      onClose={() => setOpen(false)}
      onResetLayout={onResetLayout}
    />
  );
}

function PaletteDialog({
  onClose,
  onResetLayout,
}: {
  onClose: () => void;
  onResetLayout: () => void;
}) {
  const data = useTerminal((s) => s.data);
  const mode = useTerminal((s) => s.mode);
  const selectedId = useTerminal((s) => s.selectedId);
  const activeCourseId = useTerminal((s) => s.activeCourseId);
  const [query, setQuery] = useState("");
  useRestoreFocus();
  useEscape(onClose);
  const [active, setActive] = useState(0);
  const [openedAt] = useState(() => Date.now());
  const list = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const store = useTerminal.getState();
    const selected = data?.assignments.find((a) => a.id === selectedId);
    const course = activeCourseOf({ data, selectedId, activeCourseId });
    const actions: Command[] = [
      {
        id: "tour",
        label: "RUN JUDGE DEMO TOUR",
        hint: "Automated trading desk walkthrough",
        shortcut: "TOUR",
        run: () => void startTour(),
      },
      {
        id: "sound",
        label: store.soundOn ? "MUTE TERMINAL AUDIO" : "ENABLE TERMINAL AUDIO",
        hint: "Web Audio synthesized clicks & fills",
        shortcut: "M",
        run: () => store.toggleSound(),
      },
      {
        id: "sync",
        label: "SYNC NOW",
        hint: "POST /api/sync",
        shortcut: "SYNC",
        run: () => void store.sync(),
      },
      {
        id: "token",
        label: "TOKEN CONFIG",
        hint: "Canvas API token",
        shortcut: "CONF",
        run: () => store.setTokenOpen(true),
      },
      {
        id: "layout",
        label: "RESET LAYOUT",
        hint: "Restore panel positions",
        shortcut: "RESET",
        run: onResetLayout,
      },
      {
        id: "simulation",
        label: store.simulationPinned
          ? "RETURN TO LIVE CANVAS"
          : "PIN SIMULATION DESK",
        hint: "Ctrl+Shift+D",
        shortcut: "CTRL+SHIFT+D",
        run: () => void store.toggleSimulation(),
      },
    ];
    if (course) {
      actions.push({
        id: "study-triage",
        label: `GENERATE STUDY TRIAGE · ${course.course_code}`,
        hint: "Scan syllabus, exam guides, and recent scores",
        shortcut: "STUDY",
        run: () => void store.generateStudyTriage(course.id),
      });
    }
    // Replacing an existing tree needs the order book's two-step confirm.
    if (selected && !selected.subtasks.length) {
      actions.push({
        id: "triage",
        label: `EXECUTE AI TRIAGE · ${selected.course_code}`,
        hint: selected.title,
        shortcut: "T",
        run: () => void store.triage(selected.id),
      });
    }
    if (selected) {
      actions.push({
        id: "simulate-100",
        label: `WHAT-IF: SIMULATE 100% · ${selected.course_code}`,
        hint: `Project sensitivity curve for ${selected.title}`,
        run: () => store.setScenarioScore(selected.id, 100),
      });
    }
    actions.push({
      id: "reset-scenario",
      label: "WHAT-IF: RESET SIMULATION SCORES",
      hint: "Clear what-if scores and return to actual grades",
      run: () => store.resetScenario(),
    });
    if (!isRemote(mode)) {
      actions.push({
        id: "reset-sandbox",
        label: "RESET SIMULATION DATA",
        hint: "Discard local edits",
        run: store.resetSandbox,
      });
    }
    const jumps: Command[] = data
      ? [
          ...rankQueue(data.assignments, openedAt).map(
            (entry) => entry.assignment,
          ),
          ...data.assignments.filter((a) => a.status === "completed"),
        ].map((assignment) => ({
          id: `go-${assignment.id}`,
          label: `GO ${assignment.course_code}`,
          hint: assignment.title,
          shortcut: "JUMP",
          run: () => store.select(assignment.id),
        }))
      : [];
    return [...actions, ...jumps];
  }, [data, mode, selectedId, activeCourseId, onResetLayout, openedAt]);

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return commands;
    const scored = commands
      .map((command) => {
        const text = `${command.label} ${command.hint}`;
        const score = scoreMatch(trimmed, text);
        return { command, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((s) => s.command);
  }, [commands, query]);

  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[600px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <div className="flex items-center gap-2 border-b border-line bg-head px-3 py-2">
          <span aria-hidden className="text-accent">
            &gt;
          </span>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive(Math.min(results.length - 1, current + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(Math.max(0, current - 1));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                run(results[current]);
              }
            }}
            placeholder="Type a command or course, then Enter"
            aria-label="Command"
            aria-controls="palette-results"
            aria-activedescendant={
              results[current] ? `cmd-${results[current].id}` : undefined
            }
            className="flex-1 bg-transparent text-[13px] text-ink uppercase outline-none placeholder:text-ink-3 placeholder:normal-case"
          />
          <kbd className="text-[10px] text-ink-3">ESC</kbd>
        </div>
        <ul
          id="palette-results"
          role="listbox"
          ref={list}
          className="max-h-[50vh] overflow-auto py-1"
        >
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`cmd-${command.id}`}
              role="option"
              aria-selected={index === current}
              onMouseMove={() => setActive(index)}
              onClick={() => run(command)}
              className={`flex cursor-pointer items-baseline gap-3 px-3 py-1 text-[12px] ${
                index === current
                  ? "bg-accent/15 shadow-[inset_2px_0_0_var(--color-accent)]"
                  : ""
              }`}
            >
              <span
                className={`shrink-0 ${index === current ? "text-accent" : "text-ink"}`}
              >
                {command.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-3">
                {command.hint}
              </span>
              {command.shortcut && (
                <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[9px] text-ink-3 uppercase sm:inline">
                  {command.shortcut}
                </kbd>
              )}
              {index === current && (
                <span className="shrink-0 text-[10px] text-ink-3">ENTER</span>
              )}
            </li>
          ))}
          {!results.length && (
            <li className="px-3 py-3 text-ink-3">
              No command matches “{query}”.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
