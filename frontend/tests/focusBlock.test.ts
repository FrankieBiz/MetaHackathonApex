import { describe, expect, it } from "vitest";
import {
  evaluateCircuitBreaker,
  type CircuitBreakerStatus,
} from "@/lib/circuitBreaker";
import { HOUR, gradeRisk } from "@/lib/engine";
import { FOCUS_BLOCK_MINUTES, buildFocusBlock } from "@/lib/focusBlock";
import type {
  Assignment,
  Course,
  SubTaskNode,
  TerminalMetrics,
  TerminalState,
} from "@/types";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

const METRICS: TerminalMetrics = {
  completion_velocity: 0,
  assignment_volatility: 0,
  total_budgeted_minutes: 0,
  total_actual_minutes: 0,
  last_synced_at: at(0),
  demo_mode: false,
};

function course(
  id: string,
  score: number | null,
  target = 85,
  overrides: Partial<Course> = {},
): Course {
  return {
    id,
    course_code: id.toUpperCase(),
    name: `Course ${id}`,
    current_score: score,
    target_score: target,
    portfolio_margin: score === null ? null : score - target,
    grade_history: [],
    ...overrides,
  };
}

function task(
  id: string,
  minutes: number,
  overrides: Partial<SubTaskNode> = {},
): SubTaskNode {
  return {
    id,
    assignment_id: "a",
    parent_id: null,
    title: `Task ${id}`,
    estimated_minutes: minutes,
    actual_minutes: 0,
    is_completed: false,
    is_study_recommendation: false,
    children: [],
    ...overrides,
  };
}

function assignment(
  id: string,
  courseId: string,
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    id,
    course_id: courseId,
    course_code: courseId.toUpperCase(),
    title: `Assignment ${id}`,
    due_at: at(48),
    points_possible: 100,
    weight: 20,
    description: null,
    status: "pending",
    graded: false,
    score: null,
    priority_score: 0,
    subtasks: [task(`${id}-t1`, 30)],
    ...overrides,
  };
}

const state = (
  courses: Course[],
  assignments: Assignment[],
): TerminalState => ({ courses, assignments, metrics: METRICS });

function breaker(
  overrides: Partial<CircuitBreakerStatus> = {},
): CircuitBreakerStatus {
  return {
    level: "LEVEL_2_RESTRICTION",
    triggered: true,
    halted_course_ids: [],
    protected_assignment_ids: [],
    reallocated_minutes: 0,
    reason: "test",
    recommendations: [],
    ...overrides,
  };
}

describe("buildFocusBlock packing", () => {
  it("packs open leaves in plan order up to the 45 minute budget", () => {
    const a = assignment("a", "cs", {
      subtasks: [task("t1", 20), task("t2", 15), task("t3", 25)],
    });
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(FOCUS_BLOCK_MINUTES).toBe(45);
    expect(block?.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(block?.total_minutes).toBe(35);
  });

  it("fills the budget exactly when the leaves add up to 45", () => {
    const a = assignment("a", "cs", {
      subtasks: [task("t1", 25), task("t2", 20), task("t3", 10)],
    });
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block?.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(block?.total_minutes).toBe(45);
  });

  it("skips completed leaves and flattens nested subtasks to their leaves", () => {
    const a = assignment("a", "cs", {
      subtasks: [
        task("parent", 60, {
          children: [
            task("done", 15, { is_completed: true }),
            task("open-1", 10),
            task("open-2", 10),
          ],
        }),
        task("t-last", 5),
      ],
    });
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block?.tasks.map((t) => t.id)).toEqual([
      "open-1",
      "open-2",
      "t-last",
    ]);
    expect(block?.tasks.every((t) => !t.is_completed)).toBe(true);
    expect(block?.total_minutes).toBe(25);
  });

  it("stops at the first leaf that does not fit instead of reordering the plan", () => {
    const a = assignment("a", "cs", {
      subtasks: [task("t1", 20), task("t2", 30), task("t3", 5)],
    });
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block?.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(block?.total_minutes).toBe(20);
  });

  it("time-boxes a first leaf longer than the budget to 45 minutes", () => {
    const a = assignment("a", "cs", {
      subtasks: [task("big", 120), task("t2", 10)],
    });
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block?.tasks).toEqual([
      {
        id: "big",
        title: "Task big",
        estimated_minutes: 45,
        is_completed: false,
      },
    ]);
    expect(block?.total_minutes).toBe(45);
  });

  it("returns a single 45 minute focus task for an untriaged deliverable", () => {
    const a = assignment("a", "cs", { subtasks: [] });
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block?.tasks).toHaveLength(1);
    expect(block?.tasks[0]).toMatchObject({
      estimated_minutes: 45,
      is_completed: false,
    });
    expect(block?.tasks[0].title).toContain("Assignment a");
    expect(block?.total_minutes).toBe(45);
    // No plan to size the block against, so no share of the weight is claimed.
    expect(block?.points_locked_in).toBe(0);
  });
});

describe("buildFocusBlock grade math", () => {
  it("locks in the weight share of the packed minutes", () => {
    const a = assignment("a", "cs", {
      weight: 30,
      subtasks: [task("t1", 20), task("t2", 20), task("t3", 60)],
    });
    // 40 of the plan's 100 minutes fit the block: 30% × 40/100.
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block?.points_locked_in).toBeCloseTo(12, 10);
  });

  it("keeps completed minutes in the denominator", () => {
    const a = assignment("a", "cs", {
      weight: 25,
      subtasks: [task("t1", 15, { is_completed: true }), task("t2", 15)],
    });
    // Completed minutes stay in the denominator, as in nextBestAction.
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block?.points_locked_in).toBeCloseTo(12.5, 10);
  });

  it("reports the break-even score the course needs from this deliverable", () => {
    const c = course("cs", 80, 85);
    const a = assignment("a", "cs", { weight: 20 });
    const block = buildFocusBlock(state([c], [a]), NOW);
    // 80 − (80 − 85) × 100 / 20 = 105: out of reach on this deliverable alone.
    expect(block?.break_even_score).toBeCloseTo(105, 10);
    expect(block?.break_even_score).toBe(gradeRisk(a, c).floor);
  });

  it("reports the course grade left if the deliverable scored zero", () => {
    const block = buildFocusBlock(
      state([course("cs", 80, 85)], [assignment("a", "cs", { weight: 20 })]),
      NOW,
    );
    expect(block?.downside_floor).toBeCloseTo(64, 10);
  });

  it("leaves both floors null until the course has a posted grade", () => {
    const block = buildFocusBlock(
      state([course("cs", null)], [assignment("a", "cs")]),
      NOW,
    );
    expect(block?.break_even_score).toBeNull();
    expect(block?.downside_floor).toBeNull();
  });

  it("leaves break-even null for an unweighted deliverable that cannot move the grade", () => {
    const block = buildFocusBlock(
      state([course("cs", 80)], [assignment("a", "cs", { weight: 0 })]),
      NOW,
    );
    expect(block?.break_even_score).toBeNull();
    expect(block?.points_locked_in).toBe(0);
  });

  it("carries the deliverable identity and deadline into the block", () => {
    const a = assignment("a", "cs", { due_at: at(10), title: "Lab report" });
    const block = buildFocusBlock(state([course("cs", 80)], [a]), NOW);
    expect(block).toMatchObject({
      assignment_id: "a",
      course_id: "cs",
      course_code: "CS",
      assignment_title: "Lab report",
      due_at: at(10),
    });
  });
});

describe("buildFocusBlock selection", () => {
  it("takes the top of the priority queue and says why", () => {
    const soon = assignment("soon", "cs", { due_at: at(10) });
    const later = assignment("later", "cs", { due_at: at(200) });
    const block = buildFocusBlock(state([course("cs", 80)], [later, soon]), NOW);
    expect(block?.assignment_id).toBe("soon");
    expect(block?.policy_reason).toBe("HIGHEST GRADE YIELD · TOP OF QUEUE");
  });

  it("uses the same reason when the breaker is NORMAL or absent", () => {
    const s = state([course("cs", 90)], [assignment("a", "cs")]);
    const normal = evaluateCircuitBreaker(s);
    expect(normal.level).toBe("NORMAL");
    expect(buildFocusBlock(s, NOW, normal)?.policy_reason).toBe(
      "HIGHEST GRADE YIELD · TOP OF QUEUE",
    );
    expect(buildFocusBlock(s, NOW, null)?.policy_reason).toBe(
      "HIGHEST GRADE YIELD · TOP OF QUEUE",
    );
  });

  it("skips a deliverable whose tasks are all checked and moves down the queue", () => {
    const checked = assignment("checked", "cs", {
      due_at: at(5),
      subtasks: [task("c1", 20, { is_completed: true })],
    });
    const open = assignment("open", "cs", { due_at: at(100) });
    const block = buildFocusBlock(
      state([course("cs", 80)], [checked, open]),
      NOW,
    );
    expect(block?.assignment_id).toBe("open");
  });

  it("does not mutate the terminal state or the breaker", () => {
    const s = state(
      [course("cs", 80)],
      [assignment("a", "cs", { subtasks: [task("t1", 20), task("t2", 20)] })],
    );
    const b = breaker({ protected_assignment_ids: ["a"] });
    const before = structuredClone({ s, b });
    buildFocusBlock(s, NOW, b);
    expect({ s, b }).toEqual(before);
  });
});

describe("buildFocusBlock under the circuit breaker", () => {
  // healthy is above target, so a restricted breaker pauses it; weak is below
  // target, so its work is protected. healthy's deadline is sooner, so it tops
  // the unconstrained queue.
  const courses = [course("healthy", 95, 85), course("weak", 60, 85)];
  const healthyWork = assignment("h1", "healthy", {
    due_at: at(6),
    weight: 30,
  });
  const weakWork = assignment("w1", "weak", { due_at: at(120), weight: 20 });
  const desk = state(courses, [healthyWork, weakWork]);

  it("tops the unconstrained queue with the healthy course", () => {
    expect(buildFocusBlock(desk, NOW)?.course_id).toBe("healthy");
  });

  it("never selects a halted course and reallocates to the protected one", () => {
    const status = evaluateCircuitBreaker(desk);
    expect(status.level).toBe("LEVEL_2_RESTRICTION");
    expect(status.halted_course_ids).toEqual(["healthy"]);
    const block = buildFocusBlock(desk, NOW, status);
    expect(block?.course_id).toBe("weak");
    expect(block?.assignment_id).toBe("w1");
    expect(block?.policy_reason).toBe("BREAKER L2 · PROTECTING WEAK");
  });

  it("holds the exclusion at Level 3 as well", () => {
    const block = buildFocusBlock(
      desk,
      NOW,
      breaker({
        level: "LEVEL_3_HALT",
        halted_course_ids: ["healthy"],
        protected_assignment_ids: ["w1"],
      }),
    );
    expect(block?.course_id).toBe("weak");
    expect(block?.policy_reason).toBe("BREAKER L3 · PROTECTING WEAK");
  });

  it("reallocates to an eligible unprotected course and names the halted one", () => {
    const third = assignment("o1", "other", { due_at: at(300) });
    const s = state(
      [...courses, course("other", 90, 85)],
      [healthyWork, weakWork, third],
    );
    const block = buildFocusBlock(
      s,
      NOW,
      breaker({
        halted_course_ids: ["healthy", "weak"],
        protected_assignment_ids: [],
      }),
    );
    expect(block?.assignment_id).toBe("o1");
    expect(block?.policy_reason).toBe(
      "BREAKER L2 · HEALTHY HALTED · REALLOCATED TO OTHER",
    );
  });

  it("returns null rather than touch a halted course when nothing else is open", () => {
    const s = state([course("healthy", 95)], [healthyWork]);
    expect(
      buildFocusBlock(s, NOW, breaker({ halted_course_ids: ["healthy"] })),
    ).toBeNull();
  });

  it("ignores halted course ids below Level 2", () => {
    const block = buildFocusBlock(
      desk,
      NOW,
      breaker({
        level: "LEVEL_1_CAUTION",
        halted_course_ids: ["healthy"],
      }),
    );
    expect(block?.course_id).toBe("healthy");
    expect(block?.policy_reason).toBe("HIGHEST GRADE YIELD · TOP OF QUEUE");
  });

  it("prioritizes protected assignments under Level 2 over a higher-priority deliverable", () => {
    const status = breaker({
      halted_course_ids: [],
      protected_assignment_ids: ["w1"],
    });
    const block = buildFocusBlock(desk, NOW, status);
    expect(block?.assignment_id).toBe("w1");
    expect(block?.policy_reason).toBe("BREAKER L2 · PROTECTING WEAK");
  });

  it("orders several protected deliverables by the normal priority queue", () => {
    const early = assignment("w-early", "weak", { due_at: at(24) });
    const late = assignment("w-late", "weak", { due_at: at(240) });
    const block = buildFocusBlock(
      state(courses, [healthyWork, late, early]),
      NOW,
      breaker({ protected_assignment_ids: ["w-late", "w-early"] }),
    );
    expect(block?.assignment_id).toBe("w-early");
  });

  it("falls back to other eligible work once protected work has nothing open", () => {
    const finished = assignment("w1", "weak", {
      subtasks: [task("w1-t1", 20, { is_completed: true })],
    });
    const block = buildFocusBlock(
      state(courses, [healthyWork, finished]),
      NOW,
      breaker({ protected_assignment_ids: ["w1"] }),
    );
    expect(block?.assignment_id).toBe("h1");
    expect(block?.policy_reason).toBe("HIGHEST GRADE YIELD · TOP OF QUEUE");
  });

  it("lets a halted course win over a protected id that points into it", () => {
    const block = buildFocusBlock(
      state(courses, [healthyWork]),
      NOW,
      breaker({
        halted_course_ids: ["healthy"],
        protected_assignment_ids: ["h1"],
      }),
    );
    expect(block).toBeNull();
  });
});

describe("buildFocusBlock with nothing to focus on", () => {
  it("returns null when there are no assignments", () => {
    expect(buildFocusBlock(state([course("cs", 80)], []), NOW)).toBeNull();
  });

  it("returns null when every assignment is completed or already graded", () => {
    const s = state(
      [course("cs", 80)],
      [
        assignment("done", "cs", { status: "completed" }),
        assignment("graded", "cs", { graded: true }),
      ],
    );
    expect(buildFocusBlock(s, NOW)).toBeNull();
    expect(buildFocusBlock(s, NOW, evaluateCircuitBreaker(s))).toBeNull();
  });

  it("returns null when every open deliverable has all of its tasks checked", () => {
    const s = state(
      [course("cs", 80)],
      [
        assignment("a", "cs", {
          subtasks: [task("t1", 20, { is_completed: true })],
        }),
      ],
    );
    expect(buildFocusBlock(s, NOW)).toBeNull();
  });
});
