export const TEAM_MEMBER_ROLES = ["LEADER", "MUSICIAN", "TECH", "MEMBER"] as const;
export type TeamMemberRole = typeof TEAM_MEMBER_ROLES[number];

export function buildTeamMemberPayload(input: {
  teamId: string;
  userId: string;
  role: TeamMemberRole;
  position: string;
}) {
  return {
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
    position: input.position.trim() || null,
  };
}
