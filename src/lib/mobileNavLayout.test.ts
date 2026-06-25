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

function expectOrder(source: string, labels: string[]) {
  const indexes = labels.map((label) => source.indexOf(label));
  indexes.forEach((index, itemIndex) => {
    expect(index, `${labels[itemIndex]} should be present`).toBeGreaterThanOrEqual(0);
  });

  for (let index = 1; index < indexes.length; index += 1) {
    expect(indexes[index], `${labels[index]} should follow ${labels[index - 1]}`).toBeGreaterThan(indexes[index - 1]);
  }
}

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

  it("keeps the original primary nav order with announcements at the end", () => {
    const appLayoutSource = readFileSync(`${process.cwd()}/src/layouts/AppLayout.tsx`, "utf8");
    const sidebarSource = readFileSync(`${process.cwd()}/src/components/AppSidebar.tsx`, "utf8");

    expectOrder(appLayoutSource, [
      'label: "Dar"',
      'label: "Ministerios"',
      'label: "Devocional"',
      'label: "Anuncios"',
    ]);
    expectOrder(sidebarSource, [
      'title: "Servicios"',
      'title: "Anuncios"',
      'title: "Devocionales"',
      'title: "Dar"',
      'title: "Mis asignaciones"',
      'title: "Ministerios"',
      'title: "Eventos"',
    ]);
  });

  it("shows recent announcements above my ministries on the dashboard", () => {
    const source = readFileSync(`${process.cwd()}/src/pages/app/Dashboard.tsx`, "utf8");
    const orderedSectionSource = source.slice(source.indexOf("announcements.length > 0"));

    expectOrder(source, ['label: "Anuncios"', 'label: "Ministerios"']);
    expectOrder(orderedSectionSource, ["Anuncios recientes", "Mis ministerios"]);
    expect(source).toContain("announcements.slice(0, 3)");
    expect(source).toContain("Boletín de la iglesia");
    expect(source).toContain('featured ? "h-60" : "h-40"');
  });

  it("keeps announcements as an image-led church canvas above mobile nav clearance", () => {
    const source = readFileSync(`${process.cwd()}/src/pages/app/Announcements.tsx`, "utf8");

    expect(source).toContain("mobile-page space-y-5");
    expect(source).toContain("Un tablón cálido para la vida de la iglesia");
    expect(source).toContain("AnnouncementAiImageField");
    expect(source).toContain("announcement.imageUrl");
    expect(source).toContain("src={announcement.imageUrl}");
    expect(source).toContain("featured={index === 0}");
  });

  it("keeps every ministry detail section scrollable above the bottom nav", () => {
    const detailSource = readFileSync(`${process.cwd()}/src/pages/app/MinistryDetail.tsx`, "utf8");
    const resourceSource = readFileSync(`${process.cwd()}/src/components/MinistryResources.tsx`, "utf8");

    expect(detailSource).toContain("pb-[calc(var(--tchurch-mobile-content-clearance");
    expect(detailSource).toContain("--tchurch-mobile-nav-reserved");
    expect(detailSource).toContain('value="finance"');
    expect(detailSource).toContain('value="announcements"');
    expect(resourceSource).not.toContain("pb-[calc(var(--tchurch-mobile-content-clearance");
    expect(resourceSource).not.toContain("md:pb-0");
  });
});
