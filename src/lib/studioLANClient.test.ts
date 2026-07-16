import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
  registerPlugin: () => ({}),
}));

import { normalizeStudioLANPairingQR, normalizeStudioLANStatus, normalizeStudioLANUpdate } from "./studioLANClient";

function validUpdate() {
  return {
    channel: "stage",
    payloadVersion: 1,
    sequence: "12",
    revision: "8",
    receivedAtMs: 1_700_000_000_000,
    authority: {
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authorityEpoch: "7",
      packageId: "sha256:package",
      serviceVersion: "2026-07-15T20:00:00.000Z",
    },
    audience: {
      currentCueId: "cue-1",
      currentCueIndex: 0,
      cueCount: 2,
      isBlackout: false,
      countdown: { id: "countdown", label: "Inicio", targetAtMs: 1_700_000_060_000 },
      cue: {
        cueId: "cue-1",
        title: "Verse",
        lines: ["Grace upon grace"],
        mediaAssetId: `sha256:${"a".repeat(64)}`,
      },
    },
    stage: {
      nextCue: { cueId: "cue-2", title: "Chorus", lines: ["Next"], mediaAssetId: null },
      chordLines: ["C  G  Am  F"],
      currentChordSlide: null,
      timers: [{ id: "service", label: "Servicio", mode: "countDown", anchorAtMs: 1_700_000_000_000, anchorValueMs: 5_000, durationMs: 60_000, isRunning: true }],
      message: "Puente dos veces",
    },
  };
}

describe("Studio LAN native bridge boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes only bounded discovery data and replaces unknown native diagnostics", () => {
    expect(normalizeStudioLANStatus({
      supported: true,
      phase: "connected",
      services: [{ id: "a".repeat(32), name: "Tchurch Studio" }, { id: "bad", name: "bad" }],
      selectedServiceId: "a".repeat(32),
      channel: "stage",
      paired: true,
      message: null,
    })).toEqual({
      supported: true,
      phase: "connected",
      services: [{ id: "a".repeat(32), name: "Tchurch Studio" }],
      selectedServiceId: "a".repeat(32),
      channel: "stage",
      paired: true,
      message: null,
    });

    const unsafe = normalizeStudioLANStatus({
      phase: "failed",
      services: [],
      message: "token=must-never-cross-the-bridge",
    });
    expect(unsafe.message).toBe("La conexión LAN no está disponible. Desconecta y vuelve a emparejar.");
    expect(unsafe.message).not.toContain("token=");
    expect(normalizeStudioLANStatus({ phase: "failed", services: [], message: "El emparejamiento cambió. Escanea el QR actual de Tchurch Studio." }).message)
      .toBe("El emparejamiento cambió. Escanea el QR actual de Tchurch Studio.");
  });

  it("accepts the sanitized stage shape and rejects control, malformed sequence, and invalid asset IDs", () => {
    expect(normalizeStudioLANUpdate(validUpdate())).toMatchObject({
      channel: "stage",
      sequence: "12",
      revision: "8",
      audience: { cue: { lines: ["Grace upon grace"] } },
      stage: { chordLines: ["C  G  Am  F"], message: "Puente dos veces" },
    });
    expect(normalizeStudioLANUpdate({ ...validUpdate(), channel: "control" })).toBeNull();
    expect(normalizeStudioLANUpdate({ ...validUpdate(), sequence: "0012" })).toBeNull();
    expect(normalizeStudioLANUpdate({
      ...validUpdate(),
      audience: {
        ...validUpdate().audience,
        cue: { ...validUpdate().audience.cue, mediaAssetId: "https://private.example/token" },
      },
    })).toBeNull();
  });

  it("accepts v2 chord offsets across Unicode and rejects split surrogates or cue mismatch", () => {
    const text = "Dios 🙌 es fiel";
    const v2 = {
      ...validUpdate(), payloadVersion: 2,
      audience: { ...validUpdate().audience, cue: { ...validUpdate().audience.cue, lines: [text] } },
      stage: {
        ...validUpdate().stage,
        chordLines: ["C   C/E   G"],
        currentChordSlide: { cueId: "cue-1", key: "C", lines: [{ text, chords: [
          { value: "C", offsetUtf16: 0 }, { value: "C/E", offsetUtf16: 0 }, { value: "G", offsetUtf16: 8 },
        ] }] },
      },
    };
    expect(normalizeStudioLANUpdate(v2)).toMatchObject({ payloadVersion: 2, stage: { currentChordSlide: { key: "C" } } });
    expect(normalizeStudioLANUpdate({ ...v2, stage: { ...v2.stage, currentChordSlide: { ...v2.stage.currentChordSlide, lines: [{ text, chords: [{ value: "G", offsetUtf16: 6 }] }] } } })).toBeNull();
    expect(normalizeStudioLANUpdate({ ...v2, stage: { ...v2.stage, currentChordSlide: { ...v2.stage.currentChordSlide, cueId: "cue-other" } } })).toBeNull();
    expect(normalizeStudioLANUpdate({ ...v2, stage: { ...v2.stage, chordLines: ["DIVERGES"] } })).toBeNull();
    expect(normalizeStudioLANUpdate({ ...v2, stage: { ...v2.stage, currentChordSlide: { ...v2.stage.currentChordSlide, key: "H" } } })).toBeNull();
    expect(normalizeStudioLANUpdate({ ...v2, stage: {
      ...v2.stage,
      chordLines: ["<script>"],
      currentChordSlide: { ...v2.stage.currentChordSlide, lines: [{ text, chords: [{ value: "<script>", offsetUtf16: 0 }] }] },
    } })).toBeNull();

    const thirteen = Array.from({ length: 13 }, () => ({ value: "C", offsetUtf16: 0 }));
    expect(normalizeStudioLANUpdate({ ...v2, stage: {
      ...v2.stage,
      chordLines: [thirteen.map((token) => token.value).join("   ")],
      currentChordSlide: { ...v2.stage.currentChordSlide, lines: [{ text, chords: thirteen }] },
    } })).toBeNull();

    const texts = Array.from({ length: 5 }, (_, index) => `Line ${index}`);
    const denseLines = texts.map((lineText, index) => ({
      text: lineText,
      chords: Array.from({ length: index === 4 ? 9 : 10 }, () => ({ value: "C", offsetUtf16: 0 })),
    }));
    expect(normalizeStudioLANUpdate({
      ...v2,
      audience: { ...v2.audience, cue: { ...v2.audience.cue, lines: texts } },
      stage: {
        ...v2.stage,
        chordLines: denseLines.map((line) => line.chords.map((token) => token.value).join("   ")),
        currentChordSlide: { cueId: "cue-1", key: "Sol", lines: denseLines },
      },
    })).toBeNull();

    expect(normalizeStudioLANUpdate({ ...v2, stage: {
      ...v2.stage,
      chordLines: [],
      currentChordSlide: null,
    } })).not.toBeNull();

    const exactLines = ["  verso  ", "", "final"];
    const exactV2 = {
      ...v2,
      audience: { ...v2.audience, cue: { ...v2.audience.cue, lines: exactLines } },
      stage: {
        ...v2.stage,
        chordLines: ["C", "G"],
        currentChordSlide: { cueId: "cue-1", key: "Sol", lines: [
          { text: exactLines[0], chords: [{ value: "C", offsetUtf16: 2 }] },
          { text: exactLines[1], chords: [] },
          { text: exactLines[2], chords: [{ value: "G", offsetUtf16: 0 }] },
        ] },
      },
    };
    expect(normalizeStudioLANUpdate(exactV2)).toMatchObject({
      audience: { cue: { lines: exactLines } },
      stage: { currentChordSlide: { lines: [
        { text: "  verso  ", chords: [{ value: "C", offsetUtf16: 2 }] },
        { text: "", chords: [] },
        { text: "final", chords: [{ value: "G", offsetUtf16: 0 }] },
      ] } },
    });
    expect(normalizeStudioLANUpdate({
      ...exactV2,
      payloadVersion: 1,
      stage: { ...exactV2.stage, currentChordSlide: null },
    })).toBeNull();
    expect(normalizeStudioLANUpdate({
      ...exactV2,
      payloadVersion: 1,
      audience: { ...exactV2.audience, cue: { ...exactV2.audience.cue, lines: ["  verso  ", "final"] } },
      stage: { ...exactV2.stage, chordLines: ["C", "G"], currentChordSlide: null },
    })).toBeNull();
    expect(normalizeStudioLANUpdate({
      ...exactV2,
      audience: { ...exactV2.audience, cue: { ...exactV2.audience.cue, lines: ["bad\u0000line"] } },
      stage: { ...exactV2.stage, currentChordSlide: {
        ...exactV2.stage.currentChordSlide,
        lines: [{ text: "bad\u0000line", chords: [{ value: "C", offsetUtf16: 0 }] }],
      }, chordLines: ["C"] },
    })).toBeNull();
  });

  it("accepts only bounded Studio pairing QR payloads", () => {
    const valid = `tchurch-studio:${"A".repeat(43)}`;
    expect(normalizeStudioLANPairingQR(`  ${valid}\n`)).toBe(valid);
    expect(normalizeStudioLANPairingQR(`TCHURCH-STUDIO:${"A".repeat(43)}`)).toBe(valid);
    expect(normalizeStudioLANPairingQR("https://example.com/not-studio")).toBeNull();
    expect(normalizeStudioLANPairingQR(`tchurch-studio:${"A".repeat(42)}`)).toBeNull();
    expect(normalizeStudioLANPairingQR(`tchurch-studio:${"A".repeat(43)}=`)).toBeNull();
  });
});
