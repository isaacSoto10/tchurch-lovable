import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  configureUserActionLogger,
  describeElementForAction,
  describeFormSubmit,
  flushUserActionLogs,
  logApiRequestSummary,
  logUserAction,
  resetUserActionLoggerForTests,
  sanitizeActionMetadata,
  sanitizeActionPath,
} from "./userActionLogger";
import { API_BASE } from "./apiConfig";

describe("user action logger", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetUserActionLoggerForTests();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.fetch = originalFetch;
    vi.restoreAllMocks();
    resetUserActionLoggerForTests();
  });

  it("redacts sensitive paths, query values, and metadata", () => {
    expect(sanitizeActionPath("/app/events/evt_123/check-in?token=secret&tab=rsvp")).toBe(
      "/app/events/evt_123/check-in?token=%5Bredacted%5D&tab=rsvp",
    );

    expect(
      sanitizeActionMetadata({
        email: "person@example.com",
        password: "secret",
        label: "Save",
        body: "do not keep this",
      }),
    ).toMatchObject({
      email: "[redacted]",
      password: "[redacted]",
      label: "Save",
      body: "[redacted]",
    });
  });

  it("sends action and path fields that the web endpoint can normalize", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.fetch = fetchMock as unknown as typeof fetch;
    localStorage.setItem("tchurch_church_id", "church_123");
    configureUserActionLogger({ tokenProvider: async () => "test-auth-token" });

    logUserAction("interaction.click", { label: "Save settings" }, { immediate: true });
    await flushUserActionLogs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/user-action-logs`);
    expect(request.headers).toMatchObject({
      Authorization: "Bearer test-auth-token",
      "Content-Type": "application/json",
      "x-church-id": "church_123",
    });

    const payload = JSON.parse(String(request.body));
    expect(payload.events[0]).toMatchObject({
      action: "interaction.click",
      path: "/",
      type: "interaction.click",
    });
  });

  it("describes form and click metadata without field values or visible text", () => {
    document.body.innerHTML = `
      <form id="login-form" method="post" action="/login?code=123456">
        <input name="email" type="email" value="person@example.com" />
        <input name="password" type="password" value="super-secret" />
        <button type="submit" aria-label="Continue sign in">Continue as Isaac</button>
      </form>
    `;

    const button = document.querySelector("button") as HTMLButtonElement;
    const form = document.querySelector("form") as HTMLFormElement;

    expect(describeElementForAction(button)).toMatchObject({
      kind: "button",
      tag: "button",
      controlType: "submit",
      label: "Continue sign in",
      formId: "login-form",
    });
    expect(describeFormSubmit(form)).toMatchObject({
      formId: "login-form",
      method: "POST",
      action: "/login?code=%5Bredacted%5D",
      fieldCount: 2,
      controlTypes: ["email", "password"],
      hasSensitiveFields: true,
    });
    expect(JSON.stringify(describeFormSubmit(form))).not.toContain("person@example.com");
    expect(JSON.stringify(describeElementForAction(button))).not.toContain("Continue as Isaac");
  });

  it("summarizes API bodies by kind instead of raw values", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.fetch = fetchMock as unknown as typeof fetch;
    configureUserActionLogger({ tokenProvider: async () => "test-auth-token" });

    logApiRequestSummary({
      path: "/mobile-auth/verify",
      method: "POST",
      status: 401,
      ok: false,
      durationMs: 22,
      body: JSON.stringify({ email: "person@example.com", code: "123456" }),
      source: "test",
    });
    await flushUserActionLogs();

    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const serialized = String(request.body);
    expect(serialized).toContain('"bodyKind":"json"');
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("123456");
  });

  it("keeps queued events until an auth token is available", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.fetch = fetchMock as unknown as typeof fetch;

    logUserAction("navigation.changed", { to: "/app" });
    await flushUserActionLogs();
    expect(fetchMock).not.toHaveBeenCalled();

    configureUserActionLogger({ tokenProvider: async () => "test-auth-token" });
    await flushUserActionLogs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the backend logging route is not available", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.fetch = fetchMock as unknown as typeof fetch;
    configureUserActionLogger({ tokenProvider: async () => "test-auth-token" });

    logUserAction("navigation.changed", { to: "/app" });
    await flushUserActionLogs();
    logUserAction("interaction.click", { label: "Retry" });
    await flushUserActionLogs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
