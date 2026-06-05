import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, type AppNotification } from "@/providers/NotificationsProvider";

function normalizeRoute(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  return value.startsWith("/app") ? value : `/app${value}`;
}

function formatNotificationTime(value?: string | null) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} d`;
  return new Date(value).toLocaleDateString("es-US", { month: "short", day: "numeric" });
}

function notificationRoute(notification: AppNotification) {
  return normalizeRoute(notification.data?.route);
}

export function NotificationBell() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    loading,
    refreshNotifications,
    markNotificationRead,
    markAllRead,
  } = useNotifications();
  const recentNotifications = notifications.slice(0, 12);

  async function openNotification(notification: AppNotification) {
    if (!notification.read) {
      await markNotificationRead(notification.id);
    }

    const route = notificationRoute(notification);
    if (route) navigate(route);
  }

  return (
    <Popover onOpenChange={(open) => { if (open) void refreshNotifications(); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="relative h-10 w-10 shrink-0 rounded-2xl border-zinc-200 bg-white shadow-sm"
          aria-label={`Notificaciones${unreadCount > 0 ? `: ${unreadCount} sin leer` : ""}`}
        >
          <Bell className="h-4 w-4 text-zinc-700" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] rounded-3xl border-zinc-200 p-0 shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div>
            <p className="text-sm font-black text-zinc-950">Notificaciones</p>
            <p className="text-xs text-zinc-500">
              {unreadCount > 0 ? `${unreadCount} sin leer` : "Todo al día"}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-8 rounded-xl px-2 text-xs" onClick={() => void markAllRead()}>
              <CheckCheck className="h-3.5 w-3.5" />
              Listo
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[24rem]">
          {loading && recentNotifications.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando
            </div>
          ) : recentNotifications.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Bell className="h-5 w-5" />
              </div>
              <p className="text-sm font-bold text-zinc-900">No tienes notificaciones</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Cuando haya asignaciones, anuncios o avisos aparecerán aquí.</p>
            </div>
          ) : (
            <div className="p-2">
              {recentNotifications.map((notification) => {
                const unread = !notification.read;
                const route = notificationRoute(notification);

                return (
                  <button
                    key={notification.id}
                    type="button"
                    className="flex w-full gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-zinc-50"
                    onClick={() => void openNotification(notification)}
                  >
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-zinc-200"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className={`line-clamp-2 text-sm leading-tight ${unread ? "font-black text-zinc-950" : "font-bold text-zinc-700"}`}>
                          {notification.title}
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold text-zinc-400">
                          {formatNotificationTime(notification.createdAt)}
                        </span>
                      </span>
                      {notification.body && (
                        <span className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{notification.body}</span>
                      )}
                      {route && <span className="mt-1 block text-[11px] font-bold text-primary">Abrir</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
