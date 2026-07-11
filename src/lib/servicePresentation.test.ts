import { describe, expect, it } from "vitest";
import { buildPresentationRunSteps, buildServicePresentationSlides, type PresentationService } from "./servicePresentation";
import { derivePresentationWorkspaceItem, type PresentationWorkspace } from "./presentationWorkspace";

const PRESENTATION_WRAP_COLUMNS = 34;
const TABLET_PRESENTATION_WRAP_COLUMNS = 64;

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

function makeLongSong(lineCount = 32) {
  return Array.from({ length: lineCount }, (_value, index) => {
    const chord = index % 2 === 0 ? "C" : "Am";
    return `[${chord}]Linea ${index + 1} con letra para llenar espacio y probar el modo de presentacion`;
  }).join("\n");
}

function estimateRenderedRows(slide: ReturnType<typeof buildServicePresentationSlides>[number]) {
  if (slide.kind !== "song") return 0;

  return slide.lines.reduce((rows, line) => {
    if (line.kind === "blank") return rows + 0.5;
    if (line.kind === "section" || line.kind === "meta") return rows + 0.85;

    const hasChords = Boolean(line.chords.trim());
    const hasLyrics = Boolean(line.lyrics.trim());
    if (hasChords && hasLyrics) return rows + 2.1;
    if (hasChords || hasLyrics) return rows + 1.1;
    return rows + 0.5;
  }, 0);
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

  it("keeps tablet songs as one scrollable slide with wider chart lines", () => {
    const slides = buildServicePresentationSlides(
      buildService(
        "[Bm]Originalmente comienza un [A]solo de batería y luego [G]entran los demás [F#]instrumentos.\n" +
        "[Bm]////Al Rey"
      ),
      { layout: "tablet" }
    );
    const songSlides = slides.filter((slide) => slide.kind === "song");
    const lines = songSlides.flatMap((slide) => slide.lines).filter((line) => line.kind === "line");

    expect(songSlides).toHaveLength(1);
    expect(songSlides[0]).toMatchObject({ part: 1, totalParts: 1 });
    expect(lines.some((line) => Math.max(line.chords.length, line.lyrics.length) > PRESENTATION_WRAP_COLUMNS)).toBe(true);
    expect(lines.every((line) => Math.max(line.chords.length, line.lyrics.length) <= TABLET_PRESENTATION_WRAP_COLUMNS)).toBe(true);
  });

  it("can render a full song as one scrollable phone slide", () => {
    const slides = buildServicePresentationSlides(buildService(makeLongSong()), {
      layout: "phone",
      songMode: "scroll",
    });
    const songSlides = slides.filter((slide) => slide.kind === "song");
    const lines = songSlides.flatMap((slide) => slide.lines).filter((line) => line.kind === "line");

    expect(songSlides).toHaveLength(1);
    expect(songSlides[0]).toMatchObject({ part: 1, totalParts: 1 });
    expect(lines.length).toBeGreaterThan(25);
    expect(lines.every((line) => Math.max(line.chords.length, line.lyrics.length) <= PRESENTATION_WRAP_COLUMNS)).toBe(true);
  });

  it("can split tablet songs into horizontal slides when requested", () => {
    const slides = buildServicePresentationSlides(buildService(makeLongSong(42)), {
      layout: "tablet",
      songMode: "paged",
    });
    const songSlides = slides.filter((slide) => slide.kind === "song");

    expect(songSlides.length).toBeGreaterThan(1);
    expect(songSlides.every((slide) => slide.totalParts === songSlides.length)).toBe(true);
  });

  it("uses stable song-wide columns across split slides so chord placement does not shift", () => {
    const slides = buildServicePresentationSlides(
      buildService(
        "[Bm]Originalmente comienza un [A]solo de batería y luego [G]entran los demás [F#]instrumentos.\n" +
        makeLongSong(34)
      ),
      { layout: "phone", songMode: "paged" }
    );
    const songSlides = slides.filter((slide) => slide.kind === "song");
    const maxColumns = songSlides[0]?.maxColumns;
    const perSlideColumns = songSlides.map((slide) => Math.max(
      18,
      ...slide.lines.map((line) => line.kind === "line" ? Math.max(line.chords.length, line.lyrics.length) : 0)
    ));

    expect(songSlides.length).toBeGreaterThan(1);
    expect(maxColumns).toBeGreaterThan(0);
    expect(songSlides.every((slide) => slide.maxColumns === maxColumns)).toBe(true);
    expect(perSlideColumns.some((columns) => columns < maxColumns!)).toBe(true);
  });

  it("keeps phone paged song slides compact enough for presentation controls", () => {
    const slides = buildServicePresentationSlides(
      buildService(
        "{start_of_section: Intro}\n" +
        "F# | F# | F# | F# (x2)\n" +
        "{start_of_section: Verso}\n" +
        "[F#]Digno es el Cordero\n" +
        "[C#m7]inmolado en la cruz\n" +
        "[E]Quien pago nuestra [B]redencion [F#]\n" +
        "[F#]El Verbo se hizo carne,\n" +
        "[C#m7]nuestra deuda cancelo\n" +
        "[E]Y propicio la ira [B]del Senor [F#]\n" +
        "{start_of_section: Pre-Coro}\n" +
        "[E]A la muerte derroto,\n" +
        "[B/D#]Su victoria reclamo"
      ),
      { layout: "phone", songMode: "paged" }
    );
    const songSlides = slides.filter((slide) => slide.kind === "song");

    expect(songSlides.length).toBeGreaterThan(1);
    expect(songSlides.every((slide) => estimateRenderedRows(slide) <= 15)).toBe(true);
    expect(songSlides[0].lines.some((line) => (line.kind === "section" || line.kind === "meta") && /pre-coro/i.test(line.label))).toBe(false);
  });

  it("runs a repeated service-specific section map as distinct operator steps", () => {
    const configuredService = buildService("{verse}\n[C]Verso\n{chorus}\n[F]Coro");
    const item = derivePresentationWorkspaceItem(configuredService.items[0]);
    const chorus = item.source.sections.find((section) => section.semanticKey === "chorus")!;
    item.sequence = [
      { id: "chorus-1", sectionAnchorId: chorus.anchorId, sourceFingerprint: chorus.fingerprint, label: "Coro", position: 0 },
      { id: "chorus-2", sectionAnchorId: chorus.anchorId, sourceFingerprint: chorus.fingerprint, label: "Coro · repetir", position: 1 },
    ];
    const workspace: PresentationWorkspace = {
      schemaVersion: 1,
      serviceId: configuredService.id,
      serviceVersion: "v1",
      viewer: { view: "operator", churchRole: "PLANNER", roles: ["operator"], canEdit: true },
      items: [item],
      legacyNotes: [],
      source: "api",
    };

    const slides = buildServicePresentationSlides(configuredService, { layout: "tablet", songMode: "scroll", workspace });
    const steps = buildPresentationRunSteps(slides, "scroll");

    expect(slides).toHaveLength(1);
    expect(steps.map((step) => step.sectionSequenceId)).toEqual(["chorus-1", "chorus-2"]);
    expect(steps.map((step) => step.sectionLabel)).toEqual(["Coro", "Coro · repetir"]);
  });

  it("renders the selected arrangement and transposes it to the service key", () => {
    const configuredService = buildService("[C]Arreglo original");
    configuredService.items[0].details = { serviceKey: "E" };
    configuredService.items[0].song!.arrangements = [
      { id: "arr-c", name: "Original", key: "C", lyrics: "[C]Arreglo original" },
      { id: "arr-d", name: "Domingo", key: "D", lyrics: "[D]Arreglo del domingo" },
    ];
    const item = derivePresentationWorkspaceItem(configuredService.items[0], "arr-d");
    const workspace: PresentationWorkspace = {
      schemaVersion: 1,
      serviceId: configuredService.id,
      serviceVersion: "v1",
      viewer: { view: "stage", churchRole: "MEMBER", roles: ["band"], canEdit: false },
      items: [item],
      legacyNotes: [],
      source: "api",
    };

    const songSlide = buildServicePresentationSlides(configuredService, { workspace })[0];
    expect(songSlide.kind).toBe("song");
    if (songSlide.kind !== "song") return;
    const musicLine = songSlide.lines.find((line) => line.kind === "line");
    expect(songSlide.arrangementId).toBe("arr-d");
    expect(songSlide.key).toBe("E");
    expect(musicLine).toMatchObject({ chords: "E", lyrics: "Arreglo del domingo" });
  });

  it("keeps an all-unresolved song recoverable without rendering uncertain lyrics", () => {
    const configuredService = buildService("{verse}\n[C]Verso\n{chorus}\n[F]Coro");
    const item = derivePresentationWorkspaceItem(configuredService.items[0]);
    item.reconciliation = {
      status: "needs_review",
      unresolvedAnnotationIds: [],
      unresolvedStepIds: item.sequence.map((entry) => entry.id),
    };
    const workspace: PresentationWorkspace = {
      schemaVersion: 1,
      serviceId: configuredService.id,
      serviceVersion: "v2",
      viewer: { view: "editor", churchRole: "PLANNER", roles: ["all"], canEdit: true },
      items: [item],
      legacyNotes: [],
      source: "api",
    };

    const slides = buildServicePresentationSlides(configuredService, { layout: "phone", songMode: "paged", workspace });
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ kind: "cue", itemId: "item-1", subtitle: "Revisión requerida" });
    expect(slides.filter((slide) => slide.kind === "song")).toEqual([]);
  });
});
