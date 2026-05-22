import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar } from "../components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useChurch } from "@/providers/ChurchProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePushNotifications } from "@/hooks/usePushNotifications";

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
      className="flex min-h-svh w-full flex-1 overflow-x-clip bg-background"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <AppSidebar />
      <SidebarInset className="min-w-0 w-full max-w-full overflow-x-clip overflow-y-auto">
        {isMobile ? (
          <header
            className="sticky top-0 z-20 border-b border-border bg-card/95 shadow-sm backdrop-blur"
            style={{ paddingTop: "max(env(safe-area-inset-top), 0.65rem)" }}
          >
            <div className="flex items-center gap-3 px-4 pb-2.5">
              <SidebarTrigger className="h-10 w-10 rounded-md border border-border bg-card shadow-sm" />
              <div className="min-w-0">
                <p className="text-[0.95rem] font-semibold leading-tight">Tchurch</p>
                <p className="truncate text-[0.8rem] leading-tight text-muted-foreground">
                  {selectedChurch?.name || "Configura tu iglesia"}
                </p>
              </div>
            </div>
          </header>
        ) : null}
        <div
          className="mx-auto flex w-full min-w-0 flex-1 flex-col overflow-x-clip px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:px-4 md:px-6 md:pt-6 lg:px-8"
          style={{ maxWidth: "min(100vw, 100%)" }}
        >
          <Outlet />
        </div>
      </SidebarInset>
    </div>
  );
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppLayoutInner />
    </SidebarProvider>
  );
}
