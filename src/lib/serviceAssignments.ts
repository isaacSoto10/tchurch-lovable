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

const ROLE_LABELS: Array<[string, string]> = [
  ["lead vocal", "Voz principal"],
  ["backing vocal", "Voz"],
  ["vocal", "Voz"],
  ["singer", "Voz"],
  ["cantante", "Voz"],
  ["worship leader", "Lidera"],
  ["alabanza", "Alabanza"],
  ["keys", "Piano"],
  ["keyboard", "Teclado"],
  ["teclado", "Teclado"],
  ["piano", "Piano"],
  ["acoustic guitar", "Guitarra acústica"],
  ["electric guitar", "Guitarra eléctrica"],
  ["guitar", "Guitarra"],
  ["guitarra", "Guitarra"],
  ["bass", "Bajo"],
  ["bajo", "Bajo"],
  ["drum", "Batería"],
  ["bateria", "Batería"],
  ["batería", "Batería"],
  ["percusion", "Percusión"],
  ["percusión", "Percusión"],
  ["sound", "Audio"],
  ["audio", "Audio"],
  ["lyrics", "Letras"],
  ["letras", "Letras"],
  ["visual", "Visuales"],
];

const ROLE_PRIORITY = ["voz", "lidera", "alabanza", "piano", "teclado", "guitarra", "bajo", "batería", "percusión", "audio", "letras", "visuales"];

export function getAssignmentPersonName(user: ServiceAssignmentUserLike | null | undefined) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Sin nombre";
}

export function getAssignmentRoleLabel(position: string | null | undefined) {
  const normalized = position?.toLowerCase().trim() || "";
  const match = ROLE_LABELS.find(([keyword]) => normalized.includes(keyword));
  return match?.[1] || position || "Equipo";
}

function getAssignmentSortWeight(assignment: ServiceAssignmentLike) {
  const label = getAssignmentRoleLabel(assignment.position).toLowerCase();
  const index = ROLE_PRIORITY.findIndex((role) => label.includes(role));
  return index === -1 ? ROLE_PRIORITY.length : index;
}

export function getAssignmentStatusText(assignment: ServiceAssignmentLike) {
  if (assignment.responseStatus === "accepted" || (!assignment.responseStatus && assignment.confirmed)) return "Aceptada";
  if (assignment.responseStatus === "declined") return "Declinada";
  return "Pendiente";
}

export function getMusicAssignments(assignments: ServiceAssignmentLike[] | null | undefined) {
  const list = assignments || [];
  return list
    .filter((assignment) => {
      const position = assignment.position?.toLowerCase() || "";
      return MUSIC_ROLE_KEYWORDS.some((keyword) => position.includes(keyword));
    })
    .sort((a, b) => getAssignmentSortWeight(a) - getAssignmentSortWeight(b));
}

export function summarizeAssignments(assignments: ServiceAssignmentLike[] | null | undefined, limit = 3) {
  const visible = getMusicAssignments(assignments).slice(0, limit);
  return visible.map((assignment) => {
    const name = getAssignmentPersonName(assignment.user);
    return `${getAssignmentRoleLabel(assignment.position)}: ${name}`;
  });
}

export function getMusicAssignmentSummaries(assignments: ServiceAssignmentLike[] | null | undefined, limit = Infinity) {
  return getMusicAssignments(assignments).slice(0, limit).map((assignment) => ({
    id: assignment.id,
    personName: getAssignmentPersonName(assignment.user),
    roleLabel: getAssignmentRoleLabel(assignment.position),
    originalPosition: assignment.position || null,
    statusText: getAssignmentStatusText(assignment),
  }));
}
