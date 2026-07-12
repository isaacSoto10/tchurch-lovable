import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useNativeDeepLinks } from "@/hooks/useNativeDeepLinks";
import { PRESENTATION_PLANNING_CENTER_RELAY_EVENT, type PlanningCenterRelayEventDetail, type PresentationIntegrationSummary } from "@/lib/presentationProduction";

function flushPromises() {
  return act(() => Promise.resolve());
}

type AppUrlOpenListener = (event: { url: string }) => void;

function Harness({
  navigate,
  runtime,
  routeAfterMount,
}: {
  navigate: (route: string, options?: { replace?: boolean }) => void;
  runtime: Parameters<typeof useNativeDeepLinks>[1];
  routeAfterMount?: string;
}) {
  const routerNavigate = useNavigate();
  const trackedNavigate = (route: string, options?: { replace?: boolean }) => {
    navigate(route, options);
    routerNavigate(route, options);
  };

  useNativeDeepLinks(trackedNavigate, runtime);

  useEffect(() => {
    if (routeAfterMount) routerNavigate(routeAfterMount);
  }, [routeAfterMount, routerNavigate]);

  return null;
}

describe("useNativeDeepLinks", () => {
  it("consumes launch URL once while keeping appUrlOpen listeners current", async () => {
    let appUrlOpenListener: AppUrlOpenListener | null = null;
    const remove = vi.fn();
    const runtime = {
      isNativePlatform: vi.fn(() => true),
      getLaunchUrl: vi.fn(async () => ({ url: "tchurchapp://tchurchapp.com/#/app/ministries" })),
      addListener: vi.fn(async (_eventName: "appUrlOpen", listener: AppUrlOpenListener) => {
        appUrlOpenListener = listener;
        return { remove };
      }),
      warn: vi.fn(),
    };
    const firstNavigate = vi.fn();
    const latestNavigate = vi.fn();

    const { rerender, unmount } = render(
      <MemoryRouter initialEntries={["/app"]}>
        <Harness navigate={firstNavigate} runtime={runtime} />
      </MemoryRouter>,
    );
    await flushPromises();

    expect(runtime.getLaunchUrl).toHaveBeenCalledTimes(1);
    expect(firstNavigate).toHaveBeenCalledWith("/app/ministries", { replace: true });

    rerender(
      <MemoryRouter initialEntries={["/app"]}>
        <Harness navigate={latestNavigate} runtime={runtime} />
      </MemoryRouter>,
    );
    await flushPromises();

    expect(runtime.getLaunchUrl).toHaveBeenCalledTimes(1);
    expect(latestNavigate).not.toHaveBeenCalled();

    act(() => {
      appUrlOpenListener?.({ url: "tchurchapp://tchurchapp.com/#/app/services" });
    });

    expect(latestNavigate).toHaveBeenCalledWith("/app/services", undefined);

    unmount();
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale launch URL override in-app ministry navigation", async () => {
    let resolveLaunchUrl: ((launch: { url?: string | null }) => void) | null = null;
    const runtime = {
      isNativePlatform: vi.fn(() => true),
      getLaunchUrl: vi.fn(
        () =>
          new Promise<{ url?: string | null }>((resolve) => {
            resolveLaunchUrl = resolve;
          }),
      ),
      addListener: vi.fn(async () => ({ remove: vi.fn() })),
      warn: vi.fn(),
    };
    const navigate = vi.fn();

    render(
      <MemoryRouter initialEntries={["/app/ministries"]}>
        <Harness navigate={navigate} runtime={runtime} routeAfterMount="/app/ministries/ministry-1" />
      </MemoryRouter>,
    );
    await flushPromises();

    act(() => {
      resolveLaunchUrl?.({ url: "tchurchapp://tchurchapp.com/#/app/ministries" });
    });
    await flushPromises();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("removes a Planning Center handoff from the route before completing it", async () => {
    let appUrlOpenListener: AppUrlOpenListener | null = null;
    const handoff = "h".repeat(43);
    const summary: PresentationIntegrationSummary = {
      schemaVersion: 4 as const,
      integrations: [
        { provider: "planning_center", status: "connected", externalOrganization: { id: "org-1", name: "Church" }, scopes: ["services"], connectedAt: "2026-07-12T13:00:00.000Z", lastSyncAt: null },
      ],
    };
    const complete = vi.fn(async () => summary);
    const runtime = {
      isNativePlatform: vi.fn(() => true),
      getLaunchUrl: vi.fn(async () => undefined),
      addListener: vi.fn(async (_eventName: "appUrlOpen", listener: AppUrlOpenListener) => {
        appUrlOpenListener = listener;
        return { remove: vi.fn() };
      }),
      warn: vi.fn(),
      completePlanningCenterHandoff: complete,
    };
    const navigate = vi.fn();
    const relayEvents: PlanningCenterRelayEventDetail[] = [];
    const capture = (event: Event) => relayEvents.push((event as CustomEvent<PlanningCenterRelayEventDetail>).detail);
    window.addEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, capture);
    const view = render(
      <MemoryRouter initialEntries={["/app/services/service-1/presentation"]}>
        <Harness navigate={navigate} runtime={runtime} />
      </MemoryRouter>,
    );
    await flushPromises();
    act(() => {
      appUrlOpenListener?.({ url: `tchurchapp://tchurchapp.com/#/app/services/service-1/presentation?planningCenter=complete&handoff=${handoff}` });
    });
    expect(navigate).toHaveBeenCalledWith("/app/services/service-1/presentation", { replace: true });
    expect(JSON.stringify(navigate.mock.calls)).not.toContain(handoff);
    expect(complete).toHaveBeenCalledWith(handoff);
    await flushPromises();
    expect(relayEvents).toEqual([{ serviceId: "service-1", outcome: "complete", summary }]);
    view.unmount();
    window.removeEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, capture);
  });

  it("keeps wrong-user, wrong-church, replayed and expired relay failures generic and credential-free", async () => {
    let appUrlOpenListener: AppUrlOpenListener | null = null;
    const complete = vi.fn(async () => { throw new Error("server rejected relay"); });
    const runtime = {
      isNativePlatform: vi.fn(() => true),
      getLaunchUrl: vi.fn(async () => undefined),
      addListener: vi.fn(async (_eventName: "appUrlOpen", listener: AppUrlOpenListener) => {
        appUrlOpenListener = listener;
        return { remove: vi.fn() };
      }),
      warn: vi.fn(),
      completePlanningCenterHandoff: complete,
    };
    const navigate = vi.fn();
    const relayEvents: PlanningCenterRelayEventDetail[] = [];
    const capture = (event: Event) => relayEvents.push((event as CustomEvent<PlanningCenterRelayEventDetail>).detail);
    window.addEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, capture);
    const view = render(<MemoryRouter initialEntries={["/app"]}><Harness navigate={navigate} runtime={runtime} /></MemoryRouter>);
    await flushPromises();
    for (const marker of ["a", "b", "c", "d"]) {
      const handoff = marker.repeat(43);
      act(() => appUrlOpenListener?.({ url: `tchurchapp://tchurchapp.com/#/app/services/service-1/presentation?planningCenter=complete&handoff=${handoff}` }));
      await flushPromises();
      expect(JSON.stringify(navigate.mock.calls)).not.toContain(handoff);
      expect(JSON.stringify(relayEvents)).not.toContain(handoff);
    }
    expect(relayEvents).toEqual(Array.from({ length: 4 }, () => ({ serviceId: "service-1", outcome: "error", code: "HANDOFF_FAILED" })));
    expect(runtime.warn).not.toHaveBeenCalled();
    view.unmount();
    window.removeEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, capture);
  });

  it("accepts controlled callback failures without reflecting the server code", async () => {
    let appUrlOpenListener: AppUrlOpenListener | null = null;
    const runtime = {
      isNativePlatform: vi.fn(() => true),
      getLaunchUrl: vi.fn(async () => undefined),
      addListener: vi.fn(async (_eventName: "appUrlOpen", listener: AppUrlOpenListener) => {
        appUrlOpenListener = listener;
        return { remove: vi.fn() };
      }),
      warn: vi.fn(),
      completePlanningCenterHandoff: vi.fn(),
    };
    const navigate = vi.fn();
    const relayEvents: PlanningCenterRelayEventDetail[] = [];
    const capture = (event: Event) => relayEvents.push((event as CustomEvent<PlanningCenterRelayEventDetail>).detail);
    window.addEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, capture);
    const view = render(<MemoryRouter initialEntries={["/app"]}><Harness navigate={navigate} runtime={runtime} /></MemoryRouter>);
    await flushPromises();

    act(() => appUrlOpenListener?.({ url: "tchurchapp://tchurchapp.com/#/app/services/service-1/presentation?planningCenter=error&code=OAUTH_STATE_INVALID" }));

    expect(navigate).toHaveBeenCalledWith("/app/services/service-1/presentation", { replace: true });
    expect(relayEvents).toEqual([{ serviceId: "service-1", outcome: "error", code: "OAUTH_CALLBACK_ERROR" }]);
    expect(JSON.stringify(relayEvents)).not.toContain("OAUTH_STATE_INVALID");
    expect(runtime.completePlanningCenterHandoff).not.toHaveBeenCalled();
    view.unmount();
    window.removeEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, capture);
  });
});
