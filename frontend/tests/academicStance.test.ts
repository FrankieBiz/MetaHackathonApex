import { describe, expect, it } from "vitest";
import { academicStance } from "@/components/TopBar";

describe("academic stance", () => {
  it("prioritizes high deadline volatility even with a healthy margin and pace", () => {
    expect(academicStance(12, 150, 200)).toBe("VOLATILITY ALERT");
  });

  it("accelerates when grades meet target and completion beats the time budget", () => {
    expect(academicStance(0, 100, 199)).toBe("BULLISH ACCELERATION");
  });

  it.each([
    [-1, 110], [3, 99], [null, 110], [3, null], [null, null],
  ])("protects the buffer for margin %s and velocity %s", (margin, velocity) => {
    expect(academicStance(margin, velocity, 0)).toBe("DEFENSIVE BUFFER");
  });
});
