import type { CanvasAssignment } from "../types";

export interface GradeAssumptions {
  currentGrade: number;
  gradedPoints: number;
  targetGrade: number;
}
export function gradableAssignments(assignments: CanvasAssignment[]) {
  return assignments
    .filter(
      (a) =>
        !a.completed &&
        a.points !== null &&
        Number.isFinite(a.points) &&
        a.points > 0,
    )
    .sort(
      (a, b) =>
        Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id),
    );
}
export function sameCourse(a: CanvasAssignment, b: CanvasAssignment) {
  return a.courseId !== undefined && b.courseId !== undefined
    ? a.courseId === b.courseId
    : a.course === b.course;
}

// Point-weighted scenario only: no completion flags or stored grades are changed.
// Other pending assignments keep the assumed current grade, in the same course.
export function projectTrajectory(
  assignments: CanvasAssignment[],
  activeId: string,
  hypotheticalScore: number,
  assumptions: GradeAssumptions,
) {
  const { currentGrade, gradedPoints, targetGrade } = assumptions;
  if (
    ![currentGrade, targetGrade, hypotheticalScore].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 100,
    ) ||
    !Number.isFinite(gradedPoints) ||
    gradedPoints < 0
  )
    return null;
  const pending = gradableAssignments(assignments);
  const active = pending.find((a) => a.id === activeId);
  if (!active) return null;
  const courseAssignments = pending.filter((a) => sameCourse(a, active));
  let earned = (currentGrade * gradedPoints) / 100;
  let possible = gradedPoints;
  const points = [
    {
      id: "baseline",
      label: "Now",
      grade: currentGrade,
      dueAt: null as string | null,
    },
    ...courseAssignments.map((a) => {
      const score = a.id === activeId ? hypotheticalScore : currentGrade;
      earned += (a.points! * score) / 100;
      possible += a.points!;
      return {
        id: a.id,
        label: a.title,
        dueAt: a.dueAt,
        grade: (earned / possible) * 100,
      };
    }),
  ];
  const finalGrade = points[points.length - 1].grade;
  const activePoints = active.points!;
  const requiredScore =
    (targetGrade * possible - currentGrade * (possible - activePoints)) /
    activePoints;
  return {
    points,
    finalGrade,
    marginOfSafety: finalGrade - targetGrade,
    assignmentWeight: (activePoints / possible) * 100,
    requiredScore,
    courseAssignments,
  };
}
