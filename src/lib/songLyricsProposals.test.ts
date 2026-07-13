import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
  SONG_LYRICS_PROPOSAL_MAX_BYTES,
  buildSongLyricsProposalDecision,
  buildSongLyricsProposalSubmission,
  canonicalizeChordPro,
  chordProChecksum,
  secureUuidV4,
} from "./songLyricsProposals";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  }
});

describe("song lyrics proposal v1 browser contract", () => {
  it("matches the backend iOS golden request byte-for-byte", async () => {
    const request = await buildSongLyricsProposalSubmission({
      target: { type: "SONG", songId: "legacy.song:es-1", arrangementId: null },
      sourceType: "IOS",
      sourceRef: null,
      lyrics: "\uFEFFC\r\nGracia\r\n",
      baseLyrics: "",
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    expect(request.lyrics).toBe("[C]Gracia");
    expect(request.checksum).toBe("sha256:99cd7b347666e21fa7ce708f03244a0f57b826f5b817681e24fbcd1386fc9437");
    expect(request.baseChecksum).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(request.requestChecksum).toBe("sha256:7523a86ee2b023ee6cca7173fa0d84bed046d8c616a36a54d02c7f7ba14b27fc");
  });

  it("matches the backend decision golden vector", async () => {
    const decision = await buildSongLyricsProposalDecision({
      status: "ACCEPTED",
      decisionReason: "Revisada",
      decisionIdempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(decision.decisionRequestChecksum).toBe("sha256:ccc2ba46a9784fd91458fba93b4458ba34ab6e2d8e73ad93b8fe65f78baf1e4d");
  });

  it("canonicalizes without regex lookbehind and keeps Unicode rules", async () => {
    expect(canonicalizeChordPro("C | G\nGra  cia")).toBe("[C]Gra [G] cia");
    expect(canonicalizeChordPro("Cafe\u0301")).toBe("Café");
    expect(await chordProChecksum("")).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(() => canonicalizeChordPro("ok\u0007bad")).toThrow(/carácter/i);
    expect(() => canonicalizeChordPro("á".repeat(SONG_LYRICS_PROPOSAL_MAX_BYTES / 2 + 1))).toThrow(/64 KiB/i);
  });

  it("creates only RFC 4122 v4 retry keys", () => {
    expect(secureUuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("rejects unsafe legacy resource IDs and mismatched targets", async () => {
    await expect(buildSongLyricsProposalSubmission({
      target: { type: "SONG", songId: "unsafe/id", arrangementId: null },
      sourceType: "IOS",
      lyrics: "[C]Texto",
      baseLyrics: "",
    })).rejects.toThrow(/identificador/i);

    await expect(buildSongLyricsProposalSubmission({
      target: { type: "ARRANGEMENT", songId: "song-1", arrangementId: null },
      sourceType: "IOS",
      lyrics: "[C]Texto",
      baseLyrics: "",
    })).rejects.toThrow(/arreglo/i);
  });
});
