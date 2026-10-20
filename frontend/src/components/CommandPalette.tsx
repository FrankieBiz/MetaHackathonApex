"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRestoreFocus } from "@/components/ui";
import { rankQueue } from "@/lib/engine";
import { activeCourseOf, isRemote, useTerminal } from "@/store/terminal";

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
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
  const [active, setActive] = useState(0);
  const [openedAt] = useState(() => Date.now());
  const list = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const store = useTerminal.getState();
    const selected = data?.assignments.find((a) => a.id === selectedId);
    const course = activeCourseOf({ data, selectedId, activeCourseId });
    const actions: Command[] = [
      {
        id: "sync",
        label: "SYNC NOW",
        hint: "POST /api/sync",
        run: () => void store.sync(),
      },
      {
        id: "token",
        label: "TOKEN CONFIG",
        hint: "Canvas API token",
        run: () => store.setTokenOpen(true),
      },
      {
        id: "layout",
        label: "RESET LAYOUT",
        hint: "Restore panel positions",
        run: onResetLayout,
      },
      {
        id: "simulation",
        label: store.simulationPinned
          ? "RETURN TO LIVE CANVAS"
          : "PIN SIMULATION DESK",
        hint: "Ctrl+Shift+D",
        run: () => void store.toggleSimulation(),
      },
    ];
    if (course) {
      actions.push({
        id: "study-triage",
        label: `GENERATE STUDY TRIAGE · ${course.course_code}`,
        hint: "Scan syllabus, exam guides, and recent scores",
        run: () => void store.generateStudyTriage(course.id),
      });
    }
    // Replacing an existing tree needs the order book's two-step confirm.
    if (selected && !selected.subtasks.length) {
      actions.push({
        id: "triage",
        label: `EXECUTE AI TRIAGE · ${selected.course_code}`,
        hint: selected.title,
        run: () => void store.triage(selected.id),
      });
    }
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
          run: () => store.select(assignment.id),
        }))
      : [];
    return [...actions, ...jumps];
  }, [data, mode, selectedId, activeCourseId, onResetLayout, openedAt]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.hint}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
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
              if (event.key === "Escape") onClose();
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
