import { describe, expect, it } from "vitest";
import { getPrayerAuthorLabel, normalizePrayerRequest, normalizePrayerRequests } from "@/lib/prayer";

describe("prayer request normalization", () => {
  it("maps the current API contract", () => {
    expect(normalizePrayerRequest({
      id: "prayer-1",
      content: "Por mi familia",
      authorName: "Ana",
      prayedCount: 4,
      answeredAt: null,
      createdAt: "2026-07-10T12:00:00.000Z",
      isMine: true,
      isPrivate: false,
      isAnonymous: false,
      hasPrayed: true,
    })).toMatchObject({ id: "prayer-1", authorName: "Ana", prayedCount: 4, hasPrayed: true });
  });

  it("accepts wrapped lists and drops malformed rows", () => {
    expect(normalizePrayerRequests({ requests: [{ id: "one", content: "Ayuda" }, { id: "two" }] })).toHaveLength(1);
  });

  it("protects private and anonymous author labels", () => {
    const request = normalizePrayerRequest({ id: "one", content: "Ayuda", isPrivate: true, isMine: true });
    expect(request && getPrayerAuthorLabel(request)).toBe("Solo tú");
  });
});
