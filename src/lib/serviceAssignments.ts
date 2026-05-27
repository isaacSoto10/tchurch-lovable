export type ServiceAssignmentStatus = "pending" | "accepted" | "declined" | null | undefined;

export type ServiceAssignmentUserLike = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type ServiceAssignmentLike = {
  id: string;
  position?: string | null;
  confirmed?: boolean | null;
  responseStatus?: ServiceAssignmentStatus;
  user?: ServiceAssignmentUserLike | null;
};

const MUSIC_ROLE_KEYWORDS = [
  "worship",
  "alabanza",
  "vocal",
  "singer",
  "cantante",
  "guitar",
  "guitarra",
  "bass",
  "bajo",
  "keys",
  "piano",
  "keyboard",
  "teclado",
  "drum",
  "bateria",
  "batería",
  "percusion",
  "percusión",
  "strings",
  "cuerdas",
  "lyrics",
  "letras",
  "sound",
  "audio",
  "visual",
];

export function getAssignmentPersonName(user: ServiceAssignmentUserLike | null | undefined) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Sin nombre";
}

export function getAssignmentStatusText(assignment: ServiceAssignmentLike) {
  if (assignment.responseStatus === "accepted" || (!assignment.responseStatus && assignment.confirmed)) return "Aceptada";
  if (assignment.responseStatus === "declined") return "Declinada";
  return "Pendiente";
}

export function getMusicAssignments(assignments: ServiceAssignmentLike[] | null | undefined) {
  const list = assignments || [];
  return list.filter((assignment) => {
    const position = assignment.position?.toLowerCase() || "";
    return MUSIC_ROLE_KEYWORDS.some((keyword) => position.includes(keyword));
  });
}

export function summarizeAssignments(assignments: ServiceAssignmentLike[] | null | undefined, limit = 3) {
  const visible = getMusicAssignments(assignments).slice(0, limit);
  return visible.map((assignment) => {
    const name = getAssignmentPersonName(assignment.user);
    return assignment.position ? `${name} · ${assignment.position}` : name;
  });
}
