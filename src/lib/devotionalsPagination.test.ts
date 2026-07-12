import { describe, expect, it } from "vitest";
import {
  DEVOTIONALS_PAGE_SIZE,
  devotionalPageAfterDeletion,
  devotionalsCollectionPath,
  normalizeDevotionalsPagination,
  parseDevotionalsPage,
} from "@/lib/devotionalsPagination";

describe("devotionals pagination", () => {
  it("uses page one for missing or invalid URL values", () => {
    expect(parseDevotionalsPage(null)).toBe(1);
    expect(parseDevotionalsPage("0")).toBe(1);
    expect(parseDevotionalsPage("2.5")).toBe(1);
    expect(parseDevotionalsPage("abc")).toBe(1);
    expect(parseDevotionalsPage("3")).toBe(3);
  });

  it("opts into the exact paginated API contract", () => {
    expect(devotionalsCollectionPath(2)).toBe(
      `/devotionals?includeDrafts=1&paginated=1&page=2&pageSize=${DEVOTIONALS_PAGE_SIZE}`,
    );
  });

  it("normalizes metadata and clamps an out-of-range response page", () => {
    expect(normalizeDevotionalsPagination({ page: 9, pageSize: 12, total: 13, totalPages: 2 }, 9, 0)).toEqual({
      page: 2,
      pageSize: 12,
      total: 13,
      totalPages: 2,
      hasPrevious: true,
      hasNext: false,
    });
  });

  it("moves back after deleting the only item on the last page", () => {
    expect(devotionalPageAfterDeletion({
      page: 2,
      pageSize: 12,
      total: 13,
      totalPages: 2,
      hasPrevious: true,
      hasNext: false,
    })).toBe(1);
  });
});
