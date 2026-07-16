import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
  registerPlugin: () => ({}),
}));

import { normalizeStudioLANStatus, normalizeStudioLANUpdate } from "./studioLANClient";

function validUpdate() {
  return {
    channel: "stage",
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
});
