import { describe, expect, it } from "vitest";
import {
  HOUR,
  assignmentVolatility,
  completionVelocity,
  deadlineLoad,
  deriveStatus,
  findNode,
  leaves,
  localTriage,
  logMinutes,
  portfolio,
  priorityScore,
  projectGrade,
  simulatable,
  velocityByCourse,
  priorityTier,
  rankQueue,
  rollup,
  setCompletion,
  studyRecommendation,
  updateSubtasks,
  volatilityRegime,
} from "@/lib/engine";
import { createMockState } from "@/lib/mockData";
import { reanchor } from "@/lib/sandbox";
import type { Assignment, Course, SubTaskNode } from "@/types";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

const node = (
  id: string,
  children: SubTaskNode[] = [],
  extra: Partial<SubTaskNode> = {},
): SubTaskNode => ({
  id,
  assignment_id: "a",
  parent_id: null,
  title: id,
  estimated_minutes: 30,
  actual_minutes: 0,
  is_completed: false,
  is_study_recommendation: false,
  children,
  ...extra,
});

const tree = () => [
  node("p", [node("c1"), node("c2", [node("g1"), node("g2")])]),
  node("q"),
];

describe("priority score", () => {
  it("is weight × points / hours until due", () => {
    expect(
      priorityScore({ weight: 0.2, points_possible: 100, due_at: at(40) }, NOW),
    ).toBeCloseTo(0.5);
  });

  it("floors hours at one so imminent and overdue work peaks", () => {
    const imminent = priorityScore(
      { weight: 0.1, points_possible: 10, due_at: at(0.25) },
      NOW,
    );
    const overdue = priorityScore(
      { weight: 0.1, points_possible: 10, due_at: at(-5) },
      NOW,
    );
    expect(imminent).toBe(1);
    expect(overdue).toBe(1);
  });

  it("bands tiers absolutely so an overdue outlier does not demote the queue", () => {
    expect(priorityTier(2000)).toBe("high");
    expect(priorityTier(253)).toBe("high");
    expect(priorityTier(41.8)).toBe("medium");
    expect(priorityTier(7.8)).toBe("low");
  });

  it("scores undated work at zero and ranks the queue by score", () => {
    expect(
      priorityScore({ weight: 1, points_possible: 100, due_at: null }, NOW),
    ).toBe(0);
    const ranked = rankQueue(createMockState(NOW).assignments, NOW);
    expect(
      ranked.every((entry) => entry.assignment.status !== "completed"),
    ).toBe(true);
    const scores = ranked.map((entry) => entry.priority);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });
});

describe("recursive task tree", () => {
  it("cascades a checked parent to every descendant", () => {
    const next = setCompletion(tree(), "p", true);
    expect(findNode(next, "p")?.is_completed).toBe(true);
    expect(
      ["c1", "c2", "g1", "g2"].every((id) => findNode(next, id)?.is_completed),
    ).toBe(true);
    expect(findNode(next, "q")?.is_completed).toBe(false);
  });

  it("checks ancestors once every sibling is complete", () => {
    let next = setCompletion(tree(), "g1", true);
    expect(findNode(next, "c2")?.is_completed).toBe(false);
    next = setCompletion(next, "g2", true);
    expect(findNode(next, "c2")?.is_completed).toBe(true);
    expect(findNode(next, "p")?.is_completed).toBe(false);
    next = setCompletion(next, "c1", true);
    expect(findNode(next, "p")?.is_completed).toBe(true);
  });

  it("unchecks ancestors when a descendant is reopened", () => {
    const done = setCompletion(tree(), "p", true);
    const reopened = setCompletion(done, "g2", false);
    expect(findNode(reopened, "c2")?.is_completed).toBe(false);
    expect(findNode(reopened, "p")?.is_completed).toBe(false);
    expect(findNode(reopened, "g1")?.is_completed).toBe(true);
  });

  it("logs minutes on leaves only and never below zero", () => {
    let next = logMinutes(tree(), "g1", 15);
    expect(findNode(next, "g1")?.actual_minutes).toBe(15);
    next = logMinutes(next, "g1", -45);
    expect(findNode(next, "g1")?.actual_minutes).toBe(0);
    next = logMinutes(next, "p", 15);
    expect(rollup(next).actual).toBe(0);
  });

  it("derives assignment status from top-level completion", () => {
    expect(deriveStatus(tree(), "pending")).toBe("pending");
    expect(deriveStatus(logMinutes(tree(), "c1", 15), "pending")).toBe(
      "in_progress",
    );
    expect(
      deriveStatus(
        setCompletion(setCompletion(tree(), "p", true), "q", true),
        "in_progress",
      ),
    ).toBe("completed");
    expect(deriveStatus([], "completed")).toBe("completed");
  });

  it("marks an assignment completed when its last top-level node closes", () => {
    const state = createMockState(NOW);
    const target = state.assignments.find((a) => a.id === "fin3100-var")!;
    const next = target.subtasks.reduce(
      (acc, top) =>
        updateSubtasks(acc, target.id, (nodes) =>
          setCompletion(nodes, top.id, true),
        ),
      state,
    );
    expect(next.assignments.find((a) => a.id === target.id)?.status).toBe(
      "completed",
    );
  });
});

describe("metrics", () => {
  it("computes completion velocity over completed, logged leaves", () => {
    const assignments = createMockState(NOW).assignments;
    // Raft 130/135 · Midterm 45/40 · HW7 55/70 · Memo 20/25 · VaR 75/90
    expect(completionVelocity(assignments)).toBeCloseTo((325 / 360) * 100);
  });

  it("ignores completed leaves with no logged time and returns null with no fills", () => {
    const unlogged = [
      {
        ...createMockState(NOW).assignments[0],
        subtasks: [node("x", [], { is_completed: true })],
      },
    ];
    expect(completionVelocity(unlogged)).toBeNull();
  });

  it("scores clustered deadlines as more volatile than spread ones", () => {
    expect(assignmentVolatility([5, 5, 5, 5])).toBe(0);
    expect(assignmentVolatility([0, 0, 20, 0])).toBeGreaterThan(
      assignmentVolatility([5, 5, 5, 5]),
    );
    // The fixtures spread work from 4h to 8 days: CV ≈ 110 over the 14-day window.
    const load = deadlineLoad(createMockState(NOW).assignments, NOW);
    expect(load).toHaveLength(14);
    expect(assignmentVolatility(load)).toBeCloseTo(110.2, 0);
    expect(volatilityRegime(assignmentVolatility(load))).toBe("low");
  });
});

describe("portfolio", () => {
  it("averages graded courses only", () => {
    const { courses } = createMockState(NOW);
    const ungraded = {
      ...courses[0],
      current_score: null,
      portfolio_margin: null,
    };
    const book = portfolio([ungraded, courses[1]]);
    expect(book.graded).toBe(1);
    expect(book.average).toBe(courses[1].current_score);
    expect(portfolio([ungraded]).average).toBeNull();
  });
});

describe("study fallback", () => {
  it("recommends a Rapid Study Action only for courses with no open work", () => {
    const { courses, assignments } = createMockState(NOW);
    const recommend = (list: typeof assignments) =>
      courses.map((course) => studyRecommendation(course, list));
    expect(recommend(assignments).filter(Boolean)).toHaveLength(0);

    const engDone = assignments.map((a) =>
      a.course_id === "eng2001" ? { ...a, status: "completed" as const } : a,
    );
    const recommendations = recommend(engDone);
    expect(recommendations.filter(Boolean)).toHaveLength(1);
    const eng = recommendations[courses.findIndex((c) => c.id === "eng2001")];
    expect(eng?.source_assignment_id).toBe("eng2001-proposal");
  });

  it("falls back to syllabus keywords when no assignment mentions study material", () => {
    const { courses } = createMockState(NOW);
    const course = {
      ...courses[0],
      syllabus: "Midterm Study Guide PDF: gait analysis",
    };
    const recommendation = studyRecommendation(course, []);
    expect(recommendation?.reason).toContain("syllabus");
    expect(recommendation?.source_assignment_id).toBeNull();
  });
});

describe("local triage", () => {
  it("builds a hierarchy of 15–45 minute leaves tied to the assignment", () => {
    const exam = createMockState(NOW).assignments.find(
      (a) => a.id === "math4102-exam",
    )!;
    const plan = localTriage(exam);
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.some((top) => top.children.length > 0)).toBe(true);
    for (const leaf of leaves(plan)) {
      expect(leaf.estimated_minutes).toBeGreaterThanOrEqual(15);
      expect(leaf.estimated_minutes).toBeLessThanOrEqual(45);
      expect(leaf.assignment_id).toBe(exam.id);
    }
    for (const top of plan) {
      for (const child of top.children) expect(child.parent_id).toBe(top.id);
    }
  });
});

describe("sandbox", () => {
  it("re-anchors every timestamp by the same offset", () => {
    const state = createMockState(NOW);
    const shifted = reanchor(state, 3 * HOUR);
    expect(
      Date.parse(shifted.assignments[0].due_at!) -
        Date.parse(state.assignments[0].due_at!),
    ).toBe(3 * HOUR);
    expect(
      Date.parse(shifted.courses[0].grade_history[0].at) -
        Date.parse(state.courses[0].grade_history[0].at),
    ).toBe(3 * HOUR);
  });
});

describe("per-course velocity", () => {
  it("matches completion velocity over each course's own assignments", () => {
    const { assignments } = createMockState(NOW);
    const byCourse = velocityByCourse(assignments);
    // Raft 130/135 + Midterm 45/40 are the CS 3801 fills.
    expect(byCourse.get("cs3801")).toBeCloseTo((175 / 175) * 100);
    for (const [id, velocity] of byCourse) {
      expect(velocity).toEqual(
        completionVelocity(assignments.filter((a) => a.course_id === id)),
      );
    }
  });
});

describe("what-if projection", () => {
  const course: Course = {
    id: "c",
    course_code: "CS 1",
    name: "Course",
    current_score: 92.4,
    target_score: 90,
    portfolio_margin: 2.4,
    grade_history: [],
  };
  const assignment = (
    id: string,
    weight: number,
    due_at: string | null,
    extra: Partial<Assignment> = {},
  ): Assignment => ({
    id,
    course_id: "c",
    course_code: "CS 1",
    title: id,
    due_at,
    points_possible: 100,
    weight,
    description: null,
    status: "pending",
    graded: false,
    priority_score: 0,
    subtasks: [],
    ...extra,
  });
  const lab = assignment("lab", 25, at(26));
  const quiz = assignment("quiz", 15, at(72));

  it("simulates ungraded, weighted work in this course, earliest deadline first", () => {
    const open = simulatable("c", [
      assignment("undated", 10, null),
      quiz,
      // Submitted (or every task checked) but not scored: still simulatable.
      assignment("submitted", 20, at(5), { status: "completed" }),
      assignment("graded", 20, at(-48), { status: "completed", graded: true }),
      assignment("unweighted", 0, at(5)),
      assignment("other", 20, at(5), { course_id: "x" }),
      lab,
    ]);
    expect(open.map((a) => a.id)).toEqual([
      "submitted",
      "lab",
      "quiz",
      "undated",
    ]);
  });

  it("holds the current grade until a hypothetical score is set", () => {
    const projection = projectGrade(course, [lab, quiz], {}, NOW)!;
    expect(projection.grade).toBe(92.4);
    expect(projection.margin).toBeCloseTo(2.4);
    expect(projection.impact).toEqual({ lab: 0, quiz: 0 });
    expect(projection.path.map((step) => step.score)).toEqual([
      92.4, 92.4, 92.4,
    ]);
  });

  it("moves the grade by weight × (score − current) and flips buffer to deficit", () => {
    const projection = projectGrade(course, [lab, quiz], { lab: 80 }, NOW)!;
    // 92.4 + 0.25 × (80 − 92.4) = 89.3
    expect(projection.impact.lab).toBeCloseTo(-3.1);
    expect(projection.grade).toBeCloseTo(89.3);
    expect(projection.margin).toBeCloseTo(-0.7);
  });

  it.each([
    [5, 0, 87.78, 91.54, 0.04, 1],
    [5, 50, 90.28, 92.79, 1.29, 2],
    [30, 50, 79.68, 87.49, -4.01, 1],
    [30, 85, 90.18, 92.74, 1.24, 2],
    [30, 98, 94.08, 94.69, 3.19, 2],
    [30, 100, 94.68, 94.99, 3.49, 2],
  ])(
    "projects weight %s and score %s into the course and portfolio",
    (weight, score, grade, average, margin, above) => {
      const deliverable = assignment("midterm", weight, at(24));
      const projection = projectGrade(
        course,
        [deliverable],
        { midterm: score },
        NOW,
      )!;
      const peer = {
        ...course,
        id: "peer",
        current_score: 95.3,
        target_score: 93,
        portfolio_margin: 2.3,
      };
      const courses = [course, peer];
      const book = portfolio(courses, new Map([[course.id, projection]]));

      expect(projection.grade).toBeCloseTo(grade);
      expect(projection.margin).toBeCloseTo(grade - 90);
      expect(projection.path.at(-1)?.score).toBeCloseTo(grade);
      expect(book.average).toBeCloseTo(average);
      expect(book.margin).toBeCloseTo(margin);
      expect(book.above).toBe(above);
      expect(book.graded).toBe(2);
      // Clearing the scenario restores the posted grades without mutating them.
      const reset = projectGrade(course, [deliverable], {}, NOW);
      const resetBook = portfolio(courses, new Map([[course.id, reset]]));
      expect(resetBook.average).toBeCloseTo(93.85);
      expect(resetBook.margin).toBeCloseTo(2.35);
      expect(resetBook.above).toBe(2);
      expect(course.current_score).toBe(92.4);
      expect(peer.current_score).toBe(95.3);
    },
  );

  it("finds the single score on open work that lands exactly on target", () => {
    const { breakEven } = projectGrade(course, [lab, quiz], {}, NOW)!;
    // 92.4 + (90 − 92.4) × 100 / 40
    expect(breakEven).toBeCloseTo(86.4);
    const atBreakEven = projectGrade(
      course,
      [lab, quiz],
      { lab: breakEven!, quiz: breakEven! },
      NOW,
    )!;
    expect(atBreakEven.grade).toBeCloseTo(90);
    expect(projectGrade(course, [], {}, NOW)!.breakEven).toBeNull();
  });

  it("stays a weighted average when open weight exceeds 100", () => {
    const heavy = [assignment("a", 80, at(1)), assignment("b", 40, at(2))];
    const projection = projectGrade(
      { ...course, current_score: 90 },
      heavy,
      { a: 100, b: 100 },
      NOW,
    )!;
    expect(projection.grade).toBeCloseTo(100);
  });

  it("steps the path at each deadline: overdue now, undated after the last", () => {
    const overdue = assignment("late", 10, at(-5));
    const undated = assignment("tbd", 10, null);
    const open = simulatable("c", [undated, quiz, overdue, lab]);
    const { path } = projectGrade(course, open, { late: 0, quiz: 100 }, NOW)!;
    expect(path.map((step) => step.assignment_id)).toEqual([
      null,
      "late",
      "lab",
      "quiz",
      "tbd",
    ]);
    expect(path.map((step) => step.at)).toEqual([
      NOW,
      NOW,
      Date.parse(lab.due_at!),
      Date.parse(quiz.due_at!),
      Date.parse(quiz.due_at!) + 24 * HOUR,
    ]);
    // 0% on the overdue 10% assignment costs 9.24 immediately.
    expect(path[1].score).toBeCloseTo(92.4 - 9.24);
    expect(path.at(-1)!.score).toBeCloseTo(92.4 - 9.24 + 0.15 * 7.6);
  });

  it("has nothing to project from before the first posted grade", () => {
    expect(
      projectGrade({ ...course, current_score: null }, [lab], {}, NOW),
    ).toBeNull();
  });
});
