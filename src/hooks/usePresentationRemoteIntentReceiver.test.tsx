import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { clearPresentationRemoteIntentReceiverStorage } from "@/lib/presentationRemoteIntentReceiver";
import type { PresentationRemoteIntentReceiverCommandSender, PresentationRemoteIntentReceiverRequest } from "@/lib/presentationRemoteIntentReceiver";
import { usePresentationRemoteIntentReceiver } from "./usePresentationRemoteIntentReceiver";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const INTENT_ID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_ID = "55555555-5555-4555-8555-555555555555";
const CONTROLLER_AUTHORITY_VERSION = `sha256:${"a".repeat(64)}`;

function pending() {
  return {
    schemaVersion: 1,
    serviceId: "service-1",
    sessionId: SESSION_ID,
    serverNow: "2026-07-13T18:00:05.000Z",
    leaseExpiresAt: "2026-07-13T18:00:25.000Z",
    intents: [{
      id: INTENT_ID,
      deliveryId: DELIVERY_ID,
      type: "program_next",
      payload: {},
      createdAt: "2026-07-13T18:00:04.000Z",
      expiresAt: "2026-07-13T18:00:14.000Z",
    }],
  };
}

function authoritativeNextResult() {
  return {
    local: false,
    idempotent: true,
    snapshot: {
      serviceId: "service-1",
      session: {
        id: SESSION_ID,
        display: { blackout: false, chordsVisible: true },
        lastCommand: null,
      },
    },
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "account-1",
    churchId: "church-1",
    serviceId: "service-1",
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    controllerClientId: CLIENT_ID,
    viewerVersion: "viewer-v1",
    controllerAuthorityVersion: CONTROLLER_AUTHORITY_VERSION,
    controllerVersion: "controller-heartbeat-v1",
    mode: "live" as const,
    enabled: true,
    active: true,
    online: true,
    viewerCanControl: true,
    controllerOwned: true,
    controllerLeaseActive: true,
    sessionLive: true,
    currentRevision: 8,
    sendCommand: vi.fn(async () => authoritativeNextResult()) as unknown as PresentationRemoteIntentReceiverCommandSender,
    pollMs: 60_000,
    ...overrides,
  };
}

afterEach(() => {
  clearPresentationRemoteIntentReceiverStorage(window.localStorage);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePresentationRemoteIntentReceiver lifecycle", () => {
  it("never polls or applies while rehearsal is active", async () => {
    const request = vi.fn() as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = vi.fn() as unknown as PresentationRemoteIntentReceiverCommandSender;
    const view = renderHook(() => usePresentationRemoteIntentReceiver(options({
      mode: "rehearsal",
      active: false,
      request,
      sendCommand,
    })));
    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.available).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("does not poll as another controller client even when ownedByViewer is true", async () => {
    const request = vi.fn() as unknown as PresentationRemoteIntentReceiverRequest;
    const view = renderHook(() => usePresentationRemoteIntentReceiver(options({
      controllerClientId: OTHER_CLIENT_ID,
      controllerOwned: true,
      request,
    })));
    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.available).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps an in-flight pending poll alive across controllerVersion-only heartbeat updates", async () => {
    let resolvePending: (value: unknown) => void = () => undefined;
    let firstSignal: AbortSignal | null = null;
    const request = vi.fn(async (path: string, requestOptions: { signal: AbortSignal }) => {
      if (path.includes("/pending")) return new Promise<unknown>((resolve) => {
        firstSignal ||= requestOptions.signal;
        resolvePending = resolve;
      });
      return {
        schemaVersion: 1,
        serviceId: "service-1",
        sessionId: SESSION_ID,
        deliveryId: DELIVERY_ID,
        status: "applied",
        idempotent: false,
      };
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = vi.fn(async () => authoritativeNextResult()) as unknown as PresentationRemoteIntentReceiverCommandSender;
    const initial = options({ request, sendCommand });
    const view = renderHook((props) => usePresentationRemoteIntentReceiver(props), { initialProps: initial });
    await waitFor(() => expect(firstSignal).not.toBeNull());

    view.rerender(options({ request, sendCommand, controllerVersion: "controller-heartbeat-v2" }));
    expect(firstSignal!.aborted).toBe(false);
    await act(async () => { resolvePending(pending()); });
    await waitFor(() => expect(view.result.current.lastResult.phase).toBe("applied"));
    expect(sendCommand).toHaveBeenCalledOnce();
  });

  it.each([
    ["session", { sessionId: "66666666-6666-4666-8666-666666666666" }],
    ["client", { clientId: OTHER_CLIENT_ID, controllerClientId: OTHER_CLIENT_ID }],
    ["controller", { controllerClientId: OTHER_CLIENT_ID }],
    ["ownership", { controllerOwned: false }],
    ["viewerVersion", { viewerVersion: "viewer-v2" }],
    ["controllerAuthorityVersion", { controllerAuthorityVersion: `sha256:${"b".repeat(64)}` }],
    ["controller authority missing", { controllerAuthorityVersion: null }],
    ["mode", { mode: "rehearsal", active: false }],
    ["network", { online: false }],
  ] as const)("aborts the old pending poll when %s authority changes", async (_label, changed) => {
    const signals: AbortSignal[] = [];
    const request = vi.fn(async (_path: string, requestOptions: { signal: AbortSignal }) => new Promise<unknown>(() => {
      signals.push(requestOptions.signal);
    })) as unknown as PresentationRemoteIntentReceiverRequest;
    const initial = options({ request });
    const view = renderHook((props) => usePresentationRemoteIntentReceiver(props), { initialProps: initial });
    await waitFor(() => expect(signals).toHaveLength(1));

    view.rerender(options({ request, ...changed }));
    expect(signals[0].aborted).toBe(true);
    view.unmount();
  });

  it("drops a late pending response after viewer authority changes", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let callCount = 0;
    const request = vi.fn(async (_path: string) => {
      callCount += 1;
      if (callCount === 1) return new Promise<unknown>((resolve) => { resolveFirst = resolve; });
      return new Promise<unknown>(() => undefined);
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = vi.fn() as unknown as PresentationRemoteIntentReceiverCommandSender;
    const initial = options({ request, sendCommand });
    const view = renderHook((props) => usePresentationRemoteIntentReceiver(props), { initialProps: initial });
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    view.rerender(options({ request, sendCommand, viewerVersion: "viewer-v2" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () => { resolveFirst(pending()); });
    await act(async () => { await Promise.resolve(); });
    expect(sendCommand).not.toHaveBeenCalled();
    view.unmount();
  });

  it("stops polling after a 403 access change until authority changes", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => {
      throw new ApiError("Forbidden", 403, { error: "FORBIDDEN" });
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const view = renderHook(() => usePresentationRemoteIntentReceiver(options({ request, pollMs: 250 })));

    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.lastResult.phase).toBe("halted");
    expect(request).toHaveBeenCalledOnce();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(request).toHaveBeenCalledOnce();
    view.unmount();
  });
});
