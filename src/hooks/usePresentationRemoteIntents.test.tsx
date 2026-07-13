import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePresentationRemoteIntents } from "./usePresentationRemoteIntents";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const CONTROLLER_ID = "33333333-3333-4333-8333-333333333333";

function options(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "account-1",
    churchId: "church-1",
    serviceId: "service-1",
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    controllerClientId: CONTROLLER_ID,
    enabled: true,
    online: true,
    viewerCanControl: true,
    controllerOwned: false,
    ...overrides,
  };
}

function applied(intentId: string) {
  return {
    schemaVersion: 1,
    serviceId: "service-1",
    sessionId: SESSION_ID,
    idempotent: true,
    intent: {
      id: intentId,
      deliveryId: "55555555-5555-4555-8555-555555555555",
      type: "take",
      status: "applied",
      createdAt: "2026-07-13T12:00:00.000Z",
      expiresAt: "2026-07-13T12:00:10.000Z",
    },
  };
}

describe("usePresentationRemoteIntents authority lifecycle", () => {
  it("drops a late applied response after the controller scope changes", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    let requestBody = "";
    const request = async (_path: string, requestOptions: { body: string }) => new Promise<unknown>((resolve) => {
      requestBody = requestOptions.body;
      resolveRequest = resolve;
    });
    const view = renderHook((props) => usePresentationRemoteIntents(props), { initialProps: options({ request }) });
    let action: Promise<unknown> = Promise.resolve();
    act(() => { action = view.result.current.send("take", {}); });
    await waitFor(() => expect(view.result.current.status.phase).toBe("sending"));

    view.rerender(options({ request, controllerClientId: "66666666-6666-4666-8666-666666666666" }));
    await waitFor(() => expect(view.result.current.status.phase).toBe("idle"));
    const intentId = JSON.parse(requestBody).intent.id as string;
    resolveRequest(applied(intentId));
    await act(async () => { await action; });

    expect(view.result.current.status.phase).toBe("idle");
  });

  it("turns off remote availability immediately for offline, read-only, or owned control", () => {
    const view = renderHook((props) => usePresentationRemoteIntents(props), { initialProps: options() });
    expect(view.result.current.available).toBe(true);
    view.rerender(options({ online: false }));
    expect(view.result.current.available).toBe(false);
    view.rerender(options({ viewerCanControl: false }));
    expect(view.result.current.available).toBe(false);
    view.rerender(options({ controllerOwned: true }));
    expect(view.result.current.available).toBe(false);
  });
});
