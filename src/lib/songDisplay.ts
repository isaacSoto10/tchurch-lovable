export type SongArrangement = {
  id: string;
  name: string;
  key?: string | null;
  bpm?: number | null;
  meter?: string | null;
  lyrics?: string | null;
  notes?: string | null;
};

export type SongLike = {
  id: string;
  title: string;
  author?: string | null;
  key?: string | null;
  bpm?: number | null;
  meter?: string | null;
  notes?: string | null;
  lyrics?: string | null;
  youtubeUrl?: string | null;
  arrangements?: SongArrangement[] | null;
};

export type SongNotes = {
  youtubeUrl: string | null;
  plainNotes: string | null;
  sourceUrl: string | null;
  needsLicensedChart: boolean;
};

export type ChordProDisplayLine =
  | { kind: "blank" }
  | { kind: "section"; label: string }
  | { kind: "meta"; label: string }
  | { kind: "line"; chords: string; lyrics: string };

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro",
  introduccion: "Intro",
  "introducción": "Intro",
  verse: "Verse",
  verso: "Verso",
  estrofa: "Verso",
  chorus: "Coro",
  coro: "Coro",
  bridge: "Puente",
  puente: "Puente",
  "pre-chorus": "Pre-coro",
  prechorus: "Pre-coro",
  precoro: "Pre-coro",
  "pre coro": "Pre-coro",
  interlude: "Interludio",
  interludio: "Interludio",
  instrumental: "Instrumental",
  tag: "Tag",
  outro: "Final",
  final: "Final",
  ending: "Final",
};

function normalizeLabel(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getDirectiveLabel(raw: string) {
  const normalized = normalizeLabel(raw.replace(/\d+$/g, "").trim());
  const section = SECTION_LABELS[normalized];
  if (!section) return null;

  const number = raw.match(/(\d+)$/)?.[1];
  return number ? `${section} ${number}` : section;
}

export function parseSongNotes(notes: string | null | undefined): SongNotes {
  if (!notes) {
    return { youtubeUrl: null, plainNotes: null, sourceUrl: null, needsLicensedChart: false };
  }

  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object") {
      return {
        youtubeUrl: typeof parsed.youtubeUrl === "string" ? parsed.youtubeUrl : null,
        plainNotes: typeof parsed.notes === "string" ? parsed.notes : null,
        sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : null,
        needsLicensedChart: Boolean(parsed.needsLicensedChart),
      };
    }
  } catch {
    return { youtubeUrl: null, plainNotes: notes, sourceUrl: null, needsLicensedChart: false };
  }

  return { youtubeUrl: null, plainNotes: notes, sourceUrl: null, needsLicensedChart: false };
}

export function buildSongNotes(youtubeUrl: string | null, plainNotes: string | null) {
  if (!youtubeUrl && !plainNotes) return null;

  return JSON.stringify({
    ...(youtubeUrl ? { youtubeUrl } : {}),
    ...(plainNotes ? { notes: plainNotes } : {}),
  });
}

export function getSongYoutubeUrl(song: SongLike | null | undefined) {
  if (!song) return null;
  return song.youtubeUrl || parseSongNotes(song.notes).youtubeUrl;
}

export function getSongPlainNotes(song: SongLike | null | undefined) {
  if (!song) return null;
  return parseSongNotes(song.notes).plainNotes;
}

export function getPrimaryArrangement(song: SongLike | null | undefined) {
  return (song?.arrangements || []).find((arr) => arr.lyrics?.trim()) || song?.arrangements?.[0] || null;
}

export function getSongChordPro(song: SongLike | null | undefined) {
  if (!song) return null;
  return getPrimaryArrangement(song)?.lyrics || song.lyrics || null;
}

export function hasChordPro(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function isSongItemType(type: string | null | undefined) {
  return (type || "").toLowerCase() === "song";
}

export function chordProToDisplayLines(value: string | null | undefined, maxLines = 80): ChordProDisplayLine[] {
  if (!value) return [];

  const lines: ChordProDisplayLine[] = [];
  for (const rawLine of value.replace(/\r\n/g, "\n").split("\n")) {
    if (lines.length >= maxLines) break;

    const trimmed = rawLine.trim();
    if (!trimmed) {
      lines.push({ kind: "blank" });
      continue;
    }

    const directive = trimmed.match(/^\{([^}:]+)(?::\s*(.*))?\}$/);
    if (directive) {
      const sectionLabel = getDirectiveLabel(directive[1]);
      lines.push({
        kind: sectionLabel ? "section" : "meta",
        label: sectionLabel || `${directive[1]}${directive[2] ? `: ${directive[2]}` : ""}`,
      });
      continue;
    }

    const bracketOnly = trimmed.match(/^\[([^\]]+)\]$/);
    if (bracketOnly) {
      const sectionLabel = getDirectiveLabel(bracketOnly[1]);
      if (sectionLabel) {
        lines.push({ kind: "section", label: sectionLabel });
        continue;
      }
    }

    const chords = [...rawLine.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]).join("   ");
    const lyrics = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    lines.push({ kind: "line", chords, lyrics });
  }

  return lines;
}
