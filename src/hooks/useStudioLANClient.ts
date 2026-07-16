import { useCallback, useEffect, useState } from "react";
import {
  connectStudioLANBridge,
  connectToStudioLAN,
  disconnectFromStudioLAN,
  forgetStudioLANPairing,
  isStudioLANSupported,
  refreshStudioLANDiscovery,
  type StudioLANChannel,
  type StudioLANStatus,
  type StudioLANUpdate,
} from "@/lib/studioLANClient";

const INITIAL_STATUS: StudioLANStatus = {
  supported: isStudioLANSupported(),
  phase: "idle",
  services: [],
  selectedServiceId: null,
  channel: null,
  paired: false,
  message: isStudioLANSupported() ? null : "Tchurch Studio LAN está disponible en la app de iPhone o iPad.",
};

export function useStudioLANClient() {
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [update, setUpdate] = useState<StudioLANUpdate | null>(null);

  useEffect(() => {
    let active = true;
    let cleanup: (() => Promise<void>) | undefined;
    void connectStudioLANBridge({
      onStatus(next) {
        if (active) setStatus(next);
      },
      onUpdate(next) {
        if (active) setUpdate(next);
      },
    }).then((session) => {
      if (!active) void session.disconnect();
      else cleanup = session.disconnect;
    }).catch(() => {
      if (active) setStatus((current) => ({
        ...current,
        phase: "failed",
        message: "La conexión LAN no está disponible. Desconecta y vuelve a emparejar.",
      }));
    });
    return () => {
      active = false;
      void cleanup?.();
    };
  }, []);

  const connect = useCallback(async (serviceId: string, channel: StudioLANChannel, pairingCode: string) => {
    setUpdate(null);
    await connectToStudioLAN(serviceId, channel, pairingCode);
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectFromStudioLAN();
    setUpdate(null);
  }, []);

  const forget = useCallback(async (serviceId: string) => {
    await forgetStudioLANPairing(serviceId);
    setUpdate(null);
  }, []);

  const refresh = useCallback(async () => {
    await refreshStudioLANDiscovery();
  }, []);

  return { status, update, connect, disconnect, forget, refresh };
}
