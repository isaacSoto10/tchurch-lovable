import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
  PRESENTATION_REMOTE_INTENT_ATTEMPT_TIMEOUT_MS,
  PRESENTATION_REMOTE_INTENT_POLL_MS,
  PRESENTATION_REMOTE_INTENT_TTL_MS,
  PRESENTATION_REMOTE_INTENT_TYPES,
  buildPresentationRemoteIntentRequest,
  canSendPresentationRemoteIntent,
  dispatchPresentationRemoteIntent,
  parsePresentationRemoteIntentSubmission,
  presentationRemoteIntentScopeKey,
  type PresentationRemoteIntentType,
} from "./presentationRemoteIntents";

const SERVICE_ID = "service-1";
const CHURCH_ID = "church-1";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const CONTROLLER_ID = "33333333-3333-4333-8333-333333333333";
const INTENT_ID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_ID = "55555555-5555-4555-8555-555555555555";

function payload(type: PresentationRemoteIntentType) {
  if (type === "set_blackout") return { enabled: true };
  if (type === "set_chords") return { visible: false };
  return {};
}

function submission(status: "pending" | "applied" | "rejected" | "failed" | "expired" | "invalidated", idempotent = status !== "pending") {
  return {
    schemaVersion: 1,
    serviceId: SERVICE_ID,
    sessionId: SESSION_ID,
    idempotent,
    intent: {
      id: INTENT_ID,
      deliveryId: DELIVERY_ID,
      type: "take",
      status,
      createdAt: "2026-07-13T12:00:00.000Z",
      expiresAt: "2026-07-13T12:00:10.000Z",
    },
  };
}

describe("presentation remote intent v1 contract", () => {
  it("serializes all seven mappings with the exact versioned shape", () => {
    expect(PRESENTATION_REMOTE_INTENT_TYPES).toEqual([
      "preview_previous",
      "preview_next",
      "take",
      "program_previous",
      "program_next",
      "set_blackout",
      "set_chords",
    ]);
    for (const type of PRESENTATION_REMOTE_INTENT_TYPES) {
      const built = buildPresentationRemoteIntentRequest({
        serviceId: SERVICE_ID,
        sessionId: SESSION_ID,
        clientId: CLIENT_ID,
        intentId: INTENT_ID,
        type,
        payload: payload(type) as never,
      });
      expect(built.path).toBe("/services/service-1/presentation-remote-intents");
      expect(JSON.parse(built.body)).toEqual({
        schemaVersion: 1,
        sessionId: SESSION_ID,
        clientId: CLIENT_ID,
        intent: { id: INTENT_ID, type, payload: payload(type) },
      });
      expect(Object.keys(JSON.parse(built.body))).toEqual(["schemaVersion", "sessionId", "clientId", "intent"]);
    }
  });

  it("rejects unknown or type-specific extra payload fields before transport", () => {
    expect(() => buildPresentationRemoteIntentRequest({
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: { enabled: true } as never,
    })).toThrow(/payload vacío/i);
    expect(() => buildPresentationRemoteIntentRequest({
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "set_blackout",
      payload: { enabled: true, visible: true } as never,
    })).toThrow(/únicamente payload.enabled/i);
  });

  it("parses only the exact matching service/session/id/delivery/type/status response", () => {
    expect(parsePresentationRemoteIntentSubmission(submission("pending"), {
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      intentId: INTENT_ID,
      type: "take",
    }).intent.status).toBe("pending");
    expect(() => parsePresentationRemoteIntentSubmission({ ...submission("applied"), extra: true }, {
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      intentId: INTENT_ID,
      type: "take",
    })).toThrow(/inválida/i);
    expect(() => parsePresentationRemoteIntentSubmission({ ...submission("applied"), serviceId: "other" }, {
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      intentId: INTENT_ID,
      type: "take",
    })).toThrow(/inválida/i);
  });
});

describe("presentation remote intent idempotency and deadline", () => {
  it("reuses byte-identical JSON and the same UUID through ambiguity, pending, and applied", async () => {
    let clock = 0;
    const bodies: string[] = [];
    const churches: string[] = [];
    const states: string[] = [];
    const request = vi.fn(async (_path: string, options: { body: string; churchId: string }) => {
      bodies.push(options.body);
      churches.push(options.churchId);
      if (bodies.length === 1) throw new ApiError("connection lost", 0, { error: "offline" });
      if (bodies.length === 2) return submission("pending", false);
      return submission("applied", true);
    });
    const result = await dispatchPresentationRemoteIntent({
      churchId: CHURCH_ID,
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: {},
      request,
      now: () => clock,
      wait: async (milliseconds) => { clock += milliseconds; },
      onState: (next) => states.push(next.phase),
    });

    expect(result.phase).toBe("applied");
    expect(new Set(bodies).size).toBe(1);
    expect(churches).toEqual([CHURCH_ID, CHURCH_ID, CHURCH_ID]);
    expect(JSON.parse(bodies[0]).intent.id).toBe(INTENT_ID);
    expect(states).toContain("pending");
    expect(states.at(-1)).toBe("applied");
  });

  it("never retries at or after the absolute ten-second local deadline and reports expired", async () => {
    let clock = 0;
    const attemptedAt: number[] = [];
    const result = await dispatchPresentationRemoteIntent({
      churchId: CHURCH_ID,
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: {},
      request: async () => {
        attemptedAt.push(clock);
        throw new ApiError("ambiguous", 0, { error: "offline" });
      },
      now: () => clock,
      wait: async (milliseconds) => { clock += milliseconds; },
    });
    expect(result.phase).toBe("expired");
    expect(attemptedAt.length).toBeGreaterThan(1);
    expect(attemptedAt.every((attempt) => attempt < 10_000)).toBe(true);
    expect(clock).toBe(10_000);
  });

  it("cannot remain blocked beyond the absolute ten-second deadline when request ignores abort", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const signals: AbortSignal[] = [];
      const request = vi.fn((_path: string, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        return new Promise<unknown>(() => undefined);
      });
      let settled = false;
      const action = dispatchPresentationRemoteIntent({
        churchId: CHURCH_ID,
        serviceId: SERVICE_ID,
        sessionId: SESSION_ID,
        clientId: CLIENT_ID,
        intentId: INTENT_ID,
        type: "take",
        payload: {},
        request,
      }).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(action).resolves.toMatchObject({ phase: "expired", intentId: INTENT_ID });
      expect(Date.now()).toBe(PRESENTATION_REMOTE_INTENT_TTL_MS);
      expect(signals.length).toBeGreaterThan(1);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries the same UUID and byte-identical body after an attempt timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const bodies: string[] = [];
      const signals: AbortSignal[] = [];
      const request = vi.fn((_path: string, options: { body: string; signal: AbortSignal }) => {
        bodies.push(options.body);
        signals.push(options.signal);
        if (bodies.length === 1) return new Promise<unknown>(() => undefined);
        return Promise.resolve(submission("applied", true));
      });
      const action = dispatchPresentationRemoteIntent({
        churchId: CHURCH_ID,
        serviceId: SERVICE_ID,
        sessionId: SESSION_ID,
        clientId: CLIENT_ID,
        intentId: INTENT_ID,
        type: "take",
        payload: {},
        request,
      });

      await vi.advanceTimersByTimeAsync(PRESENTATION_REMOTE_INTENT_ATTEMPT_TIMEOUT_MS + PRESENTATION_REMOTE_INTENT_POLL_MS);
      await expect(action).resolves.toMatchObject({ phase: "applied", intentId: INTENT_ID });
      expect(bodies).toHaveLength(2);
      expect(new Set(bodies).size).toBe(1);
      expect(JSON.parse(bodies[0]).intent.id).toBe(INTENT_ID);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [9_999, "applied"],
    [10_000, "expired"],
    [10_001, "expired"],
  ] as const)("fails closed when a valid applied response returns at local millisecond %i", async (returnedAt, expectedPhase) => {
    let clock = 0;
    const states: string[] = [];
    const result = await dispatchPresentationRemoteIntent({
      churchId: CHURCH_ID,
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: {},
      request: async () => {
        clock = returnedAt;
        return submission("applied", true);
      },
      now: () => clock,
      onState: (next) => states.push(next.phase),
    });

    expect(result.phase).toBe(expectedPhase);
    if (returnedAt >= PRESENTATION_REMOTE_INTENT_TTL_MS) {
      expect(states).not.toContain("applied");
      expect(result.message).toMatch(/expiró/i);
    }
  });

  it.each([
    [999, "applied"],
    [1_000, "expired"],
    [1_001, "expired"],
  ] as const)("honors a shorter server TTL when applied returns at local millisecond %i", async (returnedAt, expectedPhase) => {
    let clock = 0;
    const states: string[] = [];
    const result = await dispatchPresentationRemoteIntent({
      churchId: CHURCH_ID,
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: {},
      request: async () => {
        clock = returnedAt;
        const applied = submission("applied", true);
        return {
          ...applied,
          intent: {
            ...applied.intent,
            expiresAt: "2026-07-13T12:00:01.000Z",
          },
        };
      },
      now: () => clock,
      onState: (next) => states.push(next.phase),
    });

    expect(result.phase).toBe(expectedPhase);
    if (returnedAt >= 1_000) {
      expect(states).not.toContain("applied");
      expect(result.message).toMatch(/expiró/i);
    }
  });

  it.each([
    ["rejected", "rejected"],
    ["invalidated", "rejected"],
    ["expired", "expired"],
    ["failed", "error"],
  ] as const)("maps server status %s to UI state %s", async (serverStatus, phase) => {
    const result = await dispatchPresentationRemoteIntent({
      churchId: CHURCH_ID,
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: {},
      request: async () => submission(serverStatus),
    });
    expect(result.phase).toBe(phase);
  });

  it("never invents applied from a malformed HTTP-success response", async () => {
    const result = await dispatchPresentationRemoteIntent({
      churchId: CHURCH_ID,
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: {},
      request: async () => ({ ...submission("applied"), serviceId: "wrong-service" }),
    });
    expect(result.phase).toBe("error");
  });

  it.each([
    ["deliveryId", "99999999-9999-4999-8999-999999999999"],
    ["createdAt", "2026-07-13T12:00:00.001Z"],
    ["expiresAt", "2026-07-13T12:00:09.999Z"],
  ] as const)("binds pending to the same %s through terminal polling", async (field, changedValue) => {
    let clock = 0;
    let attempt = 0;
    const result = await dispatchPresentationRemoteIntent({
      churchId: CHURCH_ID,
      serviceId: SERVICE_ID,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      intentId: INTENT_ID,
      type: "take",
      payload: {},
      request: async () => {
        attempt += 1;
        if (attempt === 1) return submission("pending", false);
        return {
          ...submission("applied", true),
          intent: {
            ...submission("applied", true).intent,
            [field]: changedValue,
          },
        };
      },
      now: () => clock,
      wait: async (milliseconds) => { clock += milliseconds; },
    });
    expect(result.phase).toBe("error");
    expect(result.message).toMatch(/identidad de entrega/i);
  });
});

describe("presentation remote intent authority scope", () => {
  const base = {
    accountId: "account-1",
    churchId: "church-1",
    serviceId: SERVICE_ID,
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    controllerClientId: CONTROLLER_ID,
    viewerVersion: "viewer-v1",
    controllerAuthorityVersion: `sha256:${"a".repeat(64)}`,
    controllerVersion: "controller-v1",
    mode: "live" as const,
    enabled: true,
    online: true,
    viewerCanControl: true,
    controllerOwned: false,
  };

  it("changes scope across account, church, service, session, client, controller, network, permission and ownership", () => {
    const key = presentationRemoteIntentScopeKey(base);
    for (const changed of [
      { accountId: "account-2" },
      { churchId: "church-2" },
      { serviceId: "service-2" },
      { sessionId: "66666666-6666-4666-8666-666666666666" },
      { clientId: "77777777-7777-4777-8777-777777777777" },
      { controllerClientId: "88888888-8888-4888-8888-888888888888" },
      { viewerVersion: "viewer-v2" },
      { controllerAuthorityVersion: `sha256:${"b".repeat(64)}` },
      { mode: "rehearsal" as const },
      { enabled: false },
      { online: false },
      { viewerCanControl: false },
      { controllerOwned: true },
    ]) expect(presentationRemoteIntentScopeKey({ ...base, ...changed })).not.toBe(key);
    expect(presentationRemoteIntentScopeKey({ ...base, controllerVersion: "controller-heartbeat-v2" })).toBe(key);
  });

  it("is available only to an online authorized observer with another exact controller", () => {
    expect(canSendPresentationRemoteIntent(base)).toBe(true);
    expect(canSendPresentationRemoteIntent({ ...base, online: false })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, controllerOwned: true })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, controllerClientId: null })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, controllerClientId: CLIENT_ID })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, controllerAuthorityVersion: null })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, controllerAuthorityVersion: "sha256:not-a-digest" })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, controllerAuthorityVersion: `sha256:${"A".repeat(64)}` })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, viewerCanControl: false })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, accountId: null })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, churchId: null })).toBe(false);
    expect(canSendPresentationRemoteIntent({ ...base, mode: "rehearsal" })).toBe(false);
  });
});
