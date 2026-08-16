import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  baseProvider: vi.fn(({ children }: { children: React.ReactNode }) => children),
}));

vi.mock("@clerk/clerk-react", () => ({ ClerkProvider: mocks.baseProvider }));
vi.mock("@/lib/mobileAuth", () => ({ isNativeMobileAuth: true }));
vi.mock("@/lib/clerkClient", () => ({
  CLERK_PUBLISHABLE_KEY: "test-key",
  clerkAllowedRedirectOrigins: undefined,
  clerkAllowedRedirectProtocols: undefined,
  clerkRedirects: {
    signInUrl: "/login",
    signUpUrl: "/signup",
    postAuthRedirect: "/app",
  },
  headlessClerk: {},
  isStandardBrowserRuntime: false,
}));

import { ClerkProvider } from "./ClerkProvider";

describe("ClerkProvider native boundary", () => {
  it("does not initialize the Clerk React provider for native mobile auth", () => {
    render(
      <ClerkProvider>
        <span>Native application</span>
      </ClerkProvider>,
    );

    expect(screen.getByText("Native application")).toBeInTheDocument();
    expect(mocks.baseProvider).not.toHaveBeenCalled();
  });
});
