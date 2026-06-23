import { describe, expect, it } from "vitest";
import {
  addWeeksToServiceDateValue,
  getServiceDateInputValue,
  toServiceApiDateValue,
} from "./serviceDates";

describe("service date helpers", () => {
  it("keeps local service form dates as date-only API values", () => {
    expect(toServiceApiDateValue("2026-06-25")).toBe("2026-06-25");
    expect(toServiceApiDateValue("2026-06-25T19:30")).toBe("2026-06-25");
    expect(toServiceApiDateValue("2026-06-25T23:45")).toBe("2026-06-25");
  });

  it("formats UTC midnight date-only values without rolling to the prior local day", () => {
    expect(getServiceDateInputValue("2026-06-26T00:00:00.000Z")).toBe("2026-06-26");
  });

  it("adds weekly service dates from calendar dates", () => {
    expect(addWeeksToServiceDateValue("2026-06-25", 1)).toBe("2026-07-02");
    expect(addWeeksToServiceDateValue("2026-12-31", 1)).toBe("2027-01-07");
  });
});
