import { describe, expect, it } from "vitest";
import { chordProToDisplayLines } from "./songDisplay";
import { normalizeChordProText } from "./chordProText";

describe("complete imported ChordPro charts", () => {
  it("keeps every line by default, while allowing explicit preview limits", () => {
    const song = Array.from({ length: 160 }, (_, i) => `[C/G]Línea ${i + 1}`).join("\n");
    const lines = chordProToDisplayLines(song);
    expect(lines).toHaveLength(160);
    expect(lines.at(-1)).toEqual({ kind: "line", chords: "C/G", lyrics: "Línea 160" });
    expect(chordProToDisplayLines(song, 3)).toHaveLength(3);
  });
  it("repairs pasted Spanish mojibake and keeps inline cues above the words", () => {
    expect(normalizeChordProText("Jesús, Ã‰l nos guía — Ámame. Ã‚Â¡Amén!")).toBe("Jesús, Él nos guía — Ámame. ¡Amén!");
    expect(chordProToDisplayLines("[C/G]JesÃºs mi [<i>INTRO</i>]canciÃ³n")).toEqual([
      { kind: "line", chords: "C/G      INTRO", lyrics: "Jesús mi canción" },
    ]);
  });
  it("reads HTML imports and encoded newlines as text without executing markup", () => {
    expect(chordProToDisplayLines('<p>{verse}</p><div>[C/G]Gracia&nbsp;y <strong>paz</strong><br>[Am]Amén</div>')).toEqual([
      { kind: "section", label: "Verse" },
      { kind: "line", chords: "C/G", lyrics: "Gracia y paz" },
      { kind: "line", chords: "Am", lyrics: "Amén" },
      { kind: "blank" },
    ]);
    expect(normalizeChordProText('&#91;C/G&#93;Jesús&#10;[G]Rey<script>alert(1)</script>')).toBe('[C/G]Jesús\n[G]Rey');
  });
});
