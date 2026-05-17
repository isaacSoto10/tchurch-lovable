import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token, type ActionPerformed, type PluginListenerHandle } from "@capacitor/push-notifications";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";

const REGISTERED_TOKEN_KEY = "tchurch_push_token";

function normalizeRoute(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (value.startsWith("/join-") || value.startsWith("/login")) return value;
  return value.startsWith("/app") ? value : `/app${value}`;
}

export function usePushNotifications() {
  const navigate = useNavigate();
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !selectedChurch || initializedRef.current) return;

    let mounted = true;
    const listeners: PluginListenerHandle[] = [];

    async function setupPushNotifications() {
      try {
        const permission = await PushNotifications.requestPermissions();
        if (!mounted || permission.receive !== "granted") return;

        listeners.push(
          await PushNotifications.addListener("registration", async (token: Token) => {
            try {
              const previousToken = localStorage.getItem(REGISTERED_TOKEN_KEY);
              if (previousToken === token.value) return;

              await fetchApi("/device-tokens", {
                method: "POST",
                body: JSON.stringify({
                  token: token.value,
                  platform: Capacitor.getPlatform(),
                  churchId: selectedChurch.id,
                }),
              });
              localStorage.setItem(REGISTERED_TOKEN_KEY, token.value);
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
          await PushNotifications.addListener("pushNotificationActionPerformed", (event: ActionPerformed) => {
            const data = event.notification.data as Record<string, unknown> | undefined;
            const route = normalizeRoute(data?.route);
            if (route) navigate(route);
          })
        );

        await PushNotifications.register();
        initializedRef.current = true;
      } catch (error) {
        console.warn("[Push] Las notificaciones push no pudieron inicializarse:", error);
      }
    }

    setupPushNotifications();

    return () => {
      mounted = false;
      listeners.forEach((listener) => listener.remove());
    };
  }, [fetchApi, navigate, selectedChurch]);
}
