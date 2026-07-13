import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationLiveSnapshot, PresentationPrivateLiveView } from "@/lib/presentationLive";

const rehearsalMocks = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  sendCommand: vi.fn(),
}));

vi.mock("@/lib/presentationLive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentationLive")>("@/lib/presentationLive");
  return {
    ...actual,
    fetchPresentationRehearsalSnapshot: rehearsalMocks.fetchSnapshot,
    sendPresentationRehearsalCommand: rehearsalMocks.sendCommand,
  };
});

import { usePresentationRehearsal } from "./usePresentationRehearsal";
import { PRESENTATION_HEARTBEAT_MS, bindPresentationMediaCommand } from "@/lib/presentationLive";

function snapshot(viewerVersion: string, controllerVersion: string): PresentationLiveSnapshot {
  return {
    schemaVersion: 2,
    serviceId: "service-1",
    serviceVersion: "service-v1",
    viewerVersion,
    controllerVersion,
    serverNow: "2026-07-13T14:00:00.000Z",
    receivedAtMs: Date.parse("2026-07-13T14:00:00.000Z"),
    viewer: {
      view: "operator",
      roles: ["operator"],
      canEdit: true,
      canStart: true,
      canControl: true,
      canForceTakeover: true,
    },
    viewerLayout: null,
    session: {
      id: "rehearsal-session",
      mode: "rehearsal",
      status: "live",
      revision: 7,
      startedAt: "2026-07-13T13:30:00.000Z",
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

describe("usePresentationRehearsal conditional polling", () => {
  beforeEach(() => {
    localStorage.clear();
    rehearsalMocks.fetchSnapshot.mockReset();
    rehearsalMocks.sendCommand.mockReset();
  });

  it("sends both opaque versions on a quiet-revision refresh", async () => {
    const initial = snapshot("viewer-v1", "controller-v1");
    const controllerChanged = snapshot("viewer-v1", "controller-v2");
    rehearsalMocks.fetchSnapshot.mockImplementation((
      _serviceId: string,
      _view: PresentationPrivateLiveView,
      _clientId: string,
      sinceRevision?: number,
    ) => Promise.resolve(sinceRevision === undefined ? initial : controllerChanged));

    const { result, unmount } = renderHook(() => usePresentationRehearsal({
      serviceId: "service-1",
      preferredView: "operator",
      churchId: "church-1",
      accountId: "account-1",
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.refresh(); });

    expect(rehearsalMocks.fetchSnapshot).toHaveBeenLastCalledWith(
      "service-1",
      "operator",
      expect.any(String),
      7,
      "viewer-v1",
      "controller-v1",
    );
    expect(result.current.snapshot?.viewerVersion).toBe("viewer-v1");
    expect(result.current.snapshot?.controllerVersion).toBe("controller-v2");
    unmount();
  });

  it("does not let a poll started before a command overwrite its newer ACK", async () => {
    const initial = snapshot("viewer-v1", "controller-v1");
    const stalePoll = snapshot("viewer-stale", "controller-stale");
    const acknowledged = snapshot("viewer-v2", "controller-v2");
    acknowledged.session = {
      ...acknowledged.session!,
      revision: 8,
      display: { ...acknowledged.session!.display, blackout: true },
    };
    let resolvePoll: (value: PresentationLiveSnapshot) => void = () => undefined;
    const deferredPoll = new Promise<PresentationLiveSnapshot>((resolve) => { resolvePoll = resolve; });
    rehearsalMocks.fetchSnapshot.mockImplementation((
      _serviceId: string,
      _view: PresentationPrivateLiveView,
      _clientId: string,
      sinceRevision?: number,
    ) => sinceRevision === undefined ? Promise.resolve(initial) : deferredPoll);
    rehearsalMocks.sendCommand.mockResolvedValue(acknowledged);

    const { result, unmount } = renderHook(() => usePresentationRehearsal({
      serviceId: "service-1",
      preferredView: "operator",
      churchId: "church-1",
      accountId: "account-1",
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const refreshPromise = result.current.refresh();
    await waitFor(() => expect(rehearsalMocks.fetchSnapshot).toHaveBeenCalledTimes(2));
    await act(async () => {
      await result.current.sendCommand("set_blackout", { blackout: true });
    });
    await act(async () => {
      resolvePoll(stalePoll);
      await refreshPromise;
    });

    expect(result.current.snapshot?.session?.revision).toBe(8);
    expect(result.current.snapshot?.session?.display.blackout).toBe(true);
    expect(result.current.snapshot?.viewerVersion).toBe("viewer-v2");
    unmount();
  });

  it.each([
    ["11111111-1111-4111-8111-111111111111", true],
    ["22222222-2222-4222-8222-222222222222", false],
  ] as const)("schedules rehearsal heartbeats only for the exact local controller client (%s)", async (controllerClientId, expectedHeartbeat) => {
    const localClientId = "11111111-1111-4111-8111-111111111111";
    localStorage.setItem("tchurch_live_installation_client_id", localClientId);
    const controlled = snapshot("viewer-v1", "controller-v1");
    controlled.session!.controller = {
      clientId: controllerClientId,
      displayName: controllerClientId === localClientId ? "Este iPad" : "Otro iPad",
      leaseExpiresAt: "2099-07-13T14:01:00.000Z",
      ownedByViewer: true,
    };
    rehearsalMocks.fetchSnapshot.mockResolvedValue(controlled);
    const intervalSpy = vi.spyOn(window, "setInterval");
    const { result, unmount } = renderHook(() => usePresentationRehearsal({
      serviceId: "service-1",
      preferredView: "operator",
      churchId: "church-1",
      accountId: "account-1",
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
        expect(rehearsalMocks.sendCommand).toHaveBeenCalled();
      } else {
        expect(rehearsalMocks.sendCommand).not.toHaveBeenCalled();
      }
    } finally {
      unmount();
      intervalSpy.mockRestore();
    }
  });

  it("rejects a rehearsal media ACK from another session without accepting or retrying it", async () => {
    const initial = snapshot("viewer-v1", "controller-v1");
    initial.session = {
      ...initial.session!,
      id: "rehearsal-session-a",
      cursor: { itemId: "video-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
    };
    const late = snapshot("viewer-v1", "controller-v1");
    late.session = {
      ...late.session!,
      id: "rehearsal-session-b",
      cursor: { itemId: "video-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
      playback: { itemId: "video-item", slideId: "video-item:video:0", kind: "video", status: "playing", positionMs: 0, startedAt: "2026-07-13T14:00:00.000Z", rate: 1, loop: false },
    };
    rehearsalMocks.fetchSnapshot.mockResolvedValue(initial);
    rehearsalMocks.sendCommand.mockResolvedValue(late);

    const { result, unmount } = renderHook(() => usePresentationRehearsal({
      serviceId: "service-1",
      preferredView: "operator",
      churchId: "church-1",
      accountId: "account-1",
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
        sessionId: "rehearsal-session-a",
        itemId: "video-item",
        slideId: "video-item:video:0",
        kind: "video",
        positionMs: 0,
        loop: false,
      }, { expectedRevision: 7, mediaBinding: binding! })).rejects.toThrow(/otra sesión/);
    });

    expect(rehearsalMocks.sendCommand).toHaveBeenCalledOnce();
    expect(result.current.snapshot?.session?.id).toBe("rehearsal-session-a");
    expect(result.current.snapshot?.session?.playback).toBeNull();
    unmount();
  });
});
