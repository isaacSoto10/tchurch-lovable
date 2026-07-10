import { describe, expect, it } from "vitest";
import { buildTeamMemberPayload } from "./teamMembers";

describe("team member payload", () => {
  it("sends the selected role instead of forcing musician", () => {
    expect(buildTeamMemberPayload({
      teamId: "team-1",
      userId: "user-1",
      role: "TECH",
      position: "  Audio  ",
    })).toEqual({ teamId: "team-1", userId: "user-1", role: "TECH", position: "Audio" });
  });
});
