"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Key, Meter, Panel, Spinner } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import { API_BASE } from "@/lib/api";
import { priorityScore, rollup } from "@/lib/engine";
import { countdown, minutes, score } from "@/lib/format";
import {
  TRIAGE_STREAM_MS,
  activeCourseOf,
  isRemote,
  useTerminal,
} from "@/store/terminal";
import { studyOpportunity, studyTitleKey } from "@/lib/study";
import type { Assignment, Course, SubTaskNode } from "@/types";

const STATUS_LABEL: Record<
  Assignment["status"],
  { text: string; color: string }
> = {
  pending: { text: "PENDING", color: "text-ink-2" },
  in_progress: { text: "IN PROGRESS", color: "text-accent" },
  completed: { text: "COMPLETED", color: "text-up" },
};

function TriageLog({
  assignment,
  remote,
  now,
}: {
  assignment: Assignment;
  remote: boolean;
  now: number;
}) {
  // Only a reachable backend runs Llama; offline, the local planner builds the tree.
  const agent = remote ? "[META-LLAMA]" : "[LOCAL-PLANNER]";
  const lines = useMemo(
    () => [
      {
        tag: ">",
        text: `TRIAGE ${assignment.course_code} "${assignment.title}"`,
      },
      remote
        ? { tag: ">", text: `POST ${API_BASE}/api/decompose` }
        : { tag: ">", text: "BACKEND OFFLINE · LOCAL PLANNER ENGAGED" },
      {
        tag: ">",
        text: `CONTEXT ${assignment.points_possible} PTS · ${assignment.weight.toFixed(1)}% WT${
          assignment.due_at
            ? ` · DUE IN ${countdown(Date.parse(assignment.due_at) - now)}`
            : ""
        }`,
      },
      { tag: agent, text: "Parsing rubric constraints…" },
      { tag: agent, text: "Generating atomic work tree…" },
      { tag: agent, text: "Splitting into 15–45 min micro-tasks…" },
    ],
    // `now` only seeds the countdown line; the script must not restart every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignment.id, remote],
  );
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (shown >= lines.length) return;
    // Every line lands inside the store's minimum stream window.
    const timer = setTimeout(
      () => setShown((n) => n + 1),
      (TRIAGE_STREAM_MS - 100) / (lines.length - 1),
    );
    return () => clearTimeout(timer);
  }, [shown, lines.length]);

  return (
    <div className="px-3 py-3 text-[12px]" role="status" aria-live="polite">
      {lines.slice(0, shown).map((line, index) => (
        <div
          key={index}
          className={`log-line ${index === 0 ? "text-accent" : "text-ink-2"}`}
        >
          <span className={line.tag === ">" ? "" : "text-accent"}>
            {line.tag}
          </span>{" "}
          {line.text}
        </div>
      ))}
      <div className="mt-1 text-accent">
        <Spinner /> <span className="caret">█</span>
      </div>
    </div>
  );
}

function Badge({ node }: { node: SubTaskNode }) {
  const { actual, estimated } = rollup(node);
  const leaf = !node.children.length;
  const tone =
    !leaf || actual === 0
      ? "text-ink-3"
      : actual > estimated
        ? "text-down"
        : "text-up";
  return (
    <span
      className={`shrink-0 text-right text-[11px] whitespace-nowrap ${tone}`}
      title={`${minutes(actual)} logged of ${minutes(estimated)} estimated`}
    >
      {minutes(actual)} / {minutes(estimated)}
    </span>
  );
}

function TreeRow({
  node,
  assignmentId,
  trail,
  last,
}: {
  node: SubTaskNode;
  assignmentId: string;
  trail: boolean[];
  last: boolean;
}) {
  const toggle = useTerminal((s) => s.toggle);
  const logTime = useTerminal((s) => s.logTime);
  const leaf = !node.children.length;
  const { done } = rollup(node);
  const checked: boolean | "mixed" = node.is_completed
    ? true
    : done > 0
      ? "mixed"
      : false;
  const prefix =
    trail.map((ended) => (ended ? "    " : "│   ")).join("") +
    (last ? "└── " : "├── ");

  return (
    <li className="flex h-[24px] items-center gap-1.5 pr-2.5 pl-2.5 hover:bg-hover">
      <span aria-hidden className="shrink-0 whitespace-pre text-bar-neutral">
        {prefix}
      </span>
      <span className="sr-only">Level {trail.length + 1}.</span>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={node.title}
        onClick={() => toggle(assignmentId, node.id, !node.is_completed)}
        className={`shrink-0 hover:text-accent ${
          checked === true
            ? "text-up"
            : checked === "mixed"
              ? "text-accent"
              : "text-ink-2"
        }`}
      >
        {checked === true ? "[x]" : checked === "mixed" ? "[-]" : "[ ]"}
      </button>
      <span
        title={node.title}
        className={`min-w-0 flex-1 truncate ${
          node.is_completed
            ? "text-ink-3"
            : leaf
              ? "text-ink"
              : "font-semibold text-ink-2"
        }`}
      >
        {node.title}
      </span>
      {node.is_study_recommendation && (
        <span className="shrink-0 text-[10px] tracking-wider text-accent">
          ◆ STUDY
        </span>
      )}
      <Badge node={node} />
      {leaf ? (
        <span className="flex shrink-0 gap-0.5">
          <Key
            caps={false}
            onClick={() => logTime(assignmentId, node.id, -15)}
            disabled={node.actual_minutes === 0}
            aria-label={`Remove 15 minutes from ${node.title}`}
          >
            -15m
          </Key>
          <Key
            caps={false}
            onClick={() => logTime(assignmentId, node.id, 15)}
            aria-label={`Log 15 minutes on ${node.title}`}
          >
            +15m
          </Key>
        </span>
      ) : (
        // Keeps parent badges aligned with leaf badges.
        <span aria-hidden className="invisible flex shrink-0 gap-0.5">
          <Key tabIndex={-1} caps={false}>
            -15m
          </Key>
          <Key tabIndex={-1} caps={false}>
            +15m
          </Key>
        </span>
      )}
    </li>
  );
}

function TreeRows({
  nodes,
  assignmentId,
  trail,
}: {
  nodes: SubTaskNode[];
  assignmentId: string;
  trail: boolean[];
}) {
  return nodes.map((node, index) => {
    const last = index === nodes.length - 1;
    return (
      <Fragment key={node.id}>
        <TreeRow
          node={node}
          assignmentId={assignmentId}
          trail={trail}
          last={last}
        />
        {node.children.length > 0 && (
          <TreeRows
            nodes={node.children}
            assignmentId={assignmentId}
            trail={[...trail, last]}
          />
        )}
      </Fragment>
    );
  });
}

function StudySprint({ course, now }: { course: Course; now: number }) {
  const plan = useTerminal((s) => s.studyPlans[course.id]);
  const running = useTerminal((s) => Boolean(s.studying[course.id]));
  const inserting = useTerminal((s) => Boolean(s.insertingStudy[course.id]));
  const error = useTerminal((s) => s.studyErrors[course.id]);
  const data = useTerminal((s) => s.data);
  const insert = useTerminal((s) => s.insertStudyBlocks);
  const nodes =
    data?.study_recommendations?.filter((n) => n.course_id === course.id) ?? [];
  const titles = new Set(nodes.map((n) => studyTitleKey(n.title)));
  const inserted = plan?.recommended_blocks.every((b) =>
    titles.has(studyTitleKey(b.title)),
  );
  const opportunity = studyOpportunity(data?.assignments ?? [], course.id, now);
  return (
    <section
      aria-label={`Study sprint for ${course.course_code}`}
      aria-busy={running || inserting}
      className="border-b border-line px-2.5 py-2 text-[12px]"
    >
      <div className="text-accent">
        {course.course_code}
        {" // STUDY SPRINT"}
      </div>
      {opportunity && <p className="mt-1 text-ink-2">{opportunity}</p>}
      {running && (
        <p role="status" className="mt-2 text-accent">
          <Spinner /> Scanning syllabus and recent performance…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-down">
          {error}
        </p>
      )}
      {plan && !running && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="text-[10px] tracking-wider text-ink-3">
              FLAGGED MATERIALS &amp; SIGNALS
            </div>
            <ul className="mt-1 space-y-1 break-words text-ink-2">
              {plan.detected_triggers.map((trigger, i) => (
                <li key={i}>◆ {trigger}</li>
              ))}
              {!plan.detected_triggers.length && (
                <li>
                  No exam or performance triggers found; general review sprint.
                </li>
              )}
            </ul>
          </div>
          <div>
            <div className="text-[10px] tracking-wider text-ink-3">
              3 FOCUS TOPICS
            </div>
            <ol className="mt-1 list-inside list-decimal space-y-1 break-words text-ink-2">
              {plan.focus_topics.map((topic, i) => (
                <li key={i}>{topic}</li>
              ))}
            </ol>
          </div>
          <ul aria-label="Proposed study blocks" className="space-y-1 text-ink">
            {plan.recommended_blocks.map((block, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-accent">25m</span>
                <span className="break-words">{block.title}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Key
              tone="accent"
              disabled={inserting || inserted}
              onClick={() => void insert(course.id)}
            >
              {inserting
                ? "Saving study blocks…"
                : inserted
                  ? "Study blocks inserted"
                  : `Insert ${plan.recommended_blocks.length} study blocks`}
            </Key>
            <span className="text-[11px] text-ink-3">
              {plan.source === "local"
                ? "Local starter · model unavailable"
                : "Llama study plan"}
            </span>
          </div>
        </div>
      )}
      {nodes.length > 0 && (
        <ul
          aria-label={`Saved study blocks for ${course.course_code}`}
          className="mt-2 -mx-2.5"
        >
          <TreeRows
            nodes={nodes}
            assignmentId={`study:${course.id}`}
            trail={[]}
          />
        </ul>
      )}
    </section>
  );
}

export function TaskTree() {
  const course = useTerminal(activeCourseOf);
  const studyRunning = useTerminal((s) =>
    course ? Boolean(s.studying[course.id]) : false,
  );
  const generateStudy = useTerminal((s) => s.generateStudyTriage);
  const assignment = useTerminal(
    (s) => s.data?.assignments.find((a) => a.id === s.selectedId) ?? null,
  );
  const triaging = useTerminal((s) =>
    s.selectedId ? Boolean(s.triaging[s.selectedId]) : false,
  );
  const remote = useTerminal((s) => isRemote(s.mode));
  const triage = useTerminal((s) => s.triage);
  const now = useNow(1000);
  const studyAction = course ? (
    <Key
      tone="accent"
      caps={false}
      disabled={studyRunning}
      onClick={() => void generateStudy(course.id)}
    >
      {studyRunning ? "Scanning…" : "⚡ Study Triage"}
    </Key>
  ) : null;

  if (!assignment) {
    return (
      <Panel
        title="EXECUTION DECK // RECURSIVE WORK BREAKDOWN TREE"
        actions={studyAction}
      >
        {course && <StudySprint course={course} now={now} />}
        <p className="px-3 py-6 text-ink-3">
          Select a row in the order book to load its work breakdown.
        </p>
      </Panel>
    );
  }

  const totals = rollup(assignment.subtasks);
  const status = STATUS_LABEL[assignment.status];
  const hours = assignment.due_at
    ? (Date.parse(assignment.due_at) - now) / 3_600_000
    : null;
  const progress = totals.total ? (totals.done / totals.total) * 100 : 0;

  return (
    <Panel
      title="EXECUTION DECK // RECURSIVE WORK BREAKDOWN TREE"
      actions={studyAction}
    >
      <div className="flex min-h-full flex-col">
        {course && <StudySprint course={course} now={now} />}
        <div className="flex flex-col gap-1 border-b border-line px-2.5 py-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-[12px] font-semibold whitespace-nowrap text-accent">
                {assignment.course_code}
              </span>
              <span
                className="truncate text-[12px] text-ink"
                title={assignment.title}
              >
                {assignment.title}
              </span>
            </div>
            <span
              className={`shrink-0 text-[12px] ${
                assignment.status === "completed"
                  ? "text-ink-3"
                  : hours !== null && hours < 0
                    ? "text-down"
                    : hours !== null && hours < 24
                      ? "text-accent"
                      : "text-ink-2"
              }`}
            >
              {assignment.due_at
                ? `DUE ${countdown(Date.parse(assignment.due_at) - now)}`
                : "NO DUE DATE"}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 text-[10px] tracking-wider text-ink-3 uppercase">
            <span className={status.color}>{status.text}</span>
            <span>
              {assignment.points_possible} pts · {assignment.weight.toFixed(1)}%
              wt
            </span>
            <span>Priority {score(priorityScore(assignment, now))}</span>
            {totals.total > 0 && (
              <span>
                {totals.done}/{totals.total} tasks · est{" "}
                {minutes(totals.estimated)} · act{" "}
                <span
                  className={
                    totals.actual > totals.estimated
                      ? "text-down"
                      : "text-ink-2"
                  }
                >
                  {minutes(totals.actual)}
                </span>
              </span>
            )}
          </div>
          {totals.total > 0 && (
            <Meter
              label="Task completion"
              value={progress}
              max={100}
              color={
                assignment.status === "completed"
                  ? "var(--color-up)"
                  : "var(--color-accent)"
              }
            />
          )}
        </div>

        {assignment.status === "completed" && totals.total > 0 && (
          <div className="border-b border-line bg-up/10 px-2.5 py-1 text-[11px] text-up">
            ✓ FILLED: every top-level task is done, so the assignment is marked
            completed.
          </div>
        )}

        {triaging ? (
          <TriageLog assignment={assignment} remote={remote} now={now} />
        ) : assignment.subtasks.length ? (
          <ul
            aria-label={`Work breakdown for ${assignment.title}`}
            className="py-1 text-[12px]"
          >
            <li className="flex h-[24px] items-center gap-1.5 px-2.5 text-ink-2">
              <span aria-hidden className="text-accent">
                ■
              </span>
              {assignment.course_code} WORK BREAKDOWN
            </li>
            <TreeRows
              nodes={assignment.subtasks}
              assignmentId={assignment.id}
              trail={[]}
            />
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
            <div className="text-[11px] tracking-wider text-ink-3 uppercase">
              No work breakdown yet
            </div>
            <p className="max-w-[46ch] text-ink-2">
              Llama-3 splits this assignment into 15–45 minute tasks you can
              check off and time.
            </p>
            <Key
              tone="accent"
              size="lg"
              onClick={() => void triage(assignment.id)}
            >
              ⚡ DECONSTRUCT WITH META LLAMA
            </Key>
            {!remote && (
              <p className="text-[11px] text-ink-3">
                Backend offline: the local planner builds the tree instead.
              </p>
            )}
          </div>
        )}

        {assignment.subtasks.length > 0 && !triaging && (
          <footer className="sticky bottom-0 mt-auto flex flex-wrap gap-x-4 border-t border-line bg-panel px-2.5 py-1 text-[10px] tracking-wider text-ink-3 uppercase">
            <span>
              <span className="text-up">[x]</span> done
            </span>
            <span>
              <span className="text-accent">[-]</span> partial
            </span>
            <span>[ ] open</span>
            <span className="hidden @lg:inline">
              Checking a parent checks every task under it
            </span>
          </footer>
        )}
      </div>
    </Panel>
  );
}
