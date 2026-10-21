// Sample syllabi for the one-click quick-load bar. The backend serves the same
// IDs at /api/v1/syllabus/presets; these copies keep the bar working offline.
// Weights and dates are representative samples, not official course policy.

import type { Assignment, Course, TerminalState } from "@/types";

export type PresetUniversity = "MIT" | "Stanford" | "Harvard" | "Columbia";

export interface PresetDeliverable {
  title: string;
  /** Percent of the final grade, 0–100. */
  weight: number;
  points: number;
  dueInDays: number;
}

export interface SyllabusPreset {
  id: string;
  university: PresetUniversity;
  course_code: string;
  name: string;
  term: string;
  description: string;
  /** Only the local copies carry these; they build the offline course book. */
  syllabus_text?: string;
  deliverables?: PresetDeliverable[];
}

const DAY = 86_400_000;

/** Renders a preset's deliverables as the plain-text syllabus the extractor reads. */
const syllabusOf = (
  preset: Omit<SyllabusPreset, "syllabus_text">,
): string =>
  [
    `${preset.course_code}: ${preset.name} (${preset.university}, ${preset.term})`,
    preset.description,
    "Grading:",
    ...(preset.deliverables ?? []).map(
      (d) =>
        `- ${d.title}: ${d.weight}% (${d.points} pts), due in ${d.dueInDays} days`,
    ),
  ].join("\n");

const preset = (
  base: Omit<SyllabusPreset, "syllabus_text">,
): SyllabusPreset => ({ ...base, syllabus_text: syllabusOf(base) });

export const LOCAL_SYLLABUS_PRESETS: readonly SyllabusPreset[] = [
  preset({
    id: "mit-6-033",
    university: "MIT",
    course_code: "6.033",
    name: "Computer System Engineering",
    term: "Spring",
    description:
      "Operating systems, networking, distributed systems, and security, taught through design papers and a semester-long systems project.",
    deliverables: [
      { title: "Design Project Preliminary Report", weight: 10, points: 100, dueInDays: 6 },
      { title: "Hands-on Assignments", weight: 10, points: 100, dueInDays: 9 },
      { title: "Quiz 1", weight: 20, points: 100, dueInDays: 16 },
      { title: "Design Project Final Report", weight: 25, points: 100, dueInDays: 30 },
      { title: "Quiz 2", weight: 20, points: 100, dueInDays: 41 },
      { title: "Recitation Participation", weight: 15, points: 100, dueInDays: 45 },
    ],
  }),
  preset({
    id: "stanford-cs229",
    university: "Stanford",
    course_code: "CS229",
    name: "Machine Learning",
    term: "Autumn",
    description:
      "Supervised and unsupervised learning, learning theory, and reinforcement learning, with four problem sets and a research-style final project.",
    deliverables: [
      { title: "Problem Set 1", weight: 10, points: 100, dueInDays: 4 },
      { title: "Problem Set 2", weight: 10, points: 100, dueInDays: 13 },
      { title: "Project Proposal", weight: 5, points: 20, dueInDays: 18 },
      { title: "Midterm Exam", weight: 25, points: 100, dueInDays: 24 },
      { title: "Problem Set 3", weight: 10, points: 100, dueInDays: 31 },
      { title: "Final Project Report", weight: 40, points: 100, dueInDays: 52 },
    ],
  }),
  preset({
    id: "harvard-stat110",
    university: "Harvard",
    course_code: "STAT 110",
    name: "Introduction to Probability",
    term: "Fall",
    description:
      "Probability as a language for uncertainty: counting, conditioning, random variables, distributions, expectation, and Markov chains.",
    deliverables: [
      { title: "Homework 1", weight: 5, points: 50, dueInDays: 3 },
      { title: "Homework 2", weight: 5, points: 50, dueInDays: 10 },
      { title: "Homework 3", weight: 5, points: 50, dueInDays: 17 },
      { title: "Midterm Exam", weight: 30, points: 100, dueInDays: 22 },
      { title: "Homework 4", weight: 5, points: 50, dueInDays: 29 },
      { title: "Final Exam", weight: 50, points: 150, dueInDays: 60 },
    ],
  }),
  preset({
    id: "columbia-bio-c2005",
    university: "Columbia",
    course_code: "BIO C2005",
    name: "Introduction to Molecular and Cellular Biology I",
    term: "Fall",
    description:
      "Biochemistry, molecular biology, and genetics: from macromolecules and gene expression to inheritance, with weekly recitation quizzes.",
    deliverables: [
      { title: "Recitation Quizzes", weight: 10, points: 100, dueInDays: 5 },
      { title: "Problem Set A", weight: 10, points: 100, dueInDays: 11 },
      { title: "Midterm 1", weight: 20, points: 100, dueInDays: 19 },
      { title: "Midterm 2", weight: 20, points: 100, dueInDays: 38 },
      { title: "Final Exam", weight: 40, points: 150, dueInDays: 63 },
    ],
  }),
];

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * The course book a preset describes, built without the backend. IDs carry the
 * `local-` prefix so the terminal never mirrors these edits to the backend.
 */
export function presetState(preset: SyllabusPreset, now: number): TerminalState {
  const courseId = `local-preset:${preset.id}`;
  const course: Course = {
    id: courseId,
    course_code: preset.course_code,
    name: preset.name,
    current_score: null,
    target_score: 90,
    portfolio_margin: null,
    syllabus: preset.syllabus_text,
    grade_history: [],
  };
  const assignments: Assignment[] = (preset.deliverables ?? []).map((d) => ({
    id: `${courseId}:${slug(d.title)}`,
    course_id: courseId,
    course_code: preset.course_code,
    title: d.title,
    due_at: new Date(now + d.dueInDays * DAY).toISOString(),
    points_possible: d.points,
    weight: d.weight,
    description: `${preset.university} ${preset.course_code} sample syllabus`,
    status: "pending",
    graded: false,
    score: null,
    priority_score: 0,
    subtasks: [],
  }));
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

/** Adds (or replaces) the incoming courses and their deliverables on an existing book. */
export function mergeSyllabusState(
  base: TerminalState,
  incoming: TerminalState,
): TerminalState {
  const replaced = new Set(incoming.courses.map((c) => c.id));
  return {
    ...base,
    courses: [
      ...base.courses.filter((c) => !replaced.has(c.id)),
      ...incoming.courses,
    ],
    assignments: [
      ...base.assignments.filter((a) => !replaced.has(a.course_id)),
      ...incoming.assignments,
    ],
  };
}
