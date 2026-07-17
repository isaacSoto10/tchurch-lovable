import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  synchronizePrivacyContext: vi.fn().mockResolvedValue({ accepted: true }),
  requestDeviceReapproval: vi.fn().mockResolvedValue({
    accepted: true,
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  }),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
  registerPlugin: () => nativeMocks,
}));

import {
  normalizeStudioLANImageAssetStatus,
  normalizeStudioLANPairingQR,
  normalizeStudioLANRemoteFeedback,
  normalizeStudioLANStatus,
  normalizeStudioLANUpdate,
  requestStudioLANDeviceReapproval,
  synchronizeStudioLANPrivacyContext,
} from "./studioLANClient";

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
      services: [{ id: "a".repeat(32), name: "Tchurch Studio", protocolFloor: 1 }],
      selectedServiceId: "a".repeat(32),
      channel: "stage",
      paired: true,
      message: null,
      enrollmentState: "unenrolled",
      protocolFloor: 1,
      role: null,
      permissions: [],
      permissionRevision: "0",
      revocationGeneration: "0",
      studioId: null,
      remoteControlAvailable: false,
      remoteCommandInFlight: false,
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
    expect(normalizeStudioLANStatus({
      phase: "reconnecting",
      services: [],
      message: "No se pudo usar el almacenamiento seguro. Conservamos los datos existentes y reintentaremos.",
    }).message).toBe("No se pudo usar el almacenamiento seguro. Conservamos los datos existentes y reintentaremos.");
    expect(normalizeStudioLANStatus({
      phase: "connected",
      services: [],
      message: "Conectado de forma segura, pero el emparejamiento no pudo guardarse. Si cierras la app, vuelve a escanear el QR.",
    }).message).toBe("Conectado de forma segura, pero el emparejamiento no pudo guardarse. Si cierras la app, vuelve a escanear el QR.");
    [
      "Studio respondió a una verificación LAN inválida. Cerramos ese transporte y reconectaremos.",
      "No se pudo verificar la conexión LAN. Reconectando…",
      "Studio dejó de responder en la red local. Reconectando…",
    ].forEach((message) => {
      expect(normalizeStudioLANStatus({ phase: "reconnecting", services: [], message }).message).toBe(message);
    });
  });

  it("accepts the sanitized stage shape and rejects incomplete control, malformed sequence, and invalid asset IDs", () => {
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

  it("accepts only a complete signed-control v4 projection and strict remote feedback", () => {
    const base = validUpdate();
    const control = {
      ...base,
      channel: "control",
      payloadVersion: 4,
      stage: { ...base.stage, chordLines: [] },
      control: {
        chordsVisible: true,
        lightingArmed: false,
        healthyOutputCount: 2,
        expectedOutputCount: 3,
        routeEpoch: "9",
        cueCatalog: [
          { cueId: "cue-1", title: "Verse" },
          { cueId: "cue-2", title: "Chorus" },
        ],
      },
    };
    expect(normalizeStudioLANUpdate(control)).toMatchObject({
      channel: "control",
      payloadVersion: 4,
      control: { routeEpoch: "9", cueCatalog: [{ cueId: "cue-1" }, { cueId: "cue-2" }] },
    });
    expect(normalizeStudioLANUpdate({ ...control, payloadVersion: 3 })).toBeNull();
    expect(normalizeStudioLANUpdate({ ...control, control: { ...control.control, routeEpoch: "0" } })).toBeNull();
    expect(normalizeStudioLANUpdate({
      ...control,
      control: { ...control.control, cueCatalog: [control.control.cueCatalog[0], control.control.cueCatalog[0]] },
    })).toBeNull();

    const accepted = {
      commandId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
      kind: "next",
      cueId: null,
      enabled: null,
      state: "accepted",
      rejection: null,
      revision: "42",
      wasIdempotentReplay: false,
    };
    expect(normalizeStudioLANRemoteFeedback(accepted)).toEqual(accepted);
    expect(normalizeStudioLANRemoteFeedback({ ...accepted, state: "rejected", rejection: "secretFailure" })).toBeNull();
    expect(normalizeStudioLANRemoteFeedback({ ...accepted, kind: "jump", cueId: null })).toBeNull();
  });

  it("normalizes v4 device trust and fails closed on non-canonical permissions", () => {
    const approved = normalizeStudioLANStatus({
      supported: true,
      phase: "connected",
      services: [{ id: "a".repeat(32), name: "Studio", protocolFloor: 4 }],
      selectedServiceId: "a".repeat(32),
      channel: "stage",
      paired: true,
      message: null,
      enrollmentState: "approved",
      protocolFloor: 4,
      role: "musicians",
      permissions: ["observe", "controlProgram"],
      permissionRevision: "9",
      revocationGeneration: "2",
      studioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      remoteControlAvailable: false,
      remoteCommandInFlight: false,
    });
    expect(approved).toMatchObject({
      phase: "connected",
      enrollmentState: "approved",
      protocolFloor: 4,
      role: "musicians",
      permissions: ["observe", "controlProgram"],
      permissionRevision: "9",
      revocationGeneration: "2",
    });
    const v4Update = validUpdate();
    expect(normalizeStudioLANUpdate({
      ...v4Update,
      payloadVersion: 4,
      stage: { ...v4Update.stage, chordLines: [] },
    })?.payloadVersion).toBe(4);

    expect(normalizeStudioLANStatus({
      ...approved,
      permissions: ["controlProgram", "observe"],
    }).phase).toBe("failed");
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

  it("accepts the exact v3 image descriptor and rejects it from legacy or mismatched cues", () => {
    const objectId = `sha256:${"b".repeat(64)}`;
    const descriptor = {
      schemaVersion: 1,
      referenceId: `sha256:${"a".repeat(64)}`,
      objectId,
      kind: "image",
      mimeType: "image/png",
      byteSize: "65537",
      required: true,
      imageFit: "cover",
    };
    const v3 = {
      ...validUpdate(),
      payloadVersion: 3,
      audience: {
        ...validUpdate().audience,
        cue: { ...validUpdate().audience.cue, mediaAssetId: objectId, imageAsset: descriptor },
      },
      stage: { ...validUpdate().stage, chordLines: [], currentChordSlide: null },
    };
    expect(normalizeStudioLANUpdate(v3)).toMatchObject({
      payloadVersion: 3,
      audience: { cue: { mediaAssetId: objectId, imageAsset: descriptor } },
    });
    expect(normalizeStudioLANUpdate({ ...v3, payloadVersion: 2 })).toBeNull();
    expect(normalizeStudioLANUpdate({
      ...v3,
      audience: {
        ...v3.audience,
        cue: { ...v3.audience.cue, mediaAssetId: `sha256:${"c".repeat(64)}` },
      },
    })).toBeNull();
    expect(normalizeStudioLANUpdate({
      ...v3,
      audience: {
        ...v3.audience,
        cue: { ...v3.audience.cue, imageAsset: { ...descriptor, byteSize: String(64 * 1_024 * 1_024 + 1) } },
      },
    })).toBeNull();
  });

  it("allows only verified portable local image URLs and bounded progress", () => {
    const objectId = `sha256:${"b".repeat(64)}`;
    const ready = {
      cueId: "cue-1",
      objectId,
      phase: "ready",
      receivedBytes: "65537",
      totalBytes: "65537",
      imageFit: "contain",
      localUrl: "capacitor://localhost/_capacitor_file_/private/cache/image.png",
      message: null,
    };
    expect(normalizeStudioLANImageAssetStatus(ready)).toEqual(ready);
    expect(normalizeStudioLANImageAssetStatus({ ...ready, localUrl: "file:///private/cache/image.png" })).toBeNull();
    expect(normalizeStudioLANImageAssetStatus({ ...ready, localUrl: "https://evil.example/image.png" })).toBeNull();
    expect(normalizeStudioLANImageAssetStatus({ ...ready, localUrl: `${ready.localUrl}?token=private` })).toBeNull();
    expect(normalizeStudioLANImageAssetStatus({ ...ready, receivedBytes: "65536" })).toBeNull();
    expect(normalizeStudioLANImageAssetStatus({
      ...ready,
      phase: "loading",
      receivedBytes: "32768",
      localUrl: null,
      message: "Descargando imagen offline…",
    })).toMatchObject({ phase: "loading", receivedBytes: "32768", localUrl: null });
    expect(normalizeStudioLANImageAssetStatus({
      ...ready,
      phase: "unavailable",
      receivedBytes: "0",
      localUrl: null,
      message: "token=must-not-cross",
    })).toBeNull();
  });

  it("forwards only bounded privacy contexts and keeps unknown auth non-destructive", async () => {
    await synchronizeStudioLANPrivacyContext({ access: "principal", principalId: "user-1" });
    await synchronizeStudioLANPrivacyContext({ access: "unknown" });
    await synchronizeStudioLANPrivacyContext({
      access: "authorized",
      principalId: "user-1",
      churchId: "church-1",
    });

    expect(nativeMocks.synchronizePrivacyContext).toHaveBeenNthCalledWith(1, {
      access: "principal",
      principalId: "user-1",
    });
    expect(nativeMocks.synchronizePrivacyContext).toHaveBeenNthCalledWith(2, { access: "unknown" });
    expect(nativeMocks.synchronizePrivacyContext).toHaveBeenNthCalledWith(3, {
      access: "authorized",
      principalId: "user-1",
      churchId: "church-1",
    });
    await expect(synchronizeStudioLANPrivacyContext({
      access: "authorized",
      principalId: "user\nunsafe",
      churchId: "church-1",
    })).rejects.toThrow("studio_lan_invalid_privacy_context");
    expect(nativeMocks.synchronizePrivacyContext).toHaveBeenCalledTimes(3);
  });

  it("accepts only a valid rotated device identity from the native boundary", async () => {
    await expect(requestStudioLANDeviceReapproval()).resolves.toEqual({
      accepted: true,
      deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    nativeMocks.requestDeviceReapproval.mockResolvedValueOnce({
      accepted: true,
      deviceId: "not-a-device-id",
    });
    await expect(requestStudioLANDeviceReapproval()).rejects.toThrow("studio_lan_reapproval_failed");
  });
});
