import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearMobileAuthSession: vi.fn(),
  signedOut: vi.fn(),
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: false, userId: null, getToken: vi.fn() })),
  useClerk: vi.fn(() => ({ signOut: vi.fn() })),
  useUser: vi.fn(() => ({ user: null })),
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: mocks.useAuth,
  useClerk: mocks.useClerk,
  useUser: mocks.useUser,
}));

vi.mock("@/lib/mobileAuth", () => ({
  isNativeMobileAuth: true,
  getMobileAuthSession: () => ({
    token: "test-session-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: { id: "user-1", email: "member@example.test" },
  }),
  clearMobileAuthSession: mocks.clearMobileAuthSession,
  onMobileAuthChange: () => () => undefined,
}));

vi.mock("@/lib/studioLANPrivacyCoordinator", () => ({
  studioLANPrivacyCoordinator: { signedOut: mocks.signedOut },
}));

import { useAppAuth } from "./useAppAuth";

describe("useAppAuth Studio LAN privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signedOut.mockResolvedValue(undefined);
    window.location.hash = "#/app/settings";
  });

  it("purges Studio pairing and cache state before clearing the mobile session", async () => {
    const { result } = renderHook(() => useAppAuth());

    await act(async () => {
      await result.current.signOut("/login");
    });

    expect(mocks.signedOut).toHaveBeenCalledOnce();
    expect(mocks.clearMobileAuthSession).toHaveBeenCalledOnce();
    expect(mocks.signedOut.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.clearMobileAuthSession.mock.invocationCallOrder[0]);
    expect(window.location.hash).toBe("#/login");
  });

  it("does not clear the account when the durable privacy boundary cannot begin", async () => {
    mocks.signedOut.mockRejectedValueOnce(new Error("tombstone-write-failed"));
    const { result } = renderHook(() => useAppAuth());

    await expect(result.current.signOut("/login")).rejects.toThrow("tombstone-write-failed");
    expect(mocks.clearMobileAuthSession).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/app/settings");
  });

  it("keeps the native auth facade stable across unrelated Clerk renders", () => {
    const { result, rerender } = renderHook(() => useAppAuth());
    const nativeAuth = result.current;
    const nativeGetToken = result.current.getToken;

    rerender();

    expect(result.current).toBe(nativeAuth);
    expect(result.current.getToken).toBe(nativeGetToken);
    expect(mocks.useAuth).not.toHaveBeenCalled();
    expect(mocks.useClerk).not.toHaveBeenCalled();
    expect(mocks.useUser).not.toHaveBeenCalled();
  });
});
