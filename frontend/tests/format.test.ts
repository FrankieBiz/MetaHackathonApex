import { describe, expect, it } from "vitest";
import {
  clock,
  countdown,
  minutes,
  pct,
  score,
  shortDate,
  signed,
  stamp,
} from "@/lib/format";

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

describe("format date/time hardening", () => {
  describe("clock", () => {
    it("returns the default dash for an invalid Date", () => {
      expect(clock(new Date("invalid"))).toBe("—");
    });

    it("returns a custom fallback for an invalid Date", () => {
      expect(clock(new Date("invalid"), undefined, "n/a")).toBe("n/a");
    });

    it("keeps an empty-string fallback instead of reverting to the dash", () => {
      expect(clock(new Date("invalid"), undefined, "")).toBe("");
    });

    it("returns the fallback when the time zone is rejected with a RangeError", () => {
      expect(clock(new Date(0), "Not/AZone")).toBe("—");
    });

    it("returns the fallback when the input is not a Date and formatting throws a TypeError", () => {
      expect(clock(Symbol("corrupt") as unknown as Date)).toBe("—");
    });

    it("keeps valid output unchanged", () => {
      expect(clock(new Date("2026-03-05T13:45:09Z"), "UTC")).toBe("13:45:09");
    });
  });

  describe("shortDate", () => {
    it("returns the default dash for an unparseable string", () => {
      expect(shortDate("not-a-date")).toBe("—");
    });

    it("returns the default dash for an empty string", () => {
      expect(shortDate("")).toBe("—");
    });

    it("returns a custom fallback for invalid input", () => {
      expect(shortDate("not-a-date", "n/a")).toBe("n/a");
    });

    it("keeps an empty-string fallback instead of reverting to the dash", () => {
      expect(shortDate("", "")).toBe("");
    });

    it("keeps valid output unchanged", () => {
      expect(shortDate("2026-03-05T12:00:00")).toBe("MAR 05");
    });
  });

  describe("stamp", () => {
    it("returns the default dash for a corrupt string", () => {
      expect(stamp("corrupt-date")).toBe("—");
    });

    it("returns the default dash for an empty string", () => {
      expect(stamp("")).toBe("—");
    });

    it("returns a custom fallback for invalid input", () => {
      expect(stamp("corrupt-date", "n/a")).toBe("n/a");
    });

    it("keeps an empty-string fallback instead of reverting to the dash", () => {
      expect(stamp("", "")).toBe("");
    });

    it("keeps valid output unchanged", () => {
      expect(stamp("2026-03-05T14:07:00")).toMatch(/^05 MAR,? 14:07$/);
    });
  });
});
