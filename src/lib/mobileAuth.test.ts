import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE } from "./apiConfig";
import {
  MobileAuthApiError,
  requestMobileJoinAuthCode,
  verifyMobileJoinAuthCode,
} from "./mobileAuth";

describe("mobile auth join flow", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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
});
