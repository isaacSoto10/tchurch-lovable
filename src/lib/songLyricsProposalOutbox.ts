import type {
  SongLyricsProposalDecisionV1,
  SongLyricsProposalDetailEnvelopeV1,
  SongLyricsProposalSubmissionV1,
} from "./songLyricsProposals";
import {
  createSongLyricsProposal,
  decideSongLyricsProposal,
  secureUuidV4,
  sha256,
  songLyricsProposalFailure,
} from "./songLyricsProposals";

const DB_NAME = "tchurch_song_lyrics_proposals";
const DB_VERSION = 1;
const STORE_NAME = "outbox";
const MAX_SCOPE_RECORDS = 20;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHANGE_EVENT = "tchurch-song-lyrics-outbox-change";

export type SongLyricsProposalOutboxScope = { churchId: string; ownerHash: string };
export type SongLyricsProposalOutboxState = "pending" | "needs_review" | "terminal";

type SubmissionRecord = {
  kind: "submission";
  body: SongLyricsProposalSubmissionV1;
  proposalId: null;
};

type DecisionRecord = {
  kind: "decision";
  body: SongLyricsProposalDecisionV1;
  proposalId: string;
};

export type SongLyricsProposalOutboxRecord = (SubmissionRecord | DecisionRecord) & {
  id: string;
  churchId: string;
  ownerHash: string;
  state: SongLyricsProposalOutboxState;
  attempts: number;
  createdAt: string;
  expiresAt: string;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type SongLyricsProposalOutboxFlushResult = {
  sent: number;
  pending: number;
  needsReview: number;
  terminal: number;
  envelopes: SongLyricsProposalDetailEnvelopeV1[];
};

function emitChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onSongLyricsProposalOutboxChange(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("El almacenamiento sin conexión no está disponible."));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("scope", ["churchId", "ownerHash"], { unique: false });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function allRecords() {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const records = await requestAsPromise<SongLyricsProposalOutboxRecord[]>(transaction.objectStore(STORE_NAME).getAll());
    await done;
    return records;
  } finally {
    db.close();
  }
}

async function putRecord(record: SongLyricsProposalOutboxRecord) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await done;
  } finally {
    db.close();
  }
  emitChange();
}

export async function removeSongLyricsProposalOutboxRecord(id: string) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await done;
  } finally {
    db.close();
  }
  emitChange();
}

async function removeMany(ids: string[]) {
  if (ids.length === 0) return;
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
    await done;
  } finally {
    db.close();
  }
  emitChange();
}

export async function songLyricsProposalOutboxScope(churchId: string, userId: string): Promise<SongLyricsProposalOutboxScope> {
  if (!churchId || !userId) throw new Error("Falta el contexto seguro de la iglesia.");
  return { churchId, ownerHash: await sha256(`lyrics-outbox-owner:v1:${userId}`) };
}

function belongsTo(record: SongLyricsProposalOutboxRecord, scope: SongLyricsProposalOutboxScope) {
  return record.churchId === scope.churchId && record.ownerHash === scope.ownerHash;
}

export async function listSongLyricsProposalOutbox(scope: SongLyricsProposalOutboxScope) {
  const now = Date.now();
  const records = await allRecords();
  const expired = records.filter((record) => Date.parse(record.expiresAt) <= now).map((record) => record.id);
  await removeMany(expired);
  return records
    .filter((record) => !expired.includes(record.id) && belongsTo(record, scope))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function purgeSongLyricsProposalOutbox(scope?: SongLyricsProposalOutboxScope) {
  const records = await allRecords();
  await removeMany(records.filter((record) => !scope || belongsTo(record, scope)).map((record) => record.id));
}

async function trimScope(scope: SongLyricsProposalOutboxScope) {
  const records = await listSongLyricsProposalOutbox(scope);
  if (records.length < MAX_SCOPE_RECORDS) return;
  assertSongLyricsOutboxCapacity(records);
  const removable = records.filter((record) => record.state !== "pending");
  await removeMany(removable.slice(0, records.length - MAX_SCOPE_RECORDS + 1).map((record) => record.id));
}

export function assertSongLyricsOutboxCapacity(records: Array<Pick<SongLyricsProposalOutboxRecord, "state">>) {
  if (records.length >= MAX_SCOPE_RECORDS && records.every((record) => record.state === "pending")) {
    throw new Error("Tienes 20 propuestas pendientes en este dispositivo. Conéctate para enviarlas antes de guardar otra.");
  }
}

function nowRecord(scope: SongLyricsProposalOutboxScope, id: string) {
  const now = new Date();
  return {
    id,
    churchId: scope.churchId,
    ownerHash: scope.ownerHash,
    state: "pending" as const,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    nextAttemptAt: now.toISOString(),
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

export async function enqueueSongLyricsProposalSubmission(scope: SongLyricsProposalOutboxScope, body: SongLyricsProposalSubmissionV1) {
  const existing = (await listSongLyricsProposalOutbox(scope)).find((record) =>
    isSamePendingSubmission(record, body)
  );
  if (existing) return existing;
  await trimScope(scope);
  const record: SongLyricsProposalOutboxRecord = {
    ...nowRecord(scope, body.idempotencyKey), kind: "submission", proposalId: null, body,
  };
  await putRecord(record);
  return record;
}

export async function enqueueSongLyricsProposalDecision(
  scope: SongLyricsProposalOutboxScope,
  proposalId: string,
  body: SongLyricsProposalDecisionV1,
) {
  const existing = (await listSongLyricsProposalOutbox(scope)).find((record) =>
    isSamePendingDecision(record, proposalId, body)
  );
  if (existing) return existing;
  await trimScope(scope);
  const record: SongLyricsProposalOutboxRecord = {
    ...nowRecord(scope, body.decisionIdempotencyKey), kind: "decision", proposalId, body,
  };
  await putRecord(record);
  return record;
}

export function isSamePendingSubmission(record: SongLyricsProposalOutboxRecord, body: SongLyricsProposalSubmissionV1) {
  return record.kind === "submission"
    && record.state === "pending"
    && record.body.target.type === body.target.type
    && record.body.target.songId === body.target.songId
    && record.body.target.arrangementId === body.target.arrangementId
    && record.body.checksum === body.checksum
    && record.body.baseChecksum === body.baseChecksum;
}

export function isSamePendingDecision(
  record: SongLyricsProposalOutboxRecord,
  proposalId: string,
  body: SongLyricsProposalDecisionV1,
) {
  return record.kind === "decision"
    && record.state === "pending"
    && record.proposalId === proposalId
    && record.body.status === body.status
    && record.body.decisionReason === body.decisionReason;
}

export function songLyricsOutboxRetryDelayMs(attempts: number) {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.min(Math.max(0, attempts), 8));
}

export function songLyricsOutboxDisposition(error: unknown): SongLyricsProposalOutboxState | "retry" | "auth" {
  const failure = songLyricsProposalFailure(error);
  if (failure.code === "LYRICS_BASE_STALE") return "needs_review";
  if (failure.status === 401) return "auth";
  if (failure.status === 0 || failure.status === 429 || failure.status >= 500) return "retry";
  return "terminal";
}

async function sendRecord(record: SongLyricsProposalOutboxRecord, token?: string | null) {
  return record.kind === "submission"
    ? createSongLyricsProposal(record.body, token)
    : decideSongLyricsProposal(record.proposalId, record.body, token);
}

async function markFailed(record: SongLyricsProposalOutboxRecord, error: unknown) {
  const failure = songLyricsProposalFailure(error);
  const disposition = songLyricsOutboxDisposition(error);
  const attempts = record.attempts + 1;
  const state: SongLyricsProposalOutboxState = disposition === "needs_review" || disposition === "terminal"
    ? disposition
    : "pending";
  await putRecord({
    ...record,
    state,
    attempts,
    nextAttemptAt: new Date(Date.now() + songLyricsOutboxRetryDelayMs(attempts)).toISOString(),
    lastErrorCode: failure.code,
    lastErrorMessage: failure.message.slice(0, 300),
  });
  return disposition;
}

export async function sendSongLyricsProposalOutboxRecord(record: SongLyricsProposalOutboxRecord, token?: string | null) {
  try {
    const envelope = await sendRecord(record, token);
    await removeSongLyricsProposalOutboxRecord(record.id);
    return { envelope, queued: false as const };
  } catch (error) {
    const disposition = await markFailed(record, error);
    if (disposition === "retry" || disposition === "auth") return { envelope: null, queued: true as const };
    throw error;
  }
}

export async function submitSongLyricsProposalDurably(
  scope: SongLyricsProposalOutboxScope,
  body: SongLyricsProposalSubmissionV1,
  token?: string | null,
) {
  const record = await enqueueSongLyricsProposalSubmission(scope, body);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { envelope: null, queued: true as const };
  return sendSongLyricsProposalOutboxRecord(record, token);
}

export async function decideSongLyricsProposalDurably(
  scope: SongLyricsProposalOutboxScope,
  proposalId: string,
  body: SongLyricsProposalDecisionV1,
  token?: string | null,
) {
  const record = await enqueueSongLyricsProposalDecision(scope, proposalId, body);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { envelope: null, queued: true as const };
  return sendSongLyricsProposalOutboxRecord(record, token);
}

export async function flushSongLyricsProposalOutbox(scope: SongLyricsProposalOutboxScope, token?: string | null) {
  const records = await listSongLyricsProposalOutbox(scope);
  const envelopes: SongLyricsProposalDetailEnvelopeV1[] = [];
  let sent = 0;
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    for (const record of records) {
      if (record.state !== "pending" || Date.parse(record.nextAttemptAt) > Date.now()) continue;
      try {
        const result = await sendSongLyricsProposalOutboxRecord(record, token);
        if (result.envelope) {
          envelopes.push(result.envelope);
          sent += 1;
        }
        if (result.queued) break;
      } catch {
        // Terminal and stale records remain available for explicit user review.
      }
    }
  }
  const remaining = await listSongLyricsProposalOutbox(scope);
  return {
    sent,
    pending: remaining.filter((record) => record.state === "pending").length,
    needsReview: remaining.filter((record) => record.state === "needs_review").length,
    terminal: remaining.filter((record) => record.state === "terminal").length,
    envelopes,
  } satisfies SongLyricsProposalOutboxFlushResult;
}

export function localDraftId() {
  return secureUuidV4();
}
