import { describe, expect, it } from "vitest";
import { buildServicePresentationSlides, type PresentationService } from "./servicePresentation";

const PRESENTATION_WRAP_COLUMNS = 34;

function buildService(chordPro: string): PresentationService {
  return {
    id: "service-1",
    title: "Servicio",
    date: "2026-05-27T18:00:00.000Z",
    type: "service",
    notes: null,
    items: [
      {
        id: "item-1",
        title: "Al Rey",
        type: "song",
        position: 0,
        duration: null,
        details: {},
        song: {
          id: "song-1",
          title: "Al Rey",
          author: "Tchurch",
          key: "Bm",
          lyrics: chordPro,
        },
      },
    ],
  };
}

function getSongLines(chordPro: string) {
  const slides = buildServicePresentationSlides(buildService(chordPro));
  const songSlides = slides.filter((slide) => slide.kind === "song");

  return songSlides.flatMap((slide) => slide.lines).filter((line) => line.kind === "line");
}

describe("buildServicePresentationSlides", () => {
  it("wraps long mobile chord lines without exceeding the presentation column budget", () => {
    const lines = getSongLines(
      "[Bm]Originalmente comienza un [A]solo de batería y luego [G]entran los demás [F#]instrumentos.\n" +
      "[Bm]////Al Rey"
    );
    const wrappedLyricLines = lines.filter((line) => !line.lyrics.includes("////Al Rey"));

    expect(wrappedLyricLines.length).toBeGreaterThan(1);
    expect(wrappedLyricLines.length).toBeLessThanOrEqual(3);
    expect(wrappedLyricLines.every((line) => Math.max(line.chords.length, line.lyrics.length) <= PRESENTATION_WRAP_COLUMNS)).toBe(true);
  });

  it("keeps wrapped segments as readable phrases instead of producing tiny leftovers", () => {
    const lines = getSongLines("[Bm]Uno dos tres cuatro cinco seis siete ocho nueve diez once");

    expect(lines.length).toBe(2);
    expect(lines.every((line) => line.lyrics.trim().length >= 20)).toBe(true);
  });

  it("preserves chord alignment when a long line is wrapped", () => {
    const lines = getSongLines(
      "[Bm]Originalmente comienza un [A]solo de batería y luego [G]entran los demás [F#]instrumentos."
    );

    const chordTargets = [
      { chord: "Bm", lyric: "Originalmente" },
      { chord: "A", lyric: "solo" },
      { chord: "G", lyric: "entran" },
      { chord: "F#", lyric: "instrumentos" },
    ];

    for (const { chord, lyric } of chordTargets) {
      const line = lines.find((candidate) => candidate.chords.includes(chord));

      expect(line).toBeDefined();
      expect(line?.lyrics).toContain(lyric);
      expect(line!.chords.indexOf(chord)).toBeLessThanOrEqual(line!.lyrics.indexOf(lyric));
    }
  });
});
