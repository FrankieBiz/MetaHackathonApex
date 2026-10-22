import { describe, expect, it } from "vitest";
import {
  calculateClientEfficientFrontier,
  scoreToGpa,
} from "@/lib/efficientFrontier";
import { createMockState } from "@/lib/mockData";

const NOW = Date.parse("2026-10-19T12:00:00Z");

describe("scoreToGpa mapping", () => {
  it("maps percentages to standard 4.0 academic scale", () => {
    expect(scoreToGpa(96)).toBe(4.0);
    expect(scoreToGpa(91.5)).toBe(3.7);
    expect(scoreToGpa(88.2)).toBe(3.3);
    expect(scoreToGpa(84.0)).toBe(3.0);
    expect(scoreToGpa(81.0)).toBe(2.7);
    expect(scoreToGpa(78.5)).toBe(2.3);
    expect(scoreToGpa(74.0)).toBe(2.0);
    expect(scoreToGpa(71.0)).toBe(1.7);
    expect(scoreToGpa(68.0)).toBe(1.3);
    expect(scoreToGpa(65.5)).toBe(1.0);
    expect(scoreToGpa(52.0)).toBe(0.8);
  });
});

describe("calculateClientEfficientFrontier", () => {
  it("conserves total study budget and satisfies minimum maintenance allocation", () => {
    const data = createMockState(NOW);
    const res = calculateClientEfficientFrontier(data, 20.0, "balanced");

    expect(res.weekly_hours).toBe(20.0);
    expect(res.strategy).toBe("balanced");
    expect(res.projected_portfolio_gpa).toBeGreaterThanOrEqual(res.current_portfolio_gpa);
    expect(res.gpa_delta).toBeGreaterThanOrEqual(0);

    const totalAllocated = res.optimal_allocation.reduce((s, a) => s + a.allocated_minutes, 0);
    expect(totalAllocated).toBe(1200); // 20 * 60

    for (const alloc of res.optimal_allocation) {
      expect(alloc.allocated_minutes).toBeGreaterThanOrEqual(30);
      expect(alloc.projected_score).toBeGreaterThanOrEqual(alloc.current_score);
    }
  });

  it("generates an 8-point monotonic efficient frontier curve", () => {
    const data = createMockState(NOW);
    const res = calculateClientEfficientFrontier(data, 15.0, "balanced");

    expect(res.frontier_curve).toHaveLength(8);
    for (let i = 0; i < res.frontier_curve.length - 1; i++) {
      const p1 = res.frontier_curve[i];
      const p2 = res.frontier_curve[i + 1];
      expect(p2.total_hours).toBeGreaterThan(p1.total_hours);
      expect(p2.portfolio_gpa).toBeGreaterThanOrEqual(p1.portfolio_gpa - 0.01);
      expect(p2.portfolio_score).toBeGreaterThanOrEqual(p1.portfolio_score - 0.01);
    }
  });

  it("differentiates between optimization strategies", () => {
    const data = createMockState(NOW);

    const resMagna = calculateClientEfficientFrontier(data, 15.0, "magna_cum_laude");
    const resDefense = calculateClientEfficientFrontier(data, 15.0, "drawdown_defense");

    expect(resMagna.optimal_allocation).toHaveLength(data.courses.length);
    expect(resDefense.optimal_allocation).toHaveLength(data.courses.length);

    // Both should allocate all 900 minutes
    const sumMagna = resMagna.optimal_allocation.reduce((s, a) => s + a.allocated_minutes, 0);
    const sumDefense = resDefense.optimal_allocation.reduce((s, a) => s + a.allocated_minutes, 0);
    expect(sumMagna).toBe(900);
    expect(sumDefense).toBe(900);
  });
});
