import { normalizeChordProText } from "./chordProText";

export const ALL_KEYS = [
  "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G",
  "G#", "Ab", "A", "A#", "Bb", "B",
] as const;

const NOTE_NAMES: readonly string[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const FLAT_EQUIVALENTS: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

const SPANISH_KEY_EQUIVALENTS: Record<string, string> = {
  do: "C",
  re: "D",
  mi: "E",
  fa: "F",
  sol: "G",
  la: "A",
  si: "B",
};

const NOTE_PATTERN = /^(Sol|Do|Re|Mi|Fa|La|Si|[A-G])([#b♯♭]?)/i;
const CHORD_QUALITY_PATTERN = /^(?:(?:maj|min|dim|aug|sus|add|dom|omit|no|m|M)|[0-9#b♯♭+°øΔ()\-.,/])*$/i;

export function normalizeKey(key: string | null | undefined): string {
  const match = key?.trim().match(NOTE_PATTERN);
  if (!match) return "";
  const root = SPANISH_KEY_EQUIVALENTS[match[1].toLowerCase()] || match[1].toUpperCase();
  const accidental = match[2].replace("♯", "#").replace("♭", "b");
  const note = root + accidental;
  if (note === "B#") return "C";
  if (note === "E#") return "F";
  if (note === "Cb") return "B";
  if (note === "Fb") return "E";
  return FLAT_EQUIVALENTS[note] || note;
}

export function inferChordProKey(value: string | null | undefined): string {
  const text = normalizeChordProText(value);
  const declaredKey = text.match(/\{(?:key|k):\s*([^}]+)\}/i)?.[1];
  if (declaredKey && normalizeKey(declaredKey)) return normalizeKey(declaredKey);
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const chord = match[1].trim().split(/[\s|]+/).map(parseChord).find(Boolean);
    if (chord) return normalizeKey(chord.root);
  }
  for (const line of text.split("\n")) {
    const progression = parseChordProgressionLine(line);
    const chord = progression && parseChord(progression.chords.trim().split(/[\s|]+/)[0]);
    if (chord) return normalizeKey(chord.root);
  }
  return "";
}

function getNoteIndex(note: string): number {
  return NOTE_NAMES.indexOf(normalizeKey(note));
}

function transposeNote(note: string, semitones: number): string {
  const idx = getNoteIndex(note);
  if (idx === -1) return note;
  const transposed = ((idx + semitones) % 12 + 12) % 12;
  return NOTE_NAMES[transposed];
}

function semitonesBetween(from: string, to: string): number {
  const fromIdx = getNoteIndex(from);
  const toIdx = getNoteIndex(to);
  if (fromIdx === -1 || toIdx === -1) return 0;
  return ((toIdx - fromIdx) % 12 + 12) % 12;
}

function parseChord(value: string): { root: string; quality: string; bass: string } | null {
  const match = value.match(NOTE_PATTERN);
  if (!match) return null;
  let quality = value.slice(match[0].length);
  const bassMatch = quality.match(/\/(Sol|Do|Re|Mi|Fa|La|Si|[A-G])([#b♯♭]?)$/i);
  const bass = bassMatch ? bassMatch[1] + bassMatch[2] : "";
  if (bassMatch) quality = quality.slice(0, bassMatch.index);
  if (!CHORD_QUALITY_PATTERN.test(quality)) return null;
  return { root: match[0], quality, bass };
}

export function parseChordProgressionLine(value: string): { label: string; chords: string } | null {
  if (/[\[\]{}]/.test(value)) return null;
  const labelMatch = value.match(/^\s*((?:intro|introducci[oó]n|interludio|instrumental|outro|final)(?:\s+\d+)?):\s*/i);
  const chords = labelMatch ? value.slice(labelMatch[0].length) : value.trim();
  const tokens = chords.split(/[\s|]+/).filter(Boolean);
  if (!tokens.length || (!labelMatch && tokens.length < 2) || tokens.some((token) => !parseChord(token))) return null;
  return { label: labelMatch?.[1] || "", chords };
}

function transposeChord(value: string, semitones: number): string {
  const chord = parseChord(value.trim());
  if (!chord) {
    // A chart may group multiple chords and bar separators in one bracket.
    // Parse each token so labels, spacing, and chord qualities stay intact.
    return value.replace(/[^\s|]+/g, (token) => {
      const entry = parseChord(token);
      if (!entry) return token;
      return `${transposeNote(entry.root, semitones)}${entry.quality}${entry.bass ? `/${transposeNote(entry.bass, semitones)}` : ""}`;
    });
  }
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  return `${leading}${transposeNote(chord.root, semitones)}${chord.quality}${chord.bass ? `/${transposeNote(chord.bass, semitones)}` : ""}${trailing}`;
}

export function shiftKey(key: string, semitones: number): string {
  return transposeNote(key, semitones);
}

export function transposeChordPro(chordPro: string, fromKey: string, toKey: string): string {
  const from = normalizeKey(fromKey);
  const to = normalizeKey(toKey);
  const semitones = semitonesBetween(from, to);
  if (!from || !to || semitones === 0) return chordPro;

  return normalizeChordProText(chordPro)
    .split("\n").map((line) => {
      const progression = parseChordProgressionLine(line);
      return progression ? `${progression.label ? `${progression.label}: ` : ""}${transposeChord(progression.chords, semitones)}` : line;
    }).join("\n")
    .replace(/\[([^\]]+)\]/g, (_match, chord: string) => `[${transposeChord(chord, semitones)}]`)
    .replace(/\{(key|k):\s*([^}]+)\}/gi, (_match, keyName: string) => `{${keyName}: ${toKey}}`);
}
