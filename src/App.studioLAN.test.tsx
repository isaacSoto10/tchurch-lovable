import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  clerkMounted: vi.fn(),
  churchMounted: vi.fn(),
  analyticsMounted: vi.fn(),
  privacyMounted: vi.fn(),
  routePreload: vi.fn(),
  dataWarmup: vi.fn(),
  fetch: vi.fn(),
  getLaunchUrl: vi.fn(),
  addAppListener: vi.fn(),
  removeAppListener: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    getLaunchUrl: mocks.getLaunchUrl,
    addListener: mocks.addAppListener,
  },
}));
vi.mock("@/lib/nativeAppWarmup", () => ({ scheduleNativeAppDataWarmup: mocks.dataWarmup }));
vi.mock("@/lib/appRoutePreloaders", async () => {
  const React = await import("react");
  const emptyLoader = () => Promise.resolve({ default: () => null });
  const routeNames = [
    "Landing", "Login", "Signup", "Dashboard", "Songs", "SongLyricsProposals", "SongDetail",
    "Services", "ServiceDetail", "ServicePresentation", "Announcements", "Devotionals", "Media",
    "MediaDetail", "Giving", "Ministries", "MinistryDetail", "Events", "EventDetail", "EventQr",
    "EventScanner", "Teams", "TeamDetail", "MyAssignments", "Settings", "Messages", "Prayer",
    "Training", "Calendar", "Users", "Blockouts", "Onboarding", "JoinChurch", "CreateChurchForm",
    "Presets", "NotFound",
  ];
  const appRouteLoaders = Object.fromEntries(routeNames.map((name) => [name, emptyLoader])) as Record<string, () => Promise<unknown>>;
  appRouteLoaders.AppLayout = () => Promise.resolve({ AppLayout: () => null });
  appRouteLoaders.StudioLANStage = () => Promise.resolve({
    default: () => React.createElement("div", { "data-testid": "studio-lan-route" }, "Studio LAN local"),
  });
  appRouteLoaders.StudioLANProduction = () => Promise.resolve({
    default: () => React.createElement("div", { "data-testid": "studio-lan-production-route" }, "Studio LAN production local"),
  });
  return { appRouteLoaders, scheduleNativeAppPreload: mocks.routePreload };
});

vi.mock("@/providers/ClerkProvider", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => {
    mocks.clerkMounted();
    return <>{children}</>;
  },
}));
vi.mock("@/providers/ChurchProvider", () => ({
  ChurchProvider: ({ children }: { children: ReactNode }) => {
    mocks.churchMounted();
    return <>{children}</>;
  },
}));
vi.mock("@/providers/UserActionLoggingProvider", () => ({
  UserActionLoggingProvider: ({ children }: { children: ReactNode }) => {
    mocks.analyticsMounted();
    return <>{children}</>;
  },
}));
vi.mock("@/components/StudioLANLocalPrivacyBoundary", () => ({
  StudioLANLocalPrivacyBoundary: ({ children }: { children: ReactNode }) => {
    mocks.privacyMounted();
    return <>{children}</>;
  },
}));
vi.mock("@/components/RequireAuth", () => ({ RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

import App from "./App";

describe("Studio LAN application boundary", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/app/studio-stage";
    mocks.getLaunchUrl.mockResolvedValue({ url: "tchurchapp://tchurchapp.com/#/app/studio-stage" });
    mocks.addAppListener.mockResolvedValue({ remove: mocks.removeAppListener });
    mocks.fetch.mockRejectedValue(new Error("Cloud traffic is forbidden on Studio LAN route"));
    globalThis.fetch = mocks.fetch as unknown as typeof fetch;
    window.fetch = mocks.fetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.fetch = originalFetch;
  });

  it("opens cold without membership, service warmup, Clerk, or analytics traffic", async () => {
    render(<App />);

    expect(await screen.findByTestId("studio-lan-route")).toHaveTextContent("Studio LAN local");
    expect(mocks.privacyMounted).toHaveBeenCalled();
    expect(mocks.clerkMounted).not.toHaveBeenCalled();
    expect(mocks.churchMounted).not.toHaveBeenCalled();
    expect(mocks.analyticsMounted).not.toHaveBeenCalled();
    expect(mocks.routePreload).not.toHaveBeenCalled();
    expect(mocks.dataWarmup).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("opens production control inside the same local-only privacy boundary", async () => {
    window.location.hash = "#/app/studio-production";
    mocks.getLaunchUrl.mockResolvedValue({ url: "tchurchapp://tchurchapp.com/#/app/studio-production" });

    render(<App />);

    expect(await screen.findByTestId("studio-lan-production-route")).toHaveTextContent("production local");
    expect(mocks.privacyMounted).toHaveBeenCalled();
    expect(mocks.clerkMounted).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps Cloud unmounted while a deferred native launch URL resolves to Studio LAN", async () => {
    let resolveLaunchUrl: ((launch: { url: string }) => void) | undefined;
    mocks.getLaunchUrl.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLaunchUrl = resolve;
    }));
    window.location.hash = "#/";

    render(<App />);

    expect(screen.getByRole("status", { name: "Cargando Tchurch" })).toBeInTheDocument();
    expect(mocks.clerkMounted).not.toHaveBeenCalled();
    expect(mocks.churchMounted).not.toHaveBeenCalled();
    expect(mocks.analyticsMounted).not.toHaveBeenCalled();
    expect(mocks.routePreload).not.toHaveBeenCalled();
    expect(mocks.dataWarmup).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();

    await act(async () => {
      resolveLaunchUrl?.({ url: "tchurchapp://tchurchapp.com/#/app/studio-stage" });
      await Promise.resolve();
    });

    expect(await screen.findByTestId("studio-lan-route")).toHaveTextContent("Studio LAN local");
    expect(mocks.clerkMounted).not.toHaveBeenCalled();
    expect(mocks.churchMounted).not.toHaveBeenCalled();
    expect(mocks.analyticsMounted).not.toHaveBeenCalled();
    expect(mocks.routePreload).not.toHaveBeenCalled();
    expect(mocks.dataWarmup).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("restores the normal Cloud providers only after leaving the LAN route", async () => {
    render(<App />);
    expect(await screen.findByTestId("studio-lan-route")).toBeInTheDocument();
    expect(mocks.clerkMounted).not.toHaveBeenCalled();

    act(() => {
      window.location.hash = "#/app/services";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => expect(mocks.clerkMounted).toHaveBeenCalled());
    expect(mocks.churchMounted).toHaveBeenCalled();
    expect(mocks.analyticsMounted).toHaveBeenCalled();
    expect(mocks.routePreload).toHaveBeenCalledOnce();
    expect(mocks.dataWarmup).toHaveBeenCalledOnce();
  });
});
