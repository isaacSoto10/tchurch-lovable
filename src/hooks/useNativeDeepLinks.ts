import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp, type URLOpenListenerEvent } from "@capacitor/app";
import { areAppRoutesEquivalent, routeFromAppUrl, shouldApplyNativeLaunchRoute } from "@/lib/navigation";
import {
  completePlanningCenterHandoff,
  parsePlanningCenterMobileRelay,
  PRESENTATION_PLANNING_CENTER_RELAY_EVENT,
  type PlanningCenterRelayEventDetail,
} from "@/lib/presentationProduction";

type NavigateToRoute = (route: string, options?: { replace?: boolean }) => void;

type NativeDeepLinkListenerHandle = {
  remove: () => void | Promise<void>;
};

type NativeDeepLinkRuntime = {
  isNativePlatform: () => boolean;
  getLaunchUrl: () => Promise<{ url?: string | null } | undefined>;
  addListener: (
    eventName: "appUrlOpen",
    listener: (event: Pick<URLOpenListenerEvent, "url">) => void,
  ) => Promise<NativeDeepLinkListenerHandle>;
  warn: (message: string, error: unknown) => void;
  completePlanningCenterHandoff?: typeof completePlanningCenterHandoff;
};

const capacitorDeepLinkRuntime: NativeDeepLinkRuntime = {
  isNativePlatform: () => Capacitor.isNativePlatform(),
  getLaunchUrl: () => CapacitorApp.getLaunchUrl(),
  addListener: (eventName, listener) => CapacitorApp.addListener(eventName, listener as (event: URLOpenListenerEvent) => void),
  warn: (message, error) => console.warn(message, error),
  completePlanningCenterHandoff,
};

function emitPlanningCenterRelay(detail: PlanningCenterRelayEventDetail) {
  window.dispatchEvent(new CustomEvent<PlanningCenterRelayEventDetail>(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, { detail }));
}

export function useNativeDeepLinks(
  navigate: NavigateToRoute,
  runtime: NativeDeepLinkRuntime = capacitorDeepLinkRuntime,
) {
  const location = useLocation();
  const navigateRef = useRef(navigate);
  const currentRouteRef = useRef(`${location.pathname}${location.search}${location.hash}`);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    currentRouteRef.current = `${location.pathname}${location.search}${location.hash}`;
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!runtime.isNativePlatform()) return undefined;

    let mounted = true;
    const initialRoute = currentRouteRef.current;

    const consumePlanningCenterRelay = (url: unknown, launch = false) => {
      const relay = parsePlanningCenterMobileRelay(url);
      if (!relay) return false;
      const shouldNavigate = !launch || shouldApplyNativeLaunchRoute(relay.route, initialRoute, currentRouteRef.current);
      if (shouldNavigate) {
        currentRouteRef.current = relay.route;
        // Replacing immediately removes the one-use handoff from the HashRouter URL/history.
        navigateRef.current(relay.route, { replace: true });
      }
      if (relay.outcome === "error") {
        emitPlanningCenterRelay({ serviceId: relay.serviceId, outcome: "error", code: relay.code });
        return true;
      }
      const complete = runtime.completePlanningCenterHandoff;
      if (!complete) {
        emitPlanningCenterRelay({ serviceId: relay.serviceId, outcome: "error", code: "HANDOFF_FAILED" });
        return true;
      }
      let handoff: string | null = relay.handoff;
      const completion = complete(handoff);
      handoff = null;
      void completion.then((summary) => {
        if (mounted) emitPlanningCenterRelay({ serviceId: relay.serviceId, outcome: "complete", summary });
      }).catch(() => {
        if (mounted) emitPlanningCenterRelay({ serviceId: relay.serviceId, outcome: "error", code: "HANDOFF_FAILED" });
      });
      return true;
    };

    const openRoute = (url: unknown) => {
      if (consumePlanningCenterRelay(url)) return;
      const route = routeFromAppUrl(url);
      if (route && !areAppRoutesEquivalent(route, currentRouteRef.current)) {
        currentRouteRef.current = route;
        navigateRef.current(route);
      }
    };

    void runtime
      .getLaunchUrl()
      .then((launch) => {
        if (consumePlanningCenterRelay(launch?.url, true)) return;
        const route = routeFromAppUrl(launch?.url);
        if (mounted && shouldApplyNativeLaunchRoute(route, initialRoute, currentRouteRef.current)) {
          currentRouteRef.current = route!;
          navigateRef.current(route!, { replace: true });
        }
      })
      .catch((error) => runtime.warn("[DeepLink] No se pudo leer el launch URL:", error));

    const listener = runtime.addListener("appUrlOpen", (event) => {
      openRoute(event.url);
    });

    return () => {
      mounted = false;
      void listener.then((handle) => handle.remove());
    };
  }, [runtime]);
}
