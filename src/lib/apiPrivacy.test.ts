import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { logApiRequestSummaryMock } = vi.hoisted(() => ({ logApiRequestSummaryMock: vi.fn() }));

vi.mock("@/lib/userActionLogger", () => ({
  actionNow: () => 10,
  logApiRequestSummary: logApiRequestSummaryMock,
}));

vi.mock("@/lib/media", () => ({ clearMediaSnapshots: vi.fn() }));
vi.mock("@/lib/nativeApiCache", () => ({
  clearNativeApiCache: vi.fn(),
  isNativeApiCacheableGet: () => false,
  readNativeApiCache: () => null,
  writeNativeApiCache: vi.fn(),
}));

import { apiFetch, setChurchId } from "./api";

describe("apiFetch private request diagnostics", () => {
  beforeEach(() => {
    logApiRequestSummaryMock.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  afterEach(() => {
    setChurchId(null);
    vi.unstubAllGlobals();
  });

  it("sends a sensitive proposal body to the server but never to the action logger", async () => {
    const privateBody = JSON.stringify({ lyrics: "[C]Texto privado", decisionReason: "Motivo privado" });
    await apiFetch("/song-lyrics-proposals", {
      method: "POST",
      body: privateBody,
      sensitiveBody: true,
    }, "test-token");

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/song-lyrics-proposals"), expect.objectContaining({ body: privateBody }));
    expect(logApiRequestSummaryMock).toHaveBeenCalled();
    for (const [entry] of logApiRequestSummaryMock.mock.calls) {
      expect(entry.body).toBeUndefined();
      expect(JSON.stringify(entry)).not.toContain("Texto privado");
      expect(JSON.stringify(entry)).not.toContain("Motivo privado");
    }
  });

  it("keeps an explicitly scoped church header stable when local selection changes", async () => {
    setChurchId("church-selected-before");
    const options = {
      method: "POST",
      body: JSON.stringify({ private: true }),
      sensitiveBody: true,
      churchId: "church-authorized-for-intent",
    } as const;

    await apiFetch("/presentation-remote-intents", options, "test-token");
    setChurchId("church-selected-after");
    await apiFetch("/presentation-remote-intents", options, "test-token");

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, request] of vi.mocked(fetch).mock.calls) {
      expect((request?.headers as Record<string, string>)["x-church-id"]).toBe("church-authorized-for-intent");
      expect(request).not.toHaveProperty("churchId");
    }
  });

  it("marks proposal decisions and direct song/arrangement lyrics writes as sensitive", () => {
    const proposalSource = readFileSync(`${process.cwd()}/src/lib/songLyricsProposals.ts`, "utf8");
    const songDetailSource = readFileSync(`${process.cwd()}/src/pages/app/SongDetail.tsx`, "utf8");
    expect(proposalSource.match(/sensitiveBody: true/g)?.length).toBeGreaterThanOrEqual(2);
    expect(songDetailSource.match(/body: JSON\.stringify\(\{ lyrics \}\),\s*\n\s*sensitiveBody: true/g)?.length).toBe(2);
  });
});
