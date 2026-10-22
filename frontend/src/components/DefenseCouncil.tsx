"use client";

import { useMemo } from "react";
import { Key, Spinner } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import {
  clusterIndex,
  clusterWindow,
  congestionTier,
  detectCongestion,
} from "@/lib/congestion";
import {
  COUNCIL_ROLES,
  COUNCIL_SEATS,
  type CouncilRole,
  type DefenseCouncilMember,
} from "@/lib/defenseCouncil";
import { floorText, gradeRisk, leaves, rollup } from "@/lib/engine";
import { minutes } from "@/lib/format";
import { useCouncil } from "@/store/council";
import { activeCourseOf, isRemote, useTerminal } from "@/store/terminal";
import type { Assignment } from "@/types";

/** Crimson bench, amber floor, emerald chair. */
const SEAT_TONE: Record<CouncilRole, { badge: string; rule: string }> = {
  Professor: {
    badge: "border-down/60 bg-down/10 text-down",
    rule: "border-l-down/70",
  },
  Student: {
    badge: "border-accent/60 bg-accent/10 text-accent",
    rule: "border-l-accent/70",
  },
  Arbitrator: {
    badge: "border-up/60 bg-up/10 text-up",
    rule: "border-l-up/70",
  },
};

function Seat({ member }: { member: DefenseCouncilMember }) {
  const tone = SEAT_TONE[member.role];
  return (
    <li
      aria-label={`${member.role} position`}
      className={`border-b border-l-2 border-line px-2.5 py-1.5 ${tone.rule}`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`shrink-0 border px-1 text-[10px] tracking-wider uppercase ${tone.badge}`}
        >
          {member.role}
        </span>
        <span className="min-w-0 truncate text-[10px] tracking-wider text-ink-3 uppercase">
          {COUNCIL_SEATS[member.role].brief}
        </span>
      </div>
      <p className="mt-1 text-[12px] break-words text-ink">{member.position}</p>
      {member.priorities.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-ink-2">
          {member.priorities.map((priority, index) => (
            <li key={index} className="flex gap-1.5">
              <span aria-hidden className="shrink-0 text-ink-3">
                ▸
              </span>
              <span className="min-w-0 break-words">{priority}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The council's three seats on the selected deliverable, and the verdict they reach. */
export function DefenseCouncil({ assignment }: { assignment: Assignment }) {
  const run = useCouncil((s) => s.runs[assignment.id]);
  const convening = useCouncil((s) => Boolean(s.convening[assignment.id]));
  const convene = useCouncil((s) => s.convene);
  const streamed = useTerminal((s) => s.traces[assignment.id]?.council);
  const course = useTerminal(activeCourseOf);
  const assignments = useTerminal((s) => s.data?.assignments);
  const remote = useTerminal((s) => isRemote(s.mode) && !s.simulationPinned);
  const now = useNow(60_000);

  const cluster = useMemo(
    () =>
      clusterIndex(detectCongestion(assignments ?? [], now)).get(
        assignment.id,
      ) ?? null,
    [assignments, assignment.id, now],
  );
  const { floor } = gradeRisk(assignment, course);
  const deliberation = run?.deliberation ?? null;
  // Seats the triage stream already convened stand in until a session runs.
  const members =
    deliberation?.members ??
    (streamed?.length
      ? COUNCIL_ROLES.flatMap(
          (role) => streamed.filter((m) => m.role === role).slice(0, 1),
        )
      : []);
  const plan = deliberation ? rollup(deliberation.subtasks) : null;
  const telemetry = deliberation?.telemetry ?? null;

  return (
    <section
      aria-label={`Defense council for ${assignment.title}`}
      aria-busy={convening}
      className="flex flex-col text-[12px]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-1.5">
        <Key
          tone="accent"
          disabled={convening}
          onClick={() => void convene(assignment.id)}
        >
          {convening ? (
            <>
              CONVENING&nbsp;
              <Spinner />
            </>
          ) : deliberation ? (
            "RECONVENE COUNCIL"
          ) : (
            "⚖ CONVENE COUNCIL"
          )}
        </Key>
        <span
          role="status"
          className="ml-auto flex min-w-0 items-center gap-1.5 truncate text-[10px] tracking-wider text-ink-3 uppercase"
          title={run?.source === "local" ? run.cause.message : undefined}
        >
          {run ? (
            <>
              <span
                className={
                  run.source === "backend" && deliberation?.source === "ai"
                    ? "text-up"
                    : "text-accent"
                }
              >
                ●{" "}
                {run.source === "local"
                  ? "LOCAL COUNCIL"
                  : deliberation?.source === "ai"
                    ? "BACKEND · MODEL"
                    : "BACKEND · LOCAL FALLBACK"}
              </span>
              {telemetry && (
                <span className="truncate normal-case">
                  {telemetry.model_used}
                  {telemetry.tokens_per_sec !== null &&
                    ` · ${telemetry.tokens_per_sec.toFixed(1)} tok/s`}
                  {` · ${telemetry.latency_ms} ms`}
                </span>
              )}
            </>
          ) : members.length ? (
            "FROM THE LAST TRIAGE STREAM"
          ) : remote ? (
            "META MODEL · ONE PASS, THREE SEATS"
          ) : (
            "OFFLINE · LOCAL COUNCIL"
          )}
        </span>
      </div>

      <dl className="flex flex-col gap-0.5 border-b border-line px-2.5 py-1.5 text-[11px]">
        <div className="flex gap-1.5">
          <dt className="shrink-0 text-ink-3">FLOOR</dt>
          <dd className="min-w-0 break-words text-ink-2">
            {floorText(floor, course)}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="shrink-0 text-ink-3">CONGESTION</dt>
          <dd
            className={`min-w-0 break-words ${
              !cluster
                ? "text-ink-2"
                : congestionTier(cluster.congestion_score) === "critical"
                  ? "text-down"
                  : "text-accent"
            }`}
          >
            {cluster
              ? `${cluster.assignment_ids.length} deliverables across ${cluster.course_ids.length} courses due ${clusterWindow(cluster)} · σ ×${Math.sqrt(cluster.variance_inflation).toFixed(2)}`
              : "clear · no cross-course deadline within 72h of this one"}
          </dd>
        </div>
      </dl>

      {convening && !members.length && (
        <p role="status" className="px-2.5 py-3 text-accent">
          <Spinner /> Professor, Student, and Arbitrator are deliberating…
        </p>
      )}

      {members.length > 0 ? (
        <>
          <ol aria-label="Council positions">
            {members.map((member) => (
              <Seat key={member.role} member={member} />
            ))}
          </ol>
          {deliberation && (
            <div className="border-b border-line bg-up/5 px-2.5 py-1.5">
              <div className="text-[10px] tracking-wider text-up uppercase">
                Verdict
              </div>
              <p className="mt-0.5 break-words text-ink">
                {deliberation.verdict}
              </p>
            </div>
          )}
          {deliberation && plan && plan.total > 0 && (
            <div className="px-2.5 py-1.5 text-[11px]">
              <div className="text-[10px] tracking-wider text-ink-3 uppercase">
                Consensus plan · {deliberation.subtasks.length} phases ·{" "}
                {leaves(deliberation.subtasks).length} tasks · est{" "}
                {minutes(plan.estimated)}
              </div>
              <ol className="mt-1 space-y-0.5 text-ink-2">
                {deliberation.subtasks.map((node, index) => (
                  <li key={node.id} className="flex gap-2">
                    <span className="shrink-0 text-ink-3 tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={node.title}>
                      {node.title}
                    </span>
                    <span className="shrink-0 text-ink-3">
                      {minutes(rollup(node).estimated)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      ) : (
        !convening && (
          <div className="flex flex-col items-center gap-2 px-6 py-6 text-center">
            <div className="text-[11px] tracking-wider text-ink-3 uppercase">
              Council not in session
            </div>
            <p className="max-w-[48ch] text-ink-2">
              The Professor presses the rubric, the Student argues for the
              highest-return work, and the Arbitrator rules on one plan that
              fits your capacity.
            </p>
          </div>
        )
      )}
    </section>
  );
}
