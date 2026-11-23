import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE } from "./apiConfig";
import {
  clearMobileAuthSession,
  getMobileAuthPrincipalId,
  getMobileAuthSession,
  MobileAuthApiError,
  requestMobileJoinAuthCode,
  saveMobileAuthSession,
  verifyMobileJoinAuthCode,
} from "./mobileAuth";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

const vault = vi.hoisted(() => ({
  load: vi.fn<() => Promise<{ session?: string }>>().mockResolvedValue({}),
  save: vi.fn<(options: { session: string }) => Promise<void>>().mockResolvedValue(undefined),
  clear: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock("./mobileSessionVault", () => ({ mobileSessionVault: vault }));

describe("mobile auth join flow", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vault.load.mockResolvedValue({});
    vault.save.mockResolvedValue(undefined);
    vault.clear.mockResolvedValue(undefined);
    await clearMobileAuthSession();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("hides raw unprocessable entity responses from the join start error", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Unprocessable Entity" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.fetch = fetchMock as unknown as typeof fetch;

    await expect(requestMobileJoinAuthCode("person@example.com", "ABCD1234")).rejects.toMatchObject({
      status: 422,
      message: "No pudimos completar la autenticación móvil (422). Intenta de nuevo.",
    } satisfies Partial<MobileAuthApiError>);
  });

  it("hides raw backend diagnostics from join verification errors", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "column u.organizationId does not exist" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.fetch = fetchMock as unknown as typeof fetch;

    await expect(verifyMobileJoinAuthCode("person@example.com", "ABCD1234", "123456")).rejects.toMatchObject({
      status: 400,
      message: "No pudimos completar la autenticación móvil (400). Intenta de nuevo.",
    } satisfies Partial<MobileAuthApiError>);
  });

  it("posts the join verification payload expected by the mobile auth API", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          token: "tm_test-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
          user: { id: "user_1", email: "person@example.com" },
          church: { id: "church_1", name: "Grace en espanol" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.fetch = fetchMock as unknown as typeof fetch;

    await verifyMobileJoinAuthCode("person@example.com", "ABCD1234", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/mobile-auth/join/verify`);
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({
      email: "person@example.com",
      joinCode: "ABCD1234",
      verificationCode: "123456",
    });
  });

  it("keeps a non-secret principal hint for verified offline LAN after token expiry", async () => {
    await saveMobileAuthSession({
      token: "tm_expired-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
      user: { id: "user_offline", email: "person@example.com" },
    });

    expect(getMobileAuthPrincipalId()).toBe("user_offline");
    expect(localStorage.getItem("tchurch_mobile_auth_session")).toBeNull();
  });

  it("removes both the bearer session and offline principal hint on explicit logout", async () => {
    await saveMobileAuthSession({
      token: "tm_test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: { id: "user_1", email: "person@example.com" },
    });

    await clearMobileAuthSession();

    expect(getMobileAuthPrincipalId()).toBeNull();
    expect(getMobileAuthSession()).toBeNull();
    expect(vault.clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("tchurch_mobile_auth_session")).toBeNull();
  });

  it("clears private snapshots on logout and account changes", async () => {
    const signIn = (id: string) => saveMobileAuthSession({
      token: `tm_test-${id}`,
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: { id, email: "person@example.com" },
    });
    const keys = [
      "tchurch_native_api_cache_v1:church:path",
      "tchurch_ios_dashboard_snapshot_v4:church",
      "tchurch_service_media_snapshot_v1:church",
      "tchurch_action_log_session_id",
    ];
    await signIn("user_1");
    keys.forEach((key) => sessionStorage.setItem(key, "fixture"));
    await signIn("user_2");
    keys.forEach((key) => expect(sessionStorage.getItem(key)).toBeNull());
    keys.forEach((key) => sessionStorage.setItem(key, "fixture"));
    await clearMobileAuthSession();
    keys.forEach((key) => expect(sessionStorage.getItem(key)).toBeNull());
  });

  it("treats invalid session expiration as expired", async () => {
    await saveMobileAuthSession({
      token: "tm_test-token",
      expiresAt: "invalid",
      user: { id: "user_1", email: "person@example.com" },
    });
    expect(getMobileAuthSession()).toBeNull();
  });

  it("moves a legacy session into secure storage before restoring it", async () => {
    vi.resetModules();
    const auth = await import("./mobileAuth");
    const legacy = { token: "fixture-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: "account-a" } };
    localStorage.setItem("tchurch_mobile_auth_session", JSON.stringify(legacy));

    await auth.initializeMobileAuthSession();

    expect(auth.getMobileAuthSession()).toEqual(legacy);
    expect(vault.save).toHaveBeenCalledWith({ session: JSON.stringify(legacy) });
    expect(localStorage.getItem("tchurch_mobile_auth_session")).toBeNull();
  });

  it("does not restore a session when prior secure sign-out still needs cleanup", async () => {
    vi.resetModules();
    const auth = await import("./mobileAuth");
    await auth.saveMobileAuthSession({
      token: "fixture-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: { id: "user_1", email: "person@example.com" },
    });
    vault.clear.mockRejectedValueOnce(new Error("unavailable"));
    expect(await auth.clearMobileAuthSession()).toBe(false);

    vi.resetModules();
    const relaunched = await import("./mobileAuth");
    await relaunched.initializeMobileAuthSession();

    expect(vault.load).not.toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalledTimes(2);
    expect(relaunched.getMobileAuthSession()).toBeNull();
    expect(localStorage.getItem("tchurch_mobile_auth_pending_clear")).toBeNull();
  });
});
