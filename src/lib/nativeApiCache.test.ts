import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, setChurchId } from "./api";
import { clearMobileAuthSession, saveMobileAuthSession } from "./mobileAuth";
import { isCollaborativeApiPath } from "./nativeApiCache";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock("@/lib/userActionLogger", () => ({
  actionNow: Date.now,
  logApiRequestSummary: vi.fn(),
}));
vi.mock("./mobileSessionVault", () => ({
  mobileSessionVault: { save: async () => undefined, clear: async () => undefined },
}));

describe("native API cache collaboration boundaries", () => {
  it("keeps service planning reads out of the device-local cache", () => {
    expect(isCollaborativeApiPath("/services")).toBe(true);
    expect(isCollaborativeApiPath("/services/service-1")).toBe(true);
    expect(isCollaborativeApiPath("/services?summary=1&from=today&limit=60")).toBe(true);
    expect(isCollaborativeApiPath("/service-items/reorder")).toBe(true);
    expect(isCollaborativeApiPath("/service-assignments/mine")).toBe(true);
    expect(isCollaborativeApiPath("/teams?limit=40")).toBe(true);
    expect(isCollaborativeApiPath("/members?search=Noely")).toBe(true);
    expect(isCollaborativeApiPath("/users/me")).toBe(true);
  });

  it("does not classify unrelated reads as service planning state", () => {
    expect(isCollaborativeApiPath("/songs?limit=30")).toBe(false);
    expect(isCollaborativeApiPath("/announcements?limit=40")).toBe(false);
  });
});

describe("native API cache request scope", () => {
  function signIn(userId: string) {
    return saveMobileAuthSession({
      token: `tm_test-${userId}`,
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: { id: userId, email: "person@example.com" },
    });
  }

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    setChurchId("church_a");
    await signIn("user_a");
  });

  afterEach(() => vi.restoreAllMocks());

  it("caches a pinned request under its church despite selection changing in flight", async () => {
    let finishRequest!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRequest = resolve; }))
      .mockResolvedValueOnce(Response.json({ church: "a" }));

    const pinnedRequest = apiFetch("/my-ministries", { churchId: "church_b" });
    setChurchId("church_c");
    finishRequest(Response.json({ church: "b" }));
    await expect(pinnedRequest).resolves.toEqual({ church: "b" });
    await expect(apiFetch("/my-ministries", { churchId: "church_b" })).resolves.toEqual({ church: "b" });
    await expect(apiFetch("/my-ministries", { churchId: "church_a" })).resolves.toEqual({ church: "a" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not restore a previous account response after sign-out", async () => {
    let finishRequest!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRequest = resolve; }))
      .mockResolvedValueOnce(Response.json({ owner: "b" }));

    const oldRequest = apiFetch("/my-ministries");
    await clearMobileAuthSession();
    await signIn("user_b");
    finishRequest(Response.json({ owner: "a" }));
    await oldRequest;
    await expect(apiFetch("/my-ministries")).resolves.toEqual({ owner: "b" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
