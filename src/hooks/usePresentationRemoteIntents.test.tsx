import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePresentationRemoteIntents } from "./usePresentationRemoteIntents";
import { PRESENTATION_REMOTE_INTENT_TYPES, type PresentationRemoteIntentType } from "@/lib/presentationRemoteIntents";
import { ApiError } from "@/lib/api";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const CONTROLLER_ID = "33333333-3333-4333-8333-333333333333";
const CONTROLLER_AUTHORITY_VERSION = `sha256:${"a".repeat(64)}`;

function capabilities(
  supportedIntents: readonly PresentationRemoteIntentType[] = PRESENTATION_REMOTE_INTENT_TYPES,
  authorityVersion = CONTROLLER_AUTHORITY_VERSION,
) {
  return {
    schemaVersion: 1,
    serviceId: "service-1",
    sessionId: SESSION_ID,
    serverNow: "2026-07-13T12:00:00.000Z",
    controllerAuthorityVersion: authorityVersion,
    receiver: {
      capabilityVersion: 1,
      supportedIntents: [...supportedIntents],
      expiresAt: "2026-07-13T12:00:03.000Z",
    },
  };
}

const defaultCapabilitiesRequest = async () => capabilities();

function options(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "account-1",
    churchId: "church-1",
    serviceId: "service-1",
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    controllerClientId: CONTROLLER_ID,
    viewerVersion: "viewer-v1",
    controllerAuthorityVersion: CONTROLLER_AUTHORITY_VERSION,
    controllerVersion: "controller-v1",
    mode: "live" as const,
    enabled: true,
    online: true,
    viewerCanControl: true,
    controllerOwned: false,
    capabilitiesRequest: defaultCapabilitiesRequest,
    ...overrides,
  };
}

function submission(intentId: string, status: "pending" | "applied" = "applied") {
  return {
    schemaVersion: 1,
    serviceId: "service-1",
    sessionId: SESSION_ID,
    idempotent: true,
    intent: {
      id: intentId,
      deliveryId: "55555555-5555-4555-8555-555555555555",
      type: "take",
      status,
      createdAt: "2026-07-13T12:00:00.000Z",
      expiresAt: "2026-07-13T12:00:10.000Z",
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePresentationRemoteIntents authority lifecycle", () => {
  it("aborts the active request immediately and drops a late response after scope changes", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    let requestBody = "";
    let requestSignal: AbortSignal | null = null;
    const request = async (_path: string, requestOptions: { body: string; signal: AbortSignal }) => new Promise<unknown>((resolve) => {
      requestBody = requestOptions.body;
      requestSignal = requestOptions.signal;
      resolveRequest = resolve;
    });
    const view = renderHook((props) => usePresentationRemoteIntents(props), { initialProps: options({ request }) });
    await waitFor(() => expect(view.result.current.available).toBe(true));
    let action: Promise<unknown> = Promise.resolve();
    act(() => { action = view.result.current.send("take", {}); });
    await waitFor(() => expect(view.result.current.status.phase).toBe("sending"));

    view.rerender(options({ request, controllerClientId: "66666666-6666-4666-8666-666666666666" }));
    await waitFor(() => expect(view.result.current.status.phase).toBe("idle"));
    expect(requestSignal).not.toBeNull();
    expect(requestSignal!.aborted).toBe(true);
    await act(async () => { await action; });

    const intentId = JSON.parse(requestBody).intent.id as string;
    resolveRequest(submission(intentId));
    await act(async () => { await Promise.resolve(); });

    expect(view.result.current.status.phase).toBe("idle");
  });

  it.each([
    ["viewerVersion", "viewer-v2"],
    ["controllerAuthorityVersion", `sha256:${"b".repeat(64)}`],
    ["controllerAuthorityVersion", null],
  ] as const)("aborts an in-flight remote intent when %s changes under the same controller client", async (field, changedVersion) => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    let requestBody = "";
    let requestSignal: AbortSignal | null = null;
    const request = async (_path: string, requestOptions: { body: string; signal: AbortSignal }) => new Promise<unknown>((resolve) => {
      requestBody = requestOptions.body;
      requestSignal = requestOptions.signal;
      resolveRequest = resolve;
    });
    const view = renderHook((props) => usePresentationRemoteIntents(props), { initialProps: options({ request }) });
    await waitFor(() => expect(view.result.current.available).toBe(true));
    let action: Promise<unknown> = Promise.resolve();
    act(() => { action = view.result.current.send("take", {}); });
    await waitFor(() => expect(view.result.current.status.phase).toBe("sending"));

    view.rerender(options({ request, [field]: changedVersion }));
    await waitFor(() => expect(view.result.current.status.phase).toBe("idle"));
    expect(requestSignal).not.toBeNull();
    expect(requestSignal!.aborted).toBe(true);
    await act(async () => { await action; });

    const intentId = JSON.parse(requestBody).intent.id as string;
    resolveRequest(submission(intentId));
    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.status.phase).toBe("idle");
  });

  it("does not abort an in-flight remote intent when only heartbeat controllerVersion changes", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    let requestBody = "";
    let requestSignal: AbortSignal | null = null;
    const request = async (_path: string, requestOptions: { body: string; signal: AbortSignal }) => new Promise<unknown>((resolve) => {
      requestBody = requestOptions.body;
      requestSignal = requestOptions.signal;
      resolveRequest = resolve;
    });
    const view = renderHook((props) => usePresentationRemoteIntents(props), { initialProps: options({ request }) });
    await waitFor(() => expect(view.result.current.available).toBe(true));
    let action: Promise<unknown> = Promise.resolve();
    act(() => { action = view.result.current.send("take", {}); });
    await waitFor(() => expect(view.result.current.status.phase).toBe("sending"));

    view.rerender(options({ request, controllerVersion: "controller-heartbeat-v2" }));
    expect(requestSignal).not.toBeNull();
    expect(requestSignal!.aborted).toBe(false);
    const intentId = JSON.parse(requestBody).intent.id as string;
    await act(async () => {
      resolveRequest(submission(intentId));
      await action;
    });
    expect(view.result.current.status.phase).toBe("applied");
  });

  it("aborts the active request on unmount even when transport ignores its signal", async () => {
    let requestSignal: AbortSignal | null = null;
    const request = async (_path: string, requestOptions: { signal: AbortSignal }) => new Promise<unknown>(() => {
      requestSignal = requestOptions.signal;
    });
    const view = renderHook(() => usePresentationRemoteIntents(options({ request })));
    await waitFor(() => expect(view.result.current.available).toBe(true));
    let action: Promise<unknown> = Promise.resolve();
    act(() => { action = view.result.current.send("take", {}); });
    await waitFor(() => expect(view.result.current.status.phase).toBe("sending"));

    view.unmount();

    expect(requestSignal).not.toBeNull();
    expect(requestSignal!.aborted).toBe(true);
    await action;
  });

  it("turns off remote availability immediately for offline, read-only, or owned control", async () => {
    const view = renderHook((props) => usePresentationRemoteIntents(props), { initialProps: options() });
    await waitFor(() => expect(view.result.current.available).toBe(true));
    view.rerender(options({ online: false }));
    expect(view.result.current.available).toBe(false);
    view.rerender(options({ viewerCanControl: false }));
    expect(view.result.current.available).toBe(false);
    view.rerender(options({ controllerOwned: true }));
    expect(view.result.current.available).toBe(false);
    view.rerender(options({ mode: "rehearsal" }));
    expect(view.result.current.available).toBe(false);
  });

  it("aborts an in-flight intent when the run mode changes", async () => {
    let requestSignal: AbortSignal | null = null;
    const request = async (_path: string, requestOptions: { signal: AbortSignal }) => new Promise<unknown>(() => {
      requestSignal = requestOptions.signal;
    });
    const view = renderHook((props) => usePresentationRemoteIntents(props), { initialProps: options({ request }) });
    await waitFor(() => expect(view.result.current.available).toBe(true));
    let action: Promise<unknown> = Promise.resolve();
    act(() => { action = view.result.current.send("take", {}); });
    await waitFor(() => expect(requestSignal).not.toBeNull());

    view.rerender(options({ request, mode: "rehearsal" }));

    expect(requestSignal!.aborted).toBe(true);
    await action;
    expect(view.result.current.available).toBe(false);
  });

  it("fails closed until the current controller publishes exact capabilities", async () => {
    let resolveCapabilities: (value: unknown) => void = () => undefined;
    const capabilitiesRequest = vi.fn(() => new Promise<unknown>((resolve) => { resolveCapabilities = resolve; }));
    const view = renderHook(() => usePresentationRemoteIntents(options({ capabilitiesRequest })));

    expect(view.result.current.available).toBe(false);
    expect(view.result.current.supportedIntents).toEqual([]);
    await waitFor(() => expect(capabilitiesRequest).toHaveBeenCalledOnce());
    await act(async () => { resolveCapabilities(capabilities(["program_next"])); });

    await waitFor(() => expect(view.result.current.available).toBe(true));
    expect(view.result.current.supportedIntents).toEqual(["program_next"]);
    view.unmount();
  });

  it("rejects an unadvertised intent locally without posting it", async () => {
    const request = vi.fn();
    const capabilitiesRequest = vi.fn(async () => capabilities(["program_next"]));
    const view = renderHook(() => usePresentationRemoteIntents(options({ request, capabilitiesRequest })));
    await waitFor(() => expect(view.result.current.available).toBe(true));

    await act(async () => {
      await expect(view.result.current.send("take", {})).resolves.toMatchObject({
        phase: "rejected",
        message: expect.stringMatching(/compatibilidad/i),
      });
    });
    expect(request).not.toHaveBeenCalled();
    view.unmount();
  });

  it("aborts and ignores an old capability response when controller authority changes", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const signals: AbortSignal[] = [];
    const capabilitiesRequest = vi.fn((_path: string, requestOptions: { signal: AbortSignal }) => {
      signals.push(requestOptions.signal);
      return new Promise<unknown>((resolve) => {
        if (signals.length === 1) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    });
    const view = renderHook((props) => usePresentationRemoteIntents(props), {
      initialProps: options({ capabilitiesRequest }),
    });
    await waitFor(() => expect(capabilitiesRequest).toHaveBeenCalledOnce());

    const nextAuthority = `sha256:${"b".repeat(64)}`;
    view.rerender(options({ capabilitiesRequest, controllerAuthorityVersion: nextAuthority }));
    await waitFor(() => expect(capabilitiesRequest).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);

    await act(async () => { resolveFirst(capabilities(PRESENTATION_REMOTE_INTENT_TYPES)); });
    expect(view.result.current.available).toBe(false);
    await act(async () => { resolveSecond(capabilities(["set_blackout"], nextAuthority)); });
    await waitFor(() => expect(view.result.current.supportedIntents).toEqual(["set_blackout"]));
    view.unmount();
  });

  it("drops advertised controls exactly at capability expiry while a refresh is unresolved", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const expiring = capabilities(["program_next"]);
      expiring.receiver.expiresAt = "2026-07-13T12:00:01.000Z";
      const capabilitiesRequest = vi.fn()
        .mockResolvedValueOnce(expiring)
        .mockImplementation(() => new Promise<unknown>(() => undefined));
      const view = renderHook(() => usePresentationRemoteIntents(options({ capabilitiesRequest })));

      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(view.result.current.available).toBe(true);
      expect(view.result.current.supportedIntents).toEqual(["program_next"]);

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(view.result.current.available).toBe(false);
      expect(view.result.current.supportedIntents).toEqual([]);
      expect(capabilitiesRequest).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps capability polling single-flight and start-to-start within one second after a slow response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    let active = 0;
    let maxActive = 0;
    const startTimes: number[] = [];
    const capabilitiesRequest = vi.fn(() => new Promise<unknown>((resolve) => {
      startTimes.push(new Date().getTime());
      active += 1;
      maxActive = Math.max(maxActive, active);
      globalThis.setTimeout(() => {
        active -= 1;
        resolve(capabilities(["program_next"]));
      }, 1_500);
    }));
    const view = renderHook(() => usePresentationRemoteIntents(options({ capabilitiesRequest })));

    clock = 1_499;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_499); });
    expect(capabilitiesRequest).toHaveBeenCalledOnce();
    clock = 1_500;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
    expect(capabilitiesRequest).toHaveBeenCalledTimes(2);
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(1_500);
    expect(startTimes[1] - startTimes[0]).toBeLessThanOrEqual(1_501);
    expect(maxActive).toBe(1);
    view.unmount();
  });

  it("starts the next capability GET immediately after the bounded timeout without overlap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const signals: AbortSignal[] = [];
    const startTimes: number[] = [];
    const capabilitiesRequest = vi.fn((_path: string, requestOptions: { signal: AbortSignal }) => {
      startTimes.push(new Date().getTime());
      signals.push(requestOptions.signal);
      return new Promise<unknown>(() => undefined);
    });
    const view = renderHook(() => usePresentationRemoteIntents(options({ capabilitiesRequest })));

    clock = 2_499;
    await act(async () => { await vi.advanceTimersByTimeAsync(2_499); });
    expect(capabilitiesRequest).toHaveBeenCalledOnce();
    clock = 2_500;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
    expect(capabilitiesRequest).toHaveBeenCalledTimes(2);
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(2_500);
    expect(startTimes[1] - startTimes[0]).toBeLessThanOrEqual(2_501);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    view.unmount();
  });

  it("fails closed while hidden and requires a fresh foreground capability GET", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const resolvers: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    const capabilitiesRequest = vi.fn((_path: string, requestOptions: { signal: AbortSignal }) => {
      signals.push(requestOptions.signal);
      return new Promise<unknown>((resolve) => { resolvers.push(resolve); });
    });
    const view = renderHook(() => usePresentationRemoteIntents(options({ capabilitiesRequest })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(capabilitiesRequest).toHaveBeenCalledOnce();

    await act(async () => {
      resolvers[0](capabilities(["program_next"]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.result.current.available).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(capabilitiesRequest).toHaveBeenCalledTimes(2);

    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(view.result.current.available).toBe(false);
    expect(view.result.current.supportedIntents).toEqual([]);
    expect(signals[1].aborted).toBe(true);

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(capabilitiesRequest).toHaveBeenCalledTimes(3);
    expect(view.result.current.available).toBe(false);
    await act(async () => {
      resolvers[1](capabilities(["program_next"]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.result.current.supportedIntents).toEqual([]);
    await act(async () => {
      resolvers[2](capabilities(["set_blackout"]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.result.current.supportedIntents).toEqual(["set_blackout"]);
    expect(signals[0].aborted).toBe(false);
    view.unmount();
  });

  it("aborts and ignores old capabilities across an exact controller-client handoff", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    const capabilitiesRequest = vi.fn((_path: string, requestOptions: { signal: AbortSignal }) => {
      signals.push(requestOptions.signal);
      return new Promise<unknown>((resolve) => { resolvers.push(resolve); });
    });
    const view = renderHook((props) => usePresentationRemoteIntents(props), {
      initialProps: options({ capabilitiesRequest }),
    });
    await waitFor(() => expect(capabilitiesRequest).toHaveBeenCalledOnce());

    view.rerender(options({
      capabilitiesRequest,
      controllerClientId: "77777777-7777-4777-8777-777777777777",
    }));
    await waitFor(() => expect(capabilitiesRequest).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);

    await act(async () => { resolvers[0](capabilities(["program_next"])); });
    expect(view.result.current.available).toBe(false);
    await act(async () => { resolvers[1](capabilities(["set_chords"])); });
    await waitFor(() => expect(view.result.current.supportedIntents).toEqual(["set_chords"]));
    view.unmount();
  });

  it("refetches capabilities on a contract 409 without aborting an already accepted idempotent send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const capabilitiesRequest = vi.fn()
      .mockResolvedValueOnce(capabilities(["take"]))
      .mockImplementation(() => new Promise<unknown>(() => undefined));
    const requestSignals: AbortSignal[] = [];
    const request = vi.fn(async (_path: string, requestOptions: { body: string; signal: AbortSignal }) => {
      requestSignals.push(requestOptions.signal);
      const intentId = JSON.parse(requestOptions.body).intent.id as string;
      if (requestSignals.length === 1) return submission(intentId, "pending");
      throw new ApiError("Offline", 409, { error: "REMOTE_RECEIVER_OFFLINE" });
    });
    const view = renderHook(() => usePresentationRemoteIntents(options({ request, capabilitiesRequest })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.available).toBe(true);

    let action: ReturnType<typeof view.result.current.send> = Promise.resolve({
      phase: "idle",
      intentId: null,
      type: null,
      message: null,
    });
    act(() => { action = view.result.current.send("take", {}); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.status.phase).toBe("pending");

    let outcome: Awaited<typeof action> | null = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
      outcome = await action;
    });
    expect(outcome).toMatchObject({ phase: "rejected", message: expect.stringMatching(/receptor remoto/i) });
    expect(capabilitiesRequest).toHaveBeenCalledTimes(2);
    expect(view.result.current.available).toBe(false);
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals.every((signal) => !signal.aborted)).toBe(true);
    view.unmount();
  });
});
