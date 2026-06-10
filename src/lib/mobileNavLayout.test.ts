import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOBILE_NAV_BASE_HEIGHT,
  MOBILE_NAV_RESERVED_SPACE,
  MOBILE_NAV_RESERVE_GAP,
  MOBILE_NAV_SAFE_BOTTOM,
  MOBILE_PAGE_BOTTOM_BUFFER,
  getMobilePageBottomBuffer,
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
    expect(MOBILE_NAV_RESERVED_SPACE).toBeGreaterThanOrEqual(120);
    expect(getMobilePageBottomBuffer()).toBe(MOBILE_PAGE_BOTTOM_BUFFER);
  });

  it("keeps AppLayout nav geometry independent from viewport scroll changes", () => {
    const source = readFileSync(`${process.cwd()}/src/layouts/AppLayout.tsx`, "utf8");

    expect(source).toContain("mobileNavGeometryStyle");
    expect(source).toContain('data-mobile-shell={showShortcutBar ? "true" : undefined}');
    expect(source).toContain('data-testid="mobile-bottom-nav"');
    expect(source).toContain("scrollPaddingBottom");
    expect(source).toContain("h-[3.75rem]");
    expect(source).not.toContain("visualViewport");
    expect(source).not.toContain('addEventListener("scroll"');
  });

  it("keeps mobile pages clear of the fixed bottom navigation", () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, "utf8");

    expect(css).toContain('[data-mobile-shell="true"] .mobile-page');
    expect(css).toContain("--tchurch-mobile-page-bottom-buffer");
    expect(css).toContain("scroll-margin-bottom");
    expect(css).not.toContain("env(safe-area-inset-bottom");
  });
});
