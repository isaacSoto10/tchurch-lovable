import {
  getPrimaryArrangement,
  getSongChordPro,
  getSongDisplayKey,
  isSongItemType,
  type ChordProDisplayLine,
  type SongLike,
} from "./songDisplay";
import { normalizeKey, transposeChordPro } from "./musicUtils";
import {
  normalizePresentationItemContent,
  paginateResolvedScripture,
  splitPresentationTextPages,
  type PresentationAudienceSlide,
  type PresentationItemContent,
} from "./presentationOutput";
import {
  derivePresentationSections,
  getWorkspaceItem,
  type PresentationWorkspace,
  type PresentationWorkspaceItem,
} from "./presentationWorkspace";

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

export type PresentationDisplayLine = ChordProDisplayLine & {
  sectionAnchorId?: string;
  sectionSequenceId?: string;
  sectionLabel?: string;
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
      lines: PresentationDisplayLine[];
      arrangementId: string | null;
      sectionAnchorIds: string[];
      sectionSequenceIds: string[];
      sectionLabels: string[];
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
    }
  | {
      id: string;
      kind: "content";
      itemId: string;
      itemIndex: number;
      title: string;
      subtitle: string;
      type: string;
      duration: number | null;
      part: number;
      totalParts: number;
      audienceSlide: PresentationAudienceSlide;
      nextTitle?: string;
    };

export type PresentationLayout = "phone" | "tablet";
export type PresentationSongMode = "paged" | "scroll";

type BuildServicePresentationSlidesOptions = {
  layout?: PresentationLayout;
  songMode?: PresentationSongMode;
  workspace?: PresentationWorkspace | null;
};

export type PresentationRunStep = {
  id: string;
  kind: "song-section" | "cue";
  slideIndex: number;
  itemId: string;
  title: string;
  sectionAnchorId: string | null;
  sectionSequenceId: string | null;
  sectionLabel: string | null;
  page: number;
  totalPages: number;
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

function getArrangement(item: PresentationServiceItem, arrangementId?: string | null) {
  return item.song?.arrangements?.find((arrangement) => arrangement.id === arrangementId) || getPrimaryArrangement(item.song);
}

function getOriginalSongKey(item: PresentationServiceItem, arrangementId?: string | null) {
  const arrangement = getArrangement(item, arrangementId);
  return normalizeKey(arrangement?.key) || normalizeKey(getSongDisplayKey(item.song)) || null;
}

function getDisplayChordPro(item: PresentationServiceItem, arrangementId?: string | null) {
  const arrangement = getArrangement(item, arrangementId);
  const chordPro = arrangement?.lyrics || getSongChordPro(item.song);
  const originalKey = getOriginalSongKey(item, arrangementId);
  const selectedKey = getServiceItemKey(item);

  if (!chordPro || !originalKey || !selectedKey || originalKey === selectedKey) {
    return chordPro;
  }

  return transposeChordPro(chordPro, originalKey, selectedKey);
}

function splitSongLines(lines: PresentationDisplayLine[], layout: PresentationLayout): PresentationDisplayLine[][] {
  const chunks: PresentationDisplayLine[][] = [];
  let current: PresentationDisplayLine[] = [];
  let currentRows = 0;
  const maxRows = layout === "phone" ? MAX_PHONE_RENDERED_ROWS_PER_SONG_SLIDE : MAX_TABLET_RENDERED_ROWS_PER_SONG_SLIDE;
  const sectionBreakThreshold = layout === "phone" ? 0.55 : 0.68;

  function lineRows(line: PresentationDisplayLine) {
    if (line.kind === "blank") return 0.5;
    if (line.kind === "section" || line.kind === "meta") return 0.85;

    const hasChords = Boolean(line.chords.trim());
    const hasLyrics = Boolean(line.lyrics.trim());
    if (hasChords && hasLyrics) return 2.1;
    if (hasChords || hasLyrics) return 1.1;
    return 0.5;
  }

  function hasMusicLine(chunk: PresentationDisplayLine[]) {
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

function splitWideDisplayLine(line: PresentationDisplayLine, maxColumns = CHART_WRAP_COLUMNS): PresentationDisplayLine[] {
  if (line.kind !== "line") return [line];

  const width = Math.max(line.chords.length, line.lyrics.length);
  if (width <= maxColumns) return [line];

  const segments: PresentationDisplayLine[] = [];
  let start = 0;

  while (start < width) {
    const end = Math.max(start + 1, findSplitColumn(line, start, width, maxColumns));

    const { chords, lyrics } = trimSharedLeadingColumns(
      line.chords.slice(start, end).trimEnd(),
      line.lyrics.slice(start, end).trimEnd()
    );
    if (chords.trim() || lyrics.trim()) {
      segments.push({
        ...line,
        kind: "line",
        chords,
        lyrics,
      });
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
  songMode: PresentationSongMode,
  workspaceItem: PresentationWorkspaceItem | null,
): PresentationSlide[] {
  const arrangement = getArrangement(item, workspaceItem?.arrangementId);
  const arrangementId = workspaceItem?.arrangementId || arrangement?.id || null;
  const chordPro = getDisplayChordPro(item, arrangementId);
  const derivedSections = derivePresentationSections(item.id, arrangementId, chordPro);
  const sourceSections = workspaceItem?.source.sections || [];
  const matchedSections = derivedSections.map((section) => {
    const source = sourceSections.find((candidate) =>
      (candidate.semanticKey === section.semanticKey || candidate.type === section.type) &&
      candidate.ordinal === section.ordinal
    );
    return source ? { ...section, ...source, lines: section.lines } : section;
  });
  const sectionsByAnchor = new Map(matchedSections.map((section) => [section.anchorId, section]));
  const fallbackSequence = matchedSections.map((section, index) => ({
    id: `${item.id}-${section.anchorId}-${index}`,
    sectionAnchorId: section.anchorId,
    sourceFingerprint: section.fingerprint,
    label: section.label,
    position: index,
  }));
  const unresolvedStepIds = new Set(workspaceItem?.reconciliation.unresolvedStepIds || []);
  const requestedSequence = workspaceItem
    ? workspaceItem.sequence.filter((entry) => !unresolvedStepIds.has(entry.id))
    : fallbackSequence;
  const arrangedSections = requestedSequence.flatMap((entry) => {
    const section = sectionsByAnchor.get(entry.sectionAnchorId);
    if (!section) return [];
    const decoratedLines = section.lines.map((line) => ({
      ...line,
      sectionAnchorId: section.anchorId,
      sectionSequenceId: entry.id,
      sectionLabel: entry.label || section.label,
    } as PresentationDisplayLine));
    return [{ entry, section, lines: decoratedLines }];
  });
  const effectiveSections = arrangedSections;
  if (!effectiveSections.length) {
    return [{
      id: `${item.id}-review`,
      kind: "cue",
      itemId: item.id,
      itemIndex,
      title: item.song?.title || item.title,
      subtitle: "Revisión requerida",
      type: "Revisión",
      duration: item.duration,
      notes: ["Las secciones de esta canción están pendientes de reconciliación y no se enviarán al escenario."],
    }];
  }
  const wrappedSections = effectiveSections.map((entry) => ({
    ...entry,
    lines: entry.lines.flatMap((line) => splitWideDisplayLine(line, layout === "tablet" ? TABLET_CHART_WRAP_COLUMNS : CHART_WRAP_COLUMNS)),
  }));
  const chartLines = wrappedSections.flatMap((section) => section.lines);
  const maxColumns = Math.max(
    18,
    ...chartLines.map((line) => line.kind === "line" ? Math.max(line.chords.length, line.lyrics.length) : 0)
  );
  const chunks = songMode === "scroll"
    ? [chartLines]
    : wrappedSections.flatMap((section) => splitSongLines(section.lines, layout));
  const key = getServiceItemKey(item);

  return chunks.map((rawLines, chunkIndex) => {
    const lines = rawLines.length ? rawLines : [{
      kind: "line" as const,
      chords: "",
      lyrics: "Esta canción todavía no tiene acordes guardados.",
    }];
    const sectionAnchorIds = [...new Set(lines.map((line) => line.sectionAnchorId).filter((value): value is string => Boolean(value)))];
    const sectionSequenceIds = [...new Set(lines.map((line) => line.sectionSequenceId).filter((value): value is string => Boolean(value)))];
    const sectionLabels = [...new Set(lines.map((line) => line.sectionLabel).filter((value): value is string => Boolean(value)))];
    return {
    id: songMode === "scroll" ? `${item.id}-song-scroll` : `${item.id}-song-${chunkIndex}`,
    kind: "song" as const,
    itemId: item.id,
    itemIndex,
    title: item.song?.title || item.title,
    artist: item.song?.author,
    key,
    bpm: arrangement?.bpm || item.song?.bpm || null,
    meter: arrangement?.meter || item.song?.meter || null,
    arrangementId,
    lines,
    sectionAnchorIds,
    sectionSequenceIds,
    sectionLabels,
    maxColumns,
    part: chunkIndex + 1,
    totalParts: chunks.length,
    };
  });
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

function buildAudienceContentSlides(
  item: PresentationServiceItem,
  itemIndex: number,
  content: PresentationItemContent,
): Extract<PresentationSlide, { kind: "content" }>[] {
  const title = item.title || "Contenido";
  const base = {
    itemId: item.id,
    itemIndex,
    title,
    durationSeconds: item.duration ? Math.max(1, Math.round(item.duration * 60)) : null,
  };
  let audienceSlides: PresentationAudienceSlide[];
  if (content.kind === "scripture") {
    if (!content.resolvedPassage) return [];
    const pages = paginateResolvedScripture(content.resolvedPassage);
    audienceSlides = pages.map((verses, index) => ({
      ...base,
      id: `${item.id}:scripture:${index}`,
      kind: "scripture",
      passage: { ...content.resolvedPassage!, verses },
      part: index + 1,
      totalParts: pages.length,
    }));
  } else if (content.kind === "image") {
    audienceSlides = [{ ...base, id: `${item.id}:image:0`, kind: "image", src: content.src, alt: content.alt, fit: content.fit }];
  } else if (content.kind === "video") {
    audienceSlides = [{ ...base, id: `${item.id}:video:0`, kind: "video", src: content.src, posterSrc: content.posterSrc, muted: content.muted, autoplay: content.autoplay, loop: content.loop, durationMs: content.durationMs }];
  } else if (content.kind === "audio") {
    audienceSlides = [{ ...base, id: `${item.id}:audio:0`, kind: "audio", src: content.src, artist: content.artist, autoplay: content.autoplay, loop: content.loop, durationMs: content.durationMs }];
  } else if (content.kind === "countdown") {
    audienceSlides = [{ ...base, id: `${item.id}:countdown:0`, kind: "countdown", label: content.label, durationSeconds: content.durationSeconds }];
  } else if (content.kind === "sermon") {
    audienceSlides = splitPresentationTextPages(content.body.join("\n"), 360, 7).map((body, index) => ({ ...base, id: `${item.id}:sermon:part:${index}`, kind: "sermon", subtitle: content.subtitle, speaker: content.speaker, body, mediaSrc: content.mediaSrc, mediaType: content.mediaSrc ? "image" : null }));
  } else if (content.kind === "announcement") {
    audienceSlides = splitPresentationTextPages(content.body.join("\n"), 300, 6).map((body, index) => ({ ...base, id: `${item.id}:announcement:part:${index}`, kind: "announcement", body, mediaSrc: content.mediaSrc, mediaType: content.mediaSrc ? "image" : null, durationSeconds: content.durationSeconds, loop: content.loop }));
  } else {
    audienceSlides = [{ ...base, id: `${item.id}:blank:0`, kind: "blank", tone: content.tone }];
  }

  const type = ITEM_TYPE_LABELS[item.type?.toLowerCase()] || content.kind || "Contenido";
  return audienceSlides.map((audienceSlide, index) => ({
    id: audienceSlide.id,
    kind: "content",
    itemId: item.id,
    itemIndex,
    title,
    subtitle: type,
    type,
    duration: item.duration,
    part: index + 1,
    totalParts: audienceSlides.length,
    audienceSlide,
  }));
}

function buildNonSongSlides(item: PresentationServiceItem, itemIndex: number): PresentationSlide[] {
  const details = getPlanningDetails(item);
  const content = normalizePresentationItemContent(details.presentation);
  if (content) {
    const contentSlides = buildAudienceContentSlides(item, itemIndex, content);
    if (contentSlides.length) return contentSlides;
    if (content.kind === "scripture") {
      const cue = buildCueSlide(item, itemIndex);
      return [cue.kind === "cue"
        ? { ...cue, notes: ["El texto bíblico debe resolverse en el servidor antes de proyectarlo."] }
        : cue];
    }
  }
  return [buildCueSlide(item, itemIndex)];
}

export function buildAudiencePreviewSlide(slide: PresentationSlide | null | undefined): PresentationAudienceSlide | null {
  if (!slide) return null;
  if (slide.kind === "content") return slide.audienceSlide;
  if (slide.kind === "cue") {
    return {
      id: `${slide.id}-preview`,
      itemId: slide.itemId,
      itemIndex: slide.itemIndex,
      kind: "sermon",
      title: slide.title,
      durationSeconds: slide.duration ? Math.round(slide.duration * 60) : null,
      subtitle: slide.subtitle,
      speaker: null,
      body: [],
      mediaSrc: null,
      mediaType: null,
    };
  }
  const lines = slide.lines
    .filter((line): line is Extract<PresentationDisplayLine, { kind: "line" }> => line.kind === "line")
    .map((line) => line.lyrics.trim())
    .filter(Boolean)
    .slice(0, 7);
  return {
    id: `${slide.id}-preview`,
    itemId: slide.itemId,
    itemIndex: slide.itemIndex,
    kind: "lyrics",
    title: slide.title,
    durationSeconds: null,
    sectionLabel: slide.sectionLabels[0] || null,
    lines: lines.length ? lines : [slide.title],
    part: slide.part,
    totalParts: slide.totalParts,
    copyright: null,
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
    if (isSongItemType(item.type) && item.song) {
      return buildSongSlides(item, index + 1, layout, songMode, getWorkspaceItem(options.workspace, item.id));
    }
    return buildNonSongSlides(item, index + 1);
  });

  return slides.map((slide, index) => ({
    ...slide,
    nextTitle: slides[index + 1]?.title,
  }));
}

export function buildPresentationRunSteps(
  slides: PresentationSlide[],
  songMode: PresentationSongMode,
): PresentationRunStep[] {
  const steps: PresentationRunStep[] = [];
  slides.forEach((slide, slideIndex) => {
    if (slide.kind !== "song") {
      steps.push({
        id: slide.id,
        kind: "cue",
        slideIndex,
        itemId: slide.itemId,
        title: slide.title,
        sectionAnchorId: null,
        sectionSequenceId: null,
        sectionLabel: null,
        page: slide.kind === "content" ? slide.part : 1,
        totalPages: slide.kind === "content" ? slide.totalParts : 1,
      });
      return;
    }

    if (songMode === "scroll" && slide.sectionSequenceIds.length) {
      slide.sectionSequenceIds.forEach((sequenceId, index) => {
        const sectionLine = slide.lines.find((line) => line.sectionSequenceId === sequenceId);
        steps.push({
          id: `${slide.id}-${sequenceId}`,
          kind: "song-section",
          slideIndex,
          itemId: slide.itemId,
          title: slide.title,
          sectionAnchorId: sectionLine?.sectionAnchorId || slide.sectionAnchorIds[0] || null,
          sectionSequenceId: sequenceId,
          sectionLabel: sectionLine?.sectionLabel || slide.sectionLabels[index] || slide.sectionLabels[0] || "Canción",
          page: index + 1,
          totalPages: slide.sectionSequenceIds.length,
        });
      });
      return;
    }

    steps.push({
      id: slide.id,
      kind: "song-section",
      slideIndex,
      itemId: slide.itemId,
      title: slide.title,
      sectionAnchorId: slide.sectionAnchorIds[0] || null,
      sectionSequenceId: slide.sectionSequenceIds[0] || null,
      sectionLabel: slide.sectionLabels[0] || "Canción",
      page: slide.part,
      totalPages: slide.totalParts,
    });
  });
  return steps;
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
