// Bundled CS-101 sample for the launch pad's demo button. It is built on the
// client with no network call, so it works offline. The grade, weights, and
// dates are representative, not any real course's policy.

import type {
  Assignment,
  Course,
  SubTaskNode,
  TerminalState,
} from "@/types";

/** The `local-` prefix keeps the terminal from mirroring edits to the backend. */
export const SAMPLE_COURSE_ID = "local-sample:cs-101";

export const isSampleCourse = (courseId: string): boolean =>
  courseId === SAMPLE_COURSE_ID;

const HOUR = 3_600_000;

interface SampleDeliverable {
  slug: string;
  title: string;
  weight: number;
  points: number;
  dueInHours: number;
  /** Planned tasks as [title, minutes]; omitted while the deliverable still needs triage. */
  plan?: [string, number][];
}

const DELIVERABLES: SampleDeliverable[] = [
  {
    slug: "binary-trees-lab",
    title: "Binary Trees Lab",
    weight: 15,
    points: 100,
    dueInHours: 30,
    plan: [
      ["Read the lab spec and grading rubric", 15],
      ["Implement insert and search", 30],
      ["Implement delete for all three cases", 40],
      ["Write traversal tests", 25],
      ["Submit and check the autograder", 10],
    ],
  },
  {
    slug: "problem-set-4",
    title: "Problem Set 4",
    weight: 10,
    points: 50,
    dueInHours: 96,
    plan: [
      ["Work the recurrence problems", 35],
      ["Write up the proofs", 40],
    ],
  },
  {
    slug: "midterm-exam",
    title: "Midterm Exam",
    weight: 25,
    points: 100,
    dueInHours: 216,
  },
  {
    slug: "sorting-project",
    title: "Sorting Project",
    weight: 20,
    points: 100,
    dueInHours: 336,
  },
  {
    slug: "final-exam",
    title: "Final Exam",
    weight: 30,
    points: 150,
    dueInHours: 720,
  },
];

const SYLLABUS_TEXT = [
  "CS-101: Introduction to Computer Science (sample syllabus)",
  "Grading:",
  ...DELIVERABLES.map(
    (d) => `- ${d.title}: ${d.weight}% (${d.points} pts)`,
  ),
].join("\n");

/** The CS-101 course book, anchored to `now` so its countdowns are live. */
export function sampleSyllabusState(now: number = Date.now()): TerminalState {
  const course: Course = {
    id: SAMPLE_COURSE_ID,
    course_code: "CS-101",
    name: "Introduction to Computer Science",
    current_score: 84,
    target_score: 90,
    portfolio_margin: -6,
    syllabus: SYLLABUS_TEXT,
    grade_history: [],
  };

  const assignments: Assignment[] = DELIVERABLES.map((d) => {
    const id = `${SAMPLE_COURSE_ID}:${d.slug}`;
    const subtasks: SubTaskNode[] = (d.plan ?? []).map(
      ([title, minutes], index) => ({
        id: `${id}:t${index + 1}`,
        assignment_id: id,
        parent_id: null,
        title,
        estimated_minutes: minutes,
        actual_minutes: 0,
        is_completed: false,
        is_study_recommendation: false,
        children: [],
      }),
    );
    return {
      id,
      course_id: SAMPLE_COURSE_ID,
      course_code: course.course_code,
      title: d.title,
      due_at: new Date(now + d.dueInHours * HOUR).toISOString(),
      points_possible: d.points,
      weight: d.weight,
      description: "CS-101 sample syllabus",
      status: "pending",
      graded: false,
      score: null,
      priority_score: 0,
      subtasks,
    };
  });

  return {
    courses: [course],
    assignments,
    metrics: {
      completion_velocity: 0,
      assignment_volatility: 0,
      total_budgeted_minutes: 0,
      total_actual_minutes: 0,
      last_synced_at: new Date(now).toISOString(),
      demo_mode: true,
    },
  };
}

export const buildSampleState = sampleSyllabusState;
