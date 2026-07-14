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

function responseWithStalledBody(signal: AbortSignal, status = 200) {
  let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller;
    },
  });
  const failBody = () => {
    bodyController?.error(signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The request was aborted.", "AbortError"));
  };
  if (signal.aborted) failBody();
  else signal.addEventListener("abort", failBody, { once: true });
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
    vi.useRealTimers();
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

  it("keeps the timeout signal active after headers until a stalled success body aborts", async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, request: RequestInit = {}) => {
      transportSignal = request.signal as AbortSignal;
      return responseWithStalledBody(transportSignal);
    }));

    const request = apiFetch("/presentation-session", {
      cache: "no-store",
      timeoutMs: 2_500,
    }, "test-token");
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(transportSignal).not.toBeNull();
    expect(transportSignal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(2_499);
    expect(transportSignal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(transportSignal!.aborted).toBe(true);
  });

  it("keeps parent abort propagation active while an error response body is stalled", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    let transportSignal: AbortSignal | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, request: RequestInit = {}) => {
      transportSignal = request.signal as AbortSignal;
      return responseWithStalledBody(transportSignal, 503);
    }));

    const request = apiFetch("/presentation-remote-intents/ack", {
      method: "POST",
      body: "{}",
      signal: parent.signal,
      timeoutMs: 60_000,
      sensitiveBody: true,
    }, "test-token");
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(transportSignal).not.toBeNull();
    expect(transportSignal!.aborted).toBe(false);

    parent.abort();
    await rejection;

    expect(transportSignal!.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("marks proposal decisions and direct song/arrangement lyrics writes as sensitive", () => {
    const proposalSource = readFileSync(`${process.cwd()}/src/lib/songLyricsProposals.ts`, "utf8");
    const songDetailSource = readFileSync(`${process.cwd()}/src/pages/app/SongDetail.tsx`, "utf8");
    expect(proposalSource.match(/sensitiveBody: true/g)?.length).toBeGreaterThanOrEqual(2);
    expect(songDetailSource.match(/body: JSON\.stringify\(\{ lyrics \}\),\s*\n\s*sensitiveBody: true/g)?.length).toBe(2);
  });
});
