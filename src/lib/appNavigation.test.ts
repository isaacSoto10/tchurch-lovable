import { describe, expect, it } from "vitest";
import {
  getPrimaryNavigationGroup,
  isSecondaryNavigationItemActive,
  routeMatchesPrefix,
  SECONDARY_NAVIGATION,
} from "@/lib/appNavigation";

describe("app navigation", () => {
  it("assigns detail routes to their primary group", () => {
    expect(getPrimaryNavigationGroup("/app/events/evt-1/rsvp")).toBe("agenda");
    expect(getPrimaryNavigationGroup("/app/services/service-1")).toBe("services");
    expect(getPrimaryNavigationGroup("/app/media/sermon-1")).toBe("community");
    expect(getPrimaryNavigationGroup("/app/teams/team-1")).toBe("more");
  });

  it("does not confuse similar route names", () => {
    expect(routeMatchesPrefix("/app/eventual", "/app/events")).toBe(false);
    expect(routeMatchesPrefix("/app/events?view=past", "/app/events")).toBe(true);
  });

  it("keeps secondary navigation active on nested routes", () => {
    const events = SECONDARY_NAVIGATION.agenda[1];
    expect(isSecondaryNavigationItemActive("/app/events/evt-1/scanner", events)).toBe(true);
  });
});
