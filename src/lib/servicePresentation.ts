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
      maxColumns: number;
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

export type PresentationLayout = "phone" | "tablet";
export type PresentationSongMode = "paged" | "scroll";

type BuildServicePresentationSlidesOptions = {
  layout?: PresentationLayout;
  songMode?: PresentationSongMode;
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

const CHART_WRAP_COLUMNS = 34;
const TABLET_CHART_WRAP_COLUMNS = 64;
const MAX_PHONE_RENDERED_ROWS_PER_SONG_SLIDE = 15;
const MAX_TABLET_RENDERED_ROWS_PER_SONG_SLIDE = 23;

export function getDefaultPresentationSongMode(layout: PresentationLayout): PresentationSongMode {
  return layout === "tablet" ? "scroll" : "paged";
}

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

function splitSongLines(lines: ChordProDisplayLine[], layout: PresentationLayout) {
  const chunks: ChordProDisplayLine[][] = [];
  let current: ChordProDisplayLine[] = [];
  let currentRows = 0;
  const maxRows = layout === "phone" ? MAX_PHONE_RENDERED_ROWS_PER_SONG_SLIDE : MAX_TABLET_RENDERED_ROWS_PER_SONG_SLIDE;
  const sectionBreakThreshold = layout === "phone" ? 0.55 : 0.68;

  function lineRows(line: ChordProDisplayLine) {
    if (line.kind === "blank") return 0.5;
    if (line.kind === "section" || line.kind === "meta") return 0.85;

    const hasChords = Boolean(line.chords.trim());
    const hasLyrics = Boolean(line.lyrics.trim());
    if (hasChords && hasLyrics) return 2.1;
    if (hasChords || hasLyrics) return 1.1;
    return 0.5;
  }

  function hasMusicLine(chunk: ChordProDisplayLine[]) {
    return chunk.some((line) => line.kind === "line");
  }

  function pushCurrent() {
    if (!current.length) return;
    chunks.push(current);
    current = [];
    currentRows = 0;
  }

  for (const line of lines) {
    if (line.kind === "blank") {
      if (!current.length) continue;
      continue;
    }

    const rows = lineRows(line);
    const startsNewSection = line.kind === "section" || line.kind === "meta";

    if (
      (startsNewSection && hasMusicLine(current) && currentRows >= maxRows * sectionBreakThreshold) ||
      (hasMusicLine(current) && currentRows + rows > maxRows)
    ) {
      pushCurrent();
    }

    current.push(line);
    currentRows += rows;
  }

  pushCurrent();
  return chunks.length ? chunks : [[{ kind: "line", chords: "", lyrics: "Esta canción todavía no tiene acordes guardados." }]];
}

function isInsideToken(value: string, index: number) {
  const before = value[index - 1];
  const after = value[index];
  return Boolean(before && after && !/\s/.test(before) && !/\s/.test(after));
}

function isSafeSplitColumn(line: Extract<ChordProDisplayLine, { kind: "line" }>, index: number) {
  return !isInsideToken(line.chords, index) && !isInsideToken(line.lyrics, index);
}

function isBreakAfterWhitespace(value: string, index: number) {
  return /\s/.test(value[index - 1] || "");
}

function findSplitColumn(line: Extract<ChordProDisplayLine, { kind: "line" }>, start: number, width: number, maxColumns: number) {
  const remaining = width - start;
  if (remaining <= maxColumns) return width;

  let target = Math.min(start + maxColumns, width);
  const shortTail = width - target;

  if (shortTail > 0 && shortTail < maxColumns * 0.45) {
    target = start + Math.ceil(remaining / 2);
  }

  const minSplit = start + Math.max(6, Math.floor(maxColumns * 0.58));
  for (let index = target; index >= minSplit; index -= 1) {
    if (
      isSafeSplitColumn(line, index) &&
      (isBreakAfterWhitespace(line.lyrics, index) || isBreakAfterWhitespace(line.chords, index))
    ) {
      return index;
    }
  }

  for (let index = target; index >= minSplit; index -= 1) {
    if (isSafeSplitColumn(line, index)) return index;
  }

  return target;
}

function firstContentColumn(value: string) {
  const index = value.search(/\S/);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function trimSharedLeadingColumns(chords: string, lyrics: string) {
  const sharedColumns = Math.min(firstContentColumn(chords), firstContentColumn(lyrics));

  if (!Number.isFinite(sharedColumns)) {
    return { chords: chords.trimStart(), lyrics: lyrics.trimStart() };
  }

  if (sharedColumns <= 0) return { chords, lyrics };
  return { chords: chords.slice(sharedColumns), lyrics: lyrics.slice(sharedColumns) };
}

function splitWideDisplayLine(line: ChordProDisplayLine, maxColumns = CHART_WRAP_COLUMNS): ChordProDisplayLine[] {
  if (line.kind !== "line") return [line];

  const width = Math.max(line.chords.length, line.lyrics.length);
  if (width <= maxColumns) return [line];

  const segments: ChordProDisplayLine[] = [];
  let start = 0;

  while (start < width) {
    const end = Math.max(start + 1, findSplitColumn(line, start, width, maxColumns));

    const { chords, lyrics } = trimSharedLeadingColumns(
      line.chords.slice(start, end).trimEnd(),
      line.lyrics.slice(start, end).trimEnd()
    );
    if (chords.trim() || lyrics.trim()) {
      segments.push({ kind: "line", chords, lyrics });
    }
    start = end;
  }

  return segments.length ? segments : [line];
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

function buildSongSlides(
  item: PresentationServiceItem,
  itemIndex: number,
  layout: PresentationLayout,
  songMode: PresentationSongMode
): PresentationSlide[] {
  const arrangement = getPrimaryArrangement(item.song);
  const chordPro = getDisplayChordPro(item);
  const displayLines = chordProToDisplayLines(chordPro, 500);
  const chartLines = displayLines.flatMap((line) => splitWideDisplayLine(line, layout === "tablet" ? TABLET_CHART_WRAP_COLUMNS : CHART_WRAP_COLUMNS));
  const maxColumns = Math.max(
    18,
    ...chartLines.map((line) => line.kind === "line" ? Math.max(line.chords.length, line.lyrics.length) : 0)
  );
  const chunks = songMode === "scroll" ? [chartLines] : splitSongLines(chartLines, layout);
  const key = getServiceItemKey(item);

  return chunks.map((lines, chunkIndex) => ({
    id: songMode === "scroll" ? `${item.id}-song-scroll` : `${item.id}-song-${chunkIndex}`,
    kind: "song" as const,
    itemId: item.id,
    itemIndex,
    title: item.song?.title || item.title,
    artist: item.song?.author,
    key,
    bpm: arrangement?.bpm || item.song?.bpm || null,
    meter: arrangement?.meter || item.song?.meter || null,
    lines,
    maxColumns,
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

export function buildServicePresentationSlides(
  service: PresentationService,
  options: BuildServicePresentationSlidesOptions = {}
): PresentationSlide[] {
  const layout = options.layout || "phone";
  const songMode = options.songMode || getDefaultPresentationSongMode(layout);
  const sortedItems = [...(service.items || [])].sort((a, b) => a.position - b.position);
  const slides = sortedItems.flatMap((item, index) => {
    if (isSongItemType(item.type) && item.song) return buildSongSlides(item, index + 1, layout, songMode);
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
