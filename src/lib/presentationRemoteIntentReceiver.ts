import { ApiError, apiFetch } from "@/lib/api";
import {
  getPresentationApiErrorCode,
  type PresentationCommandPayloads,
  type PresentationCommandType,
} from "@/lib/presentationLive";
import {
  PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION,
  PRESENTATION_REMOTE_INTENT_TTL_MS,
  PRESENTATION_REMOTE_INTENT_TYPES,
  type PresentationRemoteIntentPayloads,
  type PresentationRemoteIntentType,
} from "@/lib/presentationRemoteIntents";

export const PRESENTATION_REMOTE_INTENT_RECEIVER_POLL_MS = 750;
export const PRESENTATION_REMOTE_INTENT_RECEIVER_TIMEOUT_MS = 2_500;
export const PRESENTATION_REMOTE_INTENT_RECEIPT_STORAGE_KEY = "tchurch_remote_intent_receipts_v1";
export const PRESENTATION_REMOTE_INTENT_RECEIPT_IDENTITY_KEY = "tchurch_remote_intent_receipt_identity_v1";

export type PresentationRemoteIntentAckStatus = "applied" | "rejected" | "failed";

export type PresentationRemoteIntentDelivery = {
  id: string;
  deliveryId: string;
  type: PresentationRemoteIntentType;
  payload: PresentationRemoteIntentPayloads[PresentationRemoteIntentType];
  createdAt: string;
  expiresAt: string;
};

export type PresentationRemoteIntentPending = {
  schemaVersion: 1;
  serviceId: string;
  sessionId: string;
  serverNow: string;
  leaseExpiresAt: string | null;
  intents: PresentationRemoteIntentDelivery[];
  requestStartedAtMs: number;
  deadlineAtMs: number | null;
};

export type PresentationRemoteIntentAcknowledgement = {
  schemaVersion: 1;
  serviceId: string;
  sessionId: string;
  deliveryId: string;
  status: PresentationRemoteIntentAckStatus;
  idempotent: boolean;
};

export type PresentationRemoteIntentReceiverAuthority = {
  accountId?: string | null;
  churchId?: string | null;
  serviceId?: string | null;
  sessionId?: string | null;
  clientId?: string | null;
  controllerClientId?: string | null;
  viewerVersion?: string | null;
  /** Stable controller owner/generation fingerprint; unlike heartbeat versions, this rotates only on authority change. */
  controllerAuthorityVersion?: string | null;
  /** Informational only. Controller leases rotate this value on heartbeats. */
  controllerVersion?: string | null;
  mode: "live" | "rehearsal";
  enabled: boolean;
  active: boolean;
  online: boolean;
  viewerCanControl: boolean;
  controllerOwned: boolean;
  controllerLeaseActive: boolean;
  sessionLive: boolean;
};

export type PresentationRemoteIntentReceiverRequest = (
  path: string,
  options: {
    method?: "POST";
    body?: string;
    cache: "no-store";
    sensitiveBody?: true;
    churchId: string;
    signal: AbortSignal;
    timeoutMs: number;
  },
) => Promise<unknown>;

export type PresentationRemoteIntentReceiverCommandSender = <T extends PresentationCommandType>(
  type: T,
  payload: PresentationCommandPayloads[T],
  options: {
    commandId: string;
    expectedRevision: number;
    allowOffline: false;
    signal: AbortSignal;
    timeoutMs: number;
  },
) => Promise<unknown>;

export type PresentationRemoteIntentReceiverReceipt = {
  schemaVersion: 1;
  bindingScope: string;
  authorityScope: string;
  deliveryId: string;
  intentId: string;
  type: PresentationRemoteIntentType;
  payloadJson: string;
  createdAt: string;
  expiresAt: string;
  deadlineAtMs: number;
  expectedRevision: number | null;
  phase: "command_started" | "ack_pending" | "acked" | "expired";
  ackStatus: PresentationRemoteIntentAckStatus | null;
  errorCode: string | null;
  updatedAt: string;
};

type ProcessOptions = {
  authority: PresentationRemoteIntentReceiverAuthority;
  currentRevision: number;
  sendCommand: PresentationRemoteIntentReceiverCommandSender;
  request?: PresentationRemoteIntentReceiverRequest;
  signal: AbortSignal;
  isAuthorityCurrent: () => boolean;
  now?: () => number;
  storage?: Storage;
};

export type PresentationRemoteIntentReceiverResult =
  | { phase: "inactive" | "idle" }
  | { phase: "applied" | "rejected" | "failed" | "expired" | "retry" | "halted"; deliveryId: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ACK_STATUSES = new Set<PresentationRemoteIntentAckStatus>(["applied", "rejected", "failed"]);
const RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_RECEIPTS = 128;

class PresentationRemoteIntentReceiverTimeoutError extends Error {
  constructor() {
    super("La solicitud de control remoto agotó su tiempo disponible.");
    this.name = "TimeoutError";
  }
}

function receiverAbortError() {
  const error = new Error("La autoridad del receptor remoto cambió.");
  error.name = "AbortError";
  return error;
}

async function runWithReceiverTimeout<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  action: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
) {
  if (parentSignal.aborted) throw receiverAbortError();
  const budgetMs = Math.max(0, Math.floor(timeoutMs));
  if (budgetMs <= 0) throw new PresentationRemoteIntentReceiverTimeoutError();

  const controller = new AbortController();
  let rejectCancellation: (error: Error) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const onParentAbort = () => {
    rejectCancellation(receiverAbortError());
    controller.abort();
  };
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    rejectCancellation(new PresentationRemoteIntentReceiverTimeoutError());
    controller.abort();
  }, budgetMs);

  try {
    return await Promise.race([action(controller.signal, budgetMs), cancellation]);
  } finally {
    globalThis.clearTimeout(timeoutId);
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}

export function createPresentationRemoteIntentReceiverClock() {
  const wallStartedAt = Date.now();
  const monotonicStartedAt = typeof performance === "undefined" ? 0 : performance.now();
  let last = wallStartedAt;
  return () => {
    const monotonicElapsed = typeof performance === "undefined" ? 0 : Math.max(0, performance.now() - monotonicStartedAt);
    last = Math.max(last, Date.now(), wallStartedAt + monotonicElapsed);
    return last;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
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

function validatePayload(type: PresentationRemoteIntentType, payload: unknown): PresentationRemoteIntentPayloads[PresentationRemoteIntentType] {
  if (!isRecord(payload)) throw new Error("La entrega remota no tiene un payload válido.");
  if (type === "set_blackout") {
    if (!exactKeys(payload, ["enabled"]) || typeof payload.enabled !== "boolean") throw new Error("La entrega de blackout es inválida.");
    return { enabled: payload.enabled };
  }
  if (type === "set_chords") {
    if (!exactKeys(payload, ["visible"]) || typeof payload.visible !== "boolean") throw new Error("La entrega de acordes es inválida.");
    return { visible: payload.visible };
  }
  if (!exactKeys(payload, [])) throw new Error("La entrega remota contiene datos inesperados.");
  return {};
}

function defaultRequest(path: string, options: Parameters<PresentationRemoteIntentReceiverRequest>[1]) {
  return apiFetch<unknown>(path, options);
}

function activeStorage(storage?: Storage) {
  if (storage) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

function receiptValid(value: unknown): value is PresentationRemoteIntentReceiverReceipt {
  if (!isRecord(value)
    || !exactKeys(value, [
      "schemaVersion", "bindingScope", "authorityScope", "deliveryId", "intentId", "type", "payloadJson",
      "createdAt", "expiresAt", "deadlineAtMs", "expectedRevision", "phase", "ackStatus", "errorCode", "updatedAt",
    ])
    || value.schemaVersion !== PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION
    || typeof value.bindingScope !== "string"
    || typeof value.authorityScope !== "string"
    || !isUuid(value.deliveryId)
    || !isUuid(value.intentId)
    || !PRESENTATION_REMOTE_INTENT_TYPES.includes(value.type as PresentationRemoteIntentType)
    || typeof value.payloadJson !== "string"
    || !isIsoDate(value.createdAt)
    || !isIsoDate(value.expiresAt)
    || !Number.isFinite(value.deadlineAtMs)
    || (value.expectedRevision !== null && (!Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0))
    || !["command_started", "ack_pending", "acked", "expired"].includes(String(value.phase))
    || (value.ackStatus !== null && !ACK_STATUSES.has(value.ackStatus as PresentationRemoteIntentAckStatus))
    || (value.errorCode !== null && (typeof value.errorCode !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(value.errorCode)))
    || !isIsoDate(value.updatedAt)) return false;
  if ((value.phase === "ack_pending" || value.phase === "acked") && value.ackStatus === null) return false;
  return true;
}

function readReceipts(storage?: Storage, nowMs = Date.now()) {
  const target = activeStorage(storage);
  if (!target) return [] as PresentationRemoteIntentReceiverReceipt[];
  try {
    const raw = JSON.parse(target.getItem(PRESENTATION_REMOTE_INTENT_RECEIPT_STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) throw new Error("invalid receipt storage");
    return raw
      .filter(receiptValid)
      .filter((receipt) => nowMs - Date.parse(receipt.updatedAt) <= RECEIPT_RETENTION_MS)
      .slice(-MAX_RECEIPTS);
  } catch {
    target.removeItem(PRESENTATION_REMOTE_INTENT_RECEIPT_STORAGE_KEY);
    return [] as PresentationRemoteIntentReceiverReceipt[];
  }
}

function writeReceipts(receipts: PresentationRemoteIntentReceiverReceipt[], storage?: Storage) {
  const target = activeStorage(storage);
  if (!target) throw new Error("No hay almacenamiento seguro para deduplicar el control remoto.");
  target.setItem(PRESENTATION_REMOTE_INTENT_RECEIPT_STORAGE_KEY, JSON.stringify(receipts.slice(-MAX_RECEIPTS)));
}

export function activatePresentationRemoteIntentReceiverIdentity(accountId: string, churchId: string, storage?: Storage) {
  const target = activeStorage(storage);
  if (!target) return;
  const identity = JSON.stringify([accountId, churchId]);
  const previous = target.getItem(PRESENTATION_REMOTE_INTENT_RECEIPT_IDENTITY_KEY);
  if (previous && previous !== identity) target.removeItem(PRESENTATION_REMOTE_INTENT_RECEIPT_STORAGE_KEY);
  target.setItem(PRESENTATION_REMOTE_INTENT_RECEIPT_IDENTITY_KEY, identity);
}

export function clearPresentationRemoteIntentReceiverStorage(storage?: Storage) {
  const target = activeStorage(storage);
  target?.removeItem(PRESENTATION_REMOTE_INTENT_RECEIPT_STORAGE_KEY);
  target?.removeItem(PRESENTATION_REMOTE_INTENT_RECEIPT_IDENTITY_KEY);
}

export function presentationRemoteIntentReceiverBindingScope(authority: PresentationRemoteIntentReceiverAuthority) {
  return JSON.stringify([
    authority.accountId || "signed-out",
    authority.churchId || "no-church",
    authority.serviceId || "no-service",
    authority.sessionId || "no-session",
    authority.clientId || "no-client",
  ]);
}

export function presentationRemoteIntentReceiverAuthorityScope(authority: PresentationRemoteIntentReceiverAuthority) {
  return JSON.stringify([
    presentationRemoteIntentReceiverBindingScope(authority),
    authority.controllerClientId || "no-controller",
    authority.viewerVersion || "no-viewer-version",
    typeof authority.controllerAuthorityVersion === "string" && SHA256_DIGEST_PATTERN.test(authority.controllerAuthorityVersion)
      ? authority.controllerAuthorityVersion
      : "no-controller-authority-version",
    authority.mode,
    authority.enabled ? "enabled" : "disabled",
    authority.active ? "active" : "inactive",
    authority.online ? "online" : "offline",
    authority.viewerCanControl ? "allowed" : "read-only",
    authority.controllerOwned ? "owner" : "observer",
    authority.controllerLeaseActive ? "lease-active" : "lease-expired",
    authority.sessionLive ? "session-live" : "session-inactive",
  ]);
}

export function canReceivePresentationRemoteIntents(authority: PresentationRemoteIntentReceiverAuthority) {
  return Boolean(
    authority.enabled
    && authority.active
    && authority.mode === "live"
    && authority.online
    && authority.viewerCanControl
    && authority.controllerOwned
    && authority.controllerLeaseActive
    && authority.sessionLive
    && authority.accountId
    && authority.churchId
    && authority.serviceId
    && authority.sessionId
    && authority.clientId
    && authority.controllerClientId === authority.clientId
    && authority.viewerVersion
    && typeof authority.controllerAuthorityVersion === "string"
    && SHA256_DIGEST_PATTERN.test(authority.controllerAuthorityVersion),
  );
}

export function parsePresentationRemoteIntentPending(
  raw: unknown,
  expected: { serviceId: string; sessionId: string },
  requestStartedAtMs = Date.now(),
): PresentationRemoteIntentPending {
  if (!isRecord(raw)
    || !exactKeys(raw, ["schemaVersion", "serviceId", "sessionId", "serverNow", "leaseExpiresAt", "intents"])
    || raw.schemaVersion !== PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION
    || raw.serviceId !== expected.serviceId
    || raw.sessionId !== expected.sessionId
    || !isIsoDate(raw.serverNow)
    || (raw.leaseExpiresAt !== null && !isIsoDate(raw.leaseExpiresAt))
    || !Array.isArray(raw.intents)
    || raw.intents.length > 1) throw new Error("El servidor devolvió una cola remota inválida.");

  const intents = raw.intents.map((value) => {
    if (!isRecord(value)
      || !exactKeys(value, ["id", "deliveryId", "type", "payload", "createdAt", "expiresAt"])
      || !isUuid(value.id)
      || !isUuid(value.deliveryId)
      || !PRESENTATION_REMOTE_INTENT_TYPES.includes(value.type as PresentationRemoteIntentType)
      || !isIsoDate(value.createdAt)
      || !isIsoDate(value.expiresAt)) throw new Error("El servidor devolvió una entrega remota inválida.");
    const createdAtMs = Date.parse(value.createdAt);
    const expiresAtMs = Date.parse(value.expiresAt);
    if (expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > PRESENTATION_REMOTE_INTENT_TTL_MS) {
      throw new Error("El servidor devolvió un plazo remoto inválido.");
    }
    return {
      id: value.id.toLowerCase(),
      deliveryId: value.deliveryId.toLowerCase(),
      type: value.type as PresentationRemoteIntentType,
      payload: validatePayload(value.type as PresentationRemoteIntentType, value.payload),
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
    };
  });
  if ((intents.length === 0) !== (raw.leaseExpiresAt === null)) throw new Error("La concesión remota no coincide con la entrega.");
  const effectiveServerDeadlineMs = intents[0]
    ? Math.min(Date.parse(intents[0].expiresAt), Date.parse(raw.leaseExpiresAt as string))
    : null;
  const remainingMs = effectiveServerDeadlineMs === null ? null : Math.max(0, effectiveServerDeadlineMs - Date.parse(raw.serverNow));
  return {
    schemaVersion: PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION,
    serviceId: expected.serviceId,
    sessionId: expected.sessionId,
    serverNow: raw.serverNow,
    leaseExpiresAt: raw.leaseExpiresAt as string | null,
    intents,
    requestStartedAtMs,
    deadlineAtMs: remainingMs === null ? null : requestStartedAtMs + remainingMs,
  };
}

export function parsePresentationRemoteIntentAcknowledgement(
  raw: unknown,
  expected: { serviceId: string; sessionId: string; deliveryId: string; status: PresentationRemoteIntentAckStatus },
): PresentationRemoteIntentAcknowledgement {
  if (!isRecord(raw)
    || !exactKeys(raw, ["schemaVersion", "serviceId", "sessionId", "deliveryId", "status", "idempotent"])
    || raw.schemaVersion !== PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION
    || raw.serviceId !== expected.serviceId
    || raw.sessionId !== expected.sessionId
    || raw.deliveryId !== expected.deliveryId
    || raw.status !== expected.status
    || typeof raw.idempotent !== "boolean") throw new Error("El servidor devolvió un ACK remoto inválido.");
  return raw as PresentationRemoteIntentAcknowledgement;
}

function receiptForDelivery(bindingScope: string, deliveryId: string, storage?: Storage, nowMs = Date.now()) {
  return readReceipts(storage, nowMs).find((receipt) => receipt.bindingScope === bindingScope && receipt.deliveryId === deliveryId) || null;
}

function saveReceipt(receipt: PresentationRemoteIntentReceiverReceipt, storage?: Storage, nowMs = Date.now()) {
  const current = readReceipts(storage, nowMs).filter((candidate) => !(candidate.bindingScope === receipt.bindingScope && candidate.deliveryId === receipt.deliveryId));
  writeReceipts([...current, receipt], storage);
  return receipt;
}

export function readPresentationRemoteIntentReceiverReceipt(
  authority: PresentationRemoteIntentReceiverAuthority,
  deliveryId: string,
  storage?: Storage,
) {
  return receiptForDelivery(presentationRemoteIntentReceiverBindingScope(authority), deliveryId, storage);
}

function deliveryExpired(pending: PresentationRemoteIntentPending, delivery: PresentationRemoteIntentDelivery, deviceNowMs: number) {
  void delivery;
  return pending.deadlineAtMs === null || deviceNowMs >= pending.deadlineAtMs;
}

function receiptExpired(receipt: PresentationRemoteIntentReceiverReceipt, deviceNowMs: number) {
  return deviceNowMs >= receipt.deadlineAtMs;
}

function remainingRequestBudget(deadlineAtMs: number, deviceNowMs: number) {
  return Math.max(0, Math.min(PRESENTATION_REMOTE_INTENT_RECEIVER_TIMEOUT_MS, deadlineAtMs - deviceNowMs));
}

function receiptMatches(receipt: PresentationRemoteIntentReceiverReceipt, delivery: PresentationRemoteIntentDelivery) {
  return receipt.intentId === delivery.id
    && receipt.type === delivery.type
    && receipt.payloadJson === JSON.stringify(delivery.payload)
    && receipt.createdAt === delivery.createdAt
    && receipt.expiresAt === delivery.expiresAt;
}

function assertCurrent(options: ProcessOptions, expectedScope: string) {
  if (options.signal.aborted
    || !options.isAuthorityCurrent()
    || presentationRemoteIntentReceiverAuthorityScope(options.authority) !== expectedScope
    || !canReceivePresentationRemoteIntents(options.authority)) {
    throw receiverAbortError();
  }
}

function isAccessError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function isAmbiguousTransportError(error: unknown) {
  return error instanceof PresentationRemoteIntentReceiverTimeoutError
    || (error instanceof ApiError
      && (error.status === 0 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500));
}

function isNonAmbiguousClientError(error: unknown) {
  return error instanceof ApiError
    && error.status >= 400
    && error.status < 500
    && ![408, 425, 429].includes(error.status);
}

function safePresentationErrorCode(error: unknown, fallback: string) {
  const code = getPresentationApiErrorCode(error);
  return code && ERROR_CODE_PATTERN.test(code) ? code : fallback;
}

function terminalCommandAcknowledgement(error: unknown): {
  status: Exclude<PresentationRemoteIntentAckStatus, "applied">;
  errorCode: string;
} | null {
  if (!isNonAmbiguousClientError(error) || isAccessError(error)) return null;
  if ((error as ApiError).status === 409) {
    if (getPresentationApiErrorCode(error) === "COMMAND_ID_REUSED") {
      return { status: "failed", errorCode: "COMMAND_ID_REUSED" };
    }
    return { status: "rejected", errorCode: safePresentationErrorCode(error, "COMMAND_REJECTED") };
  }
  return { status: "failed", errorCode: safePresentationErrorCode(error, "COMMAND_FAILED") };
}

function markReceiptExpired(
  receipt: PresentationRemoteIntentReceiverReceipt,
  storage: Storage | undefined,
  nowMs: number,
) {
  return saveReceipt({
    ...receipt,
    phase: "expired",
    ackStatus: null,
    errorCode: null,
    updatedAt: new Date(nowMs).toISOString(),
  }, storage, nowMs);
}

function pendingAcknowledgementForAuthority(
  bindingScope: string,
  authorityScope: string,
  storage: Storage | undefined,
  nowMs: number,
) {
  return readReceipts(storage, nowMs).find((receipt) => (
    receipt.bindingScope === bindingScope
    && receipt.authorityScope === authorityScope
    && receipt.phase === "ack_pending"
  )) || null;
}

function commandForDelivery(delivery: PresentationRemoteIntentDelivery): {
  type: "next" | "previous" | "set_blackout" | "set_chords";
  payload: PresentationCommandPayloads["next"] | PresentationCommandPayloads["previous"] | PresentationCommandPayloads["set_blackout"] | PresentationCommandPayloads["set_chords"];
} | null {
  if (delivery.type === "program_next") return { type: "next", payload: {} };
  if (delivery.type === "program_previous") return { type: "previous", payload: {} };
  if (delivery.type === "set_blackout") return { type: "set_blackout", payload: { blackout: (delivery.payload as { enabled: boolean }).enabled } };
  if (delivery.type === "set_chords") return { type: "set_chords", payload: { chordsVisible: (delivery.payload as { visible: boolean }).visible } };
  return null;
}

async function sendMappedCommand(
  sendCommand: PresentationRemoteIntentReceiverCommandSender,
  delivery: PresentationRemoteIntentDelivery,
  expectedRevision: number,
  signal: AbortSignal,
  timeoutMs: number,
) {
  const command = commandForDelivery(delivery);
  if (!command) return null;
  const options = { commandId: delivery.deliveryId, expectedRevision, allowOffline: false as const, signal, timeoutMs };
  let result: unknown;
  if (command.type === "next") result = await sendCommand("next", {}, options);
  else if (command.type === "previous") result = await sendCommand("previous", {}, options);
  else if (command.type === "set_blackout") result = await sendCommand("set_blackout", command.payload as PresentationCommandPayloads["set_blackout"], options);
  else result = await sendCommand("set_chords", command.payload as PresentationCommandPayloads["set_chords"], options);
  return { command, result };
}

function commandWasAuthoritativelyApplied(
  result: unknown,
  authority: PresentationRemoteIntentReceiverAuthority,
  delivery: PresentationRemoteIntentDelivery,
  command: NonNullable<ReturnType<typeof commandForDelivery>>,
) {
  if (!isRecord(result) || result.local !== false || !isRecord(result.snapshot)) return false;
  const snapshot = result.snapshot;
  const session = isRecord(snapshot.session) ? snapshot.session : null;
  if (snapshot.serviceId !== authority.serviceId || !session || session.id !== authority.sessionId) return false;

  const lastCommand = isRecord(session.lastCommand) ? session.lastCommand : null;
  const hasReceipt = result.idempotent === true
    || (lastCommand?.id === delivery.deliveryId && lastCommand.type === command.type);
  if (!hasReceipt) return false;

  const display = isRecord(session.display) ? session.display : null;
  if (command.type === "set_blackout"
    && display?.blackout !== (command.payload as PresentationCommandPayloads["set_blackout"]).blackout) return false;
  if (command.type === "set_chords"
    && display?.chordsVisible !== (command.payload as PresentationCommandPayloads["set_chords"]).chordsVisible) return false;
  return true;
}

async function acknowledgeReceipt(
  options: ProcessOptions,
  receipt: PresentationRemoteIntentReceiverReceipt,
  expectedScope: string,
) {
  const now = options.now || Date.now;
  const request = options.request || defaultRequest;
  assertCurrent(options, expectedScope);
  const status = receipt.ackStatus;
  if (!status || receipt.phase !== "ack_pending") throw new Error("El recibo remoto no está listo para ACK.");
  const startedAtMs = now();
  if (receiptExpired(receipt, startedAtMs)) return markReceiptExpired(receipt, options.storage, startedAtMs);
  const timeoutMs = remainingRequestBudget(receipt.deadlineAtMs, startedAtMs);
  const raw = await runWithReceiverTimeout(options.signal, timeoutMs, (signal, requestTimeoutMs) => request(
    `/services/${encodeURIComponent(options.authority.serviceId!)}/presentation-remote-intents/ack`,
    {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION,
        sessionId: options.authority.sessionId,
        clientId: options.authority.clientId,
        deliveryId: receipt.deliveryId,
        status,
        errorCode: receipt.errorCode,
      }),
      cache: "no-store",
      sensitiveBody: true,
      churchId: options.authority.churchId!,
      signal,
      timeoutMs: requestTimeoutMs,
    },
  ));
  assertCurrent(options, expectedScope);
  parsePresentationRemoteIntentAcknowledgement(raw, {
    serviceId: options.authority.serviceId!,
    sessionId: options.authority.sessionId!,
    deliveryId: receipt.deliveryId,
    status,
  });
  const completedAtMs = now();
  if (receiptExpired(receipt, completedAtMs)) return markReceiptExpired(receipt, options.storage, completedAtMs);
  return saveReceipt({ ...receipt, phase: "acked", updatedAt: new Date(completedAtMs).toISOString() }, options.storage, completedAtMs);
}

async function finishAcknowledgement(
  options: ProcessOptions,
  receipt: PresentationRemoteIntentReceiverReceipt,
  expectedScope: string,
): Promise<PresentationRemoteIntentReceiverResult> {
  const now = options.now || Date.now;
  const startedAtMs = now();
  if (receiptExpired(receipt, startedAtMs)) {
    markReceiptExpired(receipt, options.storage, startedAtMs);
    return { phase: "expired", deliveryId: receipt.deliveryId };
  }
  try {
    const acknowledged = await acknowledgeReceipt(options, receipt, expectedScope);
    if (acknowledged.phase === "expired") return { phase: "expired", deliveryId: receipt.deliveryId };
    return { phase: acknowledged.ackStatus || "failed", deliveryId: receipt.deliveryId };
  } catch (error) {
    assertCurrent(options, expectedScope);
    const failedAtMs = now();
    if (receiptExpired(receipt, failedAtMs)) {
      markReceiptExpired(receipt, options.storage, failedAtMs);
      return { phase: "expired", deliveryId: receipt.deliveryId };
    }
    if (error instanceof ApiError
      && error.status === 409
      && getPresentationApiErrorCode(error) === "DELIVERY_LEASE_INVALID") {
      markReceiptExpired(receipt, options.storage, failedAtMs);
      return { phase: "expired", deliveryId: receipt.deliveryId };
    }
    if (isAccessError(error) || isNonAmbiguousClientError(error)) {
      return { phase: "halted", deliveryId: receipt.deliveryId };
    }
    if (isAmbiguousTransportError(error) || error instanceof Error) {
      return { phase: "retry", deliveryId: receipt.deliveryId };
    }
    return { phase: "halted", deliveryId: receipt.deliveryId };
  }
}

export async function processPresentationRemoteIntentOnce(options: ProcessOptions): Promise<PresentationRemoteIntentReceiverResult> {
  if (!canReceivePresentationRemoteIntents(options.authority)) return { phase: "inactive" };
  const now = options.now || Date.now;
  const request = options.request || defaultRequest;
  const expectedScope = presentationRemoteIntentReceiverAuthorityScope(options.authority);
  const bindingScope = presentationRemoteIntentReceiverBindingScope(options.authority);
  assertCurrent(options, expectedScope);

  // Drain a durable ACK before leasing anything else. This closes the window
  // where the server committed an ACK but its response was lost in transit.
  const durableAcknowledgement = pendingAcknowledgementForAuthority(bindingScope, expectedScope, options.storage, now());
  if (durableAcknowledgement) return finishAcknowledgement(options, durableAcknowledgement, expectedScope);

  const requestStartedAtMs = now();
  let raw: unknown;
  try {
    raw = await runWithReceiverTimeout(options.signal, PRESENTATION_REMOTE_INTENT_RECEIVER_TIMEOUT_MS, (signal, timeoutMs) => request(
      `/services/${encodeURIComponent(options.authority.serviceId!)}/presentation-remote-intents/pending?clientId=${encodeURIComponent(options.authority.clientId!)}`,
      {
        cache: "no-store",
        churchId: options.authority.churchId!,
        signal,
        timeoutMs,
      },
    ));
  } catch (error) {
    assertCurrent(options, expectedScope);
    if (isAccessError(error) || isNonAmbiguousClientError(error)) return { phase: "halted", deliveryId: "" };
    if (isAmbiguousTransportError(error) || error instanceof Error) return { phase: "retry", deliveryId: "" };
    throw error;
  }
  assertCurrent(options, expectedScope);
  const pending = parsePresentationRemoteIntentPending(raw, {
    serviceId: options.authority.serviceId!,
    sessionId: options.authority.sessionId!,
  }, requestStartedAtMs);
  const delivery = pending.intents[0];
  if (!delivery) return { phase: "idle" };

  let receipt = receiptForDelivery(bindingScope, delivery.deliveryId, options.storage, now());
  if (receipt && (!receiptMatches(receipt, delivery) || receipt.authorityScope !== expectedScope)) {
    return { phase: "halted", deliveryId: delivery.deliveryId };
  }
  if (receipt?.phase === "acked") return { phase: receipt.ackStatus || "failed", deliveryId: delivery.deliveryId };
  if (receipt?.phase === "expired") return { phase: "expired", deliveryId: delivery.deliveryId };
  if (deliveryExpired(pending, delivery, now())) {
    const expiredReceipt = receipt || {
      schemaVersion: PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION,
      bindingScope,
      authorityScope: expectedScope,
      deliveryId: delivery.deliveryId,
      intentId: delivery.id,
      type: delivery.type,
      payloadJson: JSON.stringify(delivery.payload),
      createdAt: delivery.createdAt,
      expiresAt: delivery.expiresAt,
      deadlineAtMs: pending.deadlineAtMs!,
      expectedRevision: null,
      phase: "expired" as const,
      ackStatus: null,
      errorCode: null,
      updatedAt: new Date(now()).toISOString(),
    };
    markReceiptExpired(expiredReceipt, options.storage, now());
    return { phase: "expired", deliveryId: delivery.deliveryId };
  }

  if (!receipt) {
    const supported = Boolean(commandForDelivery(delivery));
    receipt = saveReceipt({
      schemaVersion: PRESENTATION_REMOTE_INTENT_SCHEMA_VERSION,
      bindingScope,
      authorityScope: expectedScope,
      deliveryId: delivery.deliveryId,
      intentId: delivery.id,
      type: delivery.type,
      payloadJson: JSON.stringify(delivery.payload),
      createdAt: delivery.createdAt,
      expiresAt: delivery.expiresAt,
      deadlineAtMs: pending.deadlineAtMs!,
      expectedRevision: supported ? options.currentRevision : null,
      phase: supported ? "command_started" : "ack_pending",
      ackStatus: supported ? null : "rejected",
      errorCode: supported ? null : "UNSUPPORTED_INTENT",
      updatedAt: new Date(now()).toISOString(),
    }, options.storage, now());
  }

  if (receipt.phase === "command_started") {
    assertCurrent(options, expectedScope);
    const commandStartedAtMs = now();
    if (receiptExpired(receipt, commandStartedAtMs)) {
      markReceiptExpired(receipt, options.storage, commandStartedAtMs);
      return { phase: "expired", deliveryId: delivery.deliveryId };
    }
    const timeoutMs = remainingRequestBudget(receipt.deadlineAtMs, commandStartedAtMs);
    try {
      const commandReceipt = await runWithReceiverTimeout(options.signal, timeoutMs, (signal, commandTimeoutMs) => (
        sendMappedCommand(options.sendCommand, delivery, receipt!.expectedRevision!, signal, commandTimeoutMs)
      ));
      assertCurrent(options, expectedScope);
      if (!commandReceipt || !commandWasAuthoritativelyApplied(
        commandReceipt.result,
        options.authority,
        delivery,
        commandReceipt.command,
      )) {
        return { phase: "retry", deliveryId: delivery.deliveryId };
      }
    } catch (error) {
      assertCurrent(options, expectedScope);
      const failedAtMs = now();
      if (receiptExpired(receipt, failedAtMs)) {
        markReceiptExpired(receipt, options.storage, failedAtMs);
        return { phase: "expired", deliveryId: delivery.deliveryId };
      }
      if (isAccessError(error)) return { phase: "halted", deliveryId: delivery.deliveryId };
      if (error instanceof ApiError
        && error.status === 409
        && getPresentationApiErrorCode(error) === "DELIVERY_LEASE_INVALID") {
        markReceiptExpired(receipt, options.storage, failedAtMs);
        return { phase: "expired", deliveryId: delivery.deliveryId };
      }
      const terminal = terminalCommandAcknowledgement(error);
      if (terminal) {
        receipt = saveReceipt({
          ...receipt,
          phase: "ack_pending",
          ackStatus: terminal.status,
          errorCode: terminal.errorCode,
          updatedAt: new Date(failedAtMs).toISOString(),
        }, options.storage, failedAtMs);
      } else {
        return { phase: "retry", deliveryId: delivery.deliveryId };
      }
    }
    if (receipt.phase === "command_started") {
      const completedAtMs = now();
      if (receiptExpired(receipt, completedAtMs)) {
        markReceiptExpired(receipt, options.storage, completedAtMs);
        return { phase: "expired", deliveryId: delivery.deliveryId };
      }
      receipt = saveReceipt({
        ...receipt,
        phase: "ack_pending",
        ackStatus: "applied",
        errorCode: null,
        updatedAt: new Date(completedAtMs).toISOString(),
      }, options.storage, completedAtMs);
    }
  }

  return finishAcknowledgement(options, receipt, expectedScope);
}
