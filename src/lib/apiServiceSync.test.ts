import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@/lib/userActionLogger", () => ({ actionNow: () => 0, logApiRequestSummary: vi.fn() }));
vi.mock("@/lib/media", () => ({ clearMediaSnapshots: vi.fn() }));

import { apiFetch, setChurchId } from "./api";
import { saveMobileAuthSession } from "./mobileAuth";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("service collaborative transport", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setChurchId("church-a");
    saveMobileAuthSession({ token: "tm_test-service", expiresAt: "2099-01-01T00:00:00Z", user: { id: "actor-a", email: "fixture@example.org" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads a committed assignment instead of reusing an older in-flight service read", async () => {
    let completeOldRead!: (response: Response) => void;
    let getCount = 0;
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
      if (options.method === "POST") return Promise.resolve(reply({ id: "assignment-new" }, 201));
      getCount += 1;
      if (getCount === 1) return new Promise<Response>((resolve) => { completeOldRead = resolve; });
      return Promise.resolve(reply({ assignments: [{ id: "assignment-new" }] }));
    }));
    const previous = apiFetch("/services/service-a", { cache: "no-store" });
    await vi.waitFor(() => expect(getCount).toBe(1));
    await apiFetch("/service-assignments", { method: "POST", body: JSON.stringify({ serviceId: "service-a", userId: "member-a", position: "Vocals" }) });
    const readback = apiFetch("/services/service-a", { cache: "no-store" });
    completeOldRead(reply({ assignments: [] }));
    expect(await readback).toEqual({ assignments: [{ id: "assignment-new" }] });
    await previous;
    expect(getCount).toBe(2);
  });

  it("sends song and assignment mutations to the same production church and reads the server result", async () => {
    const state = { items: [] as unknown[], assignments: [] as unknown[] };
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      const payload = options.body ? JSON.parse(String(options.body)) : null;
      if (url.endsWith("/service-items")) state.items.push(payload);
      if (url.endsWith("/service-assignments")) state.assignments.push(payload);
      return reply(state, options.method === "POST" ? 201 : 200);
    });
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/service-items", { method: "POST", body: JSON.stringify({ serviceId: "service-a", songId: "song-a", type: "song", title: "Song", position: 0, details: {} }) });
    await apiFetch("/service-assignments", { method: "POST", body: JSON.stringify({ serviceId: "service-a", userId: "member-a", position: "Vocals" }) });
    expect(await apiFetch("/services/service-a", { cache: "no-store" })).toEqual(state);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toMatch(/^https:\/\/www\.tchurchapp\.com\/api\//);
      expect(options.headers).toMatchObject({ Authorization: "Bearer tm_test-service", "x-church-id": "church-a" });
    }
    expect(state.items).toHaveLength(1);
    expect(state.assignments).toHaveLength(1);
  });

  it("does not let a pre-write song request repopulate the cache after the mutation", async () => {
    let completeOldRead!: (response: Response) => void;
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
      if (options.method === "PUT") return Promise.resolve(reply({ id: "song-a", title: "Updated" }));
      gets += 1;
      if (gets === 1) return new Promise<Response>((resolve) => { completeOldRead = resolve; });
      return Promise.resolve(reply([{ id: "song-a", title: "Updated" }]));
    }));
    const beforeWrite = apiFetch("/songs?limit=30");
    await vi.waitFor(() => expect(gets).toBe(1));
    await apiFetch("/songs/song-a", { method: "PUT", body: JSON.stringify({ title: "Updated" }) });
    completeOldRead(reply([{ id: "song-a", title: "Old" }]));
    await beforeWrite;
    expect(await apiFetch("/songs?limit=30")).toEqual([{ id: "song-a", title: "Updated" }]);
    expect(gets).toBe(2);
  });
});
