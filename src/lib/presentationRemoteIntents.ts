import { ApiError, apiFetch } from "@/lib/api";
import { createPresentationId } from "@/lib/presentationLive";

export const PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION = 1 as const;
export const PRESENTATION_REMOTE_INTENT_TTL_MS = 10_000;
export const PRESENTATION_REMOTE_INTENT_POLL_MS = 450;
export const PRESENTATION_REMOTE_INTENT_ATTEMPT_TIMEOUT_MS = 2_500;
const PRESENTATION_REMOTE_INTENT_AUTHORITY_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const PRESENTATION_REMOTE_INTENT_TYPES = [
  "preview_previous",
  "preview_next",
  "take",
  "program_previous",
  "program_next",
  "set_blackout",
  "set_chords",
] as const;

export type PresentationRemoteIntentType = (typeof PRESENTATION_REMOTE_INTENT_TYPES)[number];

export type PresentationRemoteIntentPayloads = {
  preview_previous: Record<string, never>;
  preview_next: Record<string, never>;
  take: Record<string, never>;
  program_previous: Record<string, never>;
  program_next: Record<string, never>;
  set_blackout: { enabled: boolean };
  set_chords: { visible: boolean };
};

export type PresentationRemoteIntentPhase = "idle" | "sending" | "pending" | "applied" | "rejected" | "expired" | "error";

export type PresentationRemoteIntentUiState = {
  phase: PresentationRemoteIntentPhase;
  intentId: string | null;
  type: PresentationRemoteIntentType | null;
  message: string | null;
};

export const IDLE_PRESENTATION_REMOTE_INTENT_STATE: PresentationRemoteIntentUiState = {
  phase: "idle",
  intentId: null,
  type: null,
  message: null,
};

export type PresentationRemoteIntentSender = <T extends PresentationRemoteIntentType>(
  type: T,
  payload: PresentationRemoteIntentPayloads[T],
) => Promise<PresentationRemoteIntentUiState>;

type PresentationRemoteIntentEnvelope<T extends PresentationRemoteIntentType = PresentationRemoteIntentType> = {
  schemaVersion: 1;
  sessionId: string;
  clientId: string;
  intent: {
    id: string;
    type: T;
    payload: PresentationRemoteIntentPayloads[T];
  };
};

type PresentationRemoteIntentSubmission = {
  schemaVersion: 1;
  serviceId: string;
  sessionId: string;
  idempotent: boolean;
  intent: {
    id: string;
    deliveryId: string;
    type: PresentationRemoteIntentType;
    status: "pending" | "applied" | "rejected" | "failed" | "expired" | "invalidated";
    createdAt: string;
    expiresAt: string;
  };
};

export type PresentationRemoteIntentRequest = (
  path: string,
  options: {
    method: "POST";
    body: string;
    cache: "no-store";
    sensitiveBody: true;
    churchId: string;
    signal: AbortSignal;
  },
) => Promise<unknown>;

export type PresentationRemoteIntentWait = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export type DispatchPresentationRemoteIntentOptions<T extends PresentationRemoteIntentType> = {
  churchId: string;
  serviceId: string;
  sessionId: string;
  clientId: string;
  type: T;
  payload: PresentationRemoteIntentPayloads[T];
  intentId?: string;
  request?: PresentationRemoteIntentRequest;
  now?: () => number;
  wait?: PresentationRemoteIntentWait;
  signal?: AbortSignal;
  isScopeCurrent?: () => boolean;
  onState?: (state: PresentationRemoteIntentUiState) => void;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBMISSION_STATUSES = new Set(["pending", "applied", "rejected", "failed", "expired", "invalidated"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validatePayload<T extends PresentationRemoteIntentType>(
  type: T,
  payload: PresentationRemoteIntentPayloads[T],
) {
  if (!isRecord(payload)) throw new Error("El control remoto requiere un payload válido.");
  if (type === "set_blackout") {
    if (!hasExactKeys(payload, ["enabled"]) || typeof (payload as Record<string, unknown>).enabled !== "boolean") {
      throw new Error("Salida en negro requiere únicamente payload.enabled.");
    }
    return;
  }
  if (type === "set_chords") {
    if (!hasExactKeys(payload, ["visible"]) || typeof (payload as Record<string, unknown>).visible !== "boolean") {
      throw new Error("Acordes requiere únicamente payload.visible.");
    }
    return;
  }
  if (!hasExactKeys(payload, [])) throw new Error(`${type} requiere un payload vacío.`);
}

export function buildPresentationRemoteIntentRequest<T extends PresentationRemoteIntentType>(params: {
  serviceId: string;
  sessionId: string;
  clientId: string;
  type: T;
  payload: PresentationRemoteIntentPayloads[T];
  intentId?: string;
}) {
  if (!params.serviceId.trim()) throw new Error("Falta el servicio para el control remoto.");
  if (!isUuid(params.sessionId)) throw new Error("La sesión remota no es válida.");
  if (!isUuid(params.clientId)) throw new Error("El identificador de este dispositivo no es válido.");
  const intentId = params.intentId || createPresentationId();
  if (!isUuid(intentId)) throw new Error("El identificador de la acción remota no es válido.");
  if (!PRESENTATION_REMOTE_INTENT_TYPES.includes(params.type)) throw new Error("La acción remota no es válida.");
  validatePayload(params.type, params.payload);
  const envelope: PresentationRemoteIntentEnvelope<T> = {
    schemaVersion: PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION,
    sessionId: params.sessionId.toLowerCase(),
    clientId: params.clientId.toLowerCase(),
    intent: {
      id: intentId.toLowerCase(),
      type: params.type,
      payload: params.payload,
    },
  };
  return {
    path: `/services/${encodeURIComponent(params.serviceId)}/presentation-remote-intents`,
    intentId: envelope.intent.id,
    envelope,
    body: JSON.stringify(envelope),
  };
}

export function parsePresentationRemoteIntentSubmission(
  raw: unknown,
  expected: { serviceId: string; sessionId: string; intentId: string; type: PresentationRemoteIntentType },
): PresentationRemoteIntentSubmission {
  if (!isRecord(raw)
    || !hasExactKeys(raw, ["schemaVersion", "serviceId", "sessionId", "idempotent", "intent"])
    || raw.schemaVersion !== PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION
    || raw.serviceId !== expected.serviceId
    || raw.sessionId !== expected.sessionId
    || typeof raw.idempotent !== "boolean"
    || !isRecord(raw.intent)
    || !hasExactKeys(raw.intent, ["id", "deliveryId", "type", "status", "createdAt", "expiresAt"])
    || raw.intent.id !== expected.intentId
    || raw.intent.type !== expected.type
    || !isUuid(raw.intent.id)
    || !isUuid(raw.intent.deliveryId)
    || typeof raw.intent.status !== "string"
    || !SUBMISSION_STATUSES.has(raw.intent.status)
    || !isIsoDate(raw.intent.createdAt)
    || !isIsoDate(raw.intent.expiresAt)) {
    throw new Error("El servidor devolvió una confirmación remota inválida.");
  }
  const createdAt = Date.parse(raw.intent.createdAt);
  const expiresAt = Date.parse(raw.intent.expiresAt);
  if (expiresAt <= createdAt || expiresAt - createdAt > PRESENTATION_REMOTE_INTENT_TTL_MS) {
    throw new Error("El servidor devolvió un plazo remoto inválido.");
  }
  return raw as PresentationRemoteIntentSubmission;
}

function defaultRequest(path: string, options: Parameters<PresentationRemoteIntentRequest>[1]) {
  return apiFetch<unknown>(path, options);
}

function abortError(message: string) {
  if (typeof DOMException !== "undefined") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function signalAbortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : abortError("La acción remota fue cancelada.");
}

function defaultWait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signalAbortError(signal));
      return;
    }
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      reject(signalAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject<T>(signalAbortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signalAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function createAttemptAbortScope(parentSignal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  let cleaned = false;
  const onParentAbort = () => controller.abort(signalAbortError(parentSignal));
  if (parentSignal.aborted) onParentAbort();
  else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(abortError("El intento remoto agotó su tiempo."));
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      globalThis.clearTimeout(timeoutId);
      parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

function errorCode(error: unknown) {
  if (!(error instanceof ApiError) || !isRecord(error.body)) return null;
  const value = error.body.error;
  return typeof value === "string" ? value : null;
}

function isAmbiguousTransportError(error: unknown) {
  return error instanceof ApiError
    && (error.status === 0 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500);
}

function rejectedTransportMessage(error: unknown) {
  const code = errorCode(error);
  if (code === "SESSION_CHANGED") return "La sesión en vivo cambió antes de aplicar el control.";
  if (code === "CONTROL_REQUIRED") return "Ya no hay un controlador activo para recibir la acción.";
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return "Tu acceso ya no permite controlar esta presentación.";
  return error instanceof Error ? error.message : "El controlador rechazó la acción.";
}

function state(
  phase: PresentationRemoteIntentPhase,
  intentId: string,
  type: PresentationRemoteIntentType,
  message: string,
): PresentationRemoteIntentUiState {
  return { phase, intentId, type, message };
}

function terminalState(submission: PresentationRemoteIntentSubmission): PresentationRemoteIntentUiState | null {
  const { id, type, status } = submission.intent;
  if (status === "pending") return null;
  if (status === "applied") return state("applied", id, type, "Aplicado por el controlador en vivo.");
  if (status === "expired") return state("expired", id, type, "La acción expiró antes de aplicarse.");
  if (status === "invalidated") return state("rejected", id, type, "El controlador cambió; la acción no se aplicó.");
  if (status === "rejected") return state("rejected", id, type, "El controlador rechazó la acción.");
  return state("error", id, type, "El controlador no pudo aplicar la acción.");
}

export async function dispatchPresentationRemoteIntent<T extends PresentationRemoteIntentType>(
  options: DispatchPresentationRemoteIntentOptions<T>,
): Promise<PresentationRemoteIntentUiState> {
  if (!options.churchId.trim()) throw new Error("Falta la iglesia para el control remoto.");
  const request = options.request || defaultRequest;
  const now = options.now || Date.now;
  const wait = options.wait || defaultWait;
  const isScopeCurrent = options.isScopeCurrent || (() => true);
  const operationSignal = options.signal || new AbortController().signal;
  const built = buildPresentationRemoteIntentRequest(options);
  const startedAtMs = now();
  let deadlineAtMs = startedAtMs + PRESENTATION_REMOTE_INTENT_TTL_MS;
  let accepted = false;
  let acceptedDelivery: { deliveryId: string; createdAt: string; expiresAt: string } | null = null;
  const isOperationCurrent = () => !operationSignal.aborted && isScopeCurrent();
  const cancelledState = () => state("rejected", built.intentId, options.type, "La sesión o el controlador cambió.");
  const emit = (next: PresentationRemoteIntentUiState) => {
    if (isOperationCurrent()) options.onState?.(next);
    return next;
  };
  const waitForPoll = async () => {
    if (!isOperationCurrent()) return false;
    const remainingMs = Math.max(0, deadlineAtMs - now());
    if (!remainingMs) return false;
    try {
      await raceWithAbort(
        Promise.resolve().then(() => wait(Math.min(PRESENTATION_REMOTE_INTENT_POLL_MS, remainingMs), operationSignal)),
        operationSignal,
      );
      return isOperationCurrent();
    } catch {
      return false;
    }
  };

  if (!isOperationCurrent()) return cancelledState();
  emit(state("sending", built.intentId, options.type, "Enviando al controlador en vivo…"));
  while (isOperationCurrent() && now() < deadlineAtMs) {
    let raw: unknown;
    const remainingMs = deadlineAtMs - now();
    const attempt = createAttemptAbortScope(
      operationSignal,
      Math.min(PRESENTATION_REMOTE_INTENT_ATTEMPT_TIMEOUT_MS, remainingMs),
    );
    try {
      raw = await raceWithAbort(
        Promise.resolve().then(() => request(built.path, {
          method: "POST",
          body: built.body,
          cache: "no-store",
          sensitiveBody: true,
          churchId: options.churchId,
          signal: attempt.signal,
        })),
        attempt.signal,
      );
    } catch (error) {
      const attemptTimedOut = attempt.didTimeOut();
      attempt.cleanup();
      if (!isOperationCurrent()) return cancelledState();
      if (!attemptTimedOut && !isAmbiguousTransportError(error)) {
        const phase = error instanceof ApiError && [401, 403, 404, 409].includes(error.status) ? "rejected" : "error";
        return emit(state(phase, built.intentId, options.type, rejectedTransportMessage(error)));
      }
      if (now() >= deadlineAtMs) break;
      emit(state(accepted ? "pending" : "sending", built.intentId, options.type, accepted
        ? "Esperando confirmación del controlador…"
        : "Confirmando que el controlador recibió la acción…"));
      if (!await waitForPoll()) return isOperationCurrent()
        ? emit(state("expired", built.intentId, options.type, "La acción expiró antes de recibir confirmación."))
        : cancelledState();
      continue;
    } finally {
      attempt.cleanup();
    }
    if (!isOperationCurrent()) return cancelledState();
    if (now() >= deadlineAtMs) {
      return emit(state("expired", built.intentId, options.type, "La acción expiró antes de recibir confirmación."));
    }

    let submission: PresentationRemoteIntentSubmission;
    try {
      submission = parsePresentationRemoteIntentSubmission(raw, {
        serviceId: options.serviceId,
        sessionId: options.sessionId.toLowerCase(),
        intentId: built.intentId,
        type: options.type,
      });
    } catch (error) {
      return emit(state("error", built.intentId, options.type, error instanceof Error ? error.message : "La confirmación remota no es válida."));
    }
    accepted = true;
    const delivery = {
      deliveryId: submission.intent.deliveryId,
      createdAt: submission.intent.createdAt,
      expiresAt: submission.intent.expiresAt,
    };
    if (acceptedDelivery
      && (acceptedDelivery.deliveryId !== delivery.deliveryId
        || acceptedDelivery.createdAt !== delivery.createdAt
        || acceptedDelivery.expiresAt !== delivery.expiresAt)) {
      return emit(state("error", built.intentId, options.type, "La identidad de entrega cambió durante la confirmación remota."));
    }
    acceptedDelivery ||= delivery;
    const serverTtlMs = Date.parse(submission.intent.expiresAt) - Date.parse(submission.intent.createdAt);
    deadlineAtMs = Math.min(deadlineAtMs, startedAtMs + serverTtlMs);
    if (now() >= deadlineAtMs) {
      return emit(state("expired", built.intentId, options.type, "La acción expiró antes de recibir confirmación."));
    }
    const terminal = terminalState(submission);
    if (terminal) return emit(terminal);
    emit(state("pending", built.intentId, options.type, "Enviado; esperando confirmación del controlador…"));
    if (!await waitForPoll()) return isOperationCurrent()
      ? emit(state("expired", built.intentId, options.type, "La acción expiró antes de recibir confirmación."))
      : cancelledState();
  }

  if (!isOperationCurrent()) return cancelledState();
  return emit(state("expired", built.intentId, options.type, "La acción expiró antes de recibir confirmación."));
}

export function presentationRemoteIntentScopeKey(input: {
  accountId?: string | null;
  churchId?: string | null;
  serviceId?: string | null;
  sessionId?: string | null;
  clientId?: string | null;
  controllerClientId?: string | null;
  viewerVersion?: string | null;
  /** Stable controller owner/generation fingerprint. */
  controllerAuthorityVersion?: string | null;
  /** Informational only: controllerVersion rotates on heartbeat lease renewal. */
  controllerVersion?: string | null;
  enabled: boolean;
  online: boolean;
  viewerCanControl: boolean;
  controllerOwned: boolean;
}) {
  return [
    input.accountId || "signed-out",
    input.churchId || "no-church",
    input.serviceId || "no-service",
    input.sessionId || "no-session",
    input.clientId || "no-client",
    input.controllerClientId || "no-controller",
    input.viewerVersion || "no-viewer-version",
    typeof input.controllerAuthorityVersion === "string"
      && PRESENTATION_REMOTE_INTENT_AUTHORITY_DIGEST_PATTERN.test(input.controllerAuthorityVersion)
      ? input.controllerAuthorityVersion
      : "no-controller-authority-version",
    input.enabled ? "enabled" : "disabled",
    input.online ? "online" : "offline",
    input.viewerCanControl ? "allowed" : "read-only",
    input.controllerOwned ? "owner" : "observer",
  ].join("::");
}

export function canSendPresentationRemoteIntent(input: {
  accountId?: string | null;
  churchId?: string | null;
  serviceId?: string | null;
  sessionId?: string | null;
  clientId?: string | null;
  controllerClientId?: string | null;
  controllerAuthorityVersion?: string | null;
  enabled: boolean;
  online: boolean;
  viewerCanControl: boolean;
  controllerOwned: boolean;
}) {
  return Boolean(
    input.enabled
    && input.online
    && input.viewerCanControl
    && !input.controllerOwned
    && input.accountId
    && input.churchId
    && input.serviceId
    && input.sessionId
    && input.clientId
    && input.controllerClientId
    && typeof input.controllerAuthorityVersion === "string"
    && PRESENTATION_REMOTE_INTENT_AUTHORITY_DIGEST_PATTERN.test(input.controllerAuthorityVersion)
    && input.controllerClientId !== input.clientId,
  );
}
