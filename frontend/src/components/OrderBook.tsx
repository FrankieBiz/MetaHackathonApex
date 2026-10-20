"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Key, Panel, Segmented, Spinner } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  HOUR,
  priorityTier,
  rankQueue,
  type PriorityTier,
  type QueueEntry,
} from "@/lib/engine";
import { countdown, score as fmtScore } from "@/lib/format";
import { useTerminal } from "@/store/terminal";
import type { Assignment } from "@/types";

const TIER_COLOR: Record<PriorityTier, string> = {
  high: "var(--color-down)",
  medium: "var(--color-accent)",
  low: "var(--color-ink-3)",
};

const NO_ASSIGNMENTS: Assignment[] = [];

function dueTone(hours: number | null, completed: boolean) {
  if (completed) return "text-ink-3";
  if (hours === null) return "text-ink-3";
  if (hours < 0) return "text-down";
  if (hours < 24) return "text-accent";
  return "text-ink-2";
}

function StatusGlyph({ entry }: { entry: QueueEntry }) {
  const { status } = entry.assignment;
  if (status === "completed")
    return (
      <span className="text-up" title="Completed">
        ✓
      </span>
    );
  if (entry.hours !== null && entry.hours < 0)
    return (
      <span className="text-down" title="Overdue">
        !
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="text-accent" title="In progress">
        ▶
      </span>
    );
  return (
    <span className="text-ink-3" title="Pending">
      ○
    </span>
  );
}

function TriageButton({ assignment }: { assignment: Assignment }) {
  const running = useTerminal((s) => Boolean(s.triaging[assignment.id]));
  const triage = useTerminal((s) => s.triage);
  const [armed, setArmed] = useState(false);
  const hasTree = assignment.subtasks.length > 0;

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (running) {
    return (
      <Key
        tone="accent"
        active
        aria-disabled
        onClick={(event) => event.stopPropagation()}
        aria-label={`Triage running for ${assignment.title}`}
      >
        TRIAGING&nbsp;
        <Spinner />
      </Key>
    );
  }
  return (
    <Key
      tone={armed ? "down" : "accent"}
      onClick={(event) => {
        event.stopPropagation();
        if (hasTree && !armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        void triage(assignment.id);
      }}
      aria-label={
        armed
          ? `Confirm: replace the existing task tree for ${assignment.title}`
          : `Execute AI triage for ${assignment.title}`
      }
      title={
        hasTree && !armed
          ? "Already triaged. Click twice to replace the tree."
          : undefined
      }
    >
      {armed ? (
        "CONFIRM REPLACE"
      ) : (
        <>
          <span className="@lg:hidden">TRIAGE</span>
          <span className="hidden @lg:inline">EXECUTE AI TRIAGE</span>
        </>
      )}
    </Key>
  );
}

function PriorityCell({ score, max }: { score: number; max: number }) {
  const tier = priorityTier(score);
  // Log scale: overdue work scores orders of magnitude above the rest.
  const fill = max > 0 ? Math.log1p(score) / Math.log1p(max) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-ink">{fmtScore(score)}</span>
      <span
        className="relative hidden h-1.5 w-12 bg-line @2xl:block"
        aria-hidden
      >
        <span
          className="absolute inset-y-0 left-0"
          style={{
            width: `${fill * 100}%`,
            background: TIER_COLOR[tier],
          }}
        />
      </span>
      <span
        className="w-[1ch] text-[10px]"
        style={{ color: TIER_COLOR[tier] }}
        title={`${tier} priority`}
      >
        {tier[0].toUpperCase()}
      </span>
    </div>
  );
}

export function OrderBook() {
  const assignments = useTerminal((s) => s.data?.assignments ?? NO_ASSIGNMENTS);
  const selectedId = useTerminal((s) => s.selectedId);
  const select = useTerminal((s) => s.select);
  const now = useNow(1000);
  const [scope, setScope] = useState<"open" | "all">("open");
  const body = useRef<HTMLTableSectionElement>(null);

  const queue = useMemo(() => rankQueue(assignments, now), [assignments, now]);
  const rows = useMemo<QueueEntry[]>(() => {
    if (scope === "open") return queue;
    const filled = assignments
      .filter((a) => a.status === "completed")
      .map((assignment) => ({
        assignment,
        priority: 0,
        hours: assignment.due_at
          ? (Date.parse(assignment.due_at) - now) / HOUR
          : null,
      }));
    return [...queue, ...filled];
  }, [scope, queue, assignments, now]);

  const max = queue[0]?.priority ?? 0;
  const overdue = queue.filter((e) => e.hours !== null && e.hours < 0).length;
  const dueSoon = queue.filter(
    (e) => e.hours !== null && e.hours >= 0 && e.hours < 24,
  ).length;
  const untriaged = queue.filter((e) => !e.assignment.subtasks.length).length;

  const onRowKey = (
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(rows[index].assignment.id);
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(
        0,
        Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
      );
      select(rows[next].assignment.id);
      (body.current?.children[next] as HTMLElement | undefined)?.focus();
    }
  };

  return (
    <Panel
      title="ORDER BOOK // PRIORITY EXECUTION QUEUE"
      actions={
        <Segmented
          label="Queue scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: "open", label: `OPEN ${queue.length}` },
            { value: "all", label: `ALL ${assignments.length}` },
          ]}
        />
      }
    >
      <div className="flex min-h-full flex-col">
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">
            Open assignments sorted by priority score: weight times points over
            hours until due.
          </caption>
          <thead className="sticky top-0 z-10 bg-panel text-[10px] tracking-wider text-ink-3 uppercase">
            <tr className="border-b border-line">
              <th
                scope="col"
                className="py-1 pr-2 pl-2.5 text-left font-normal"
              >
                Course
              </th>
              <th
                scope="col"
                className="w-full px-2 py-1 text-left font-normal"
              >
                Deliverable
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                Due in
              </th>
              <th
                scope="col"
                className="hidden px-2 py-1 text-right font-normal @xl:table-cell"
              >
                Wt%
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                Priority
              </th>
              <th
                scope="col"
                className="hidden py-1 pr-2.5 pl-2 text-right font-normal @md:table-cell"
              >
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody ref={body}>
            {rows.map((entry, index) => {
              const { assignment, hours } = entry;
              const selected = assignment.id === selectedId;
              const completed = assignment.status === "completed";
              return (
                <tr
                  key={assignment.id}
                  tabIndex={0}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => select(assignment.id)}
                  onKeyDown={(event) => onRowKey(event, index)}
                  className={`cursor-pointer border-b border-line/70 outline-none focus-visible:bg-hover ${
                    selected
                      ? "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]"
                      : "hover:bg-hover"
                  } ${completed ? "opacity-60" : ""}`}
                >
                  <td className="py-1 pr-2 pl-2.5 whitespace-nowrap">
                    <span className="mr-1.5 inline-block w-[1ch] text-center">
                      <StatusGlyph entry={entry} />
                    </span>
                    <span className={selected ? "text-accent" : "text-ink"}>
                      {assignment.course_code}
                    </span>
                  </td>
                  <td className="w-full max-w-0 px-2 py-1">
                    <span
                      className="block truncate text-ink-2"
                      title={assignment.title}
                    >
                      {assignment.title}
                    </span>
                  </td>
                  <td
                    className={`px-2 py-1 text-right whitespace-nowrap ${dueTone(hours, completed)}`}
                  >
                    {completed
                      ? "FILLED"
                      : assignment.due_at
                        ? countdown(Date.parse(assignment.due_at) - now)
                        : "—"}
                  </td>
                  <td className="hidden px-2 py-1 text-right text-ink-2 @xl:table-cell">
                    {assignment.weight.toFixed(1)}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {completed ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <PriorityCell score={entry.priority} max={max} />
                    )}
                  </td>
                  <td className="hidden py-1 pr-2.5 pl-2 text-right @md:table-cell">
                    {!completed && <TriageButton assignment={assignment} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!rows.length && (
          <p className="px-2.5 py-6 text-ink-3">
            Queue is clear. Sync to pull new assignments from Canvas.
          </p>
        )}

        <footer className="sticky bottom-0 mt-auto flex flex-wrap gap-x-4 border-t border-line bg-panel px-2.5 py-1 text-[10px] tracking-wider text-ink-3 uppercase">
          <span>
            Open <span className="text-ink">{queue.length}</span>
          </span>
          <span>
            Overdue{" "}
            <span className={overdue ? "text-down" : "text-ink"}>
              {overdue}
            </span>
          </span>
          <span>
            Due &lt;24h{" "}
            <span className={dueSoon ? "text-accent" : "text-ink"}>
              {dueSoon}
            </span>
          </span>
          <span>
            Untriaged <span className="text-ink">{untriaged}</span>
          </span>
          <span className="ml-auto hidden @lg:inline">
            Priority = wt × pts / max(hrs, 1)
          </span>
        </footer>
      </div>
    </Panel>
  );
}
