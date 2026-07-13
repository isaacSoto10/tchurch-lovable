import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  assertSongLyricsOutboxCapacity,
  isSamePendingSubmission,
  songLyricsOutboxDisposition,
  songLyricsOutboxRetryDelayMs,
  type SongLyricsProposalOutboxRecord,
} from "./songLyricsProposalOutbox";

describe("song lyrics proposal durable outbox", () => {
  it("retries only transient failures with a bounded backoff", () => {
    expect(songLyricsOutboxDisposition(new ApiError("offline", 0, {}))).toBe("retry");
    expect(songLyricsOutboxDisposition(new ApiError("busy", 429, {}))).toBe("retry");
    expect(songLyricsOutboxDisposition(new ApiError("server", 503, {}))).toBe("retry");
    expect(songLyricsOutboxRetryDelayMs(0)).toBe(2_000);
    expect(songLyricsOutboxRetryDelayMs(50)).toBe(5 * 60_000);
  });

  it("pauses authentication failures and preserves stale drafts for review", () => {
    expect(songLyricsOutboxDisposition(new ApiError("sign in", 401, {}))).toBe("auth");
    expect(songLyricsOutboxDisposition(new ApiError("stale", 409, { code: "LYRICS_BASE_STALE" }))).toBe("needs_review");
  });

  it("does not automatically replay forbidden or invalid changes", () => {
    expect(songLyricsOutboxDisposition(new ApiError("forbidden", 403, {}))).toBe("terminal");
    expect(songLyricsOutboxDisposition(new ApiError("invalid", 400, {}))).toBe("terminal");
    expect(songLyricsOutboxDisposition(new ApiError("conflict", 409, { code: "IDEMPOTENCY_KEY_REUSED" }))).toBe("terminal");
  });

  it("never evicts an older pending proposal to make room silently", () => {
    expect(() => assertSongLyricsOutboxCapacity(Array.from({ length: 20 }, () => ({ state: "pending" as const })))).toThrow(/20 propuestas pendientes/i);
    expect(() => assertSongLyricsOutboxCapacity([
      ...Array.from({ length: 19 }, () => ({ state: "pending" as const })),
      { state: "terminal" as const },
    ])).not.toThrow();
  });

  it("reuses the persisted request identity for the same queued draft", () => {
    const body = {
      schemaVersion: 1 as const,
      target: { type: "SONG" as const, songId: "song-1", arrangementId: null },
      source: { type: "IOS" as const, ref: null },
      format: "CHORDPRO" as const,
      lyrics: "[C]Texto",
      checksum: `sha256:${"a".repeat(64)}`,
      baseChecksum: `sha256:${"b".repeat(64)}`,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestChecksum: `sha256:${"c".repeat(64)}`,
    };
    const record = {
      id: body.idempotencyKey, churchId: "church", ownerHash: "owner", kind: "submission", proposalId: null,
      body, state: "pending", attempts: 1, createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString(), lastErrorCode: null, lastErrorMessage: null,
    } satisfies SongLyricsProposalOutboxRecord;
    expect(isSamePendingSubmission(record, { ...body, idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestChecksum: `sha256:${"d".repeat(64)}` })).toBe(true);
    expect(isSamePendingSubmission(record, { ...body, checksum: `sha256:${"e".repeat(64)}` })).toBe(false);
  });
});
