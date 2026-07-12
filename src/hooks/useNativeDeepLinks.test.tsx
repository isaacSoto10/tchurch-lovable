import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useNativeDeepLinks } from "@/hooks/useNativeDeepLinks";

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

});
