import { describe, expect, it } from "vitest";
import { findChartLineSplitColumn, wrapChartLine } from "./chartLineWrap";
import { chordProToDisplayLines } from "./songDisplay";

const chart = "Cas[C]tillo [G/C]fuerte es [Am/C]nuestro [Em/C]Dios, es[F/C]pada y [C]arma[Dm7/C]du ------ [C]ra";

describe("paired chord/lyric wrapping", () => {
  it("preserves every whole chord and word at narrow and wide widths", () => {
    const line = chordProToDisplayLines(chart).find((line) => line.kind === "line");
    if (!line || line.kind !== "line") throw new Error("Expected a chart line");
    for (let budget = 8; budget <= 64; budget += 1) {
      const pieces: Array<{ chords: string; lyrics: string }> = [];
      const width = Math.max(line.chords.length, line.lyrics.length);
      for (let start = 0; start < width;) {
        const end = findChartLineSplitColumn(line, start, width, budget);
        expect(end).toBeGreaterThan(start);
        pieces.push({ chords: line.chords.slice(start, end), lyrics: line.lyrics.slice(start, end) });
        start = end;
      }
      expect(wrapChartLine(line, budget).flatMap((piece) => piece.chords.split(/\s+/).filter(Boolean))).toEqual(line.chords.split(/\s+/).filter(Boolean));
      expect(wrapChartLine(line, budget).flatMap((piece) => piece.lyrics.split(/\s+/).filter(Boolean))).toEqual(line.lyrics.split(/\s+/).filter(Boolean));
      expect(pieces.flatMap((piece) => piece.chords.split(/\s+/).filter(Boolean))).toEqual(line.chords.split(/\s+/).filter(Boolean));
      expect(pieces.flatMap((piece) => piece.lyrics.split(/\s+/).filter(Boolean))).toEqual(line.lyrics.split(/\s+/).filter(Boolean));
    }
  });
  it("keeps an indivisible span wider than the budget rather than cutting a slash bass", () => {
    const line = { chords: "Em/C", lyrics: "Dios" };
    expect(findChartLineSplitColumn(line, 0, 4, 2)).toBe(4);
  });
});
