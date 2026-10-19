import { describe, expect, it } from "vitest";
import { inferChordProKey, normalizeKey, shiftKey, transposeChordPro } from "./musicUtils";

describe("ChordPro transposition", () => {
  it("transposes the root and slash bass by the same interval", () => {
    expect(transposeChordPro("[C/G]Gloria [Am/E]hoy [Fmaj7/A]", "C", "D")).toBe("[D/A]Gloria [Bm/F#]hoy [Gmaj7/B]");
    expect(transposeChordPro("[D/A]", "D", "C")).toBe("[C/G]");
  });
  it("handles Spanish, lowercase and Unicode accidentals without changing qualities or labels", () => {
    expect(transposeChordPro("[Do/Sol] [c/g] [Re♭maj7/La♭] [Cadd9] [C6/9] [Coro] [N.C.]", "Do", "Re")).toBe("[D/A] [D/A] [D#maj7/A#] [Dadd9] [D6/9] [Coro] [N.C.]");
    expect(normalizeKey("Do")).toBe("C");
    expect(normalizeKey("re♭ menor")).toBe("C#");
    expect(normalizeKey("bb")).toBe("A#");
  });
  it("transposes every chord in a bracketed bar without damaging inline cues", () => {
    expect(transposeChordPro("[C        | F        | Am        | Asus    A] [<i>INTRO</i>]", "C", "D")).toBe("[D        | G        | Bm        | Bsus    B] [INTRO]");
  });
  it("transposes labelled and chord-only progressions while preserving ordinary Spanish prose", () => {
    expect(transposeChordPro("INTRO: C | F | Am | G\nC/G F Am\nA ti mi Dios\n[C]Mi voz", "C", "D")).toBe("INTRO: D | G | Bm | A\nD/A G Bm\nA ti mi Dios\n[D]Mi voz");
  });
  it("moves by semitones across enharmonic choices", () => {
    expect(shiftKey("C#", 1)).toBe("D");
    expect(shiftKey("Db", 1)).toBe("D");
    expect(shiftKey("C", -1)).toBe("B");
  });
  it("prefers an explicit key directive over the first chord", () => {
    expect(inferChordProKey("{key: Do}\n[Am]Inicio")).toBe("C");
    expect(inferChordProKey("[C | F | Am]")).toBe("C");
    expect(inferChordProKey("INTRO: D | G | Bm")).toBe("D");
    expect(inferChordProKey("[Verse]\n[sol♭/re♭]Inicio")).toBe("F#");
  });
});
