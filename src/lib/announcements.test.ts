import { describe, expect, it } from "vitest";
import { canDeleteAnnouncement, canManageAnnouncements, resolveAnnouncementRole } from "./announcements";

describe("announcement permissions", () => {
  it("falls back to the selected church role when the ministries response has no role", () => {
    expect(resolveAnnouncementRole(null, "admin")).toBe("ADMIN");
    expect(canManageAnnouncements(undefined, "PLANNER")).toBe(true);
  });

  it("keeps a supplied API role authoritative", () => {
    expect(resolveAnnouncementRole("MEMBER", "ADMIN")).toBe("MEMBER");
    expect(canManageAnnouncements("MEMBER", "ADMIN")).toBe(false);
  });

  it("does not expose deletion of rejected announcements to non-managers", () => {
    expect(canDeleteAnnouncement("REJECTED", false)).toBe(false);
    expect(canDeleteAnnouncement("REJECTED", true)).toBe(true);
  });
});
