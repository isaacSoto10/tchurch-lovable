import {
  chordProToDisplayLines,
  getPrimaryArrangement,
  getSongChordPro,
  getSongDisplayKey,
  isSongItemType,
  type ChordProDisplayLine,
  type SongLike,
} from "./songDisplay";
import { normalizeKey, transposeChordPro } from "./musicUtils";

export type PresentationAssignment = {
  id: string;
  userId: string;
  position: string;
  user: { email?: string | null; firstName?: string | null; lastName?: string | null } | null;
};

export type PresentationServiceItem = {
  id: string;
  title: string;
  type: string;
  position: number;
  duration: number | null;
  details?: Record<string, unknown> | null;
  song: SongLike | null;
};

export type PresentationService = {
  id: string;
  title: string;
  date: string;
  type: string;
  notes: string | null;
  items: PresentationServiceItem[];
  assignments?: PresentationAssignment[];
};

export type PresentationSlide =
  | {
      id: string;
      kind: "song";
      itemId: string;
      itemIndex: number;
      title: string;
      artist?: string | null;
      key?: string | null;
      bpm?: number | null;
      meter?: string | null;
      lines: ChordProDisplayLine[];
      part: number;
      totalParts: number;
      nextTitle?: string;
    }
  | {
      id: string;
      kind: "cue";
      itemId: string;
      itemIndex: number;
      title: string;
      subtitle: string;
      type: string;
      duration: number | null;
      notes: string[];
      nextTitle?: string;
    };

type PlanningNoteKey = "vocals" | "band" | "audioVisual" | "person";

const NOTE_LABELS: Record<PlanningNoteKey, string> = {
  vocals: "Voces",
  band: "Banda",
  audioVisual: "Audio / Visual",
  person: "Persona",
};

const TIMING_LABELS: Record<string, string> = {
  pre_service: "Antes del servicio",
  during: "Durante el servicio",
  post_service: "Después del servicio",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  song: "Canción",
  prayer: "Oración",
  scripture: "Escritura",
  announcement: "Anuncio",
  video: "Video",
  other: "Otro",
};

function getPlanningDetails(item: PresentationServiceItem) {
  return (item.details || {}) as Record<string, unknown>;
}

function getPlanningTimingLabel(item: PresentationServiceItem) {
  const timing = getPlanningDetails(item).timing;
  return typeof timing === "string" ? TIMING_LABELS[timing] || TIMING_LABELS.during : TIMING_LABELS.during;
}

function getServiceItemKey(item: PresentationServiceItem) {
  const details = getPlanningDetails(item);
  const savedKey =
    typeof details.serviceKey === "string" ? details.serviceKey :
    typeof details.selectedKey === "string" ? details.selectedKey :
    typeof details.key === "string" ? details.key :
    null;

  return normalizeKey(savedKey) || normalizeKey(getSongDisplayKey(item.song)) || null;
}

function getOriginalSongKey(item: PresentationServiceItem) {
  return normalizeKey(getSongDisplayKey(item.song)) || null;
}

function getDisplayChordPro(item: PresentationServiceItem) {
  const chordPro = getSongChordPro(item.song);
  const originalKey = getOriginalSongKey(item);
  const selectedKey = getServiceItemKey(item);

  if (!chordPro || !originalKey || !selectedKey || originalKey === selectedKey) {
    return chordPro;
  }

  return transposeChordPro(chordPro, originalKey, selectedKey);
}

function splitSongLines(lines: ChordProDisplayLine[]) {
  const chunks: ChordProDisplayLine[][] = [];
  let pendingLabels: ChordProDisplayLine[] = [];

  for (const line of lines) {
    if (line.kind === "blank") {
      if (pendingLabels.length > 0) continue;
      continue;
    }

    if (line.kind === "section" || line.kind === "meta") {
      if (pendingLabels.length > 0) chunks.push(pendingLabels);
      pendingLabels = [line];
      continue;
    }

    chunks.push([...pendingLabels, line]);
    pendingLabels = [];
  }

  if (pendingLabels.length > 0) chunks.push(pendingLabels);
  return chunks.length ? chunks : [[{ kind: "line", chords: "", lyrics: "Esta canción todavía no tiene acordes guardados." }]];
}

function getCueNotes(item: PresentationServiceItem) {
  const details = getPlanningDetails(item);
  const notes = details.notes && typeof details.notes === "object"
    ? details.notes as Partial<Record<PlanningNoteKey, string>>
    : {};

  const cueNotes = [
    getPlanningTimingLabel(item),
    item.duration ? `${item.duration} min` : null,
  ].filter(Boolean) as string[];

  for (const key of Object.keys(NOTE_LABELS) as PlanningNoteKey[]) {
    const note = notes[key]?.trim();
    if (note) cueNotes.push(`${NOTE_LABELS[key]}: ${note}`);
  }

  return cueNotes;
}

function buildSongSlides(item: PresentationServiceItem, itemIndex: number): PresentationSlide[] {
  const arrangement = getPrimaryArrangement(item.song);
  const chordPro = getDisplayChordPro(item);
  const displayLines = chordProToDisplayLines(chordPro, 500);
  const chunks = splitSongLines(displayLines);
  const key = getServiceItemKey(item);

  return chunks.map((lines, chunkIndex) => ({
    id: `${item.id}-song-${chunkIndex}`,
    kind: "song" as const,
    itemId: item.id,
    itemIndex,
    title: item.song?.title || item.title,
    artist: item.song?.author,
    key,
    bpm: arrangement?.bpm || item.song?.bpm || null,
    meter: arrangement?.meter || item.song?.meter || null,
    lines,
    part: chunkIndex + 1,
    totalParts: chunks.length,
  }));
}

function buildCueSlide(item: PresentationServiceItem, itemIndex: number): PresentationSlide {
  const type = ITEM_TYPE_LABELS[item.type?.toLowerCase()] || item.type || "Elemento";
  return {
    id: `${item.id}-cue`,
    kind: "cue",
    itemId: item.id,
    itemIndex,
    title: item.title || type,
    subtitle: type,
    type,
    duration: item.duration,
    notes: getCueNotes(item),
  };
}

export function buildServicePresentationSlides(service: PresentationService): PresentationSlide[] {
  const sortedItems = [...(service.items || [])].sort((a, b) => a.position - b.position);
  const slides = sortedItems.flatMap((item, index) => {
    if (isSongItemType(item.type) && item.song) return buildSongSlides(item, index + 1);
    return [buildCueSlide(item, index + 1)];
  });

  return slides.map((slide, index) => ({
    ...slide,
    nextTitle: slides[index + 1]?.title,
  }));
}

export function canUseServicePresentation(
  service: PresentationService | null,
  role: string | null | undefined,
  userId: string | null,
  userEmail: string | null
) {
  if (!service) return false;
  if (role === "ADMIN" || role === "PLANNER") return true;

  const normalizedEmail = userEmail?.trim().toLowerCase() || null;
  return Boolean(service.assignments?.some((assignment) => {
    const assignmentEmail = assignment.user?.email?.trim().toLowerCase() || null;
    return assignment.userId === userId || Boolean(normalizedEmail && assignmentEmail === normalizedEmail);
  }));
}
