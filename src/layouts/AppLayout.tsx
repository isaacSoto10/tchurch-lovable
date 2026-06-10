import { useEffect, useRef } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { BookOpen, Heart, Home, ListChecks, Megaphone, Users } from "lucide-react";
import { AppSidebar } from "../components/AppSidebar";
import { TchurchLogo } from "@/components/TchurchLogo";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useChurch } from "@/providers/ChurchProvider";
import { useIsMobile, useResponsiveLayout } from "@/hooks/use-mobile";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useEventCheckInQueueSync } from "@/hooks/useEventCheckInQueueSync";
import { NotificationBell } from "@/components/NotificationBell";
import { NotificationsProvider } from "@/providers/NotificationsProvider";
import { clampMobileSafeAreaBottom, getMobileNavReservedSpace } from "@/lib/mobileNavLayout";

const mobileNavItems = [
  { label: "Inicio", href: "/app", icon: Home, end: true },
  { label: "Servicios", href: "/app/services", icon: ListChecks },
  { label: "Dar", href: "/app/giving", icon: Heart },
  { label: "Ministerios", href: "/app/ministries", icon: Users },
  { label: "Devocional", href: "/app/devotionals", icon: BookOpen },
  { label: "Anuncios", href: "/app/announcements", icon: Megaphone },
];

const SAFE_BOTTOM_VAR = "--tchurch-mobile-safe-bottom";
const NAV_RESERVED_SPACE_VAR = "--tchurch-mobile-nav-reserved";

function readSafeAreaBottom() {
  if (typeof document === "undefined") return 0;

  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "0";
  probe.style.bottom = "0";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  document.body.appendChild(probe);

  const measured = Number.parseFloat(window.getComputedStyle(probe).paddingBottom);
  probe.remove();

  return clampMobileSafeAreaBottom(measured);
}

function AppLayoutInner() {
  const { selectedChurch } = useChurch();
  const isMobile = useIsMobile();
  const responsive = useResponsiveLayout();
  const useCompactNavigation = isMobile;
  const showShortcutBar = useCompactNavigation;
  const { openMobile, setOpenMobile } = useSidebar();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  usePushNotifications();
  useEventCheckInQueueSync();

  useEffect(() => {
    if (!showShortcutBar || typeof document === "undefined") return;

    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;

    const syncMobileInsets = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const safeBottom = readSafeAreaBottom();
        root.style.setProperty(SAFE_BOTTOM_VAR, `${safeBottom}px`);
        root.style.setProperty(NAV_RESERVED_SPACE_VAR, `${getMobileNavReservedSpace(safeBottom)}px`);
      });
    };

    syncMobileInsets();
    window.addEventListener("resize", syncMobileInsets);
    window.addEventListener("orientationchange", syncMobileInsets);
    viewport?.addEventListener("resize", syncMobileInsets);
    viewport?.addEventListener("scroll", syncMobileInsets);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncMobileInsets);
      window.removeEventListener("orientationchange", syncMobileInsets);
      viewport?.removeEventListener("resize", syncMobileInsets);
      viewport?.removeEventListener("scroll", syncMobileInsets);
      root.style.removeProperty(SAFE_BOTTOM_VAR);
      root.style.removeProperty(NAV_RESERVED_SPACE_VAR);
    };
  }, [showShortcutBar]);

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (!useCompactNavigation || openMobile) return;
    const touch = event.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
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
      data-device-class={responsive.isPhone ? "phone" : responsive.isTablet ? "tablet" : "wide"}
      className="flex min-h-svh w-full flex-1 overflow-x-clip bg-zinc-50"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <AppSidebar />
      <SidebarInset className="min-w-0 w-full max-w-full overflow-x-clip overflow-y-auto">
        {useCompactNavigation ? (
          <header
            className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/95 shadow-sm shadow-zinc-200/30 backdrop-blur"
            style={{ paddingTop: "max(var(--app-safe-area-top), 0.65rem)" }}
          >
            <div className="flex items-center gap-3 px-4 pb-2.5">
              <SidebarTrigger className="h-10 w-10 rounded-2xl border border-zinc-200 bg-white shadow-sm" />
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
          className="mx-auto flex w-full min-w-0 flex-1 flex-col overflow-x-clip px-3 pb-4 pt-4 sm:px-4 md:max-w-[1120px] md:px-5 lg:px-6 xl:max-w-[1320px] xl:px-8"
          style={{
            paddingTop: useCompactNavigation ? undefined : "max(var(--app-safe-area-top), 1.5rem)",
            paddingBottom: showShortcutBar
              ? "var(--tchurch-mobile-nav-reserved, 5.25rem)"
              : undefined,
          }}
        >
          {!useCompactNavigation ? (
            <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-950">
                  {selectedChurch?.name || "Configura tu iglesia"}
                </p>
                <p className="text-xs text-muted-foreground">Tchurch</p>
              </div>
              <NotificationBell />
            </div>
          ) : null}
          <Outlet />
        </div>
        {showShortcutBar ? (
          <nav
            className="pointer-events-none fixed inset-x-0 bottom-0 z-30"
            aria-label="Navegación principal"
          >
            <div
              className="border-t border-zinc-200/80 bg-white/95 px-2 pt-1.5 shadow-[0_-14px_30px_rgba(15,23,42,0.07)] backdrop-blur"
              style={{ paddingBottom: "max(var(--tchurch-mobile-safe-bottom, 0px), 0.4rem)" }}
            >
              <div className="mx-auto grid max-w-lg grid-cols-6 gap-0.5 md:max-w-2xl">
                {mobileNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.href}
                      to={item.href}
                      end={item.end}
                      className={({ isActive }) =>
                        [
                          "pointer-events-auto flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-[0.62rem] font-bold leading-tight transition",
                          isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-zinc-100 hover:text-zinc-950",
                        ].join(" ")
                      }
                    >
                      <Icon className="h-[1.15rem] w-[1.15rem]" />
                      <span className="max-w-full truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </nav>
        ) : null}
      </SidebarInset>
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
