export const PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS = 500;
export const PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES = 20;

type PlanningCenterCatalogItem = { id: string };

export type PlanningCenterCatalogPage<T extends PlanningCenterCatalogItem> = {
  items: T[];
  nextOffset: number | null;
  pagesLoaded: number;
};

/**
 * Merges exactly one user-requested Planning Center page. The client keeps a
 * hard item/page budget and rejects stalled offsets so a malformed provider
 * response cannot create an unbounded load-more loop or grow mobile memory.
 */
export function mergePlanningCenterCatalogPage<T extends PlanningCenterCatalogItem>(input: {
  current: T[];
  incoming: T[];
  requestedOffset: number;
  nextOffset: number | null;
  pagesLoaded: number;
}): PlanningCenterCatalogPage<T> {
  const pagesLoaded = Math.min(
    PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES,
    Math.max(0, Math.floor(input.pagesLoaded)) + 1,
  );
  const byId = new Map<string, T>();
  for (const item of [...input.current, ...input.incoming]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
    if (byId.size >= PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS) break;
  }
  const items = [...byId.values()];
  const nextOffset = pagesLoaded >= PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES
    || items.length >= PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS
    || input.nextOffset === null
    || input.nextOffset <= input.requestedOffset
      ? null
      : input.nextOffset;
  return { items, nextOffset, pagesLoaded };
}
