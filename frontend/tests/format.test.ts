import { describe, expect, it } from "vitest";
import { countdown, minutes, score, signed } from "@/lib/format";

describe("format", () => {
  it("renders countdowns with day prefix and true minus", () => {
    expect(countdown(((2 * 24 + 6) * 3600 + 12 * 60 + 33) * 1000)).toBe(
      "2D 06:12:33",
    );
    expect(countdown(-(3 * 3600 + 12 * 60 + 10) * 1000)).toBe("−03:12:10");
  });

  it("renders minutes, signed deltas, and priority scores", () => {
    expect(minutes(45)).toBe("45m");
    expect(minutes(65)).toBe("1h 05m");
    expect(signed(4.2)).toBe("+4.2");
    expect(signed(-2.4)).toBe("−2.4");
    expect(signed(0.01)).toBe("±0.0");
    expect(score(0.256)).toBe("0.26");
    expect(score(66.66)).toBe("66.7");
    expect(score(2000)).toBe("2000");
  });
});
