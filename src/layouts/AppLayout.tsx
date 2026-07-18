import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent, type UIEvent } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { CalendarDays, Home, ListChecks, Menu, Users } from "lucide-react";
import { AppSidebar } from "../components/AppSidebar";
import { TchurchLogo } from "@/components/TchurchLogo";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useChurch } from "@/providers/ChurchProvider";
import { useIsMobile, useResponsiveLayout } from "@/hooks/use-mobile";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useEventCheckInQueueSync } from "@/hooks/useEventCheckInQueueSync";
import { useSongLyricsProposalSync } from "@/hooks/useSongLyricsProposalSync";
import { NotificationBell } from "@/components/NotificationBell";
import { NotificationsProvider } from "@/providers/NotificationsProvider";
import {
  getMobileNavContentClearanceCss,
  getMobileNavHeightCss,
  getMobileNavReservedSpace,
  getMobileNavSafeBottom,
  getMobilePageBottomBuffer,
  isMobileKeyboardOpen,
} from "@/lib/mobileNavLayout";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";
import { getPrimaryNavigationGroup, type PrimaryNavigationGroup } from "@/lib/appNavigation";
import { ChatDock } from "@/components/ChatDock";

const mobileNavItems: ReadonlyArray<{
  label: string;
  href?: string;
  icon: typeof Home;
  group: PrimaryNavigationGroup;
}> = [
  { label: "Inicio", href: "/app", icon: Home, group: "home" },
  { label: "Agenda", href: "/app/calendar", icon: CalendarDays, group: "agenda" },
  { label: "Servicios", href: "/app/services", icon: ListChecks, group: "services" },
  { label: "Comunidad", href: "/app/announcements", icon: Users, group: "community" },
  { label: "Más", icon: Menu, group: "more" },
];

const SAFE_BOTTOM_VAR = "--tchurch-mobile-safe-bottom";
const NAV_RESERVED_SPACE_VAR = "--tchurch-mobile-nav-reserved";
const PAGE_BOTTOM_BUFFER_VAR = "--tchurch-mobile-page-bottom-buffer";
const NAV_HEIGHT_VAR = "--tchurch-mobile-nav-height";
const CONTENT_CLEARANCE_VAR = "--tchurch-mobile-content-clearance";
const MOBILE_CONTENT_CLEARANCE = "var(--tchurch-mobile-content-clearance, var(--tchurch-mobile-nav-reserved, 8rem))";
const MOBILE_CONTENT_WITH_CHAT_CLEARANCE = `calc(${MOBILE_CONTENT_CLEARANCE} + 3.75rem)`;

const mobileNavGeometryStyle = {
  [SAFE_BOTTOM_VAR]: `${getMobileNavSafeBottom()}px`,
  [NAV_RESERVED_SPACE_VAR]: `${getMobileNavReservedSpace()}px`,
  [PAGE_BOTTOM_BUFFER_VAR]: `${getMobilePageBottomBuffer()}px`,
  [NAV_HEIGHT_VAR]: getMobileNavHeightCss(),
  [CONTENT_CLEARANCE_VAR]: getMobileNavContentClearanceCss(),
} as CSSProperties;

const mobileRouteScrollPositions = new Map<string, number>();

function RouteContentFallback() {
  return (
    <div className="mobile-page min-w-0 animate-pulse space-y-4" aria-hidden="true">
      <div className="h-8 w-40 rounded-full bg-muted/80" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-24 rounded-2xl bg-muted/70" />
        <div className="h-24 rounded-2xl bg-muted/60" />
      </div>
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="h-4 w-32 rounded-full bg-muted" />
        <div className="h-16 rounded-xl bg-muted/70" />
        <div className="h-16 rounded-xl bg-muted/60" />
      </div>
    </div>
  );
}

function AppLayoutInner() {
  const { selectedChurch } = useChurch();
  const isMobile = useIsMobile();
  const responsive = useResponsiveLayout();
  const useCompactNavigation = isMobile;
  const showShortcutBar = useCompactNavigation;
  const { openMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const activePrimaryGroup = getPrimaryNavigationGroup(location.pathname);
  const routeKey = `${location.pathname}${location.search}`;
  const isMessagesRoute = location.pathname === "/app/messages";
  const isSermonsRoute = location.pathname === "/app/media" || location.pathname.startsWith("/app/media/");
  const contentRouteKey = isSermonsRoute ? location.pathname : routeKey;
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [visualHeight, setVisualHeight] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const activeRouteKeyRef = useRef(routeKey);
  const pendingScrollTopRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);

  usePushNotifications();
  useEventCheckInQueueSync();
  useSongLyricsProposalSync();

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    let focusFrame: number | null = null;
    const update = () => {
      setKeyboardOpen(isMobileKeyboardOpen({
        innerHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportOffsetTop: viewport.offsetTop,
        viewportScale: viewport.scale,
        activeElement: document.activeElement,
      }));
      setVisualHeight(Math.round(viewport.height));
    };
    const updateAfterFocusChange = () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        focusFrame = null;
        update();
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("focusin", updateAfterFocusChange);
    window.addEventListener("focusout", updateAfterFocusChange);
    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("focusin", updateAfterFocusChange);
      window.removeEventListener("focusout", updateAfterFocusChange);
    };
  }, []);

  const shellStyle = useMemo(() => ({
    ...(showShortcutBar ? mobileNavGeometryStyle : {}),
    ...(visualHeight ? { "--app-visual-height": `${visualHeight}px` } : {}),
    ...(keyboardOpen && visualHeight ? { height: `${visualHeight}px`, maxHeight: `${visualHeight}px` } : {}),
  }) as CSSProperties, [keyboardOpen, showShortcutBar, visualHeight]);

  useEffect(() => {
    activeRouteKeyRef.current = routeKey;

    if (!showShortcutBar) return undefined;

    const scrollport = contentScrollRef.current;
    if (!scrollport) return undefined;

    const frame = window.requestAnimationFrame(() => {
      scrollport.scrollTop = mobileRouteScrollPositions.get(routeKey) ?? 0;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [routeKey, showShortcutBar]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }
  }, []);

  const handleContentScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!showShortcutBar) return;

    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = window.requestAnimationFrame(() => {
      mobileRouteScrollPositions.set(activeRouteKeyRef.current, pendingScrollTopRef.current);
      scrollRafRef.current = null;
    });
  }, [showShortcutBar]);

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (!useCompactNavigation || openMobile) return;
    const touch = event.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (!useCompactNavigation || openMobile || touchStartX.current === null || touchStartY.current === null) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = Math.abs(touch.clientY - touchStartY.current);
    const startedAtEdge = touchStartX.current <= 28;

    touchStartX.current = null;
    touchStartY.current = null;

    if (startedAtEdge && deltaX > 72 && deltaY < 48) {
      setOpenMobile(true);
    }
  }

  return (
    <div
      data-mobile-shell={showShortcutBar ? "true" : undefined}
      data-device-class={responsive.isPhone ? "phone" : responsive.isTablet ? "tablet" : "wide"}
      className={[
        "flex w-full flex-1 overflow-x-clip bg-background",
        showShortcutBar ? "h-svh max-h-svh min-h-0 overflow-hidden overscroll-none" : "min-h-svh",
      ].join(" ")}
      style={shellStyle}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <AppSidebar />
      <SidebarInset
        className={[
          "min-w-0 w-full max-w-full overflow-x-clip",
          showShortcutBar ? "h-svh max-h-svh min-h-0 overflow-hidden" : "overflow-y-auto overscroll-y-contain",
        ].join(" ")}
      >
        {useCompactNavigation ? (
          <header
            className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur"
            style={{ paddingTop: "max(var(--app-safe-area-top), 0.65rem)" }}
          >
            <div className="flex items-center gap-3 px-4 pb-2.5">
              <SidebarTrigger className="h-11 w-11 rounded-xl border border-border bg-card" />
              <div className="min-w-0 flex-1">
                <TchurchLogo size="xs" wordPurple className="justify-start" />
                <p className="truncate text-[0.8rem] leading-tight text-muted-foreground">
                  {selectedChurch?.name || "Configura tu iglesia"}
                </p>
              </div>
              <NotificationBell />
            </div>
          </header>
        ) : null}
        <div
          data-testid={showShortcutBar ? "mobile-content-scrollport" : undefined}
          ref={contentScrollRef}
          onScroll={handleContentScroll}
          className={[
            "mx-auto flex w-full min-w-0 flex-1 flex-col overflow-x-clip md:max-w-[1120px] xl:max-w-[1320px]",
            isMessagesRoute ? "min-h-0 overflow-hidden p-0 lg:px-6 lg:pb-4 lg:pt-4" : "px-3 pb-4 pt-4 sm:px-4 md:px-5 lg:px-6 xl:px-8",
            showShortcutBar && !isMessagesRoute ? "min-h-0 overflow-y-auto overscroll-y-contain" : "",
            isSermonsRoute ? "bg-[#0B0A10]" : "",
          ].join(" ")}
          style={{
            paddingTop: useCompactNavigation ? undefined : "max(var(--app-safe-area-top), 1.5rem)",
            paddingBottom: showShortcutBar ? (keyboardOpen ? 0 : isMessagesRoute || isSermonsRoute ? MOBILE_CONTENT_CLEARANCE : MOBILE_CONTENT_WITH_CHAT_CLEARANCE) : undefined,
            scrollPaddingBottom: showShortcutBar ? (keyboardOpen ? 0 : isMessagesRoute || isSermonsRoute ? MOBILE_CONTENT_CLEARANCE : MOBILE_CONTENT_WITH_CHAT_CLEARANCE) : undefined,
          }}
        >
          {!useCompactNavigation ? (
            <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`truncate text-sm font-semibold ${isSermonsRoute ? "text-[#F8F7FF]" : "text-zinc-950"}`}>
                  {selectedChurch?.name || "Configura tu iglesia"}
                </p>
                <p className={`text-xs ${isSermonsRoute ? "text-[#A9A4B7]" : "text-muted-foreground"}`}>Tchurch</p>
              </div>
              <div className={isSermonsRoute ? "[&_button]:border-[#302A3B] [&_button]:bg-[#15121D] [&_button]:shadow-none [&_svg]:text-[#F8F7FF]" : ""}>
                <NotificationBell />
              </div>
            </div>
          ) : null}
          <div key={contentRouteKey} data-route-content className={isMessagesRoute ? "h-full min-h-0 min-w-0" : "min-w-0"}>
            <Suspense fallback={<RouteContentFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </SidebarInset>
      {!isSermonsRoute ? <ChatDock keyboardOpen={keyboardOpen} hasBottomNav={showShortcutBar} /> : null}
      {showShortcutBar && !keyboardOpen ? (
        <nav
          data-testid="mobile-bottom-nav"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-card"
          aria-label="Navegación principal"
          style={{ backfaceVisibility: "hidden" }}
        >
          <div
            className="border-t border-border bg-card px-2 pt-2.5"
            style={{ paddingBottom: "var(--app-safe-area-bottom, var(--tchurch-mobile-safe-bottom, 22px))" }}
          >
            <div className="mx-auto grid max-w-lg grid-cols-5 gap-1 md:max-w-2xl">
              {mobileNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activePrimaryGroup === item.group;
                const className = [
                  "pointer-events-auto flex h-[3.75rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.68rem] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                ].join(" ");

                if (!item.href) {
                  return (
                    <button
                      key={item.group}
                      type="button"
                      aria-label="Abrir menú completo"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setOpenMobile(true)}
                      className={className}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="max-w-full truncate">{item.label}</span>
                    </button>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onPointerEnter={() => preloadAppRoute(item.href)}
                    onFocus={() => preloadAppRoute(item.href)}
                    onTouchStart={() => preloadAppRoute(item.href)}
                    className={className}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="max-w-full truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export function AppLayout() {
  const responsive = useResponsiveLayout();

  return (
    <SidebarProvider defaultOpen={!responsive.isTabletPortrait}>
      <NotificationsProvider>
        <AppLayoutInner />
      </NotificationsProvider>
    </SidebarProvider>
  );
}
