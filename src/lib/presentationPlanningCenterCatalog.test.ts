import { describe, expect, it } from "vitest";
import {
  PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS,
  PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES,
  mergePlanningCenterCatalogPage,
} from "./presentationPlanningCenterCatalog";

describe("Planning Center mobile catalog pagination", () => {
  it("deduplicates one requested page and stops a stalled offset", () => {
    const page = mergePlanningCenterCatalogPage({
      current: [{ id: "type-1", name: "Domingo" }],
      incoming: [{ id: "type-1", name: "Duplicado" }, { id: "type-2", name: "Miércoles" }],
      requestedOffset: 25,
      nextOffset: 25,
      pagesLoaded: 1,
    });
    expect(page).toEqual({
      items: [{ id: "type-1", name: "Domingo" }, { id: "type-2", name: "Miércoles" }],
      nextOffset: null,
      pagesLoaded: 2,
    });
  });

  it("caps both retained items and user-requested pages", () => {
    const itemLimited = mergePlanningCenterCatalogPage({
      current: Array.from({ length: PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS - 1 }, (_, index) => ({ id: `plan-${index}` })),
      incoming: [{ id: "plan-new" }, { id: "plan-over-limit" }],
      requestedOffset: 475,
      nextOffset: 500,
      pagesLoaded: 18,
    });
    expect(itemLimited.items).toHaveLength(PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS);
    expect(itemLimited.items.at(-1)?.id).toBe("plan-new");
    expect(itemLimited.nextOffset).toBeNull();

    const pageLimited = mergePlanningCenterCatalogPage({
      current: [{ id: "type-1" }],
      incoming: [{ id: "type-2" }],
      requestedOffset: 450,
      nextOffset: 475,
      pagesLoaded: PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES - 1,
    });
    expect(pageLimited.pagesLoaded).toBe(PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES);
    expect(pageLimited.nextOffset).toBeNull();
  });
});
