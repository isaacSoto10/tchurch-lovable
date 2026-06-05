import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  read?: boolean;
  createdAt?: string | null;
  data?: {
    route?: string;
    [key: string]: unknown;
  } | null;
};

type NotificationsContextType = {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextType | null>(null);

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications must be used within NotificationsProvider");
  return context;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshNotifications = useCallback(async () => {
    if (!selectedChurch?.id) {
      setNotifications([]);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchApi<AppNotification[]>("/notifications");
      setNotifications(Array.isArray(data) ? data : []);
    } catch (error) {
      console.warn("[Notifications] No se pudieron cargar las notificaciones:", error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [fetchApi, selectedChurch?.id]);

  const markNotificationRead = useCallback(async (id: string) => {
    setNotifications((current) =>
      current.map((notification) => notification.id === id ? { ...notification, read: true } : notification)
    );

    try {
      await fetchApi(`/notifications/${id}/read`, { method: "PUT" });
    } catch (error) {
      console.warn("[Notifications] No se pudo marcar como leída:", error);
      await refreshNotifications();
    }
  }, [fetchApi, refreshNotifications]);

  const markAllRead = useCallback(async () => {
    const unreadIds = notifications.filter((notification) => !notification.read).map((notification) => notification.id);
    if (unreadIds.length === 0) return;

    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    await Promise.allSettled(unreadIds.map((id) => fetchApi(`/notifications/${id}/read`, { method: "PUT" })));
    await refreshNotifications();
  }, [fetchApi, notifications, refreshNotifications]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!selectedChurch?.id) return undefined;
    const interval = window.setInterval(() => {
      void refreshNotifications();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [refreshNotifications, selectedChurch?.id]);

  const value = useMemo<NotificationsContextType>(() => ({
    notifications,
    unreadCount: notifications.filter((notification) => !notification.read).length,
    loading,
    refreshNotifications,
    markNotificationRead,
    markAllRead,
  }), [loading, markAllRead, markNotificationRead, notifications, refreshNotifications]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}
