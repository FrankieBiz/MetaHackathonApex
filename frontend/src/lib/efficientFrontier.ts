import type { Course, TerminalState } from "@/types";
import { API_BASE } from "@/lib/api";

export type FrontierStrategy = "magna_cum_laude" | "balanced" | "drawdown_defense";

export interface FrontierCourseAllocation {
  course_id: string;
  course_code: string;
  course_name: string;
  current_score: number;
  target_score: number;
  credit_hours: number;
  allocated_minutes: number;
  allocated_hours: number;
  projected_score: number;
  score_delta: number;
  marginal_gpa_yield: number;
  efficiency_rank: number;
  status: "healthy" | "drawdown" | "critical";
}

export interface FrontierPoint {
  total_hours: number;
  portfolio_gpa: number;
  portfolio_score: number;
  portfolio_volatility: number;
  sharpe_ratio: number;
  course_allocations: FrontierCourseAllocation[];
}

export interface EfficientFrontierResponse {
  weekly_hours: number;
  strategy: FrontierStrategy;
  current_portfolio_gpa: number;
  projected_portfolio_gpa: number;
  gpa_delta: number;
  portfolio_volatility: number;
  sharpe_ratio: number;
  frontier_curve: FrontierPoint[];
  optimal_allocation: FrontierCourseAllocation[];
}

export function scoreToGpa(score: number): number {
  if (score >= 93.0) return 4.0;
  if (score >= 90.0) return 3.7;
  if (score >= 87.0) return 3.3;
  if (score >= 83.0) return 3.0;
  if (score >= 80.0) return 2.7;
  if (score >= 77.0) return 2.3;
  if (score >= 73.0) return 2.0;
  if (score >= 70.0) return 1.7;
  if (score >= 67.0) return 1.3;
  if (score >= 65.0) return 1.0;
  return Math.max(0.0, Math.round((score / 65.0) * 100) / 100);
}

function courseRemainingWeight(courseId: string, state: TerminalState): number {
  const own = state.assignments.filter((a) => a.course_id === courseId);
  if (!own.length) return 0.35;
  const openWeight = own.filter((a) => !a.graded).reduce((sum, a) => sum + a.weight, 0);
  const totalWeight = own.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight <= 0) return 0.35;
  return Math.max(0.1, Math.min(1.0, openWeight / totalWeight));
}

function scoreDelta(minutes: number, baseScore: number, remWeight: number, urgency: number): number {
  const capacity = Math.max(0.0, 100.0 - baseScore);
  const tau = Math.max(180.0, remWeight * 900.0);
  const exponent = -(urgency * minutes) / tau;
  return Math.round(capacity * (1.0 - Math.exp(exponent)) * 10) / 10;
}

function optimizeClientAllocation(
  courses: Course[],
  state: TerminalState,
  totalMinutes: number,
  strategy: FrontierStrategy,
): FrontierCourseAllocation[] {
  if (!courses.length) return [];
  const n = courses.length;

  const data = courses.map((c) => {
    const currScore = c.current_score != null ? c.current_score : 82.0;
    const remWeight = courseRemainingWeight(c.id, state);
    const margin = currScore - c.target_score;
    let urgency = 1.0;
    if (strategy === "magna_cum_laude") {
      urgency = currScore >= 87.0 ? 1.3 : 0.9;
    } else if (strategy === "drawdown_defense") {
      urgency = margin < 0 ? 1.6 : 0.8;
    } else {
      urgency = margin < 0 ? 1.1 : 1.0;
    }
    return {
      course: c,
      currentScore: currScore,
      targetScore: c.target_score,
      credits: 3.0,
      remWeight,
      urgency,
      allocatedMinutes: 0,
    };
  });

  const minAlloc = 30;
  let remainingMinutes = totalMinutes;
  if (totalMinutes >= minAlloc * n) {
    data.forEach((d) => (d.allocatedMinutes = minAlloc));
    remainingMinutes -= minAlloc * n;
  } else {
    const even = Math.floor(totalMinutes / n);
    data.forEach((d) => (d.allocatedMinutes = even));
    remainingMinutes = totalMinutes % n;
  }

  const step = 15;
  while (remainingMinutes >= step) {
    let bestIdx = 0;
    let bestGain = -1.0;

    data.forEach((d, idx) => {
      const sCurr = d.currentScore + scoreDelta(d.allocatedMinutes, d.currentScore, d.remWeight, d.urgency);
      const sNext = d.currentScore + scoreDelta(d.allocatedMinutes + step, d.currentScore, d.remWeight, d.urgency);
      const gCurr = scoreToGpa(sCurr);
      const gNext = scoreToGpa(sNext);
      const marginal = (gNext - gCurr) * d.credits + (sNext - sCurr) * 0.01;
      if (marginal > bestGain) {
        bestGain = marginal;
        bestIdx = idx;
      }
    });

    data[bestIdx].allocatedMinutes += step;
    remainingMinutes -= step;
  }

  if (remainingMinutes > 0) {
    data[0].allocatedMinutes += remainingMinutes;
  }

  const totalCredits = data.reduce((s, d) => s + d.credits, 0) || 1.0;

  const allocations: FrontierCourseAllocation[] = data.map((d) => {
    const gain = scoreDelta(d.allocatedMinutes, d.currentScore, d.remWeight, d.urgency);
    const projScore = Math.min(100.0, d.currentScore + gain);
    const gain60 = scoreDelta(d.allocatedMinutes + 60, d.currentScore, d.remWeight, d.urgency);
    const projScore60 = Math.min(100.0, d.currentScore + gain60);
    const marginalGpa = Math.round((scoreToGpa(projScore60) - scoreToGpa(projScore)) * (d.credits / totalCredits) * 1000) / 1000;
    const margin = projScore - d.targetScore;
    const status: FrontierCourseAllocation["status"] =
      margin >= 0 ? "healthy" : projScore >= 65.0 ? "drawdown" : "critical";

    return {
      course_id: d.course.id,
      course_code: d.course.course_code,
      course_name: d.course.name,
      current_score: Math.round(d.currentScore * 10) / 10,
      target_score: Math.round(d.targetScore * 10) / 10,
      credit_hours: d.credits,
      allocated_minutes: d.allocatedMinutes,
      allocated_hours: Math.round((d.allocatedMinutes / 60) * 10) / 10,
      projected_score: Math.round(projScore * 10) / 10,
      score_delta: Math.round(gain * 10) / 10,
      marginal_gpa_yield: marginalGpa,
      efficiency_rank: 1,
      status,
    };
  });

  allocations.sort((a, b) => b.marginal_gpa_yield - a.marginal_gpa_yield || b.score_delta - a.score_delta);
  allocations.forEach((a, i) => (a.efficiency_rank = i + 1));
  return allocations;
}

export function calculateClientEfficientFrontier(
  state: TerminalState,
  weeklyHours = 20.0,
  strategy: FrontierStrategy = "balanced",
): EfficientFrontierResponse {
  const courses = state.courses;
  if (!courses.length) {
    return {
      weekly_hours: weeklyHours,
      strategy,
      current_portfolio_gpa: 0,
      projected_portfolio_gpa: 0,
      gpa_delta: 0,
      portfolio_volatility: 0,
      sharpe_ratio: 0,
      frontier_curve: [],
      optimal_allocation: [],
    };
  }

  const totalCredits = courses.length * 3.0;
  const currGpas = courses.map((c) => scoreToGpa(c.current_score != null ? c.current_score : 82.0));
  const currGpa = Math.round((currGpas.reduce((sum, g) => sum + g * 3.0, 0) / totalCredits) * 100) / 100;

  const totalMinutes = Math.round(weeklyHours * 60);
  const optimal = optimizeClientAllocation(courses, state, totalMinutes, strategy);
  const projGpas = optimal.map((a) => scoreToGpa(a.projected_score));
  const projGpa = Math.round((projGpas.reduce((sum, g, i) => sum + g * optimal[i].credit_hours, 0) / totalCredits) * 100) / 100;

  const scores = optimal.map((a) => a.projected_score);
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length;
  const vol = Math.round((Math.sqrt(variance) / 100) * 1000) / 1000;
  const sharpe = Math.round(((projGpa - 2.0) / Math.max(0.01, vol)) * 100) / 100;

  const benchmarkHours = [5, 10, 15, 20, 25, 30, 35, 40];
  const curve: FrontierPoint[] = benchmarkHours.map((bh) => {
    const bMinutes = bh * 60;
    const bAllocs = optimizeClientAllocation(courses, state, bMinutes, strategy);
    const bGpas = bAllocs.map((a) => scoreToGpa(a.projected_score));
    const bGpa = Math.round((bGpas.reduce((sum, g, i) => sum + g * bAllocs[i].credit_hours, 0) / totalCredits) * 100) / 100;
    const bScores = bAllocs.map((a) => a.projected_score);
    const bScore = Math.round((bScores.reduce((s, x) => s + x, 0) / bScores.length) * 10) / 10;
    const bMean = bScores.reduce((s, x) => s + x, 0) / bScores.length;
    const bVar = bScores.reduce((s, x) => s + (x - bMean) ** 2, 0) / bScores.length;
    const bVol = Math.round((Math.sqrt(bVar) / 100) * 1000) / 1000;
    const bSharpe = Math.round(((bGpa - 2.0) / Math.max(0.01, bVol)) * 100) / 100;

    return {
      total_hours: bh,
      portfolio_gpa: bGpa,
      portfolio_score: bScore,
      portfolio_volatility: bVol,
      sharpe_ratio: bSharpe,
      course_allocations: bAllocs,
    };
  });

  return {
    weekly_hours: weeklyHours,
    strategy,
    current_portfolio_gpa: currGpa,
    projected_portfolio_gpa: projGpa,
    gpa_delta: Math.round((projGpa - currGpa) * 100) / 100,
    portfolio_volatility: vol,
    sharpe_ratio: sharpe,
    frontier_curve: curve,
    optimal_allocation: optimal,
  };
}

export async function fetchEfficientFrontier(
  weeklyHours = 20.0,
  strategy: FrontierStrategy = "balanced",
): Promise<EfficientFrontierResponse> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/efficient-frontier`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weekly_hours: weeklyHours, strategy }),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch efficient frontier (${res.status})`);
  }
  return res.json();
}
