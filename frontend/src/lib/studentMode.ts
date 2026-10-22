/**
 * Student Mode: Translates Wall Street financial engineering jargon
 * into clear, actionable collegiate English for students and hackathon judges.
 */

const STORAGE_KEY = "apex:student_mode";

export function studentModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return false;
  }
}

export function setStudentModeEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Non-blocking in private browsing or storage quota errors
  }
}

export const STUDENT_GLOSSARY = {
  orderBookTitle: "Deliverable Queue",
  orderBookSubtitle: "Upcoming work ranked by deadline urgency and grade impact",
  equityCurveTitle: "GPA Trajectory",
  equityCurveSubtitle: "Portfolio standing over time vs target floor with 90% exam risk",
  taskTreeTitle: "Execution Deck",
  taskTreeSubtitle: "Meta Llama deconstruction: atomic 25-min Pomodoro blocks",
  nextBestActionTitle: "Top Priority Action",
  nextBestActionSubtitle: "Highest-leverage task to prevent GPA drawdown",
  marginCallTitle: "Grade Floor Breached",
  marginCallSubtitle: "Course score dropped below target — recovery action required",
  circuitBreakerTitle: "Study Schedule Lockdown",
  circuitBreakerSubtitle: "Automatic study hour reallocation from safe courses to at-risk courses",
  sharpeRatioLabel: "Study ROI (GPA Yield/Hr)",
  sharpeRatioTooltip: "Academic Sharpe Ratio: expected GPA increase per hour of weekly study",
  downsideVarLabel: "Worst-Case Exam Scenario",
  downsideVarTooltip: "90% Downside VaR: lowest simulated grade across 1,000 Monte Carlo paths",
  efficientFrontierTitle: "Optimal Study Allocator",
  efficientFrontierSubtitle: "Markowitz Pareto Frontier: maximum GPA for your weekly hour budget",
  academicStances: {
    MAXIMAL_AGGRESSION: "Sprint Mode: Maximizing Course Honors & 4.0",
    ACTIVE_PROTECTION: "Balanced Pace: Defending Targets on Heavy Deliverables",
    MAINTAIN_FLOOR: "Floor Defense: Protecting Minimum Passing Buffer",
    CRITICAL_INTERVENTION: "Emergency Intervention: Halting Course Drawdown",
  },
} as const;
