import { describe, expect, it } from "vitest";
import {
  MAX_MOBILE_SAFE_BOTTOM,
  MOBILE_NAV_BASE_HEIGHT,
  MOBILE_NAV_RESERVE_GAP,
  clampMobileSafeAreaBottom,
  getMobileNavReservedSpace,
} from "./mobileNavLayout";

describe("mobile nav layout", () => {
  it("caps the bottom safe area so the tab bar cannot grow over page controls", () => {
    expect(clampMobileSafeAreaBottom(-8)).toBe(0);
    expect(clampMobileSafeAreaBottom(Number.NaN)).toBe(0);
    expect(clampMobileSafeAreaBottom(8)).toBe(8);
    expect(clampMobileSafeAreaBottom(44)).toBe(MAX_MOBILE_SAFE_BOTTOM);
  });

  it("uses a fixed reserve instead of measuring the rendered bar", () => {
    expect(getMobileNavReservedSpace(44)).toBe(
      MOBILE_NAV_BASE_HEIGHT + MAX_MOBILE_SAFE_BOTTOM + MOBILE_NAV_RESERVE_GAP,
    );
  });
});
