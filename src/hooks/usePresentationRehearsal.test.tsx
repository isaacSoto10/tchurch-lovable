import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationLiveSnapshot, PresentationPrivateLiveView } from "@/lib/presentationLive";

const rehearsalMocks = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
}));

vi.mock("@/lib/presentationLive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentationLive")>("@/lib/presentationLive");
  return {
    ...actual,
    fetchPresentationRehearsalSnapshot: rehearsalMocks.fetchSnapshot,
  };
});

import { usePresentationRehearsal } from "./usePresentationRehearsal";

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
});
