import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import {
  activatePresentationRemoteIntentReceiverIdentity,
  canReceivePresentationRemoteIntents,
  clearPresentationRemoteIntentReceiverStorage,
  presentationRemoteIntentReceiverAuthorityScope,
  processPresentationRemoteIntentOnce,
  readPresentationRemoteIntentReceiverReceipt,
  type PresentationRemoteIntentReceiverAuthority,
  type PresentationRemoteIntentReceiverCommandSender,
  type PresentationRemoteIntentReceiverRequest,
} from "./presentationRemoteIntentReceiver";
import type { PresentationRemoteIntentType } from "./presentationRemoteIntents";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const INTENT_ID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_ID = "55555555-5555-4555-8555-555555555555";
const NOW_MS = Date.parse("2026-07-13T18:00:05.000Z");
const CONTROLLER_AUTHORITY_VERSION = `sha256:${"a".repeat(64)}`;

function authority(overrides: Partial<PresentationRemoteIntentReceiverAuthority> = {}): PresentationRemoteIntentReceiverAuthority {
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
    mode: "live",
    enabled: true,
    active: true,
    online: true,
    viewerCanControl: true,
    controllerOwned: true,
    controllerLeaseActive: true,
    sessionLive: true,
    ...overrides,
  };
}

function payload(type: PresentationRemoteIntentType) {
  if (type === "set_blackout") return { enabled: true };
  if (type === "set_chords") return { visible: false };
  return {};
}

function pending(type: PresentationRemoteIntentType = "program_next", overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    serviceId: "service-1",
    sessionId: SESSION_ID,
    serverNow: new Date(NOW_MS).toISOString(),
    leaseExpiresAt: new Date(NOW_MS + 20_000).toISOString(),
    intents: [{
      id: INTENT_ID,
      deliveryId: DELIVERY_ID,
      type,
      payload: payload(type),
      createdAt: new Date(NOW_MS - 1_000).toISOString(),
      expiresAt: new Date(NOW_MS + 9_000).toISOString(),
      ...overrides,
    }],
  };
}

function acknowledgement(status: "applied" | "rejected" | "failed", idempotent = false) {
  return {
    schemaVersion: 1,
    serviceId: "service-1",
    sessionId: SESSION_ID,
    deliveryId: DELIVERY_ID,
    status,
    idempotent,
  };
}

function authoritativeCommandResult(type: unknown, payload: unknown, rawOptions: unknown, idempotent = true) {
  const commandType = String(type);
  const commandPayload = payload as { blackout?: boolean; chordsVisible?: boolean };
  const options = rawOptions as { commandId?: string };
  return {
    local: false,
    ...(idempotent ? { idempotent: true } : {}),
    snapshot: {
      serviceId: "service-1",
      session: {
        id: SESSION_ID,
        display: {
          blackout: commandType === "set_blackout" ? commandPayload.blackout : false,
          chordsVisible: commandType === "set_chords" ? commandPayload.chordsVisible : true,
        },
        lastCommand: idempotent ? null : { id: options.commandId, type: commandType },
      },
    },
  };
}

function commandSender(implementation: (...args: unknown[]) => Promise<unknown> = async (...args) => authoritativeCommandResult(args[0], args[1], args[2])) {
  return vi.fn(implementation) as unknown as PresentationRemoteIntentReceiverCommandSender;
}

function processOptions(input: {
  type?: PresentationRemoteIntentType;
  request?: PresentationRemoteIntentReceiverRequest;
  sendCommand?: PresentationRemoteIntentReceiverCommandSender;
  auth?: PresentationRemoteIntentReceiverAuthority;
  current?: () => boolean;
  now?: () => number;
}) {
  const auth = input.auth || authority();
  const request = input.request || (vi.fn(async (path: string) => path.includes("/pending") ? pending(input.type) : acknowledgement("applied")) as unknown as PresentationRemoteIntentReceiverRequest);
  return {
    authority: auth,
    currentRevision: 17,
    sendCommand: input.sendCommand || commandSender(),
    request,
    signal: new AbortController().signal,
    isAuthorityCurrent: input.current || (() => true),
    now: input.now || (() => NOW_MS),
    storage: window.localStorage,
  };
}

afterEach(() => {
  clearPresentationRemoteIntentReceiverStorage(window.localStorage);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("presentation remote intent receiver authority", () => {
  it("receives only as the exact controller client, not another client owned by the same viewer", () => {
    expect(canReceivePresentationRemoteIntents(authority())).toBe(true);
    expect(canReceivePresentationRemoteIntents(authority({ controllerClientId: OTHER_CLIENT_ID, controllerOwned: true }))).toBe(false);
    expect(canReceivePresentationRemoteIntents(authority({ controllerOwned: false }))).toBe(false);
    expect(canReceivePresentationRemoteIntents(authority({ viewerCanControl: false }))).toBe(false);
    expect(canReceivePresentationRemoteIntents(authority({ controllerAuthorityVersion: null }))).toBe(false);
    expect(canReceivePresentationRemoteIntents(authority({ controllerAuthorityVersion: "sha256:not-a-digest" }))).toBe(false);
    expect(canReceivePresentationRemoteIntents(authority({ controllerAuthorityVersion: `sha256:${"A".repeat(64)}` }))).toBe(false);
    expect(canReceivePresentationRemoteIntents(authority({ mode: "rehearsal", active: false }))).toBe(false);
    expect(canReceivePresentationRemoteIntents(authority({ online: false }))).toBe(false);
  });

  it("fails closed before GET, command, or ACK when the stable controller authority digest is absent", async () => {
    const request = vi.fn() as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();
    expect(await processPresentationRemoteIntentOnce(processOptions({
      auth: authority({ controllerAuthorityVersion: null }),
      request,
      sendCommand,
    }))).toEqual({ phase: "inactive" });
    expect(request).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("does not rotate authority or persistence for controllerVersion-only heartbeat changes", async () => {
    const first = authority();
    const heartbeat = authority({ controllerVersion: "controller-heartbeat-v2" });
    expect(presentationRemoteIntentReceiverAuthorityScope(heartbeat)).toBe(presentationRemoteIntentReceiverAuthorityScope(first));
    const request = vi.fn(async (path: string) => {
      if (path.includes("/pending")) return pending();
      throw new ApiError("Offline", 0, { error: "OFFLINE" });
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    await processPresentationRemoteIntentOnce(processOptions({ auth: first, request }));
    activatePresentationRemoteIntentReceiverIdentity("account-1", "church-1", window.localStorage);
    expect(readPresentationRemoteIntentReceiverReceipt(heartbeat, DELIVERY_ID, window.localStorage)?.phase).toBe("ack_pending");
  });

  it.each([
    { sessionId: "66666666-6666-4666-8666-666666666666" },
    { clientId: OTHER_CLIENT_ID, controllerClientId: OTHER_CLIENT_ID },
    { controllerClientId: OTHER_CLIENT_ID },
    { controllerOwned: false },
    { viewerVersion: "viewer-v2" },
    { controllerAuthorityVersion: `sha256:${"b".repeat(64)}` },
    { mode: "rehearsal" as const, active: false },
    { online: false },
  ])("rotates or disables authority for $sessionId$clientId$controllerClientId$viewerVersion$mode", (changed) => {
    const base = authority();
    const next = authority(changed);
    expect(
      presentationRemoteIntentReceiverAuthorityScope(next) !== presentationRemoteIntentReceiverAuthorityScope(base)
      || !canReceivePresentationRemoteIntents(next),
    ).toBe(true);
  });
});

describe("presentation remote intent receiver delivery ledger", () => {
  it("applies program navigation directly with deliveryId as commandId, then ACKs", async () => {
    const request = vi.fn(async (path: string) => path.includes("/pending") ? pending("program_next") : acknowledgement("applied")) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();
    const result = await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }));

    expect(result).toEqual({ phase: "applied", deliveryId: DELIVERY_ID });
    expect(sendCommand).toHaveBeenCalledWith("next", {}, expect.objectContaining({
      commandId: DELIVERY_ID,
      expectedRevision: 17,
      allowOffline: false,
      signal: expect.any(AbortSignal),
      timeoutMs: 2_500,
    }));
    const ackBody = JSON.parse((request as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
    expect(ackBody).toEqual({
      schemaVersion: 1,
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      deliveryId: DELIVERY_ID,
      status: "applied",
      errorCode: null,
    });
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("acked");
  });

  it("accepts an exact lastCommand receipt when the command response is not marked idempotent", async () => {
    const request = vi.fn(async (path: string) => path.includes("/pending") ? pending("program_previous") : acknowledgement("applied")) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async (...args) => authoritativeCommandResult(args[0], args[1], args[2], false));

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({
      phase: "applied",
      deliveryId: DELIVERY_ID,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps command_started and skips ACK when a resolved command lacks authoritative receipt proof", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes("/pending")) return pending("program_next");
      throw new Error("An unproven command must never be ACKed as applied.");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async () => ({
      local: false,
      snapshot: {
        serviceId: "service-1",
        session: { id: SESSION_ID, display: { blackout: false, chordsVisible: true }, lastCommand: null },
      },
    }));

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({
      phase: "retry",
      deliveryId: DELIVERY_ID,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("command_started");
  });

  it.each([
    ["service", { serviceId: "other-service", sessionId: SESSION_ID }],
    ["session", { serviceId: "service-1", sessionId: "66666666-6666-4666-8666-666666666666" }],
  ] as const)("rejects an idempotent command receipt for the wrong %s", async (_label, scope) => {
    const request = vi.fn(async (path: string) => {
      if (path.includes("/pending")) return pending("program_next");
      throw new Error("A cross-scope command must never be ACKed.");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async (...args) => {
      const result = authoritativeCommandResult(args[0], args[1], args[2]);
      result.snapshot.serviceId = scope.serviceId;
      result.snapshot.session.id = scope.sessionId;
      return result;
    });

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({
      phase: "retry",
      deliveryId: DELIVERY_ID,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    ["set_blackout", "blackout"],
    ["set_chords", "chordsVisible"],
  ] as const)("requires the exact %s display effect before applied ACK", async (type, displayKey) => {
    const request = vi.fn(async (path: string) => {
      if (path.includes("/pending")) return pending(type);
      throw new Error("A command with the wrong display effect must never be ACKed.");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async (...args) => {
      const result = authoritativeCommandResult(args[0], args[1], args[2]);
      result.snapshot.session.display[displayKey] = !result.snapshot.session.display[displayKey];
      return result;
    });

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({
      phase: "retry",
      deliveryId: DELIVERY_ID,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("retries a persisted ACK before GET when the server committed it but its response was lost", async () => {
    let ackAttempts = 0;
    const paths: string[] = [];
    const request = vi.fn(async (path: string) => {
      paths.push(path);
      if (path.includes("/pending")) return pending("set_blackout");
      ackAttempts += 1;
      if (ackAttempts === 1) throw new ApiError("Offline", 0, { error: "OFFLINE" });
      return acknowledgement("applied", true);
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "retry", deliveryId: DELIVERY_ID });
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("ack_pending");
    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "applied", deliveryId: DELIVERY_ID });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith("set_blackout", { blackout: true }, expect.objectContaining({
      commandId: DELIVERY_ID,
      expectedRevision: 17,
      allowOffline: false,
      signal: expect.any(AbortSignal),
      timeoutMs: 2_500,
    }));
    expect(ackAttempts).toBe(2);
    expect(paths.map((path) => path.includes("/pending") ? "GET" : "ACK")).toEqual(["GET", "ACK", "ACK"]);
  });

  it("retries an ambiguous command with the same deliveryId and persisted revision", async () => {
    const request = vi.fn(async (path: string) => path.includes("/pending") ? pending("program_previous") : acknowledgement("applied")) as unknown as PresentationRemoteIntentReceiverRequest;
    let commandAttempts = 0;
    const sendCommand = commandSender(async (...args) => {
      commandAttempts += 1;
      if (commandAttempts === 1) throw new ApiError("Offline", 0, { error: "OFFLINE" });
      return authoritativeCommandResult(args[0], args[1], args[2]);
    });

    await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }));
    await processPresentationRemoteIntentOnce({ ...processOptions({ request, sendCommand }), currentRevision: 99 });
    expect(sendCommand).toHaveBeenCalledTimes(2);
    const attempts = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2] as Record<string, unknown>);
    expect(attempts.map(({ commandId, expectedRevision, allowOffline }) => ({ commandId, expectedRevision, allowOffline }))).toEqual([
      { commandId: DELIVERY_ID, expectedRevision: 17, allowOffline: false },
      { commandId: DELIVERY_ID, expectedRevision: 17, allowOffline: false },
    ]);
    expect(attempts.every((attempt) => attempt.signal instanceof AbortSignal && attempt.timeoutMs === 2_500)).toBe(true);
  });

  it.each(["preview_previous", "preview_next", "take"] as const)("rejects unsupported %s without a presentation command", async (type) => {
    const request = vi.fn(async (path: string, options: { body?: string }) => {
      if (path.includes("/pending")) return pending(type);
      expect(JSON.parse(options.body || "{}")).toMatchObject({ status: "rejected", errorCode: "UNSUPPORTED_INTENT" });
      return acknowledgement("rejected");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();
    expect(await processPresentationRemoteIntentOnce(processOptions({ type, request, sendCommand }))).toEqual({ phase: "rejected", deliveryId: DELIVERY_ID });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("drops an already expired delivery before command or ACK", async () => {
    const request = vi.fn(async () => pending("program_next", { expiresAt: new Date(NOW_MS).toISOString() })) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();
    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "expired", deliveryId: DELIVERY_ID });
    expect(request).toHaveBeenCalledOnce();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("never reports applied when an authoritative command response crosses the conservative deadline", async () => {
    let deviceNow = NOW_MS;
    const request = vi.fn(async (path: string) => path.includes("/pending") ? pending("set_chords") : acknowledgement("applied")) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async (...args) => {
      deviceNow = NOW_MS + 10_500;
      return authoritativeCommandResult(args[0], args[1], args[2]);
    });
    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand, now: () => deviceNow }))).toEqual({ phase: "expired", deliveryId: DELIVERY_ID });
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("expired");
  });

  it("uses request start for the local deadline so two seconds of pending transit never extend TTL", async () => {
    let clock = 1_000;
    const request = vi.fn(async (path: string) => {
      if (path.includes("/pending")) {
        clock = 3_000;
        return pending("program_next", { expiresAt: new Date(NOW_MS + 1_000).toISOString() });
      }
      throw new Error("No ACK should be attempted after expiry.");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();
    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand, now: () => clock }))).toEqual({ phase: "expired", deliveryId: DELIVERY_ID });
    expect(sendCommand).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not retry an ambiguous command after its transit-safe deadline", async () => {
    let clock = 1_000;
    const request = vi.fn(async (path: string) => path.includes("/pending") ? pending("program_next", { expiresAt: new Date(NOW_MS + 1_000).toISOString() }) : acknowledgement("rejected")) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async () => {
      clock = 2_001;
      throw new ApiError("Offline", 0, { error: "OFFLINE" });
    });
    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand, now: () => clock }))).toEqual({ phase: "expired", deliveryId: DELIVERY_ID });
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it("aborts a pending GET after 2.5 seconds even when the injected transport ignores its signal", async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | null = null;
    const request = vi.fn(async (_path: string, options: { signal: AbortSignal; timeoutMs: number }) => {
      transportSignal = options.signal;
      expect(options.timeoutMs).toBe(2_500);
      return new Promise<unknown>(() => undefined);
    }) as unknown as PresentationRemoteIntentReceiverRequest;

    const processing = processPresentationRemoteIntentOnce(processOptions({ request }));
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(processing).resolves.toEqual({ phase: "retry", deliveryId: "" });
    expect(transportSignal?.aborted).toBe(true);
  });

  it("propagates the bounded timeout and abort signal through an ambiguous command transport", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => pending("program_next")) as unknown as PresentationRemoteIntentReceiverRequest;
    let commandSignal: AbortSignal | null = null;
    const sendCommand = commandSender(async (_type, _payload, rawOptions) => {
      const options = rawOptions as { signal: AbortSignal; timeoutMs: number };
      commandSignal = options.signal;
      expect(options.timeoutMs).toBe(2_500);
      return new Promise<unknown>(() => undefined);
    });

    const processing = processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }));
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(processing).resolves.toEqual({ phase: "retry", deliveryId: DELIVERY_ID });
    expect(commandSignal?.aborted).toBe(true);
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("command_started");
  });

  it("aborts an ACK POST after 2.5 seconds and keeps the durable ACK pending", async () => {
    vi.useFakeTimers();
    let acknowledgementSignal: AbortSignal | null = null;
    const request = vi.fn(async (path: string, options: { signal: AbortSignal; timeoutMs: number }) => {
      if (path.includes("/pending")) return pending("set_chords");
      acknowledgementSignal = options.signal;
      expect(options.timeoutMs).toBe(2_500);
      return new Promise<unknown>(() => undefined);
    }) as unknown as PresentationRemoteIntentReceiverRequest;

    const processing = processPresentationRemoteIntentOnce(processOptions({ request }));
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(processing).resolves.toEqual({ phase: "retry", deliveryId: DELIVERY_ID });
    expect(acknowledgementSignal?.aborted).toBe(true);
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("ack_pending");
  });

  it("never reports applied when the ACK response arrives after the delivery deadline", async () => {
    let deviceNow = NOW_MS;
    const request = vi.fn(async (path: string) => {
      if (path.includes("/pending")) return pending("program_next");
      deviceNow = NOW_MS + 9_500;
      return acknowledgement("applied");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand, now: () => deviceNow }))).toEqual({
      phase: "expired",
      deliveryId: DELIVERY_ID,
    });
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("expired");
  });

  it("ACKs a nonambiguous 409 once as rejected and never retries the command", async () => {
    let pendingFetches = 0;
    let acknowledgementPosts = 0;
    const request = vi.fn(async (path: string, options: { body?: string }) => {
      if (path.includes("/pending")) {
        pendingFetches += 1;
        if (pendingFetches === 1) return pending("program_next");
        return {
          schemaVersion: 1,
          serviceId: "service-1",
          sessionId: SESSION_ID,
          serverNow: new Date(NOW_MS).toISOString(),
          leaseExpiresAt: null,
          intents: [],
        };
      }
      acknowledgementPosts += 1;
      expect(JSON.parse(options.body || "{}")).toMatchObject({
        status: "rejected",
        errorCode: "REVISION_CONFLICT",
      });
      return acknowledgement("rejected");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async () => {
      throw new ApiError("Conflict", 409, { error: "REVISION_CONFLICT" });
    });

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "rejected", deliveryId: DELIVERY_ID });
    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "idle" });
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(acknowledgementPosts).toBe(1);
  });

  it("expires DELIVERY_LEASE_INVALID locally without ACK or command reexecution", async () => {
    const request = vi.fn(async (path: string) => {
      if (!path.includes("/pending")) throw new Error("A stale delivery lease must never be ACKed.");
      return pending("program_next");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async () => {
      throw new ApiError("Lease changed", 409, { error: "DELIVERY_LEASE_INVALID" });
    });

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "expired", deliveryId: DELIVERY_ID });
    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "expired", deliveryId: DELIVERY_ID });
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("expired");
  });

  it("ACKs COMMAND_ID_REUSED once as a terminal safe failure", async () => {
    const request = vi.fn(async (path: string, options: { body?: string }) => {
      if (path.includes("/pending")) return pending("set_blackout");
      expect(JSON.parse(options.body || "{}")).toMatchObject({
        status: "failed",
        errorCode: "COMMAND_ID_REUSED",
      });
      return acknowledgement("failed");
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender(async () => {
      throw new ApiError("Command id collision", 409, { error: "COMMAND_ID_REUSED" });
    });

    expect(await processPresentationRemoteIntentOnce(processOptions({ request, sendCommand }))).toEqual({ phase: "failed", deliveryId: DELIVERY_ID });
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)?.phase).toBe("acked");
  });

  it("halts immediately when pending access is revoked", async () => {
    const request = vi.fn(async () => {
      throw new ApiError("Forbidden", 403, { error: "FORBIDDEN" });
    }) as unknown as PresentationRemoteIntentReceiverRequest;

    expect(await processPresentationRemoteIntentOnce(processOptions({ request }))).toEqual({ phase: "halted", deliveryId: "" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("fails closed when authority changes after pending fetch", async () => {
    let current = true;
    const request = vi.fn(async () => {
      current = false;
      return pending();
    }) as unknown as PresentationRemoteIntentReceiverRequest;
    const sendCommand = commandSender();
    await expect(processPresentationRemoteIntentOnce(processOptions({ request, sendCommand, current: () => current }))).rejects.toMatchObject({ name: "AbortError" });
    expect(sendCommand).not.toHaveBeenCalled();
    expect(readPresentationRemoteIntentReceiverReceipt(authority(), DELIVERY_ID, window.localStorage)).toBeNull();
  });
});
