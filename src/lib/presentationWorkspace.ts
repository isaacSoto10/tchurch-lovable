import { ApiError, apiFetch } from "@/lib/api";
import { chordProToDisplayLines, getPrimaryArrangement, getSongChordPro, type ChordProDisplayLine } from "@/lib/songDisplay";
import type { PresentationService, PresentationServiceItem } from "@/lib/servicePresentation";

export const PRESENTATION_SCHEMA_VERSION = 1 as const;
export const MAX_PRESENTATION_ANNOTATION_BODY_LENGTH = 2_000;
const LOCAL_PRESENTATION_ID_PREFIX = "local_";

export type PresentationWorkspaceView = "editor" | "operator" | "stage";
export type PresentationAnnotationCategory = "note" | "direction" | "musical" | "technical" | "transition" | "safety";
export type PresentationAnnotationVisibility = "stage" | "all";
export type PresentationTargetRole = "worship_leader" | "band" | "vocals" | "av" | "speaker" | "operator" | "stage" | "all";

export type PresentationSourceSection = {
  anchorId: string;
  semanticKey: string;
  label: string;
  type: string;
  ordinal: number;
  fingerprint: string;
  preview: string;
};

export type PresentationSequenceEntry = {
  id: string;
  sectionAnchorId: string;
  sourceFingerprint: string;
  label: string;
  position: number;
};

export type PresentationAnnotation = {
  id: string;
  sectionAnchorId: string | null;
  sourceFingerprint: string | null;
  category: PresentationAnnotationCategory;
  visibility: PresentationAnnotationVisibility;
  roles: PresentationTargetRole[];
  body: string;
  createdById?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type PresentationWorkspaceItem = {
  serviceItemId: string;
  itemVersion: number;
  arrangementId: string | null;
  availableArrangements: Array<{ id: string; name: string; key: string | null }>;
  source: {
    arrangementId: string | null;
    lyricsFingerprint: string;
    sections: PresentationSourceSection[];
  };
  sequence: PresentationSequenceEntry[];
  annotations: PresentationAnnotation[];
  legacyNotes: string[];
  reconciliation: {
    status: "current" | "reconciled" | "needs_review";
    unresolvedAnnotationIds: string[];
    unresolvedStepIds: string[];
  };
};

export type PresentationWorkspace = {
  schemaVersion: 1;
  serviceId: string;
  serviceVersion: string;
  viewer: {
    view: PresentationWorkspaceView;
    churchRole: string | null;
    roles: PresentationTargetRole[];
    canEdit: boolean;
  };
  items: PresentationWorkspaceItem[];
  legacyNotes: string[];
  source: "api" | "derived";
};

export type DerivedPresentationSection = PresentationSourceSection & {
  lines: ChordProDisplayLine[];
};

const CATEGORIES = new Set<PresentationAnnotationCategory>(["note", "direction", "musical", "technical", "transition", "safety"]);
const TARGET_ROLES = new Set<PresentationTargetRole>(["worship_leader", "band", "vocals", "av", "speaker", "operator", "stage", "all"]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function presentationHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getSectionIdentity(label: string, counts: Map<string, number>) {
  const normalized = normalizeToken(label) || "song";
  const withoutNumber = normalized.replace(/_?\d+$/, "") || "song";
  const explicitOrdinal = Number(normalized.match(/(\d+)$/)?.[1] || 0);
  const nextOrdinal = explicitOrdinal || (counts.get(withoutNumber) || 0) + 1;
  counts.set(withoutNumber, Math.max(counts.get(withoutNumber) || 0, nextOrdinal));
  return { semanticKey: withoutNumber, ordinal: nextOrdinal };
}

function sectionPreview(lines: ChordProDisplayLine[]) {
  return lines
    .filter((line): line is Extract<ChordProDisplayLine, { kind: "line" }> => line.kind === "line")
    .map((line) => line.lyrics.trim() || line.chords.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ")
    .slice(0, 160);
}

export function derivePresentationSections(
  serviceItemId: string,
  arrangementId: string | null,
  chordPro: string | null | undefined,
): DerivedPresentationSection[] {
  const displayLines = chordProToDisplayLines(chordPro, 800);
  const groups: Array<{ label: string; lines: ChordProDisplayLine[] }> = [];

  for (const line of displayLines) {
    if (line.kind === "section" || line.kind === "meta") {
      groups.push({ label: line.label, lines: [line] });
      continue;
    }

    if (!groups.length) groups.push({ label: "Canción", lines: [] });
    groups[groups.length - 1].lines.push(line);
  }

  if (!groups.length) groups.push({ label: "Canción", lines: [] });
  const counts = new Map<string, number>();

  return groups.map((group) => {
    const { semanticKey, ordinal } = getSectionIdentity(group.label, counts);
    const preview = sectionPreview(group.lines);
    const fingerprint = `secfp_${presentationHash(`${normalizeToken(group.label)}|${preview}`)}`;
    const anchorId = `sec_${presentationHash(`${serviceItemId}|${arrangementId || "default"}|${semanticKey}|${ordinal}`)}`;
    return {
      anchorId,
      semanticKey,
      label: group.label,
      type: semanticKey,
      ordinal,
      fingerprint,
      preview,
      lines: group.lines,
    };
  });
}

function getItemArrangement(item: PresentationServiceItem, requestedId?: string | null) {
  const arrangements = item.song?.arrangements || [];
  return arrangements.find((arrangement) => arrangement.id === requestedId) || getPrimaryArrangement(item.song);
}

export function derivePresentationWorkspaceItem(
  item: PresentationServiceItem,
  requestedArrangementId?: string | null,
): PresentationWorkspaceItem {
  const arrangement = getItemArrangement(item, requestedArrangementId);
  const arrangementId = arrangement?.id || requestedArrangementId || null;
  const chordPro = arrangement?.lyrics || getSongChordPro(item.song);
  const sections = derivePresentationSections(item.id, arrangementId, chordPro);
  return {
    serviceItemId: item.id,
    itemVersion: 0,
    arrangementId,
    availableArrangements: (item.song?.arrangements || []).map((candidate) => ({
      id: candidate.id,
      name: candidate.name || "Arreglo",
      key: candidate.key || null,
    })),
    source: {
      arrangementId,
      lyricsFingerprint: `lyrics_${presentationHash(chordPro || "")}`,
      sections: sections.map(({ lines: _lines, ...section }) => section),
    },
    sequence: sections.map((section, index) => ({
      id: `${LOCAL_PRESENTATION_ID_PREFIX}seq_${presentationHash(`${item.id}|${section.anchorId}|${index}`)}`,
      sectionAnchorId: section.anchorId,
      sourceFingerprint: section.fingerprint,
      label: section.label,
      position: index,
    })),
    annotations: [],
    legacyNotes: [],
    reconciliation: { status: "current", unresolvedAnnotationIds: [], unresolvedStepIds: [] },
  };
}

function normalizeRole(value: unknown): PresentationTargetRole | null {
  const token = normalizeToken(String(value || ""));
  const aliases: Record<string, PresentationTargetRole> = {
    worship: "worship_leader",
    worshipleader: "worship_leader",
    leader: "worship_leader",
    audio_visual: "av",
    audiovisual: "av",
    production: "av",
    musicians: "band",
    musician: "band",
    vocal: "vocals",
  };
  const normalized = aliases[token] || token;
  return TARGET_ROLES.has(normalized as PresentationTargetRole) ? normalized as PresentationTargetRole : null;
}

function normalizeSourceSection(value: unknown, fallback: PresentationSourceSection | undefined): PresentationSourceSection | null {
  const source = objectValue(value);
  if (!source) return fallback || null;
  const anchorId = stringValue(source.anchorId) || fallback?.anchorId;
  if (!anchorId) return null;
  const rawSemanticKey = stringValue(source.semanticKey) || stringValue(source.type) || fallback?.semanticKey || "song";
  const semanticToken = normalizeToken(rawSemanticKey);
  const semanticOrdinal = Number(semanticToken.match(/(?:_|^)(\d+)$/)?.[1] || 0);
  const semanticKey = semanticToken.replace(/_?\d+$/, "") || normalizeToken(stringValue(source.type) || fallback?.type || "song");
  const type = (normalizeToken(stringValue(source.type) || semanticKey).replace(/_?\d+$/, "") || semanticKey);
  return {
    anchorId,
    semanticKey,
    label: stringValue(source.label) || fallback?.label || "Canción",
    type,
    ordinal: Math.max(1, numberValue(source.ordinal, semanticOrdinal || fallback?.ordinal || 1)),
    fingerprint: stringValue(source.fingerprint) || fallback?.fingerprint || `secfp_${presentationHash(anchorId)}`,
    preview: stringValue(source.preview) || fallback?.preview || "",
  };
}

function normalizeAnnotation(value: unknown, fallbackSection?: PresentationSourceSection): PresentationAnnotation | null {
  const annotation = objectValue(value);
  if (!annotation) return null;
  const body = stringValue(annotation.body) || stringValue(annotation.text);
  const anchor = objectValue(annotation.anchor);
  const hasExplicitAnchor = "sectionAnchorId" in annotation || Boolean(anchor && "sectionId" in anchor);
  const sectionAnchorId = stringValue(annotation.sectionAnchorId) || stringValue(anchor?.sectionId) || (hasExplicitAnchor ? null : fallbackSection?.anchorId || null);
  if (!body) return null;
  const rawCategory = normalizeToken(String(annotation.category || "note"));
  const roles = (Array.isArray(annotation.roles) ? annotation.roles : Array.isArray(annotation.targetRoles) ? annotation.targetRoles : [])
    .map(normalizeRole)
    .filter((role): role is PresentationTargetRole => Boolean(role));
  return {
    id: stringValue(annotation.id) || `note_${presentationHash(`${sectionAnchorId || "item"}|${body}`)}`,
    sectionAnchorId,
    sourceFingerprint: stringValue(annotation.sourceFingerprint) || (sectionAnchorId ? fallbackSection?.fingerprint || null : null),
    category: CATEGORIES.has(rawCategory as PresentationAnnotationCategory) ? rawCategory as PresentationAnnotationCategory : "note",
    visibility: normalizeToken(String(annotation.visibility || "stage")) === "all" ? "all" : "stage",
    roles: [...new Set(roles)],
    body,
    createdById: stringValue(annotation.createdById),
    createdAt: stringValue(annotation.createdAt),
    updatedAt: stringValue(annotation.updatedAt),
  };
}

function normalizeWorkspaceItem(value: unknown, serviceItem: PresentationServiceItem): PresentationWorkspaceItem {
  const raw = objectValue(value);
  const derived = derivePresentationWorkspaceItem(serviceItem, stringValue(raw?.arrangementId));
  if (!raw) return derived;
  const rawSource = objectValue(raw.source);
  const rawSections = Array.isArray(rawSource?.sections) ? rawSource.sections : [];
  const sourceSections = rawSections.length
    ? rawSections.map((section, index) => normalizeSourceSection(section, derived.source.sections[index])).filter((section): section is PresentationSourceSection => Boolean(section))
    : derived.source.sections;
  const sourceById = new Map(sourceSections.map((section) => [section.anchorId, section]));
  const hasServerSequence = Array.isArray(raw.sequence);
  const rawSequence = hasServerSequence ? raw.sequence as unknown[] : [];
  const sequence = rawSequence.map((entry, index) => {
    const row = objectValue(entry);
    const anchorId = stringValue(row?.sectionAnchorId);
    const section = anchorId ? sourceById.get(anchorId) : undefined;
    if (!row || !anchorId) return null;
    return {
      id: stringValue(row.id) || `seq_${presentationHash(`${serviceItem.id}|${anchorId}|${index}`)}`,
      sectionAnchorId: anchorId,
      sourceFingerprint: stringValue(row.sourceFingerprint) || section?.fingerprint || "",
      label: stringValue(row.label) || section?.label || "Sección por revisar",
      position: numberValue(row.position, index),
    };
  }).filter((entry): entry is PresentationSequenceEntry => Boolean(entry)).sort((a, b) => a.position - b.position);
  const annotations = (Array.isArray(raw.annotations) ? raw.annotations : [])
    .map((annotation) => normalizeAnnotation(annotation, sourceSections[0]))
    .filter((annotation): annotation is PresentationAnnotation => Boolean(annotation));
  const reconciliation = objectValue(raw.reconciliation);
  const status = stringValue(reconciliation?.status);
  const rawAvailableArrangements = Array.isArray(raw.availableArrangements) ? raw.availableArrangements : [];
  const availableArrangements = rawAvailableArrangements.map((candidate) => {
    const arrangement = objectValue(candidate);
    const id = stringValue(arrangement?.id);
    if (!id) return null;
    return { id, name: stringValue(arrangement?.name) || "Arreglo", key: stringValue(arrangement?.key) };
  }).filter((candidate): candidate is { id: string; name: string; key: string | null } => Boolean(candidate));
  return {
    serviceItemId: stringValue(raw.serviceItemId) || serviceItem.id,
    itemVersion: numberValue(raw.itemVersion),
    arrangementId: stringValue(raw.arrangementId) || derived.arrangementId,
    availableArrangements: availableArrangements.length ? availableArrangements : derived.availableArrangements,
    source: {
      arrangementId: stringValue(rawSource?.arrangementId) || stringValue(raw.arrangementId) || derived.arrangementId,
      lyricsFingerprint: stringValue(rawSource?.lyricsFingerprint) || derived.source.lyricsFingerprint,
      sections: sourceSections,
    },
    sequence: hasServerSequence ? sequence : derived.sequence,
    annotations,
    legacyNotes: [...new Set(collectLegacyNotes(raw.legacyNotes))],
    reconciliation: {
      status: status === "reconciled" || status === "needs_review" ? status : "current",
      unresolvedAnnotationIds: (Array.isArray(reconciliation?.unresolvedAnnotationIds) ? reconciliation.unresolvedAnnotationIds : []).map(String),
      unresolvedStepIds: (Array.isArray(reconciliation?.unresolvedStepIds) ? reconciliation.unresolvedStepIds : []).map(String),
    },
  };
}

function collectLegacyNotes(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(collectLegacyNotes);
  const object = objectValue(value);
  const body = stringValue(object?.body);
  if (body) return [body];
  return object ? Object.values(object).flatMap(collectLegacyNotes) : [];
}

export function normalizePresentationWorkspace(
  rawValue: unknown,
  service: PresentationService,
  requestedView: PresentationWorkspaceView,
  churchRole?: string | null,
): PresentationWorkspace {
  const raw = objectValue(rawValue);
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const itemsById = new Map(rawItems.map((item) => [stringValue(objectValue(item)?.serviceItemId), item]));
  const songItems = (service.items || []).filter((item) => Boolean(item.song));
  const viewer = objectValue(raw?.viewer);
  const role = stringValue(viewer?.churchRole) || churchRole || null;
  const roles = (Array.isArray(viewer?.roles) ? viewer.roles : []).map(normalizeRole).filter((item): item is PresentationTargetRole => Boolean(item));
  const canEdit = typeof viewer?.canEdit === "boolean" ? viewer.canEdit : role === "ADMIN" || role === "PLANNER";
  return {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    serviceId: stringValue(raw?.serviceId) || service.id,
    serviceVersion: stringValue(raw?.serviceVersion) || String(numberValue(raw?.serviceVersion)),
    viewer: {
      view: viewer?.view === "editor" || viewer?.view === "operator" || viewer?.view === "stage" ? viewer.view : requestedView,
      churchRole: role,
      roles: [...new Set(roles)],
      canEdit,
    },
    items: songItems.map((item) => normalizeWorkspaceItem(itemsById.get(item.id), item)),
    legacyNotes: [...new Set(collectLegacyNotes(raw?.legacyNotes))],
    source: raw ? "api" : "derived",
  };
}

export async function fetchPresentationWorkspace(
  service: PresentationService,
  view: PresentationWorkspaceView,
  churchRole?: string | null,
) {
  try {
    const raw = await apiFetch<unknown>(`/services/${encodeURIComponent(service.id)}/presentation-config?view=${view}`, { cache: "no-store" });
    return normalizePresentationWorkspace(raw, service, view, churchRole);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      return normalizePresentationWorkspace(null, service, view, churchRole);
    }
    throw error;
  }
}

export async function fetchPresentationWorkspaceForPreferredView(
  service: PresentationService,
  preferredView: PresentationWorkspaceView,
  churchRole?: string | null,
  fetcher: typeof fetchPresentationWorkspace = fetchPresentationWorkspace,
) {
  try {
    return await fetcher(service, preferredView, churchRole);
  } catch (error) {
    if (preferredView === "editor" && error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return fetcher(service, "stage", churchRole);
    }
    throw error;
  }
}

export function canEnterPresentationWorkspace(workspace: PresentationWorkspace | null | undefined, localPermission: boolean) {
  return workspace?.source === "api" || localPermission;
}

export function buildPresentationItemSnapshot(item: PresentationWorkspaceItem) {
  return {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    itemId: item.serviceItemId,
    expectedVersion: item.itemVersion,
    arrangementId: item.arrangementId,
    sequence: item.sequence.map((entry, index) => {
      const { id, ...snapshot } = entry;
      return {
        ...(!id.startsWith(LOCAL_PRESENTATION_ID_PREFIX) ? { id } : {}),
        ...snapshot,
        position: index,
      };
    }),
    annotations: item.annotations.map((annotation) => {
      const { id, ...snapshot } = annotation;
      return {
        ...(!id.startsWith(LOCAL_PRESENTATION_ID_PREFIX) ? { id } : {}),
        ...snapshot,
      };
    }),
  };
}

export function buildPresentationSavePayload(item: PresentationWorkspaceItem) {
  return buildPresentationItemSnapshot(item);
}

export function savePresentationWorkspaceItem(serviceId: string, item: PresentationWorkspaceItem) {
  return apiFetch<unknown>(`/services/${encodeURIComponent(serviceId)}/presentation-config?view=editor`, {
    method: "PUT",
    body: JSON.stringify(buildPresentationSavePayload(item)),
  });
}

export function getWorkspaceItem(workspace: PresentationWorkspace | null | undefined, serviceItemId: string) {
  return workspace?.items.find((item) => item.serviceItemId === serviceItemId) || null;
}

export function isPresentationAnnotationVisible(
  annotation: PresentationAnnotation,
  surface: "operator" | "stage",
  viewerRoles: PresentationTargetRole[],
  canEdit = false,
) {
  if (canEdit || viewerRoles.includes("all")) return true;
  if (!annotation.roles.length || annotation.roles.includes("all")) return true;
  if (surface === "operator" && annotation.roles.includes("operator")) return true;
  if (surface === "stage" && annotation.roles.includes("stage")) return true;
  const roleSet = new Set(viewerRoles);
  return annotation.roles.some((role) => roleSet.has(role));
}

export function isValidPresentationAnnotationBody(value: string) {
  const length = value.trim().length;
  return length > 0 && length <= MAX_PRESENTATION_ANNOTATION_BODY_LENGTH;
}

export function createPresentationAnnotationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${LOCAL_PRESENTATION_ID_PREFIX}note_${crypto.randomUUID()}`;
  return `${LOCAL_PRESENTATION_ID_PREFIX}note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createPresentationSequenceId(serviceItemId: string, anchorId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${LOCAL_PRESENTATION_ID_PREFIX}seq_${crypto.randomUUID()}`;
  return `${LOCAL_PRESENTATION_ID_PREFIX}seq_${presentationHash(`${serviceItemId}|${anchorId}|${Date.now()}|${Math.random()}`)}`;
}
