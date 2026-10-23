import { describe, expect, it } from "vitest";
import { countdown, minutes, pct, score, signed } from "@/lib/format";

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

const NON_FINITE: [string, number | null | undefined][] = [
  ["null", null],
  ["undefined", undefined],
  ["NaN", Number.NaN],
  ["+Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
];

const FORMATTERS = {
  pct: (value: number | null | undefined, fallback?: string) =>
    pct(value, 1, fallback),
  signed: (value: number | null | undefined, fallback?: string) =>
    signed(value, 1, fallback),
  score: (value: number | null | undefined, fallback?: string) =>
    score(value, fallback),
  minutes: (value: number | null | undefined, fallback?: string) =>
    minutes(value, fallback),
  countdown: (value: number | null | undefined, fallback?: string) =>
    countdown(value, fallback),
};

describe("format metric hardening", () => {
  describe.each(Object.entries(FORMATTERS))("%s", (_name, format) => {
    it.each(NON_FINITE)("returns the default dash for %s", (_label, value) => {
      expect(format(value)).toBe("—");
    });

    it.each(NON_FINITE)("returns a custom fallback for %s", (_label, value) => {
      expect(format(value, "n/a")).toBe("n/a");
    });

    it("keeps an empty-string fallback instead of reverting to the dash", () => {
      expect(format(Number.NaN, "")).toBe("");
    });
  });

  it("formats zero as a real value, never as a fallback", () => {
    expect(pct(0)).toBe("0.0%");
    expect(signed(0)).toBe("±0.0");
    expect(score(0)).toBe("0.00");
    expect(minutes(0)).toBe("0m");
    expect(countdown(0)).toBe("00:00:00");
  });

  it("formats pct with the requested digits", () => {
    expect(pct(12.34)).toBe("12.3%");
    expect(pct(12.34, 2)).toBe("12.34%");
    expect(pct(100, 0)).toBe("100%");
    expect(pct(-3.21)).toBe("-3.2%");
  });

  it("keeps finite signed, score, minutes, and countdown output unchanged", () => {
    expect(signed(4.2, 2)).toBe("+4.20");
    expect(signed(-2.4, 2)).toBe("−2.40");
    expect(score(9.5)).toBe("9.50");
    expect(minutes(-90)).toBe("-1h 30m");
    expect(countdown(1_000)).toBe("00:00:01");
  });
});
