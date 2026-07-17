import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectStudioLANBridge,
  connectToStudioLAN,
  disconnectFromStudioLAN,
  forgetStudioLANPairing,
  isStudioLANSupported,
  refreshStudioLANDiscovery,
  type StudioLANChannel,
  type StudioLANImageAssetStatus,
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
  const [imageAsset, setImageAsset] = useState<StudioLANImageAssetStatus | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    let active = true;
    let cleanup: (() => Promise<void>) | undefined;
    void connectStudioLANBridge({
      onStatus(next) {
        if (!active) return;
        connectedRef.current = next.phase === "connected";
        setStatus(next);
        if (next.phase === "failed") {
          setUpdate(null);
          setImageAsset(null);
        }
      },
      onUpdate(next) {
        if (active && connectedRef.current) setUpdate(next);
      },
      onImageAsset(next) {
        if (active && connectedRef.current) setImageAsset(next);
      },
    }).then((session) => {
      if (!active) void session.disconnect();
      else cleanup = session.disconnect;
    }).catch(() => {
      if (active) {
        connectedRef.current = false;
        setUpdate(null);
        setImageAsset(null);
        setStatus((current) => ({
          ...current,
          phase: "failed",
          message: "La conexión LAN no está disponible. Desconecta y vuelve a emparejar.",
        }));
      }
    });
    return () => {
      active = false;
      connectedRef.current = false;
      void cleanup?.();
    };
  }, []);

  const connect = useCallback(async (serviceId: string, channel: StudioLANChannel, pairingCode: string) => {
    connectedRef.current = false;
    setUpdate(null);
    setImageAsset(null);
    await connectToStudioLAN(serviceId, channel, pairingCode);
  }, []);

  const disconnect = useCallback(async () => {
    connectedRef.current = false;
    setUpdate(null);
    setImageAsset(null);
    await disconnectFromStudioLAN();
  }, []);

  const forget = useCallback(async (serviceId: string) => {
    connectedRef.current = false;
    setUpdate(null);
    setImageAsset(null);
    await forgetStudioLANPairing(serviceId);
  }, []);

  const refresh = useCallback(async () => {
    await refreshStudioLANDiscovery();
  }, []);

  return { status, update, imageAsset, connect, disconnect, forget, refresh };
}
