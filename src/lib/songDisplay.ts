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
  v: "Verse",
  verso: "Verse",
  estrofa: "Verse",
  chorus: "Chorus",
  c: "Chorus",
  coro: "Chorus",
  bridge: "Bridge",
  b: "Bridge",
  puente: "Bridge",
  "pre-chorus": "Pre-Chorus",
  "pre chorus": "Pre-Chorus",
  prechorus: "Pre-Chorus",
  pc: "Pre-Chorus",
  precoro: "Pre-Chorus",
  "pre coro": "Pre-Chorus",
  "pre-coro": "Pre-Chorus",
  interlude: "Interlude",
  interludio: "Interlude",
  instrumental: "Instrumental",
  solo: "Interlude",
  tag: "Tag",
  outro: "Outro",
  final: "Outro",
  ending: "Outro",
};

const METADATA_KEYS = new Set(["title", "artist", "key", "tempo", "capo", "time", "t", "a", "k"]);

function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
  return number && number !== "1" ? `${section} ${number}` : section;
}

function getPlainSectionLabel(raw: string) {
  if (raw.includes("[") || raw.includes("{")) return null;
  return getDirectiveLabel(raw);
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

function splitChordProContentLine(rawLine: string): { chords: string; lyrics: string } {
  const chordMatches = [...rawLine.matchAll(/\[([^\]]+)\]/g)];
  if (chordMatches.length === 0) {
    return { chords: "", lyrics: rawLine.trimEnd() };
  }

  let chords = "";
  let lyrics = "";
  let cursor = 0;

  for (const match of chordMatches) {
    const matchIndex = match.index ?? 0;
    const textBeforeChord = rawLine.slice(cursor, matchIndex);
    lyrics += textBeforeChord;

    const targetColumn = lyrics.length;
    if (chords.length < targetColumn) {
      chords += " ".repeat(targetColumn - chords.length);
    } else if (chords.length > 0) {
      chords += " ";
    }

    chords += match[1];
    cursor = matchIndex + match[0].length;
  }

  lyrics += rawLine.slice(cursor);

  if (!lyrics.trim()) {
    return {
      chords: chordMatches.map((match) => match[1]).join("   "),
      lyrics: "",
    };
  }

  return {
    chords: chords.trimEnd(),
    lyrics: lyrics.trimEnd(),
  };
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

    const plainSectionLabel = getPlainSectionLabel(trimmed);
    if (plainSectionLabel) {
      lines.push({ kind: "section", label: plainSectionLabel });
      continue;
    }

    const directive = trimmed.match(/^\{([^}:]+)(?::\s*(.*))?\}$/);
    if (directive) {
      const key = directive[1].toLowerCase();
      if (METADATA_KEYS.has(key)) continue;

      const sectionLabel = getDirectiveLabel(key);
      if (sectionLabel) {
        lines.push({ kind: "section", label: sectionLabel });
      }
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

    const { chords, lyrics } = splitChordProContentLine(trimmed);
    lines.push({ kind: "line", chords, lyrics });
  }

  return lines;
}
