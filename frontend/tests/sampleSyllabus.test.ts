import { describe, expect, it } from "vitest";
import { evaluateCircuitBreaker } from "@/lib/circuitBreaker";
import { HOUR, leaves } from "@/lib/engine";
import { FOCUS_BLOCK_MINUTES, buildFocusBlock } from "@/lib/focusBlock";
import { SAMPLE_BADGE } from "@/lib/judgeTrust";
import {
  SAMPLE_COURSE_ID,
  isSampleCourse,
  sampleSyllabusState,
} from "@/lib/sampleSyllabus";

const NOW = Date.parse("2026-10-21T12:00:00Z");

describe("sampleSyllabusState", () => {
  const sample = sampleSyllabusState(NOW);

  it("is one CS-101 course with a posted grade below its target", () => {
    expect(sample.courses).toHaveLength(1);
    const [course] = sample.courses;
    expect(course.id).toBe(SAMPLE_COURSE_ID);
    expect(course.course_code).toBe("CS-101");
    expect(course.current_score).not.toBeNull();
    expect(course.current_score as number).toBeLessThan(course.target_score);
    expect(course.portfolio_margin).toBeCloseTo(
      (course.current_score as number) - course.target_score,
    );
  });

  it("splits the whole grade across open, unscored deliverables", () => {
    expect(sample.assignments.length).toBeGreaterThanOrEqual(5);
    const weight = sample.assignments.reduce((sum, a) => sum + a.weight, 0);
    expect(weight).toBe(100);
    for (const a of sample.assignments) {
      expect(a.course_id).toBe(SAMPLE_COURSE_ID);
      expect(a.course_code).toBe("CS-101");
      expect(a.graded).toBe(false);
      expect(a.status).toBe("pending");
      expect(Date.parse(a.due_at as string)).toBeGreaterThan(NOW);
    }
  });

  it("keeps every id local so edits are never mirrored to the backend", () => {
    const ids = [
      ...sample.courses.map((c) => c.id),
      ...sample.assignments.flatMap((a) => [
        a.id,
        ...leaves(a.subtasks).map((t) => t.id),
      ]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("local-")).toBe(true);
  });

  it("is deterministic for a given clock", () => {
    expect(sampleSyllabusState(NOW)).toEqual(sample);
    const later = sampleSyllabusState(NOW + HOUR);
    expect(later.assignments[0].due_at).not.toBe(sample.assignments[0].due_at);
  });

  it("marks the book as demo data", () => {
    expect(sample.metrics.demo_mode).toBe(true);
  });

  it("ships the nearest deliverable with a ready plan that fills a 45 minute block", () => {
    const block = buildFocusBlock(sample, NOW);
    expect(block?.course_code).toBe("CS-101");
    expect(block?.total_minutes).toBe(FOCUS_BLOCK_MINUTES);
    expect(block?.tasks.length).toBeGreaterThanOrEqual(2);
    expect(block?.break_even_score).not.toBeNull();
    expect(block?.downside_floor).not.toBeNull();
    expect(block?.points_locked_in).toBeGreaterThan(0);
  });

  it("is protected, never halted, by the breaker reading of its own book", () => {
    const breaker = evaluateCircuitBreaker(sample);
    expect(breaker.triggered).toBe(true);
    expect(breaker.halted_course_ids).toEqual([]);
    const block = buildFocusBlock(sample, NOW, breaker);
    expect(block?.course_code).toBe("CS-101");
    expect(block?.course_id).toBe(SAMPLE_COURSE_ID);
    expect(block?.policy_reason).toContain("PROTECTING CS-101");
  });
});

describe("isSampleCourse", () => {
  it("recognises only the bundled sample course", () => {
    expect(isSampleCourse(SAMPLE_COURSE_ID)).toBe(true);
    expect(isSampleCourse("local-preset:stanford-cs229")).toBe(false);
    expect(isSampleCourse("course-1")).toBe(false);
  });
});

describe("SAMPLE_BADGE", () => {
  it("labels the data as a sample and says nothing was uploaded", () => {
    expect(SAMPLE_BADGE.label).toBe("SAMPLE · Offline Sandbox");
    expect(SAMPLE_BADGE.tooltip).toMatch(/bundled/i);
    expect(SAMPLE_BADGE.tooltip).toMatch(/no syllabus was uploaded/i);
  });
});
