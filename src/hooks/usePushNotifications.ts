import { useEffect, useRef } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications, type Token, type ActionPerformed } from "@capacitor/push-notifications";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useNotifications } from "@/providers/NotificationsProvider";
import { normalizeAppRoute } from "@/lib/navigation";

const REGISTERED_TOKEN_KEY = "tchurch_push_token";

export function usePushNotifications() {
  const navigate = useNavigate();
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const { userId } = useAppAuth();
  const { refreshNotifications } = useNotifications();
  const registrationContextRef = useRef<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !selectedChurch || !userId) return;

    const platform = Capacitor.getPlatform();
    const registrationContext = `${platform}:${selectedChurch.id}:${userId}`;
    if (registrationContextRef.current === registrationContext) return;

    let mounted = true;
    const listeners: PluginListenerHandle[] = [];

    async function setupPushNotifications() {
      try {
        const permission = await PushNotifications.requestPermissions();
        if (!mounted || permission.receive !== "granted") return;

        listeners.push(
          await PushNotifications.addListener("registration", async (token: Token) => {
            try {
              const tokenRegistrationKey = `${registrationContext}:${token.value}`;
              if (localStorage.getItem(REGISTERED_TOKEN_KEY) === tokenRegistrationKey) return;

              await fetchApi("/device-tokens", {
                method: "POST",
                body: JSON.stringify({
                  token: token.value,
                  platform,
                  churchId: selectedChurch.id,
                }),
              });
              localStorage.setItem(REGISTERED_TOKEN_KEY, tokenRegistrationKey);
            } catch (error) {
              console.warn("[Push] No se pudo guardar el token del dispositivo:", error);
            }
          })
        );

        listeners.push(
          await PushNotifications.addListener("registrationError", (error) => {
            console.warn("[Push] No se pudo registrar el dispositivo:", error);
          })
        );

        listeners.push(
          await PushNotifications.addListener("pushNotificationReceived", (notification) => {
            console.info("[Push] Notificación recibida:", notification.title || notification.body || notification.id);
            void refreshNotifications();
          })
        );

        listeners.push(
          await PushNotifications.addListener("pushNotificationActionPerformed", (event: ActionPerformed) => {
            const data = event.notification.data as Record<string, unknown> | undefined;
            const route = normalizeAppRoute(data?.route);
            if (route) navigate(route);
          })
        );

        await PushNotifications.register();
        registrationContextRef.current = registrationContext;
      } catch (error) {
        console.warn("[Push] Las notificaciones push no pudieron inicializarse:", error);
      }
    }

    setupPushNotifications();

    return () => {
      mounted = false;
      listeners.forEach((listener) => listener.remove());
    };
  }, [fetchApi, navigate, refreshNotifications, selectedChurch, userId]);
}
