import type { Goal, SubGoal, Breakdown } from "../types";
export const completion = (items: SubGoal[]) =>
  items.length
    ? Math.round((items.filter((t) => t.completed).length / items.length) * 100)
    : 0;
export const goalProgress = (goal: Goal, goals: Goal[]) => {
  if (goal.kind === "sprint") return completion(goal.subGoals);
  const children = goals
    .filter((g) => g.parentId === goal.id)
    .flatMap((g) => g.subGoals);
  return completion([...goal.milestones, ...children]);
};
export function localBreakdown(text: string): Breakdown {
  const clean = text.trim().replace(/\s+/g, " ");
  const title = clean.split(/[.!?\n]/)[0].slice(0, 90) || "New project";
  const subject = title.length > 50 ? title.slice(0, 47) + "…" : title;
  const research = /research|essay|paper|read|syllabus/i.test(clean);
  const code = /code|build|app|software|implement|program|project/i.test(clean);
  return {
    title,
    source: "local",
    tasks: [
      {
        title: research
          ? `Collect sources and outline “${subject}”`
          : `Define requirements and plan “${subject}”`,
        minutes: 20,
      },
      {
        title: code
          ? "Build the first working version"
          : research
            ? "Draft the main argument with supporting evidence"
            : "Complete the first focused work session",
        minutes: 45,
      },
      {
        title: research
          ? "Review citations, edit, and prepare submission"
          : "Review the result against requirements and finish",
        minutes: 25,
      },
    ],
  };
}
