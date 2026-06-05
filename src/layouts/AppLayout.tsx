import { useRef } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { BookOpen, Heart, Home, ListChecks, Megaphone, Users } from "lucide-react";
import { AppSidebar } from "../components/AppSidebar";
import { TchurchLogo } from "@/components/TchurchLogo";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useChurch } from "@/providers/ChurchProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { NotificationBell } from "@/components/NotificationBell";
import { NotificationsProvider } from "@/providers/NotificationsProvider";

const mobileNavItems = [
  { label: "Inicio", href: "/app", icon: Home, end: true },
  { label: "Servicios", href: "/app/services", icon: ListChecks },
  { label: "Dar", href: "/app/giving", icon: Heart },
  { label: "Ministerios", href: "/app/ministries", icon: Users },
  { label: "Devocional", href: "/app/devotionals", icon: BookOpen },
  { label: "Anuncios", href: "/app/announcements", icon: Megaphone },
];

function AppLayoutInner() {
  const { selectedChurch } = useChurch();
  const isMobile = useIsMobile();
  const { openMobile, setOpenMobile } = useSidebar();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  usePushNotifications();

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (!isMobile || openMobile) return;
    const touch = event.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (!isMobile || openMobile || touchStartX.current === null || touchStartY.current === null) return;

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
      className="flex min-h-svh w-full flex-1 overflow-x-clip bg-zinc-50"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <AppSidebar />
      <SidebarInset className="min-w-0 w-full max-w-full overflow-x-clip overflow-y-auto">
        {isMobile ? (
          <header
            className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/95 shadow-sm shadow-zinc-200/30 backdrop-blur"
            style={{ paddingTop: "max(env(safe-area-inset-top), 0.65rem)" }}
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
          className="mx-auto flex w-full min-w-0 flex-1 flex-col overflow-x-clip px-3 pb-[calc(env(safe-area-inset-bottom)+5.75rem)] pt-4 sm:px-4 md:px-6 md:pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pt-6 lg:px-8"
          style={{ maxWidth: "min(100vw, 100%)" }}
        >
          <Outlet />
        </div>
        {isMobile ? (
          <nav
            className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200/80 bg-white/95 px-2 pt-2 shadow-[0_-18px_40px_rgba(15,23,42,0.08)] backdrop-blur"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.55rem)" }}
            aria-label="Navegación principal"
          >
            <div className="mx-auto grid max-w-lg grid-cols-6 gap-1">
              {mobileNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.href}
                    to={item.href}
                    end={item.end}
                    className={({ isActive }) =>
                      [
                        "flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[0.68rem] font-bold transition",
                        isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-zinc-100 hover:text-zinc-950",
                      ].join(" ")
                    }
                  >
                    <Icon className="h-5 w-5" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </nav>
        ) : null}
      </SidebarInset>
    </div>
  );
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <NotificationsProvider>
        <AppLayoutInner />
      </NotificationsProvider>
    </SidebarProvider>
  );
}
