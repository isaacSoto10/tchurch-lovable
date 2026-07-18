import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StudioLANCueCatalogStatus,
  StudioLANImageAssetStatus,
  StudioLANLocalBroadcastLowerThirdFeedback,
  StudioLANOperatorTimerFeedback,
  StudioLANRemoteFeedback,
  StudioLANStatus,
  StudioLANUpdate,
} from "@/lib/studioLANClient";

type BridgeCallbacks = {
  onStatus: (status: StudioLANStatus) => void;
  onUpdate: (update: StudioLANUpdate) => void;
  onImageAsset: (status: StudioLANImageAssetStatus) => void;
  onRemoteFeedback?: (feedback: StudioLANRemoteFeedback) => void;
  onOperatorTimerFeedback?: (feedback: StudioLANOperatorTimerFeedback) => void;
  onLocalBroadcastLowerThirdFeedback?: (feedback: StudioLANLocalBroadcastLowerThirdFeedback) => void;
  onCueCatalog?: (status: StudioLANCueCatalogStatus) => void;
};

const mocks = vi.hoisted(() => ({
  callbacks: null as BridgeCallbacks | null,
  cleanup: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  forget: vi.fn(),
  refresh: vi.fn(),
  reapproval: vi.fn(),
  sendLowerThird: vi.fn(),
}));

vi.mock("@/lib/studioLANClient", () => ({
  isStudioLANSupported: () => true,
  connectStudioLANBridge: vi.fn(async (callbacks: BridgeCallbacks) => {
    mocks.callbacks = callbacks;
    return { disconnect: mocks.cleanup };
  }),
  connectToStudioLAN: mocks.connect,
  disconnectFromStudioLAN: mocks.disconnect,
  forgetStudioLANPairing: mocks.forget,
  refreshStudioLANDiscovery: mocks.refresh,
  requestStudioLANDeviceReapproval: mocks.reapproval,
  sendStudioLANRemoteCommand: vi.fn(),
  sendStudioLANOperatorTimerCommand: vi.fn(),
  sendStudioLANLocalBroadcastLowerThirdCommand: mocks.sendLowerThird,
}));

import { useStudioLANClient } from "./useStudioLANClient";

const serviceId = "a".repeat(32);
const connectedStatus: StudioLANStatus = {
  supported: true,
  phase: "connected",
  services: [{ id: serviceId, name: "Tchurch Studio", protocolFloor: 1 }],
  selectedServiceId: serviceId,
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
  operatorTimerControlAvailable: false,
  operatorTimerCommandInFlight: false,
  localBroadcastLowerThirdControlAvailable: false,
  localBroadcastLowerThirdCommandInFlight: false,
};

const update: StudioLANUpdate = {
  channel: "stage",
  payloadVersion: 1,
  sequence: "12",
  revision: "8",
  issuedAtMs: 1_753_000_000_000,
  receivedAtMs: 1_753_000_000_000,
  authority: {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authorityEpoch: "7",
    packageId: "package",
    serviceVersion: "v1",
  },
  audience: {
    currentCueId: "cue-1",
    currentCueIndex: 0,
    cueCount: 1,
    isBlackout: false,
    countdown: null,
    cue: {
      cueId: "cue-1",
      title: "Verso",
      lines: ["Gracia sobre gracia"],
      mediaAssetId: null,
      imageAsset: null,
    },
  },
  stage: { nextCue: null, chordLines: [], currentChordSlide: null, timers: [], message: null },
  control: null,
};

const imageAsset: StudioLANImageAssetStatus = {
  cueId: "cue-1",
  objectId: `sha256:${"b".repeat(64)}`,
  phase: "ready",
  receivedBytes: "1024",
  totalBytes: "1024",
  imageFit: "cover",
  localUrl: "capacitor://localhost/_capacitor_file_/private/cache/image.png",
  message: null,
};

describe("useStudioLANClient transport lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callbacks = null;
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.forget.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(undefined);
    mocks.reapproval.mockResolvedValue({
      accepted: true,
      deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    mocks.sendLowerThird.mockResolvedValue({
      accepted: true,
      commandId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
    });
  });

  it("clears private show state across reconnect, suspension, and terminal failures", async () => {
    const view = renderHook(() => useStudioLANClient());
    await waitFor(() => expect(mocks.callbacks).not.toBeNull());

    act(() => mocks.callbacks?.onUpdate(update));
    expect(view.result.current.update).toBeNull();

    act(() => {
      mocks.callbacks?.onStatus(connectedStatus);
      mocks.callbacks?.onUpdate(update);
      mocks.callbacks?.onImageAsset(imageAsset);
      mocks.callbacks?.onOperatorTimerFeedback?.({
        commandId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
        kind: "operatorTimer",
        scope: "service",
        operation: "start",
        state: "queued",
        rejection: null,
        timerRevision: null,
        wasIdempotentReplay: false,
      });
      mocks.callbacks?.onLocalBroadcastLowerThirdFeedback?.({
        commandId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
        kind: "localBroadcastLowerThird",
        operation: "show",
        title: "Pastor Isaac Soto",
        subtitle: null,
        state: "queued",
        rejection: null,
        lowerThirdRevision: null,
        wasIdempotentReplay: false,
      });
    });
    expect(view.result.current.update).toEqual(update);
    expect(view.result.current.imageAsset).toEqual(imageAsset);
    expect(view.result.current.operatorTimerFeedback?.state).toBe("queued");
    expect(view.result.current.localBroadcastLowerThirdFeedback?.state).toBe("queued");

    act(() => mocks.callbacks?.onStatus({
      ...connectedStatus,
      phase: "reconnecting",
      message: "Se perdió la conexión LAN. Reintentando…",
    }));
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();
    expect(view.result.current.operatorTimerFeedback).toBeNull();
    expect(view.result.current.localBroadcastLowerThirdFeedback).toBeNull();

    act(() => mocks.callbacks?.onStatus({
      ...connectedStatus,
      phase: "suspended",
      message: "En espera: abre Tchurch para volver a conectar.",
    }));
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();

    act(() => {
      mocks.callbacks?.onUpdate(update);
      mocks.callbacks?.onImageAsset(imageAsset);
    });
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();

    act(() => mocks.callbacks?.onStatus({
      ...connectedStatus,
      phase: "failed",
      message: "Studio envió datos que no pudieron verificarse. La pantalla quedó cerrada por seguridad.",
    }));
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();

    act(() => {
      mocks.callbacks?.onStatus(connectedStatus);
      mocks.callbacks?.onUpdate({ ...update, sequence: "13", revision: "9" });
    });
    expect(view.result.current.update?.sequence).toBe("13");

    view.unmount();
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledOnce());
  });

  it("delegates the closed v7 lower-third action through its independent bridge lane", async () => {
    const view = renderHook(() => useStudioLANClient());
    await waitFor(() => expect(mocks.callbacks).not.toBeNull());

    const action = {
      kind: "localBroadcastLowerThird" as const,
      operation: "show" as const,
      title: "Pastor Isaac Soto",
    };
    await act(async () => view.result.current.sendLocalBroadcastLowerThirdCommand(action));
    expect(mocks.sendLowerThird).toHaveBeenCalledWith(action);
  });

  it("clears the visible frame at every manual connection boundary", async () => {
    const view = renderHook(() => useStudioLANClient());
    await waitFor(() => expect(mocks.callbacks).not.toBeNull());

    const publishFrame = () => act(() => {
      mocks.callbacks?.onStatus(connectedStatus);
      mocks.callbacks?.onUpdate(update);
      mocks.callbacks?.onImageAsset(imageAsset);
    });

    publishFrame();
    await act(async () => view.result.current.connect(serviceId, "stage", "tchurch-studio:pairing"));
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();

    publishFrame();
    await act(async () => view.result.current.disconnect());
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();

    publishFrame();
    await act(async () => view.result.current.forget(serviceId));
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();
  });

  it("purges the visible frame immediately when v4 trust becomes pending or revoked", async () => {
    const view = renderHook(() => useStudioLANClient());
    await waitFor(() => expect(mocks.callbacks).not.toBeNull());

    act(() => {
      mocks.callbacks?.onStatus(connectedStatus);
      mocks.callbacks?.onUpdate(update);
      mocks.callbacks?.onImageAsset(imageAsset);
    });
    expect(view.result.current.update).toEqual(update);

    act(() => mocks.callbacks?.onStatus({
      ...connectedStatus,
      phase: "authenticating",
      enrollmentState: "pending",
      protocolFloor: 4,
      role: null,
    }));
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();

    act(() => {
      mocks.callbacks?.onStatus(connectedStatus);
      mocks.callbacks?.onUpdate(update);
    });
    act(() => mocks.callbacks?.onStatus({
      ...connectedStatus,
      phase: "failed",
      enrollmentState: "revoked",
      protocolFloor: 4,
      role: "musicians",
      permissions: ["observe"],
      permissionRevision: "2",
      revocationGeneration: "1",
      studioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      message: "Este dispositivo fue revocado en Tchurch Studio.",
    }));
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();

    await act(async () => view.result.current.requestReapproval());
    expect(mocks.reapproval).toHaveBeenCalledOnce();
    expect(view.result.current.update).toBeNull();
    expect(view.result.current.imageAsset).toBeNull();
  });
});
