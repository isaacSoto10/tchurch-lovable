export const DEVOTIONALS_PAGE_SIZE = 12;

export type DevotionalsPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

export function parseDevotionalsPage(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function devotionalsCollectionPath(page: number) {
  const safePage = parseDevotionalsPage(String(page));
  return `/devotionals?includeDrafts=1&paginated=1&page=${safePage}&pageSize=${DEVOTIONALS_PAGE_SIZE}`;
}

export function normalizeDevotionalsPagination(
  value: Partial<DevotionalsPagination> | null | undefined,
  requestedPage: number,
  itemCount: number,
): DevotionalsPagination {
  const pageSize = Number.isInteger(value?.pageSize) && Number(value?.pageSize) > 0
    ? Number(value?.pageSize)
    : DEVOTIONALS_PAGE_SIZE;
  const total = Number.isInteger(value?.total) && Number(value?.total) >= 0
    ? Number(value?.total)
    : itemCount;
  const totalPages = Number.isInteger(value?.totalPages) && Number(value?.totalPages) > 0
    ? Number(value?.totalPages)
    : Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    totalPages,
    Number.isInteger(value?.page) && Number(value?.page) > 0 ? Number(value?.page) : requestedPage,
  );

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrevious: typeof value?.hasPrevious === "boolean" ? value.hasPrevious : page > 1,
    hasNext: typeof value?.hasNext === "boolean" ? value.hasNext : page < totalPages,
  };
}

export function devotionalPageAfterDeletion(pagination: DevotionalsPagination) {
  const remainingTotal = Math.max(0, pagination.total - 1);
  const remainingPages = Math.max(1, Math.ceil(remainingTotal / pagination.pageSize));
  return Math.min(pagination.page, remainingPages);
}
