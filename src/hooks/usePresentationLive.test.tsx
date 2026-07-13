import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CachedPresentationPackage,
  PresentationLiveSnapshot,
  PresentationPackage,
  PresentationPrivateLiveView,
} from "@/lib/presentationLive";

const liveMocks = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  fetchPackage: vi.fn(),
  savePackage: vi.fn(),
  sendCommand: vi.fn(),
}));

vi.mock("@/lib/presentationLive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentationLive")>("@/lib/presentationLive");
  return {
    ...actual,
    fetchPresentationLiveSnapshot: liveMocks.fetchSnapshot,
    fetchPresentationPackage: liveMocks.fetchPackage,
    savePresentationPackage: liveMocks.savePackage,
    sendPresentationCommand: liveMocks.sendCommand,
  };
});

import { usePresentationLive } from "./usePresentationLive";
import { PRESENTATION_HEARTBEAT_MS, bindPresentationMediaCommand } from "@/lib/presentationLive";

function snapshot(
  serviceId: string,
  viewerVersion: string,
  revision = 1,
  controllerVersion = `${serviceId}-controller-v1`,
): PresentationLiveSnapshot {
  return {
    schemaVersion: 2,
    serviceId,
    serviceVersion: `${serviceId}-v1`,
    viewerVersion,
    controllerVersion,
    serverNow: "2026-07-11T19:00:00.000Z",
    receivedAtMs: Date.parse("2026-07-11T19:00:00.000Z"),
    viewer: {
      view: "operator",
      roles: ["all"],
      canEdit: true,
      canStart: true,
      canControl: true,
      canForceTakeover: true,
    },
    viewerLayout: null,
    session: {
      id: `${serviceId}-session`,
      mode: "live",
      status: "live",
      revision,
      startedAt: "2026-07-11T18:30:00.000Z",
      endedAt: null,
      controller: null,
      presence: [],
      cursor: { itemId: null, itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
      display: { blackout: false, chordsVisible: true, broadcastVisible: true },
      playback: null,
      timing: {
        service: { status: "paused", plannedSeconds: 0, elapsedSeconds: 0, remainingSeconds: 0, overrunSeconds: 0, projectedEndAt: null, startedAt: null, pausedAt: null, accumulatedPausedMs: 0 },
        item: { itemId: null, status: "paused", plannedSeconds: 0, elapsedSeconds: 0, overrunSeconds: 0, startedAt: null, pausedAt: null, accumulatedPausedMs: 0 },
        countdown: null,
      },
      messages: [],
      lastCommand: null,
    },
  };
}

function presentationPackage(serviceId: string, accountId: string, churchId: string): PresentationPackage {
  return {
    schemaVersion: 2,
    packageId: `sha256:${"a".repeat(64)}`,
    checksum: `sha256:${"a".repeat(64)}`,
    generatedAt: "2026-07-11T19:00:00.000Z",
    scope: { accountId, churchId, view: "operator", roleFingerprint: "all" },
    serviceVersion: `${serviceId}-v1`,
    service: { id: serviceId, title: serviceId, date: "2026-07-11T19:00:00.000Z", type: "service", notes: null, items: [] },
    presentation: {
      schemaVersion: 1,
      serviceId,
      serviceVersion: `${serviceId}-v1`,
      viewer: { view: "operator", churchRole: "ADMIN", roles: ["all"], canEdit: true },
      items: [],
      legacyNotes: [],
      source: "api",
    },
    plannedTiming: { serviceSeconds: 0, itemSecondsById: {} },
    liveSeed: {
      cursor: { itemId: null, itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
      display: { blackout: false, chordsVisible: true, broadcastVisible: true },
      timing: snapshot(serviceId, "seed").session!.timing,
      countdown: null,
    },
  };
}

function mockPackageSave() {
  liveMocks.savePackage.mockImplementation(async (scope, value): Promise<CachedPresentationPackage> => ({
    key: `${scope.accountId}:${scope.churchId}:${scope.serviceId}:${scope.view}:${[...scope.roles].sort().join(",")}`,
    accountId: scope.accountId,
    churchId: scope.churchId,
    serviceId: scope.serviceId,
    view: scope.view,
    roleFingerprint: [...scope.roles].sort().join(","),
    savedAt: "2026-07-11T19:00:00.000Z",
    package: value,
  }));
}

describe("usePresentationLive authority generation", () => {
  beforeEach(() => {
    localStorage.clear();
    liveMocks.fetchSnapshot.mockReset();
    liveMocks.fetchPackage.mockReset();
    liveMocks.savePackage.mockReset();
    liveMocks.sendCommand.mockReset();
  });

  it("ignores a deferred old-service poll after account/church/service scope changes", async () => {
    let resolveOldPoll: (value: PresentationLiveSnapshot) => void = () => undefined;
    const oldPoll = new Promise<PresentationLiveSnapshot>((resolve) => { resolveOldPoll = resolve; });
    liveMocks.fetchSnapshot.mockImplementation((serviceId: string, _view: PresentationPrivateLiveView, _clientId: string, sinceRevision?: number) => {
      if (serviceId === "service-old" && sinceRevision !== undefined) return oldPoll;
      return Promise.resolve(snapshot(serviceId, serviceId === "service-old" ? "viewer-old" : "viewer-new"));
    });
    liveMocks.fetchPackage.mockImplementation((serviceId: string) => Promise.resolve(
      serviceId === "service-old"
        ? presentationPackage(serviceId, "account-old", "church-old")
        : presentationPackage(serviceId, "account-new", "church-new"),
    ));
    mockPackageSave();
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result, rerender } = renderHook(
      (props: { serviceId: string; accountId: string; churchId: string }) => usePresentationLive({
        ...props,
        preferredView: "operator",
        offlineContext,
      }),
      { initialProps: { serviceId: "service-old", accountId: "account-old", churchId: "church-old" } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshot?.serviceId).toBe("service-old");
    const deferredRefresh = result.current.refresh(false);
    await act(async () => {
      rerender({ serviceId: "service-new", accountId: "account-new", churchId: "church-new" });
    });
    await waitFor(() => expect(result.current.snapshot?.serviceId).toBe("service-new"));

    await act(async () => {
      resolveOldPoll(snapshot("service-old", "viewer-old-late", 99));
      await deferredRefresh;
    });

    expect(result.current.snapshot?.serviceId).toBe("service-new");
    expect(result.current.snapshot?.viewerVersion).toBe("viewer-new");
    expect(result.current.presentationPackage?.service.id).toBe("service-new");
  });

  it("drops an in-memory editor package before a downgraded replacement finishes", async () => {
    const initial = snapshot("service-1", "viewer-editor");
    const downgraded = snapshot("service-1", "viewer-band");
    downgraded.viewer = {
      view: "remote",
      roles: ["band"],
      canEdit: false,
      canStart: false,
      canControl: true,
      canForceTakeover: false,
    };
    const replacement = presentationPackage("service-1", "account-1", "church-1");
    replacement.scope = { ...replacement.scope, view: "remote", roleFingerprint: "band" };
    replacement.presentation = {
      ...replacement.presentation,
      viewer: { view: "stage", churchRole: "MEMBER", roles: ["band"], canEdit: false },
    };
    let resolveReplacement: (value: PresentationPackage) => void = () => undefined;
    const replacementRequest = new Promise<PresentationPackage>((resolve) => { resolveReplacement = resolve; });
    liveMocks.fetchSnapshot.mockImplementation((_serviceId: string, _view: PresentationPrivateLiveView, _clientId: string, sinceRevision?: number) => (
      Promise.resolve(sinceRevision === undefined ? initial : downgraded)
    ));
    liveMocks.fetchPackage.mockImplementation((_serviceId: string, view: PresentationPrivateLiveView) => (
      view === "remote" ? replacementRequest : Promise.resolve(presentationPackage("service-1", "account-1", "church-1"))
    ));
    mockPackageSave();
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result } = renderHook(() => usePresentationLive({
      serviceId: "service-1",
      accountId: "account-1",
      churchId: "church-1",
      preferredView: "operator",
      offlineContext,
    }));

    await waitFor(() => expect(result.current.presentationPackage?.scope.view).toBe("operator"));
    await act(async () => { await result.current.refresh(false); });

    expect(liveMocks.fetchSnapshot).toHaveBeenLastCalledWith(
      "service-1",
      "operator",
      expect.any(String),
      1,
      "viewer-editor",
      "service-1-controller-v1",
    );

    expect(result.current.snapshot?.viewer.view).toBe("remote");
    if (result.current.snapshot?.viewer.view !== "audience") {
      expect(result.current.snapshot?.viewer.roles).toEqual(["band"]);
    }
    expect(result.current.presentationPackage).toBeNull();

    await act(async () => { resolveReplacement(replacement); });
    await waitFor(() => expect(result.current.presentationPackage?.scope.view).toBe("remote"));
  });

  it("keeps the verified package visible for a viewerVersion-only refresh", async () => {
    const initial = snapshot("service-1", "viewer-v1", 1, "controller-v1");
    const versionOnly = snapshot("service-1", "viewer-v2", 1, "controller-v1");
    liveMocks.fetchSnapshot.mockImplementation((_serviceId: string, _view: PresentationPrivateLiveView, _clientId: string, sinceRevision?: number) => (
      Promise.resolve(sinceRevision === undefined ? initial : versionOnly)
    ));
    liveMocks.fetchPackage.mockResolvedValue(presentationPackage("service-1", "account-1", "church-1"));
    mockPackageSave();
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result } = renderHook(() => usePresentationLive({
      serviceId: "service-1",
      accountId: "account-1",
      churchId: "church-1",
      preferredView: "operator",
      offlineContext,
    }));

    await waitFor(() => expect(result.current.presentationPackage).not.toBeNull());
    const verifiedPackage = result.current.presentationPackage;
    await act(async () => { await result.current.refresh(false); });

    expect(result.current.snapshot?.viewerVersion).toBe("viewer-v2");
    expect(result.current.snapshot?.controllerVersion).toBe("controller-v1");
    expect(result.current.presentationPackage).toBe(verifiedPackage);
    expect(liveMocks.fetchPackage).toHaveBeenCalledTimes(1);
    expect(liveMocks.fetchSnapshot).toHaveBeenLastCalledWith(
      "service-1",
      "operator",
      expect.any(String),
      1,
      "viewer-v1",
      "controller-v1",
    );
  });

  it("accepts a controllerVersion-only refresh without changing viewer permissions", async () => {
    const initial = snapshot("service-1", "viewer-v1", 1, "controller-v1");
    const controllerOnly = snapshot("service-1", "viewer-v1", 1, "controller-v2");
    liveMocks.fetchSnapshot.mockImplementation((_serviceId: string, _view: PresentationPrivateLiveView, _clientId: string, sinceRevision?: number) => (
      Promise.resolve(sinceRevision === undefined ? initial : controllerOnly)
    ));
    liveMocks.fetchPackage.mockResolvedValue(presentationPackage("service-1", "account-1", "church-1"));
    mockPackageSave();
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result } = renderHook(() => usePresentationLive({
      serviceId: "service-1",
      accountId: "account-1",
      churchId: "church-1",
      preferredView: "operator",
      offlineContext,
    }));

    await waitFor(() => expect(result.current.presentationPackage).not.toBeNull());
    const verifiedPackage = result.current.presentationPackage;
    await act(async () => { await result.current.refresh(false); });

    expect(result.current.snapshot?.viewerVersion).toBe("viewer-v1");
    expect(result.current.snapshot?.controllerVersion).toBe("controller-v2");
    expect(result.current.snapshot?.viewer).toEqual(initial.viewer);
    expect(result.current.presentationPackage).toBe(verifiedPackage);
    expect(liveMocks.fetchPackage).toHaveBeenCalledTimes(1);
  });

  it("keeps a controller active across a cached 204-style snapshot until the server revises it", async () => {
    const controlled = snapshot("service-1", "viewer-v1");
    controlled.receivedAtMs = Date.now() - 31_000;
    controlled.session!.controller = {
      clientId: "11111111-1111-4111-8111-111111111111",
      displayName: "Sanctuary Mac",
      leaseExpiresAt: new Date(controlled.receivedAtMs + 30_000).toISOString(),
      ownedByViewer: false,
    };
    liveMocks.fetchSnapshot.mockResolvedValue(controlled);
    liveMocks.fetchPackage.mockResolvedValue(presentationPackage("service-1", "account-1", "church-1"));
    mockPackageSave();
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result } = renderHook(() => usePresentationLive({
      serviceId: "service-1",
      accountId: "account-1",
      churchId: "church-1",
      preferredView: "operator",
      offlineContext,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Date.parse(controlled.session!.controller!.leaseExpiresAt)).toBeLessThan(Date.now());
    expect(result.current.controllerLeaseActive).toBe(true);
  });

  it.each([
    ["11111111-1111-4111-8111-111111111111", true],
    ["22222222-2222-4222-8222-222222222222", false],
  ] as const)("schedules heartbeats only for the exact local controller client (%s)", async (controllerClientId, expectedHeartbeat) => {
    const localClientId = "11111111-1111-4111-8111-111111111111";
    localStorage.setItem("tchurch_live_installation_client_id", localClientId);
    const controlled = snapshot("service-1", "viewer-v1");
    controlled.session!.controller = {
      clientId: controllerClientId,
      displayName: controllerClientId === localClientId ? "Este iPad" : "Otro iPad",
      leaseExpiresAt: "2099-07-11T19:01:00.000Z",
      ownedByViewer: true,
    };
    liveMocks.fetchSnapshot.mockResolvedValue(controlled);
    liveMocks.fetchPackage.mockResolvedValue(presentationPackage("service-1", "account-1", "church-1"));
    mockPackageSave();
    const intervalSpy = vi.spyOn(window, "setInterval");
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result, unmount } = renderHook(() => usePresentationLive({
      serviceId: "service-1",
      accountId: "account-1",
      churchId: "church-1",
      preferredView: "operator",
      offlineContext,
      maintainController: true,
    }));

    try {
      await waitFor(() => expect(result.current.loading).toBe(false));
      const heartbeat = intervalSpy.mock.calls.find(([, milliseconds]) => milliseconds === PRESENTATION_HEARTBEAT_MS);
      expect(Boolean(heartbeat)).toBe(expectedHeartbeat);
      if (heartbeat) {
        await act(async () => {
          (heartbeat[0] as () => void)();
          await Promise.resolve();
        });
        expect(liveMocks.sendCommand).toHaveBeenCalled();
      } else {
        expect(liveMocks.sendCommand).not.toHaveBeenCalled();
      }
    } finally {
      unmount();
      intervalSpy.mockRestore();
    }
  });

  it("rejects a late media ACK from session B with the same revision without accepting or retrying it", async () => {
    const initial = snapshot("service-1", "viewer-v1", 7);
    initial.session = {
      ...initial.session!,
      id: "session-a",
      cursor: { itemId: "video-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
    };
    const late = snapshot("service-1", "viewer-v1", 7);
    late.session = {
      ...late.session!,
      id: "session-b",
      cursor: { itemId: "video-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
      playback: { itemId: "video-item", slideId: "video-item:video:0", kind: "video", status: "playing", positionMs: 0, startedAt: "2026-07-11T19:00:00.000Z", rate: 1, loop: false },
    };
    liveMocks.fetchSnapshot.mockResolvedValue(initial);
    liveMocks.fetchPackage.mockResolvedValue(presentationPackage("service-1", "account-1", "church-1"));
    liveMocks.sendCommand.mockResolvedValue(late);
    mockPackageSave();
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result } = renderHook(() => usePresentationLive({
      serviceId: "service-1",
      accountId: "account-1",
      churchId: "church-1",
      preferredView: "operator",
      offlineContext,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const binding = bindPresentationMediaCommand({
      snapshot: result.current.snapshot,
      activeCursor: { itemId: "video-item", stepId: null, partIndex: 0 },
      itemId: "video-item",
      slideId: "video-item:video:0",
      kind: "video",
    });
    expect(binding).not.toBeNull();

    await act(async () => {
      await expect(result.current.sendCommand("media_play", {
        sessionId: "session-a",
        itemId: "video-item",
        slideId: "video-item:video:0",
        kind: "video",
        positionMs: 0,
        loop: false,
      }, { expectedRevision: 7, allowOffline: false, mediaBinding: binding! })).rejects.toThrow(/otra sesión/);
    });

    expect(liveMocks.sendCommand).toHaveBeenCalledOnce();
    expect(result.current.snapshot?.session?.id).toBe("session-a");
    expect(result.current.snapshot?.session?.playback).toBeNull();
  });

  it("rejects an exact media effect when its ACK keeps the expected revision without accepting or retrying it", async () => {
    const initial = snapshot("service-1", "viewer-v1", 7);
    initial.session = {
      ...initial.session!,
      id: "session-a",
      cursor: { itemId: "video-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
    };
    const sameRevision = snapshot("service-1", "viewer-v1", 7);
    sameRevision.session = {
      ...sameRevision.session!,
      id: "session-a",
      cursor: { itemId: "video-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
      playback: { itemId: "video-item", slideId: "video-item:video:0", kind: "video", status: "playing", positionMs: 0, startedAt: "2026-07-11T19:00:00.000Z", rate: 1, loop: false },
    };
    liveMocks.fetchSnapshot.mockResolvedValue(initial);
    liveMocks.fetchPackage.mockResolvedValue(presentationPackage("service-1", "account-1", "church-1"));
    liveMocks.sendCommand.mockResolvedValue(sameRevision);
    mockPackageSave();
    const offlineContext = { steps: [], plannedTiming: { serviceSeconds: 0, itemSecondsById: {} } };
    const { result } = renderHook(() => usePresentationLive({
      serviceId: "service-1",
      accountId: "account-1",
      churchId: "church-1",
      preferredView: "operator",
      offlineContext,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const binding = bindPresentationMediaCommand({
      snapshot: result.current.snapshot,
      activeCursor: { itemId: "video-item", stepId: null, partIndex: 0 },
      itemId: "video-item",
      slideId: "video-item:video:0",
      kind: "video",
    });
    expect(binding).not.toBeNull();

    await act(async () => {
      await expect(result.current.sendCommand("media_play", {
        sessionId: "session-a",
        itemId: "video-item",
        slideId: "video-item:video:0",
        kind: "video",
        positionMs: 0,
        loop: false,
      }, { expectedRevision: 7, allowOffline: false, mediaBinding: binding! })).rejects.toThrow(/no avanzó la revisión/);
    });

    expect(liveMocks.sendCommand).toHaveBeenCalledOnce();
    expect(result.current.snapshot?.session?.revision).toBe(7);
    expect(result.current.snapshot?.session?.playback).toBeNull();
  });
});
