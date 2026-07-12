import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presentationAutomationEventId, projectPresentationAutomationOccurredAt, usePresentationAutomations, type PresentationAutomationCommandSender } from "./usePresentationAutomations";
import type { PresentationLiveSnapshot } from "@/lib/presentationLive";
import type { PresentationAutomationDispatch, PresentationAutomationPending } from "@/lib/presentationProduction";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  pending: vi.fn(),
  ack: vi.fn(),
  activeObs: vi.fn(),
}));

vi.mock("@/lib/presentationProduction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentationProduction")>();
  return {
    ...actual,
    dispatchPresentationAutomation: mocks.dispatch,
    fetchPendingPresentationAutomations: mocks.pending,
    acknowledgePresentationAutomation: mocks.ack,
  };
});

vi.mock("@/lib/presentationLocalConnectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentationLocalConnectors")>();
  return { ...actual, getActivePresentationObsConnection: mocks.activeObs };
});

function snapshot(mode: "live" | "rehearsal", revision: number): PresentationLiveSnapshot {
  const now = new Date();
  return {
    schemaVersion: 2,
    serviceId: "service-1",
    serviceVersion: "service-v1",
    viewerVersion: "sha256:viewer",
    serverNow: now.toISOString(),
    receivedAtMs: now.getTime(),
    viewer: { view: "operator", roles: ["operator"], canEdit: true, canStart: true, canControl: true, canForceTakeover: true },
    viewerLayout: null,
    session: {
      id: `${mode}-session-0001`,
      mode,
      status: "live",
      revision,
      startedAt: new Date(now.getTime() - 300_000).toISOString(),
      endedAt: null,
      controller: { clientId: "11111111-1111-4111-8111-111111111111", displayName: "Booth", leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(), ownedByViewer: true },
      presence: [],
      cursor: { itemId: "item-00000001", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
      display: { blackout: false, chordsVisible: true, broadcastVisible: true },
      playback: null,
      timing: {
        service: { status: "running", plannedSeconds: 3_600, elapsedSeconds: 300, remainingSeconds: 3_300, overrunSeconds: 0, projectedEndAt: new Date(now.getTime() + 3_300_000).toISOString(), startedAt: new Date(now.getTime() - 300_000).toISOString(), pausedAt: null, accumulatedPausedMs: 0 },
        item: { itemId: "item-00000001", status: "paused", plannedSeconds: 300, elapsedSeconds: 0, overrunSeconds: 0, startedAt: null, pausedAt: null, accumulatedPausedMs: 0 },
        countdown: null,
      },
      messages: [],
      lastCommand: null,
    },
  };
}

function dispatch(mode: "live" | "rehearsal", actions: PresentationAutomationDispatch["actions"] = []): PresentationAutomationDispatch {
  return { schemaVersion: 4, serviceId: "service-1", mode, idempotent: false, simulated: mode === "rehearsal", actions };
}

function pending(actions: PresentationAutomationPending["actions"] = []): PresentationAutomationPending {
  return { schemaVersion: 4, serviceId: "service-1", mode: "live", idempotent: false, simulated: false, leaseExpiresAt: actions.length ? new Date(Date.now() + 30_000).toISOString() : null, actions };
}

function options(mode: "live" | "rehearsal", sendCommand: PresentationAutomationCommandSender, overrides: Partial<Parameters<typeof usePresentationAutomations>[0]> = {}) {
  const current = snapshot(mode, 5);
  return {
    serviceId: "service-1",
    mode,
    clientId: "11111111-1111-4111-8111-111111111111",
    snapshot: current,
    timing: current.session!.timing,
    controllerOwned: true,
    commandPending: false,
    networkState: "online" as const,
    itemElapsedThresholds: [],
    sendCommand,
    privacyScope: `account::church::service::${mode}::session::client`,
    externalConnectorScope: `account::church::service::${mode}::session::client::church::service`,
    enabled: false,
    ...overrides,
  };
}

describe("usePresentationAutomations delivery discipline", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.pending.mockReset();
    mocks.ack.mockReset();
    mocks.activeObs.mockReset();
    mocks.ack.mockResolvedValue({ schemaVersion: 4, deliveryId: "delivery", status: "applied", idempotent: false });
  });

  it("builds stable UUID event ids without exposing cursor or timer identifiers", () => {
    const first = presentationAutomationEventId("private-session-id", "item_elapsed", "private-item::2026-07-12T13:00:00Z::30");
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).toBe(presentationAutomationEventId("private-session-id", "item_elapsed", "private-item::2026-07-12T13:00:00Z::30"));
    expect(first).not.toContain("private");
  });

  it("projects event time from the authoritative server clock when the device clock is skewed", () => {
    const current = snapshot("live", 5);
    current.serverNow = "2026-07-12T13:00:00.000Z";
    current.receivedAtMs = Date.parse("2026-07-12T19:00:00.000Z");
    expect(projectPresentationAutomationOccurredAt(current, Date.parse("2026-07-12T19:00:05.000Z"))).toBe("2026-07-12T13:00:05.000Z");
    expect(projectPresentationAutomationOccurredAt(current, Date.parse("2026-07-12T18:59:50.000Z"))).toBe("2026-07-12T13:00:00.000Z");
    expect(projectPresentationAutomationOccurredAt(current, Date.parse("2026-07-13T19:00:00.000Z"))).toBe("2026-07-12T13:00:08.000Z");
  });

  it("anchors item elapsed and occurredAt to the same clamped server projection", async () => {
    const deviceNow = Date.parse("2026-07-12T19:00:20.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(deviceNow);
    try {
      const current = snapshot("rehearsal", 5);
      current.serverNow = "2026-07-12T13:00:00.000Z";
      current.receivedAtMs = Date.parse("2026-07-12T19:00:00.000Z");
      current.session!.startedAt = "2026-07-12T12:59:00.000Z";
      current.session!.timing.item = { ...current.session!.timing.item, status: "running", elapsedSeconds: 28, startedAt: "2026-07-12T12:59:32.000Z" };
      const uiTiming = { ...current.session!.timing, item: { ...current.session!.timing.item, elapsedSeconds: 48 } };
      mocks.dispatch.mockResolvedValue(dispatch("rehearsal"));
      renderHook(() => usePresentationAutomations(options("rehearsal", vi.fn() as unknown as PresentationAutomationCommandSender, {
        snapshot: current,
        timing: uiTiming,
        itemElapsedThresholds: [30],
        enabled: true,
      })));
      await waitFor(() => expect(mocks.dispatch.mock.calls.flatMap((call) => call[1].event).some((event) => event.type === "item_elapsed")).toBe(true));
      const event = mocks.dispatch.mock.calls.flatMap((call) => call[1].event).find((entry) => entry.type === "item_elapsed");
      expect(event).toMatchObject({ occurredAt: "2026-07-12T13:00:08.000Z", thresholdSeconds: 30, elapsedSeconds: 36 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("uses base-only slide events and fires an item threshold again after the same item timer restarts", async () => {
    mocks.dispatch.mockResolvedValue(dispatch("rehearsal"));
    const sendCommand = vi.fn() as unknown as PresentationAutomationCommandSender;
    const first = snapshot("rehearsal", 5);
    const firstTimerStartedAt = new Date(Date.parse(first.serverNow) - 30_000).toISOString();
    first.session!.timing.item = { ...first.session!.timing.item, status: "running", elapsedSeconds: 30, startedAt: firstTimerStartedAt };
    const initial = options("rehearsal", sendCommand, { snapshot: first, timing: first.session!.timing, itemElapsedThresholds: [30], enabled: true });
    const { rerender } = renderHook((props) => usePresentationAutomations(props), { initialProps: initial });
    await waitFor(() => expect(mocks.dispatch.mock.calls.flatMap((call) => call[1].event).filter((event) => event.type === "item_elapsed")).toHaveLength(1));
    const slideEvent = mocks.dispatch.mock.calls.flatMap((call) => call[1].event).find((event) => event.type === "slide_entered");
    expect(Object.keys(slideEvent).sort()).toEqual(["id", "occurredAt", "revision", "sessionId", "type"]);
    const second = snapshot("rehearsal", 6);
    const secondTimerStartedAt = new Date(Date.parse(second.serverNow) - 30_000).toISOString();
    second.session!.timing.item = { ...second.session!.timing.item, status: "running", elapsedSeconds: 30, startedAt: secondTimerStartedAt };
    rerender({ ...initial, snapshot: second, timing: second.session!.timing });
    await waitFor(() => expect(mocks.dispatch.mock.calls.flatMap((call) => call[1].event).filter((event) => event.type === "item_elapsed")).toHaveLength(2));
    const elapsedEvents = mocks.dispatch.mock.calls.flatMap((call) => call[1].event).filter((event) => event.type === "item_elapsed");
    expect(elapsedEvents.map((event) => ({ thresholdSeconds: event.thresholdSeconds, elapsedSeconds: event.elapsedSeconds }))).toEqual([{ thresholdSeconds: 30, elapsedSeconds: 30 }, { thresholdSeconds: 30, elapsedSeconds: 30 }]);
    expect(elapsedEvents[0].id).not.toBe(elapsedEvents[1].id);
  });

  it("treats rehearsal dispatch actions as informational and never applies or acknowledges them", async () => {
    const sendCommand = vi.fn() as unknown as PresentationAutomationCommandSender;
    mocks.dispatch.mockResolvedValue(dispatch("rehearsal", [{ deliveryId: "simulation-1", ruleId: "rule-1", type: "obs_scene", payload: { sceneName: "Wide" } }]));
    const { result } = renderHook(() => usePresentationAutomations(options("rehearsal", sendCommand)));
    let finalRevision = 0;
    await act(async () => { finalRevision = await result.current.prepareSessionEnd(); });
    expect(finalRevision).toBe(5);
    expect(mocks.dispatch).toHaveBeenCalledWith("service-1", expect.objectContaining({ mode: "rehearsal", clientId: "11111111-1111-4111-8111-111111111111" }));
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.activeObs).not.toHaveBeenCalled();
  });

  it("drains prior deliveries, dispatches session_ended with the resulting revision, then drains end deliveries", async () => {
    const order: string[] = [];
    const blackout = { deliveryId: "delivery-blackout", ruleId: "rule-1", type: "set_blackout" as const, payload: { enabled: true } };
    const stageMessage = { deliveryId: "delivery-message", ruleId: "rule-2", type: "stage_message" as const, payload: { body: "Cierre", tone: "info" as const, roles: ["all" as const], lifetimeSeconds: 20 } };
    mocks.pending
      .mockImplementationOnce(async () => { order.push("pending-before"); return pending([blackout]); })
      .mockImplementationOnce(async () => pending())
      .mockImplementationOnce(async () => { order.push("pending-after"); return pending([stageMessage]); })
      .mockImplementationOnce(async () => pending());
    mocks.dispatch.mockImplementation(async (_serviceId, input) => {
      order.push(`dispatch-end-r${input.event.revision}`);
      return dispatch("live", [{ deliveryId: "informational-only", ruleId: "rule-x", type: "obs_scene", payload: { sceneName: "Never execute this response" } }]);
    });
    const sendCommand = vi.fn(async (type: string) => {
      order.push(`command-${type}`);
      return { snapshot: snapshot("live", type === "set_blackout" ? 6 : 7), local: false };
    }) as unknown as PresentationAutomationCommandSender;
    mocks.ack.mockImplementation(async (_serviceId, input) => {
      order.push(`ack-${input.deliveryId}`);
      return { schemaVersion: 4, deliveryId: input.deliveryId, status: input.status, idempotent: false };
    });
    const { result } = renderHook(() => usePresentationAutomations(options("live", sendCommand)));
    let finalRevision = 0;
    await act(async () => { finalRevision = await result.current.prepareSessionEnd(); });
    expect(finalRevision).toBe(7);
    expect(mocks.dispatch.mock.calls[0][1].event.revision).toBe(6);
    expect(sendCommand).toHaveBeenNthCalledWith(1, "set_blackout", { blackout: true }, { commandId: "delivery-blackout", expectedRevision: 5, allowOffline: false });
    expect(sendCommand).toHaveBeenNthCalledWith(2, "stage_message_send", stageMessage.payload, { commandId: "delivery-message", expectedRevision: 6, allowOffline: false });
    expect(order.indexOf("ack-delivery-blackout")).toBeLessThan(order.indexOf("dispatch-end-r6"));
    expect(order.indexOf("dispatch-end-r6")).toBeLessThan(order.indexOf("command-stage_message_send"));
    expect(mocks.activeObs).not.toHaveBeenCalled();
  });

  it("drains 80 one-action leases before session end without skipping apply or ack", async () => {
    const empty = pending();
    let leased = 0;
    mocks.pending.mockImplementation(async () => {
      if (leased >= 80) return empty;
      const index = leased;
      leased += 1;
      return pending([{
        deliveryId: `delivery-${String(index).padStart(3, "0")}`,
        ruleId: "rule-single-page",
        type: "set_blackout",
        payload: { enabled: index % 2 === 0 },
      }]);
    });
    mocks.dispatch.mockResolvedValue(dispatch("live"));
    const sendCommandMock = vi.fn(async (_type: string, _payload: unknown, commandOptions?: { expectedRevision?: number }) => ({
      snapshot: snapshot("live", (commandOptions?.expectedRevision ?? 5) + 1),
      local: false,
    }));
    const sendCommand = sendCommandMock as unknown as PresentationAutomationCommandSender;
    const { result } = renderHook(() => usePresentationAutomations(options("live", sendCommand)));

    let finalRevision = 0;
    await act(async () => { finalRevision = await result.current.prepareSessionEnd(); });

    expect(finalRevision).toBe(85);
    expect(sendCommand).toHaveBeenCalledTimes(80);
    expect(mocks.ack).toHaveBeenCalledTimes(80);
    expect(mocks.ack.mock.calls.every((call) => call[1].status === "applied")).toBe(true);
    expect(sendCommandMock.mock.calls[0][2]).toEqual({ commandId: "delivery-000", expectedRevision: 5, allowOffline: false });
    expect(sendCommandMock.mock.calls[79][2]).toEqual({ commandId: "delivery-079", expectedRevision: 84, allowOffline: false });
    expect(mocks.dispatch).toHaveBeenCalledWith("service-1", expect.objectContaining({ event: expect.objectContaining({ type: "session_ended", revision: 85 }) }));
    expect(mocks.pending).toHaveBeenCalledTimes(82);
  });

  it("aborts before applying or acknowledging when identity/control changes during pending fetch", async () => {
    let resolvePending!: (value: PresentationAutomationPending) => void;
    mocks.pending.mockReturnValue(new Promise((resolve) => { resolvePending = resolve; }));
    const sendCommand = vi.fn() as unknown as PresentationAutomationCommandSender;
    const initial = options("live", sendCommand);
    const { result, rerender } = renderHook((props) => usePresentationAutomations(props), { initialProps: initial });
    const closing = result.current.prepareSessionEnd();
    const handledClosing = closing.then(() => null, (error: unknown) => error);
    await waitFor(() => expect(mocks.pending).toHaveBeenCalledOnce());
    rerender({ ...initial, controllerOwned: false, privacyScope: "other-account::other-church" });
    await act(async () => resolvePending(pending([{ deliveryId: "delivery-unsafe", ruleId: "rule-1", type: "set_blackout", payload: { enabled: true } }])));
    const closingError = await handledClosing;
    expect(closingError).toBeInstanceOf(Error);
    expect((closingError as Error).message).toMatch(/control|identidad/i);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
