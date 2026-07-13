import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  PRESENTATION_BACKGROUND_POLL_MS,
  PRESENTATION_HEARTBEAT_MS,
  PRESENTATION_POLL_MS,
  assertPresentationMediaCommandAcknowledged,
  assertPresentationMediaCommandBound,
  buildPresentationCommand,
  fetchPresentationRehearsalSnapshot,
  getPresentationApiErrorCode,
  getPresentationClientId,
  getPresentationClientName,
  getPresentationConflictSnapshot,
  isPresentationAuthorizationError,
  isPresentationMediaCommandType,
  projectPresentationTiming,
  sendPresentationRehearsalCommand,
  type PresentationCommandPayloads,
  type PresentationCommandType,
  type PresentationLiveSnapshot,
  type PresentationMediaCommandBinding,
  type PresentationNetworkState,
  type PresentationPrivateLiveView,
} from "@/lib/presentationLive";

type UsePresentationRehearsalOptions = {
  serviceId: string | undefined;
  preferredView: PresentationPrivateLiveView;
  churchId: string | null | undefined;
  accountId: string | null | undefined;
  enabled?: boolean;
  maintainController?: boolean;
};

const NO_EXPECTED_REVISION = new Set<PresentationCommandType>([
  "start_session",
  "heartbeat",
  "claim_control",
  "request_control",
]);

function viewCandidates(view: PresentationPrivateLiveView) {
  if (view === "operator") return ["operator", "remote", "stage"] as PresentationPrivateLiveView[];
  if (view === "remote") return ["remote", "stage"] as PresentationPrivateLiveView[];
  return ["stage"] as PresentationPrivateLiveView[];
}

function isConnectivityError(error: unknown) {
  return (typeof navigator !== "undefined" && navigator.onLine === false) || (error instanceof ApiError && error.status === 0);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo actualizar el ensayo.";
}

function pollDelay(failures: number) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return PRESENTATION_BACKGROUND_POLL_MS;
  return Math.max(750, Math.min(PRESENTATION_BACKGROUND_POLL_MS, PRESENTATION_POLL_MS * 2 ** Math.min(failures, 3)));
}

/**
 * Rehearsal deliberately has no package/offline/report/broadcast pipeline.
 * It keeps polling beside the live hook, but every mutation is sent only to
 * the isolated rehearsal endpoint.
 */
export function usePresentationRehearsal({
  serviceId,
  preferredView,
  churchId,
  accountId,
  enabled = true,
  maintainController = true,
}: UsePresentationRehearsalOptions) {
  const [snapshot, setSnapshot] = useState<PresentationLiveSnapshot | null>(null);
  const [activeView, setActiveView] = useState<PresentationPrivateLiveView>(preferredView);
  const [networkState, setNetworkState] = useState<PresentationNetworkState>("online");
  const [loading, setLoading] = useState(enabled);
  const [commandPending, setCommandPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const snapshotRef = useRef<PresentationLiveSnapshot | null>(null);
  const activeViewRef = useRef(preferredView);
  const pendingRef = useRef(false);
  const mutationEpochRef = useRef(0);
  const generationRef = useRef(0);
  const scope = [serviceId || "none", churchId || "none", accountId || "none", preferredView, enabled].join("::");
  const scopeRef = useRef(scope);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    generationRef.current += 1;
  }

  const clientIdRef = useRef<string | null>(null);
  const clientNameRef = useRef<string | null>(null);
  if (clientIdRef.current === null && typeof window !== "undefined") clientIdRef.current = getPresentationClientId();
  if (clientNameRef.current === null && typeof window !== "undefined") clientNameRef.current = `${getPresentationClientName()} · Ensayo`;
  const clientId = clientIdRef.current || "00000000-0000-4000-8000-000000000000";
  const clientName = clientNameRef.current || "Tchurch Live · Ensayo";

  const acceptSnapshot = useCallback((next: PresentationLiveSnapshot | null) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const fetchAllowed = useCallback(async (
    sinceRevision?: number,
    viewerVersion?: string,
    controllerVersion?: string,
  ) => {
    if (!serviceId) return null;
    const candidates = sinceRevision === undefined ? viewCandidates(preferredView) : [activeViewRef.current];
    let lastForbidden: unknown = null;
    for (const view of candidates) {
      try {
        const next = await fetchPresentationRehearsalSnapshot(
          serviceId,
          view,
          clientId,
          sinceRevision,
          viewerVersion,
          controllerVersion,
        );
        if (next?.viewer.view !== "audience") {
          activeViewRef.current = next?.viewer.view || view;
          setActiveView(activeViewRef.current);
        }
        return next;
      } catch (candidateError) {
        if (candidateError instanceof ApiError && candidateError.status === 403 && sinceRevision === undefined) {
          lastForbidden = candidateError;
          continue;
        }
        throw candidateError;
      }
    }
    throw lastForbidden || new ApiError("Ensayo no disponible", 403, { error: "FORBIDDEN" });
  }, [clientId, preferredView, serviceId]);

  const refresh = useCallback(async () => {
    const generation = generationRef.current;
    if (!enabled || !serviceId || pendingRef.current) return snapshotRef.current;
    const pollEpoch = mutationEpochRef.current;
    try {
      const current = snapshotRef.current;
      const next = await fetchAllowed(
        current?.session?.revision,
        current?.viewerVersion,
        current?.controllerVersion,
      );
      if (generation !== generationRef.current || pollEpoch !== mutationEpochRef.current || pendingRef.current) return snapshotRef.current;
      if (next) acceptSnapshot(next);
      setNetworkState("online");
      return next || snapshotRef.current;
    } catch (refreshError) {
      if (generation !== generationRef.current) return snapshotRef.current;
      if (isPresentationAuthorizationError(refreshError)) {
        acceptSnapshot(null);
        setError(refreshError instanceof ApiError && refreshError.status === 401
          ? "Tu sesión expiró. Inicia sesión otra vez para ensayar."
          : "Ya no tienes permiso para abrir este ensayo.");
        return null;
      }
      if (pollEpoch !== mutationEpochRef.current || pendingRef.current) return snapshotRef.current;
      if (isConnectivityError(refreshError)) {
        setNetworkState("offline");
        return snapshotRef.current;
      }
      setNetworkState("reconnecting");
      setNotice(message(refreshError));
      return snapshotRef.current;
    }
  }, [acceptSnapshot, enabled, fetchAllowed, serviceId]);

  useEffect(() => {
    const generation = generationRef.current;
    if (!enabled || !serviceId || !churchId || !accountId) {
      acceptSnapshot(null);
      setError(null);
      setNotice(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    setNetworkState("online");
    activeViewRef.current = preferredView;
    setActiveView(preferredView);
    void fetchAllowed().then((next) => {
      if (!cancelled && generation === generationRef.current) acceptSnapshot(next);
    }).catch((initialError) => {
      if (cancelled || generation !== generationRef.current) return;
      if (isPresentationAuthorizationError(initialError)) {
        setError(initialError instanceof ApiError && initialError.status === 401
          ? "Tu sesión expiró. Inicia sesión otra vez para ensayar."
          : "Ya no tienes permiso para abrir este ensayo.");
      } else if (isConnectivityError(initialError)) {
        setNetworkState("offline");
        setNotice("El ensayo necesita conexión para iniciar. La sesión en vivo no cambió.");
      } else setError(message(initialError));
    }).finally(() => {
      if (!cancelled && generation === generationRef.current) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [acceptSnapshot, accountId, churchId, enabled, fetchAllowed, preferredView, serviceId]);

  useEffect(() => {
    if (!enabled || loading || !serviceId) return undefined;
    let cancelled = false;
    let timeout: number | undefined;
    let failures = 0;
    const poll = async () => {
      const before = networkState;
      await refresh();
      failures = before === "online" ? 0 : Math.min(4, failures + 1);
      if (!cancelled) timeout = window.setTimeout(poll, pollDelay(failures));
    };
    timeout = window.setTimeout(poll, pollDelay(0));
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [enabled, loading, networkState, refresh, serviceId]);

  const sendCommand = useCallback(async <T extends PresentationCommandType>(
    type: T,
    payload: PresentationCommandPayloads[T],
    options?: { commandId?: string; expectedRevision?: number; mediaBinding?: PresentationMediaCommandBinding },
  ) => {
    const generation = generationRef.current;
    if (!serviceId || pendingRef.current) throw new Error("Espera a que termine la acción anterior.");
    const current = snapshotRef.current;
    if (type !== "start_session" && !current?.session) throw new Error("Inicia el ensayo antes de usar este control.");
    if (isPresentationMediaCommandType(type)) {
      assertPresentationMediaCommandBound({
        snapshot: current,
        type,
        payload: payload as PresentationCommandPayloads[typeof type],
        binding: options?.mediaBinding,
      });
    }
    const expectedRevision = isPresentationMediaCommandType(type)
      ? options?.mediaBinding?.expectedRevision
      : NO_EXPECTED_REVISION.has(type) ? undefined : options?.expectedRevision ?? current?.session?.revision;
    const request = buildPresentationCommand(clientId, clientName, type, payload, expectedRevision, options?.commandId);
    pendingRef.current = true;
    mutationEpochRef.current += 1;
    setCommandPending(true);
    setError(null);
    try {
      const next = await sendPresentationRehearsalCommand(serviceId, request, activeViewRef.current);
      if (generation !== generationRef.current) throw new Error("La cuenta activa cambió antes de completar el ensayo.");
      if (isPresentationMediaCommandType(type)) {
        assertPresentationMediaCommandAcknowledged({
          snapshot: next,
          type,
          payload: payload as PresentationCommandPayloads[typeof type],
          binding: options!.mediaBinding!,
        });
      }
      acceptSnapshot(next);
      setNetworkState("online");
      setNotice(null);
      return { snapshot: next, local: false as const };
    } catch (commandError) {
      if (generation !== generationRef.current) throw commandError;
      if (isConnectivityError(commandError)) {
        setNetworkState("offline");
        setNotice("No se envió la acción. El ensayo no usa una cola offline y la salida en vivo no cambió.");
      }
      const conflict = getPresentationConflictSnapshot(commandError, activeViewRef.current, clientId, "rehearsal");
      if (conflict) acceptSnapshot(conflict);
      const code = getPresentationApiErrorCode(commandError);
      if (code === "CONTROL_HELD") setNotice("Otro dispositivo controla este ensayo. Solicita el control para continuar.");
      else if (code === "REVISION_CONFLICT") setNotice("El ensayo avanzó en otro dispositivo. Cargamos su estado oficial.");
      throw commandError;
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false;
        setCommandPending(false);
      }
    }
  }, [acceptSnapshot, clientId, clientName, serviceId]);

  useEffect(() => {
    if (!maintainController || !snapshot?.session?.controller?.ownedByViewer || networkState !== "online") return undefined;
    const timer = window.setInterval(() => {
      if (!pendingRef.current) void sendCommand("heartbeat", {}).catch(() => undefined);
    }, PRESENTATION_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [maintainController, networkState, sendCommand, snapshot?.session?.controller?.ownedByViewer]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const timing = useMemo(() => projectPresentationTiming(snapshot, nowMs), [nowMs, snapshot]);
  const projectedNow = snapshot ? Date.parse(snapshot.serverNow) + Math.max(0, nowMs - snapshot.receivedAtMs) : nowMs;
  const messages = useMemo(
    () => (snapshot?.session?.messages || []).filter((item) => Date.parse(item.expiresAt) > projectedNow),
    [projectedNow, snapshot?.session?.messages],
  );
  // The server renews heartbeats without bumping the session revision, so a
  // 204 poll does not contain a newer lease timestamp. Actual expiry clears
  // the controller and increments revision; trust that authoritative shape.
  const controllerLeaseActive = Boolean(snapshot?.session?.controller);

  return {
    snapshot,
    activeView,
    networkState,
    controllerLeaseActive,
    timing,
    messages,
    loading,
    error,
    notice,
    commandPending,
    clientId,
    clientName,
    sendCommand,
    refresh,
    clearNotice: () => setNotice(null),
  };
}
