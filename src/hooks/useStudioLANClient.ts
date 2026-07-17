import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectStudioLANBridge,
  connectToStudioLAN,
  disconnectFromStudioLAN,
  forgetStudioLANPairing,
  isStudioLANSupported,
  refreshStudioLANDiscovery,
  requestStudioLANDeviceReapproval,
  sendStudioLANRemoteCommand,
  type StudioLANChannel,
  type StudioLANDeviceRole,
  type StudioLANImageAssetStatus,
  type StudioLANRemoteAction,
  type StudioLANRemoteFeedback,
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
  enrollmentState: "unenrolled",
  protocolFloor: 1,
  role: null,
  permissions: [],
  permissionRevision: "0",
  revocationGeneration: "0",
  studioId: null,
  remoteControlAvailable: false,
  remoteCommandInFlight: false,
};

export function useStudioLANClient() {
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [update, setUpdate] = useState<StudioLANUpdate | null>(null);
  const [imageAsset, setImageAsset] = useState<StudioLANImageAssetStatus | null>(null);
  const [remoteFeedback, setRemoteFeedback] = useState<StudioLANRemoteFeedback | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    let active = true;
    let cleanup: (() => Promise<void>) | undefined;
    void connectStudioLANBridge({
      onStatus(next) {
        if (!active) return;
        connectedRef.current = next.phase === "connected"
          && (next.enrollmentState === "unenrolled" || next.enrollmentState === "approved");
        setStatus(next);
        if (next.phase === "failed" || next.enrollmentState === "pending" || next.enrollmentState === "revoked") {
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
      onRemoteFeedback(next) {
        if (active) setRemoteFeedback(next);
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

  const connect = useCallback(async (
    serviceId: string,
    channel: StudioLANChannel,
    pairingCode: string,
    requestedRole?: StudioLANDeviceRole,
  ) => {
    connectedRef.current = false;
    setUpdate(null);
    setImageAsset(null);
    setRemoteFeedback(null);
    await connectToStudioLAN(serviceId, channel, pairingCode, requestedRole);
  }, []);

  const disconnect = useCallback(async () => {
    connectedRef.current = false;
    setUpdate(null);
    setImageAsset(null);
    setRemoteFeedback(null);
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

  const sendRemoteCommand = useCallback(async (action: StudioLANRemoteAction) => {
    await sendStudioLANRemoteCommand(action);
  }, []);

  const requestReapproval = useCallback(async () => {
    connectedRef.current = false;
    setUpdate(null);
    setImageAsset(null);
    setRemoteFeedback(null);
    await requestStudioLANDeviceReapproval();
  }, []);

  return {
    status,
    update,
    imageAsset,
    remoteFeedback,
    connect,
    disconnect,
    forget,
    refresh,
    sendRemoteCommand,
    requestReapproval,
  };
}
