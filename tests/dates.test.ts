import { describe, expect, it } from "vitest";
import { daysUntil } from "../src/lib/dates";
describe("calendar-day countdowns", () => {
  it("counts calendar days across daylight-saving transitions", () => {
    expect(
      daysUntil(
        new Date(2026, 10, 22, 10).toISOString(),
        new Date(2026, 9, 11, 10),
      ),
    ).toBe(42);
  });
  it("shows zero for a deadline later on the same calendar day", () => {
    expect(
      daysUntil(
        new Date(2026, 9, 11, 23, 59).toISOString(),
        new Date(2026, 9, 11, 8),
      ),
    ).toBe(0);
  });
  it("represents past target dates as negative calendar days", () => {
    expect(
      daysUntil(new Date(2026, 9, 10).toISOString(), new Date(2026, 9, 11)),
    ).toBe(-1);
  });
});
