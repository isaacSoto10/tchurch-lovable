import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOBILE_NAV_BASE_HEIGHT,
  MOBILE_NAV_RESERVED_SPACE,
  MOBILE_NAV_RESERVE_GAP,
  MOBILE_NAV_SAFE_BOTTOM,
  getMobileNavSafeBottom,
  getMobileNavReservedSpace,
} from "./mobileNavLayout";

describe("mobile nav layout", () => {
  it("uses a stable bottom inset so browser chrome scroll cannot resize the tab bar", () => {
    expect(getMobileNavSafeBottom()).toBe(MOBILE_NAV_SAFE_BOTTOM);
  });

  it("reserves enough fixed space below every mobile page for the nav and tap clearance", () => {
    expect(getMobileNavReservedSpace()).toBe(MOBILE_NAV_RESERVED_SPACE);
    expect(MOBILE_NAV_RESERVED_SPACE).toBe(MOBILE_NAV_BASE_HEIGHT + MOBILE_NAV_RESERVE_GAP);
    expect(MOBILE_NAV_RESERVED_SPACE).toBeGreaterThanOrEqual(100);
  });

  it("keeps AppLayout nav geometry independent from viewport scroll changes", () => {
    const source = readFileSync(`${process.cwd()}/src/layouts/AppLayout.tsx`, "utf8");

    expect(source).toContain("mobileNavGeometryStyle");
    expect(source).not.toContain("visualViewport");
    expect(source).not.toContain('addEventListener("scroll"');
  });
});
