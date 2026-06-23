import { describe, expect, it } from "vitest";
import {
  hasLocalServiceBlockoutConflict,
  serviceDateOverlapsBlockout,
} from "./serviceBlockouts";

describe("service blockout date matching", () => {
  it("does not match adjacent calendar dates", () => {
    expect(serviceDateOverlapsBlockout("2026-06-25", {
      startDate: "2026-06-26",
      endDate: "2026-06-26",
    })).toBe(false);
  });

  it("matches service dates inside a blockout range", () => {
    expect(serviceDateOverlapsBlockout("2026-06-26", {
      startDate: "2026-06-25",
      endDate: "2026-06-27",
    })).toBe(true);
  });

  it("handles UTC-midnight blockout values as local calendar days", () => {
    expect(hasLocalServiceBlockoutConflict("2026-06-26", [
      {
        startDate: "2026-06-26T00:00:00.000Z",
        endDate: "2026-06-26T00:00:00.000Z",
      },
    ])).toBe(true);
  });
});
