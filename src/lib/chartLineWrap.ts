type ChartLine = { chords: string; lyrics: string };

function isInsideToken(value: string, column: number) {
  const before = value[column - 1];
  const after = value[column];
  return Boolean(before && after && !/\s/.test(before) && !/\s/.test(after));
}

// Chords and words share columns. A wrap must preserve both tokens, including
// slash basses; an indivisible span can overflow and be scrolled horizontally.
export function findChartLineSplitColumn(line: ChartLine, start: number, width: number, maxColumns: number) {
  if (width - start <= maxColumns) return width;
  const target = Math.min(start + maxColumns, width);
  const safe = (column: number) => !isInsideToken(line.chords, column) && !isInsideToken(line.lyrics, column);
  for (let column = target; column > start; column -= 1) {
    if (safe(column)) return column;
  }
  for (let column = target + 1; column < width; column += 1) {
    if (safe(column)) return column;
  }
  return width;
}

export function wrapChartLine<T extends ChartLine>(line: T, maxColumns: number): T[] {
  const width = Math.max(line.chords.length, line.lyrics.length);
  const budget = Math.max(1, Math.floor(maxColumns));
  if (width <= budget) return [line];
  const rows: T[] = [];
  for (let start = 0; start < width;) {
    const end = findChartLineSplitColumn(line, start, width, budget);
    let chords = line.chords.slice(start, end).trimEnd();
    let lyrics = line.lyrics.slice(start, end).trimEnd();
    const chordStart = chords.search(/\S/);
    const lyricStart = lyrics.search(/\S/);
    const sharedStart = Math.min(chordStart < 0 ? Infinity : chordStart, lyricStart < 0 ? Infinity : lyricStart);
    if (Number.isFinite(sharedStart) && sharedStart > 0) {
      chords = chords.slice(sharedStart);
      lyrics = lyrics.slice(sharedStart);
    }
    if (chords.trim() || lyrics.trim()) rows.push({ ...line, chords, lyrics });
    start = end;
  }
  return rows.length ? rows : [line];
}
