import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectStudioLANBridge,
  connectToStudioLAN,
  disconnectFromStudioLAN,
  forgetStudioLANPairing,
  isStudioLANSupported,
  refreshStudioLANDiscovery,
  requestStudioLANDeviceReapproval,
  sendStudioLANLocalBroadcastLowerThirdCommand,
  sendStudioLANOperatorTimerCommand,
  sendStudioLANRemoteCommand,
  type StudioLANChannel,
  type StudioLANCueCatalogStatus,
  type StudioLANDeviceRole,
  type StudioLANImageAssetStatus,
  type StudioLANLocalBroadcastLowerThirdAction,
  type StudioLANLocalBroadcastLowerThirdFeedback,
  type StudioLANOperatorTimerAction,
  type StudioLANOperatorTimerFeedback,
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
  operatorTimerControlAvailable: false,
  operatorTimerCommandInFlight: false,
  localBroadcastLowerThirdControlAvailable: false,
  localBroadcastLowerThirdCommandInFlight: false,
};

export function useStudioLANClient() {
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [update, setUpdate] = useState<StudioLANUpdate | null>(null);
  const [imageAsset, setImageAsset] = useState<StudioLANImageAssetStatus | null>(null);
  const [remoteFeedback, setRemoteFeedback] = useState<StudioLANRemoteFeedback | null>(null);
  const [operatorTimerFeedback, setOperatorTimerFeedback] = useState<StudioLANOperatorTimerFeedback | null>(null);
  const [localBroadcastLowerThirdFeedback, setLocalBroadcastLowerThirdFeedback] = useState<StudioLANLocalBroadcastLowerThirdFeedback | null>(null);
  const [cueCatalog, setCueCatalog] = useState<StudioLANCueCatalogStatus | null>(null);
  const connectedRef = useRef(false);
  const updateRef = useRef<StudioLANUpdate | null>(null);

  useEffect(() => {
    let active = true;
    let cleanup: (() => Promise<void>) | undefined;
    void connectStudioLANBridge({
      onStatus(next) {
        if (!active) return;
        connectedRef.current = next.phase === "connected"
          && (next.enrollmentState === "unenrolled" || next.enrollmentState === "approved");
        setStatus(next);
        if (next.phase !== "connected" || next.enrollmentState === "pending" || next.enrollmentState === "revoked") {
          updateRef.current = null;
          setUpdate(null);
          setImageAsset(null);
          setCueCatalog(null);
          setRemoteFeedback(null);
          setOperatorTimerFeedback(null);
          setLocalBroadcastLowerThirdFeedback(null);
        }
      },
      onUpdate(next) {
        if (active && connectedRef.current) {
          updateRef.current = next;
          setUpdate(next);
          setCueCatalog((current) => {
            const manifest = next.payloadVersion >= 5 ? next.control?.cueCatalogManifest : null;
            return manifest && current?.catalogId === manifest.catalogId
              && current.routeEpoch === next.control?.routeEpoch ? current : null;
          });
        }
      },
      onImageAsset(next) {
        if (active && connectedRef.current) setImageAsset(next);
      },
      onRemoteFeedback(next) {
        if (active) setRemoteFeedback(next);
      },
      onOperatorTimerFeedback(next) {
        if (active) setOperatorTimerFeedback(next);
      },
      onLocalBroadcastLowerThirdFeedback(next) {
        if (active) setLocalBroadcastLowerThirdFeedback(next);
      },
      onCueCatalog(next) {
        const current = updateRef.current;
        if (!active || !connectedRef.current || (current?.payloadVersion !== 5
          && current?.payloadVersion !== 6 && current?.payloadVersion !== 7)
          || current.control?.cueCatalogManifest?.catalogId !== next.catalogId
          || current.control.routeEpoch !== next.routeEpoch) return;
        setCueCatalog(next);
      },
    }).then((session) => {
      if (!active) void session.disconnect();
      else cleanup = session.disconnect;
    }).catch(() => {
      if (active) {
        connectedRef.current = false;
        updateRef.current = null;
        setUpdate(null);
        setImageAsset(null);
        setCueCatalog(null);
        setRemoteFeedback(null);
        setOperatorTimerFeedback(null);
        setLocalBroadcastLowerThirdFeedback(null);
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
    updateRef.current = null;
    setUpdate(null);
    setImageAsset(null);
    setCueCatalog(null);
    setRemoteFeedback(null);
    setOperatorTimerFeedback(null);
    setLocalBroadcastLowerThirdFeedback(null);
    await connectToStudioLAN(serviceId, channel, pairingCode, requestedRole);
  }, []);

  const disconnect = useCallback(async () => {
    connectedRef.current = false;
    updateRef.current = null;
    setUpdate(null);
    setImageAsset(null);
    setCueCatalog(null);
    setRemoteFeedback(null);
    setOperatorTimerFeedback(null);
    setLocalBroadcastLowerThirdFeedback(null);
    await disconnectFromStudioLAN();
  }, []);

  const forget = useCallback(async (serviceId: string) => {
    connectedRef.current = false;
    updateRef.current = null;
    setUpdate(null);
    setImageAsset(null);
    setCueCatalog(null);
    setRemoteFeedback(null);
    setOperatorTimerFeedback(null);
    setLocalBroadcastLowerThirdFeedback(null);
    await forgetStudioLANPairing(serviceId);
  }, []);

  const refresh = useCallback(async () => {
    await refreshStudioLANDiscovery();
  }, []);

  const sendRemoteCommand = useCallback(async (action: StudioLANRemoteAction) => {
    await sendStudioLANRemoteCommand(action);
  }, []);

  const sendOperatorTimerCommand = useCallback(async (
    action: StudioLANOperatorTimerAction,
  ) => {
    await sendStudioLANOperatorTimerCommand(action);
  }, []);

  const sendLocalBroadcastLowerThirdCommand = useCallback(async (
    action: StudioLANLocalBroadcastLowerThirdAction,
  ) => {
    await sendStudioLANLocalBroadcastLowerThirdCommand(action);
  }, []);

  const requestReapproval = useCallback(async () => {
    connectedRef.current = false;
    updateRef.current = null;
    setUpdate(null);
    setImageAsset(null);
    setCueCatalog(null);
    setRemoteFeedback(null);
    setOperatorTimerFeedback(null);
    setLocalBroadcastLowerThirdFeedback(null);
    await requestStudioLANDeviceReapproval();
  }, []);

  return {
    status,
    update,
    imageAsset,
    remoteFeedback,
    operatorTimerFeedback,
    localBroadcastLowerThirdFeedback,
    cueCatalog,
    connect,
    disconnect,
    forget,
    refresh,
    sendRemoteCommand,
    sendOperatorTimerCommand,
    sendLocalBroadcastLowerThirdCommand,
    requestReapproval,
  };
}
