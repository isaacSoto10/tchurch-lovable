import { describe, expect, it } from "vitest";
import { toCalendarQueryDate } from "./calendar";

describe("calendar query dates", () => {
  it("uses the backend YYYY-MM-DD contract without a time component", () => {
    expect(toCalendarQueryDate(new Date(2026, 0, 4, 23, 45))).toBe("2026-01-04");
    expect(toCalendarQueryDate(new Date(2026, 10, 9, 0, 15))).toBe("2026-11-09");
  });

  it("rejects invalid dates", () => {
    expect(() => toCalendarQueryDate(new Date(Number.NaN))).toThrow("Invalid calendar date");
  });
});
