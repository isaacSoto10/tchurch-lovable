import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOBILE_NAV_BASE_HEIGHT,
  MOBILE_NAV_CONTENT_CLEARANCE_CSS,
  MOBILE_NAV_HEIGHT_CSS,
  MOBILE_NAV_RESERVED_SPACE,
  MOBILE_NAV_RESERVE_GAP,
  MOBILE_NAV_SAFE_BOTTOM,
  MOBILE_PAGE_BOTTOM_BUFFER,
  getMobileNavContentClearanceCss,
  getMobileNavHeightCss,
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

  it("uses CSS safe-area values for live viewport clearance", () => {
    expect(getMobileNavHeightCss()).toBe(MOBILE_NAV_HEIGHT_CSS);
    expect(getMobileNavContentClearanceCss()).toBe(MOBILE_NAV_CONTENT_CLEARANCE_CSS);
    expect(MOBILE_NAV_CONTENT_CLEARANCE_CSS).toContain("--app-safe-area-bottom");
    expect(MOBILE_NAV_CONTENT_CLEARANCE_CSS).toContain("--tchurch-mobile-nav-height");
  });

  it("keeps AppLayout nav geometry independent from viewport scroll changes", () => {
    const source = readFileSync(`${process.cwd()}/src/layouts/AppLayout.tsx`, "utf8");

    expect(source).toContain("mobileNavGeometryStyle");
    expect(source).toContain('data-mobile-shell={showShortcutBar ? "true" : undefined}');
    expect(source).toContain("h-svh max-h-svh min-h-0 overflow-hidden overscroll-none");
    expect(source).toContain('data-testid={showShortcutBar ? "mobile-content-scrollport" : undefined}');
    expect(source).toContain('data-testid="mobile-bottom-nav"');
    expect(source).toContain("scrollPaddingBottom");
    expect(source).toContain("paddingBottom: showShortcutBar ? MOBILE_CONTENT_CLEARANCE : undefined");
    expect(source).toContain("var(--app-safe-area-bottom, var(--tchurch-mobile-safe-bottom, 22px))");
    expect(source).toContain("h-[3.75rem]");
    expect(source).not.toContain("visualViewport");
    expect(source).not.toContain('addEventListener("scroll"');

    const sidebarCloseIndex = source.indexOf("</SidebarInset>");
    const navIndex = source.indexOf('data-testid="mobile-bottom-nav"');
    expect(navIndex).toBeGreaterThan(sidebarCloseIndex);
  });

  it("keeps mobile pages clear of the fixed bottom navigation", () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, "utf8");

    expect(css).toContain('[data-mobile-shell="true"] .mobile-page');
    expect(css).toContain("--tchurch-mobile-page-bottom-buffer");
    expect(css).toContain("scroll-margin-bottom");
    expect(css).toContain("env(safe-area-inset-bottom");
    expect(css).toContain("height: 100svh");
    expect(css).toContain("max-height: 100svh");
    expect(css).toContain("overscroll-behavior: none");
  });

  it("applies mobile page clearance to every primary bottom-tab screen", () => {
    const primaryScreens = ["Dashboard", "Services", "Giving", "Ministries", "Devotionals", "Announcements"];

    for (const screen of primaryScreens) {
      const source = readFileSync(`${process.cwd()}/src/pages/app/${screen}.tsx`, "utf8");
      expect(source).toContain("mobile-page");
    }
  });
});
