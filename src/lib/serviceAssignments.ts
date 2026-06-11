export type ServiceAssignmentStatus = "pending" | "accepted" | "declined" | null | undefined;

export type NormalizedServiceAssignmentStatus = "pending" | "accepted" | "declined";

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

export const DEFAULT_SERVICE_POSITION_GROUPS = [
  { title: "Liderazgo", positions: ["Preacher", "Service Director", "Worship Leader", "Director"] },
  { title: "Banda", positions: ["Vocals", "Lead Vocal", "Backing Vocal", "Acoustic Guitar", "Electric Guitar", "Bass", "Keys", "Drums", "Percussion", "Strings"] },
  { title: "Audio / Visual", positions: ["Sound Tech", "Visuals Tech", "Camera", "Lyrics"] },
] as const;

export const DEFAULT_SERVICE_POSITIONS = DEFAULT_SERVICE_POSITION_GROUPS.flatMap((group) => group.positions);

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

function normalizeServicePosition(position: string | null | undefined) {
  return position?.trim().toLowerCase() || "";
}

function addUniquePosition(options: string[], position: string | null | undefined) {
  const trimmed = position?.trim();
  if (!trimmed) return;
  const normalized = normalizeServicePosition(trimmed);
  if (!options.some((option) => normalizeServicePosition(option) === normalized)) {
    options.push(trimmed);
  }
}

export function getAssignmentResponseStatus(assignment: Pick<ServiceAssignmentLike, "confirmed" | "responseStatus">): NormalizedServiceAssignmentStatus {
  if (assignment.responseStatus === "accepted" || assignment.responseStatus === "declined" || assignment.responseStatus === "pending") {
    return assignment.responseStatus;
  }

  return assignment.confirmed ? "accepted" : "pending";
}

export function assignmentNeedsResponse(assignment: Pick<ServiceAssignmentLike, "confirmed" | "responseStatus">) {
  return getAssignmentResponseStatus(assignment) === "pending";
}

export function servicePositionsMatch(position: string | null | undefined, targetPosition: string | null | undefined) {
  const normalizedPosition = normalizeServicePosition(position);
  const normalizedTarget = normalizeServicePosition(targetPosition);
  return Boolean(normalizedPosition && normalizedTarget && (
    normalizedPosition === normalizedTarget || normalizedPosition.includes(normalizedTarget)
  ));
}

export function matchesDefaultServicePosition(position: string | null | undefined) {
  return DEFAULT_SERVICE_POSITIONS.some((defaultPosition) => servicePositionsMatch(position, defaultPosition));
}

export function getAssignmentPositionOptions(assignments: ServiceAssignmentLike[] | null | undefined) {
  const options: string[] = [];
  DEFAULT_SERVICE_POSITIONS.forEach((position) => addUniquePosition(options, position));
  (assignments || []).forEach((assignment) => addUniquePosition(options, assignment.position));
  return options;
}

export function getCustomAssignmentPositions(assignments: ServiceAssignmentLike[] | null | undefined) {
  const positions: string[] = [];
  (assignments || []).forEach((assignment) => {
    if (!matchesDefaultServicePosition(assignment.position)) {
      addUniquePosition(positions, assignment.position);
    }
  });
  return positions;
}

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
  const status = getAssignmentResponseStatus(assignment);
  if (status === "accepted") return "Aceptada";
  if (status === "declined") return "Declinada";
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
