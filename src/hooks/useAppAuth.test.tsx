import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearMobileAuthSession: vi.fn(),
  purgeStudioLANPrivateState: vi.fn(),
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false, userId: null, getToken: vi.fn() }),
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: null }),
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

vi.mock("@/lib/studioLANClient", () => ({
  purgeStudioLANPrivateState: mocks.purgeStudioLANPrivateState,
}));

import { useAppAuth } from "./useAppAuth";

describe("useAppAuth Studio LAN privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.purgeStudioLANPrivateState.mockResolvedValue(undefined);
    window.location.hash = "#/app/settings";
  });

  it("purges Studio pairing and cache state before clearing the mobile session", async () => {
    const { result } = renderHook(() => useAppAuth());

    await act(async () => {
      await result.current.signOut("/login");
    });

    expect(mocks.purgeStudioLANPrivateState).toHaveBeenCalledOnce();
    expect(mocks.clearMobileAuthSession).toHaveBeenCalledOnce();
    expect(mocks.purgeStudioLANPrivateState.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.clearMobileAuthSession.mock.invocationCallOrder[0]);
    expect(window.location.hash).toBe("#/login");
  });
});
