// Deadline congestion: open deliverables from different courses that fall due
// inside one 72-hour window. Mirrors backend/service.py
// `detect_deadline_congestion` (the Monte Carlo response's `congestion_matrix`)
// so a detached desk flags, and prices, the same pile-ups the backend would.

import { HOUR, isActive } from "@/lib/engine";
import type { Assignment } from "@/types";

/** Deadlines this close together compete for the same nights (inclusive). */
export const CONGESTION_WINDOW_HOURS = 72;
/** Pressure each competing deliverable adds past the first, capped at 1. */
export const PRESSURE_PER_DELIVERABLE = 0.25;

export interface CongestionCluster {
  id: string;
  start_at: string;
  end_at: string;
  /** Two or more: a pile-up inside one course is just that course's schedule. */
  course_ids: string[];
  assignment_ids: string[];
  /** 0–1: 0.25 per competing deliverable. */
  congestion_score: number;
  /** 1 + congestion_score, a multiplier of variance: simulated spread grows by its square root. */
  variance_inflation: number;
}

export type CongestionTier = "watch" | "elevated" | "critical";

/** One competitor watches, two elevate, three or more is critical. */
export function congestionTier(score: number): CongestionTier {
  if (score >= 0.75) return "critical";
  if (score >= 0.5) return "elevated";
  return "watch";
}

const byId = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Maximal cross-course windows: from each open, future-dated deadline in due
 * order, take everything due within 72 hours. A window that ends where the
 * previous one ended is a subset of it and is skipped; one spanning a single
 * course is not congestion. Windows may overlap, so a deliverable can sit in
 * more than one cluster.
 */
export function detectCongestion(
  assignments: Assignment[],
  now: number,
): CongestionCluster[] {
  const pending = assignments
    .filter((a) => isActive(a) && !a.graded && a.due_at !== null)
    .map((a) => ({ assignment: a, due: Date.parse(a.due_at!) }))
    .filter((entry) => Number.isFinite(entry.due) && entry.due >= now)
    .sort((x, y) => x.due - y.due || byId(x.assignment.id, y.assignment.id));
  const span = CONGESTION_WINDOW_HOURS * HOUR;
  const clusters: CongestionCluster[] = [];
  let right = 0;
  let lastEnd = 0;
  pending.forEach((first, left) => {
    while (right < pending.length && pending[right].due - first.due <= span)
      right += 1;
    if (right === lastEnd) return;
    const window = pending.slice(left, right);
    const courseIds = [...new Set(window.map((e) => e.assignment.course_id))].sort(byId);
    if (courseIds.length < 2) return;
    lastEnd = right;
    const ids = window.map((e) => e.assignment.id).sort(byId);
    const score = Math.min(1, (window.length - 1) * PRESSURE_PER_DELIVERABLE);
    clusters.push({
      id: `congestion:${ids.join("+")}`,
      start_at: new Date(first.due).toISOString(),
      end_at: new Date(window[window.length - 1].due).toISOString(),
      course_ids: courseIds,
      assignment_ids: ids,
      congestion_score: score,
      variance_inflation: 1 + score,
    });
  });
  return clusters;
}

/** Assignment id → the worst cluster it sits in. */
export function clusterIndex(
  clusters: CongestionCluster[],
): Map<string, CongestionCluster> {
  const index = new Map<string, CongestionCluster>();
  for (const cluster of clusters)
    for (const id of cluster.assignment_ids) {
      const held = index.get(id);
      if (!held || cluster.congestion_score > held.congestion_score)
        index.set(id, cluster);
    }
  return index;
}

/**
 * Assignment id → variance multiplier for the Monte Carlo engine. Overlapping
 * windows describe the same workload, so the largest applies, never a product.
 */
export const varianceInflation = (clusters: CongestionCluster[]) =>
  new Map(
    [...clusterIndex(clusters)].map(([id, c]) => [id, c.variance_inflation]),
  );

/** Clusters a course takes part in, worst first. */
export const courseClusters = (
  clusters: CongestionCluster[],
  courseId: string,
) =>
  clusters
    .filter((c) => c.course_ids.includes(courseId))
    .sort((x, y) => y.congestion_score - x.congestion_score);

/** "OCT 22 – OCT 24" in local time; a single date when the window is one day. */
export function clusterWindow(cluster: CongestionCluster): string {
  const day = (iso: string) =>
    new Date(iso)
      .toLocaleDateString("en-US", { month: "short", day: "numeric" })
      .toUpperCase();
  const start = day(cluster.start_at);
  const end = day(cluster.end_at);
  return start === end ? start : `${start} – ${end}`;
}
