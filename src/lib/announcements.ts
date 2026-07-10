function normalizeRole(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

export function resolveAnnouncementRole(apiRole?: string | null, churchRole?: string | null) {
  return normalizeRole(apiRole) || normalizeRole(churchRole) || null;
}

export function canManageAnnouncements(apiRole?: string | null, churchRole?: string | null) {
  const role = resolveAnnouncementRole(apiRole, churchRole);
  return role === "ADMIN" || role === "PLANNER";
}

export function canDeleteAnnouncement(status: "PENDING" | "PUBLISHED" | "REJECTED", canManage: boolean) {
  return canManage || status === "PENDING";
}
