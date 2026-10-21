"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Key, Meter, Panel, Segmented, Spinner } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  HOUR,
  priorityTier,
  rankQueue,
  rubricBreakdown,
  type PriorityTier,
  type QueueEntry,
} from "@/lib/engine";
import { countdown, score as fmtScore } from "@/lib/format";
import { activeCourseOf, isRemote, useTerminal } from "@/store/terminal";
import { studyOpportunity } from "@/lib/study";
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

function TriageButton({
  assignment,
  label,
  size,
}: {
  assignment: Assignment;
  /** Idle label; defaults to the compact queue-row label. */
  label?: ReactNode;
  size?: "sm" | "lg";
}) {
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
        size={size}
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
      size={size}
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
      {armed
        ? "CONFIRM REPLACE"
        : (label ?? (
            <>
              <span className="@lg:hidden">TRIAGE</span>
              <span className="hidden @lg:inline">EXECUTE AI TRIAGE</span>
            </>
          ))}
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

/** Canvas prompts can run to 100k characters; the preview needs the opening. */
const PREVIEW_CHARS = 4000;

function Caption({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] tracking-wider text-ink-3 uppercase">
      {children}
    </div>
  );
}

function Fact({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <dt className="text-[10px] tracking-wider text-ink-3 uppercase">
        {label}
      </dt>
      <dd className="text-[12px] text-ink">{value}</dd>
    </div>
  );
}

/** Docked under the queue: the selected deliverable's prompt, rubric, and points. */
function Inspector() {
  const assignment = useTerminal(
    (s) => s.data?.assignments.find((a) => a.id === s.selectedId) ?? null,
  );
  const course = useTerminal(activeCourseOf);
  const remote = useTerminal((s) => isRemote(s.mode));
  const rubric = useMemo(
    () => (assignment ? rubricBreakdown(assignment) : []),
    [assignment],
  );

  const prompt = assignment?.description?.trim() ?? "";
  const completed = assignment?.status === "completed";

  return (
    <section
      aria-label="Deliverable inspector and rubric preview"
      // Gives way to the queue first, then scrolls inside; grows into spare height.
      className="flex min-h-[172px] shrink-[4] grow flex-col border-t border-line-strong"
    >
      <header className="flex h-7 shrink-0 items-center justify-between gap-3 border-b border-line bg-head px-2.5 text-[10px] tracking-wider uppercase">
        <span className="min-w-0 truncate text-accent">
          Deliverable inspector &amp; rubric preview
          {assignment && (
            <span className="text-ink-3">
              {" "}
              · SEL ▸{" "}
              <span className="text-ink-2">{assignment.course_code}</span>
            </span>
          )}
        </span>
        {assignment &&
          (completed ? (
            <span className="shrink-0 text-up">✓ FILLED</span>
          ) : (
            <TriageButton
              assignment={assignment}
              label="⚡ DECONSTRUCT WITH META LLAMA"
            />
          ))}
      </header>

      {!assignment ? (
        <p className="px-2.5 py-4 text-ink-3">
          Select a deliverable to inspect its prompt, rubric, and point
          breakdown.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-y-auto bg-line @xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @xl:grid-rows-[minmax(0,1fr)] @xl:overflow-hidden">
          <div className="flex min-w-0 flex-col gap-1.5 bg-panel px-2.5 py-2 @xl:overflow-y-auto">
            <div
              className="shrink-0 truncate text-[12px] text-ink"
              title={assignment.title}
            >
              {assignment.title}
            </div>
            <Caption>Prompt / rubric · raw</Caption>
            <p
              tabIndex={0}
              aria-label="Assignment prompt"
              className="min-h-[4.5em] flex-1 overflow-y-auto border border-line bg-canvas px-2 py-1.5 text-[11px] leading-relaxed break-words whitespace-pre-line text-ink-2 outline-none focus-visible:border-accent"
            >
              <span className="text-accent">&gt; </span>
              {prompt
                ? prompt.length > PREVIEW_CHARS
                  ? `${prompt.slice(0, PREVIEW_CHARS)}…`
                  : prompt
                : "No prompt text published in Canvas."}
            </p>
            {course?.syllabus && (
              <>
                <Caption>Syllabus · {course.name}</Caption>
                <p
                  className="line-clamp-2 shrink-0 text-[11px] leading-relaxed break-words text-ink-3"
                  title={course.syllabus.slice(0, PREVIEW_CHARS)}
                >
                  {course.syllabus}
                </p>
              </>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-1.5 bg-panel px-2.5 py-2 @xl:overflow-y-auto">
            <dl className="flex flex-wrap gap-x-4 gap-y-1">
              <Fact label="Points" value={String(assignment.points_possible)} />
              <Fact label="Weight" value={`${assignment.weight.toFixed(1)}%`} />
              <Fact
                label="Grade / pt"
                value={
                  assignment.points_possible
                    ? `${(assignment.weight / assignment.points_possible).toFixed(3)}%`
                    : "—"
                }
                title="Share of the final grade each point on this deliverable is worth"
              />
            </dl>
            <Caption>
              Point breakdown
              {rubric.length ? "" : " · no rubric weights in prompt"}
            </Caption>
            {rubric.length ? (
              <ul className="flex flex-col gap-1">
                {rubric.map((line, index) => (
                  <li
                    key={index}
                    className="flex flex-col gap-0.5 text-[11px]"
                    title={line.detail ?? undefined}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-ink-2 uppercase">
                        {line.criterion}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-ink">
                        {fmtScore(line.points)} PTS{" "}
                        <span className="text-ink-3">· {line.percent}%</span>
                      </span>
                    </div>
                    <Meter
                      label={`${line.criterion}: ${line.percent}% of the points`}
                      value={line.percent}
                      max={100}
                      color="var(--color-accent)"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-0.5 text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-2">HOLISTIC</span>
                  <span className="text-ink">
                    {assignment.points_possible} PTS{" "}
                    <span className="text-ink-3">· 100%</span>
                  </span>
                </div>
                <Meter
                  label="Holistic grading: 100% of the points"
                  value={100}
                  max={100}
                  color="var(--color-ink-3)"
                />
              </div>
            )}
            {!remote && !completed && (
              <p className="mt-auto pt-1 text-[10px] text-ink-3">
                Backend offline · deconstruct runs the local planner
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function OrderBook() {
  const courses = useTerminal((s) => s.data?.courses);
  const activeCourse = useTerminal(activeCourseOf);
  const selectCourse = useTerminal((s) => s.selectCourse);
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
      {/* The queue scrolls on its own so the inspector stays docked; with few
          rows the inspector grows into the space instead. */}
      <div className="flex h-full flex-col">
        <nav
          aria-label="Active course for study triage"
          className="flex shrink-0 flex-wrap gap-2 border-b border-line px-2.5 py-2"
        >
          {courses?.map((course) => {
            const opportunity = studyOpportunity(assignments, course.id, now);
            return (
              <Key
                key={course.id}
                active={activeCourse?.id === course.id}
                aria-pressed={activeCourse?.id === course.id}
                title={opportunity ?? course.name}
                onClick={() => selectCourse(course.id)}
              >
                {course.course_code}
                {opportunity && (
                  <span className="ml-1 text-accent"> · STUDY</span>
                )}
              </Key>
            );
          })}
        </nav>
        <div className="min-h-[96px] shrink overflow-y-auto">
          <table className="w-full border-collapse text-[12px]">
            <caption className="sr-only">
              Open assignments sorted by priority score: weight times points
              over hours until due.
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
        </div>

        <Inspector />

        <footer className="flex shrink-0 flex-wrap gap-x-4 border-t border-line bg-panel px-2.5 py-1 text-[10px] tracking-wider text-ink-3 uppercase">
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
