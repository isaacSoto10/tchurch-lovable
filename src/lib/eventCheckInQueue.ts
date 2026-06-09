import {
  ApiError,
  manualEventCheckIn,
  scanEventCheckIn,
} from "@/lib/api";
import type {
  EventCheckInPayload,
  EventCheckInResponse,
  EventManualCheckInPayload,
  QueuedEventCheckIn,
} from "@/types/events";

const DB_NAME = "tchurch_event_check_ins";
const DB_VERSION = 1;
const STORE_NAME = "pending_check_ins";

type CheckInEndpoint = QueuedEventCheckIn["endpoint"];

export interface QueueSubmitResult {
  queued: boolean;
  response?: EventCheckInResponse;
  queueItem?: QueuedEventCheckIn;
}

export interface QueueFlushResult {
  sent: number;
  failed: number;
  pending: number;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openQueueDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error("IndexedDB is not available on this device."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("eventId", "eventId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function queueId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isOfflineRetryable(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof ApiError && error.status === 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function payloadText(payload: EventCheckInPayload | EventManualCheckInPayload, keys: string[]) {
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().replace(/\s+/g, " ").toLowerCase();
  }
  return "";
}

export function getQueuedEventCheckInDedupeKey(
  endpoint: CheckInEndpoint,
  payload: EventCheckInPayload | EventManualCheckInPayload
) {
  const offlineClientId = payloadText(payload, ["offlineClientId"]);
  if (offlineClientId) return `${endpoint}:offline:${offlineClientId}`;

  if (endpoint === "scan") {
    const scanValue = payloadText(payload, ["token", "qrValue", "code", "qrCode", "scannedValue"]);
    if (scanValue) return `scan:${scanValue}`;
  }

  const manualValue = payloadText(payload, ["registrationId", "userId", "email", "name"]);
  return manualValue ? `manual:${manualValue}` : "";
}

function endpointPath(endpoint: CheckInEndpoint) {
  return endpoint === "manual" ? "manual" : "scan";
}

async function sendQueuedItem(item: QueuedEventCheckIn, token?: string | null) {
  if (item.endpoint === "manual") {
    return manualEventCheckIn(item.eventId, item.payload as EventManualCheckInPayload, token);
  }

  return scanEventCheckIn(item.eventId, item.payload as EventCheckInPayload, token);
}

export async function listQueuedEventCheckIns(eventId?: string): Promise<QueuedEventCheckIn[]> {
  const db = await openQueueDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const records = await requestAsPromise<QueuedEventCheckIn[]>(store.getAll());
    await done;
    return records
      .filter((item) => !eventId || item.eventId === eventId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally {
    db.close();
  }
}

export async function getQueuedEventCheckInCount(eventId?: string) {
  const items = await listQueuedEventCheckIns(eventId);
  return items.length;
}

export async function enqueueEventCheckIn(
  eventId: string,
  endpoint: CheckInEndpoint,
  payload: EventCheckInPayload | EventManualCheckInPayload,
  lastError?: string | null
): Promise<QueuedEventCheckIn> {
  const existingKey = getQueuedEventCheckInDedupeKey(endpoint, payload);
  if (existingKey) {
    const existing = (await listQueuedEventCheckIns(eventId)).find(
      (item) => getQueuedEventCheckInDedupeKey(item.endpoint, item.payload) === existingKey
    );
    if (existing) return existing;
  }

  const db = await openQueueDb();
  const id = queueId();
  const payloadWithOfflineClientId = {
    ...payload,
    offlineClientId: payload.offlineClientId || id,
  };
  const item: QueuedEventCheckIn = {
    id,
    eventId,
    endpoint,
    payload: payloadWithOfflineClientId,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: lastError ?? null,
  };

  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(item);
    await done;
    return item;
  } finally {
    db.close();
  }
}

export async function removeQueuedEventCheckIn(id: string) {
  const db = await openQueueDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await done;
  } finally {
    db.close();
  }
}

async function markQueuedEventCheckInFailed(item: QueuedEventCheckIn, error: unknown) {
  const db = await openQueueDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put({
      ...item,
      attempts: item.attempts + 1,
      lastError: errorMessage(error),
    });
    await done;
  } finally {
    db.close();
  }
}

export async function submitEventCheckInOnlineFirst(
  eventId: string,
  endpoint: CheckInEndpoint,
  payload: EventCheckInPayload | EventManualCheckInPayload,
  token?: string | null
): Promise<QueueSubmitResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const queueItem = await enqueueEventCheckIn(eventId, endpoint, payload, "Offline");
    return { queued: true, queueItem };
  }

  try {
    const response =
      endpointPath(endpoint) === "manual"
        ? await manualEventCheckIn(eventId, payload as EventManualCheckInPayload, token)
        : await scanEventCheckIn(eventId, payload as EventCheckInPayload, token);
    return { queued: false, response };
  } catch (error) {
    if (!isOfflineRetryable(error)) throw error;
    const queueItem = await enqueueEventCheckIn(eventId, endpoint, payload, errorMessage(error));
    return { queued: true, queueItem };
  }
}

export async function flushQueuedEventCheckIns(token?: string | null, eventId?: string): Promise<QueueFlushResult> {
  const pending = await listQueuedEventCheckIns(eventId);

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { sent: 0, failed: 0, pending: pending.length };
  }

  let sent = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      await sendQueuedItem(item, token);
      await removeQueuedEventCheckIn(item.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      await markQueuedEventCheckInFailed(item, error);
      if (isOfflineRetryable(error)) break;
    }
  }

  const remaining = await listQueuedEventCheckIns(eventId);
  return { sent, failed, pending: remaining.length };
}
