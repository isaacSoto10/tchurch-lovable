import { sanitizeActionPath } from "./userActionLogger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChurchInvitationToken, getChurchInvitationWebUrl, openChurchInvitationInBrowser } from "./churchInvitationHandoff";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.open } }));
beforeEach(() => mocks.open.mockReset().mockResolvedValue(undefined));

describe("secure church invitation handoff", () => {
  it("preserves canonical and legacy tokens without treating them as church codes", () => {
    const token = "Mixed-case_token/+?=abc";
    expect(getChurchInvitationToken(new URLSearchParams({ invite: token, code: "ABCD1234" }))).toBe(token);
    expect(getChurchInvitationToken(new URLSearchParams({ token }))).toBe(token);
    expect(getChurchInvitationToken(new URLSearchParams({ invite: "  ", token }))).toBe(token);
    expect(getChurchInvitationToken(new URLSearchParams({ code: "ABCD1234" }))).toBeNull();
  });
  it("encodes the exact token only into the fixed canonical HTTPS acceptance URL", () => {
    const token = "//attacker.test/?x=1#fragment";
    const url = new URL(getChurchInvitationWebUrl(token));
    expect(url.origin).toBe("https://www.tchurchapp.com");
    expect(url.pathname).toBe("/join-church");
    expect(url.searchParams.get("invite")).toBe(token);
    expect([...url.searchParams.keys()]).toEqual(["invite"]);
    expect(url.hash).toBe("");
  });
  it.each(["invite", "token"])("redacts %s from existing route diagnostics", (key) => {
    const token = "Mixed-private-value-for-invitation";
    const path = sanitizeActionPath(`/join-church?${new URLSearchParams({ [key]: token })}`);
    expect(path).not.toContain(token);
    expect(new URL(path, "https://www.tchurchapp.com").searchParams.get(key)).toBe("[redacted]");
  });
  it("opens the existing native browser with the canonical invitation URL", async () => {
    await openChurchInvitationInBrowser("private-token");
    expect(mocks.open).toHaveBeenCalledWith({ url: "https://www.tchurchapp.com/join-church?invite=private-token" });
  });
});
