import { describe, expect, it } from "vitest";
import { isCollaborativeApiPath } from "./nativeApiCache";

describe("native API cache collaboration boundaries", () => {
  it("keeps service planning reads out of the device-local cache", () => {
    expect(isCollaborativeApiPath("/services")).toBe(true);
    expect(isCollaborativeApiPath("/services/service-1")).toBe(true);
    expect(isCollaborativeApiPath("/services?summary=1&from=today&limit=60")).toBe(true);
    expect(isCollaborativeApiPath("/service-items/reorder")).toBe(true);
    expect(isCollaborativeApiPath("/service-assignments/mine")).toBe(true);
    expect(isCollaborativeApiPath("/teams?limit=40")).toBe(true);
    expect(isCollaborativeApiPath("/members?search=Noely")).toBe(true);
    expect(isCollaborativeApiPath("/users/me")).toBe(true);
  });

  it("does not classify unrelated reads as service planning state", () => {
    expect(isCollaborativeApiPath("/songs?limit=30")).toBe(false);
    expect(isCollaborativeApiPath("/announcements?limit=40")).toBe(false);
  });
});
