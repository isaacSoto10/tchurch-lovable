import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { isNativeMobileAuth } from "@/lib/mobileAuth";
import { useAppAuth } from "@/hooks/useAppAuth";
import {
  configureUserActionLogger,
  describeElementForAction,
  describeFormSubmit,
  flushUserActionLogs,
  getActionElementFromEventTarget,
  logUserAction,
  sanitizeActionPath,
} from "@/lib/userActionLogger";

export function UserActionLoggingProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { getToken, isLoaded, isSignedIn } = useAppAuth();
  const previousRoute = useRef<string | null>(null);
  const previousAuthState = useRef<string | null>(null);
  const route = useMemo(
    () => sanitizeActionPath(`${location.pathname}${location.search}${location.hash}`),
    [location.hash, location.pathname, location.search],
  );

  useEffect(() => {
    configureUserActionLogger({ tokenProvider: getToken });
  }, [getToken]);

  useEffect(() => {
    if (!route || previousRoute.current === route) return;

    logUserAction("navigation.changed", {
      from: previousRoute.current,
      to: route,
      initial: previousRoute.current === null,
    });
    previousRoute.current = route;
  }, [route]);

  useEffect(() => {
    if (!isLoaded) return;

    const state = isSignedIn ? "signed_in" : "signed_out";
    if (previousAuthState.current === state) return;

    logUserAction("auth.lifecycle", {
      state,
      mode: isNativeMobileAuth ? "mobile_auth" : "clerk",
      initial: previousAuthState.current === null,
    });
    previousAuthState.current = state;
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.button !== 0) return;

      const element = getActionElementFromEventTarget(event.target);
      if (!element) return;

      logUserAction("interaction.click", {
        ...describeElementForAction(element),
        input: event.detail === 0 ? "keyboard" : "pointer",
      });
    }

    function handleSubmit(event: SubmitEvent) {
      if (!(event.target instanceof HTMLFormElement)) return;

      logUserAction("form.submit", describeFormSubmit(event.target), { immediate: true });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        void flushUserActionLogs();
      }
    }

    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return <>{children}</>;
}
