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

const CHORD_ROOT_PATTERN = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G](?:#|b)?)(?=$|m|maj|min|sus|add|dim|aug|[0-9/#b+\-\s])/i;

export function normalizeKey(key: string | null | undefined): string {
  if (!key) return "";
  const root = key.trim().match(/^([A-G][#b]?|Do|Re|Mi|Fa|Sol|La|Si)/i)?.[1] || key.trim();
  const spanishRoot = SPANISH_KEY_EQUIVALENTS[root.toLowerCase()];
  return FLAT_EQUIVALENTS[spanishRoot || root] || spanishRoot || root;
}

export function inferChordProKey(value: string | null | undefined): string {
  if (!value) return "";

  for (const match of value.matchAll(/\[([^\]]+)\]/g)) {
    const token = match[1]?.trim();
    if (!token || /^n\.?c\.?$/i.test(token)) continue;

    const root = token.match(CHORD_ROOT_PATTERN)?.[1];
    if (root) return root;
  }

  return value.match(/\{(?:key|k):\s*([^}]+)\}/i)?.[1]?.trim() || "";
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

function transposeChord(chord: string, semitones: number): string {
  return chord.replace(/[A-G][#b]?/g, (note) => transposeNote(note, semitones));
}

export function transposeChordPro(chordPro: string, fromKey: string, toKey: string): string {
  const from = normalizeKey(fromKey);
  const to = normalizeKey(toKey);
  const semitones = semitonesBetween(from, to);
  if (!from || !to || semitones === 0) return chordPro;

  return chordPro
    .replace(/\[([^\]]+)\]/g, (_match, chord: string) => `[${transposeChord(chord, semitones)}]`)
    .replace(/\{(key|k):\s*([^}]+)\}/gi, (_match, keyName: string) => `{${keyName}: ${toKey}}`);
}
