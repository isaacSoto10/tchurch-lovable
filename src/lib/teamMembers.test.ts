import { describe, expect, it } from "vitest";
import { TEAM_MEMBER_ROLES, buildTeamMemberPayload } from "./teamMembers";

describe("team member payload", () => {
  it("only exposes roles accepted by the backend", () => {
    expect(TEAM_MEMBER_ROLES).toEqual(["ADMIN", "PLANNER", "MUSICIAN", "TECH"]);
  });

  it("sends the selected role instead of forcing musician", () => {
    expect(buildTeamMemberPayload({
      teamId: "team-1",
      userId: "user-1",
      role: "TECH",
      position: "  Audio  ",
    })).toEqual({ teamId: "team-1", userId: "user-1", role: "TECH", position: "Audio" });
  });
});
