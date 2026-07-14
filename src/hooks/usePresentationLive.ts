import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { ApiError } from "@/lib/api";
import {
  PRESENTATION_BACKGROUND_POLL_MS,
  PRESENTATION_HEARTBEAT_MS,
  PRESENTATION_POLL_MS,
  activatePresentationCacheIdentity,
  assertPresentationMediaCommandAcknowledged,
  assertPresentationMediaCommandBound,
  buildOfflineReconcileCommand,
  buildPresentationCommand,
  createPresentationOfflineState,
  createPresentationId,
  clearPresentationLiveCache,
  fetchPresentationLiveSnapshot,
  fetchPresentationPackage,
  getPresentationApiErrorCode,
  getPresentationClientId,
  getPresentationClientName,
  getPresentationConflictSnapshot,
  getPresentationViewerRoles,
  isOfflinePresentationCommand,
  isPresentationMediaCommandType,
  isPresentationAuthorizationError,
  loadLatestPresentationPackageForIdentity,
  loadPresentationOfflineState,
  projectPresentationTiming,
  presentationPackageMatchesLiveViewer,
  presentationRoleFingerprint,
  purgePresentationCacheForViewerDowngrade,
  queueOfflinePresentationCommand,
  removePresentationPackage,
  removePresentationOfflineState,
  savePresentationOfflineState,
  savePresentationPackage,
  sendPresentationCommand,
  type CachedPresentationPackage,
  type PresentationCommandPayloads,
  type PresentationCommandType,
  type PresentationLiveSnapshot,
  type PresentationMediaCommandBinding,
  type PresentationNetworkState,
  type PresentationOfflineContext,
  type PresentationOfflineState,
  type PresentationPackage,
  type PresentationPrivateLiveView,
  type PresentationQueuedCommand,
} from "@/lib/presentationLive";

type UsePresentationLiveOptions = {
  serviceId: string | undefined;
  preferredView: PresentationPrivateLiveView;
  churchId: string | null | undefined;
  accountId: string | null | undefined;
  offlineContext: PresentationOfflineContext;
  enabled?: boolean;
  active?: boolean;
  maintainController?: boolean;
};

type CommandResult = {
  snapshot: PresentationLiveSnapshot;
  local: boolean;
  idempotent?: true;
};

type ConfirmedLiveOwner = {
  scope: string;
  sessionId: string;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo actualizar Tchurch Live.";
}

function isConnectivityError(error: unknown) {
  return (typeof navigator !== "undefined" && navigator.onLine === false) || (error instanceof ApiError && error.status === 0);
}

function jitteredPollDelay(failureCount: number) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return PRESENTATION_BACKGROUND_POLL_MS;
  const base = failureCount
    ? Math.min(PRESENTATION_BACKGROUND_POLL_MS, PRESENTATION_POLL_MS * 2 ** Math.min(failureCount, 3))
    : PRESENTATION_POLL_MS;
  return Math.max(750, Math.round(base + (Math.random() - 0.5) * 220));
}

export function usePresentationLive({
  serviceId,
  preferredView,
  churchId,
  accountId,
  offlineContext,
  enabled = true,
  active = true,
  maintainController = true,
}: UsePresentationLiveOptions) {
  const [snapshot, setSnapshotState] = useState<PresentationLiveSnapshot | null>(null);
  const [presentationPackage, setPresentationPackageState] = useState<PresentationPackage | null>(null);
  const [activeView, setActiveViewState] = useState<PresentationPrivateLiveView>(preferredView);
  const [networkState, setNetworkStateState] = useState<PresentationNetworkState>("online");
  const [offlineState, setOfflineStateState] = useState<PresentationOfflineState | null>(null);
  const [loading, setLoading] = useState(enabled && active);
  const [commandPending, setCommandPending] = useState(false);
  const [authoritativeReadyState, setAuthoritativeReadyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const mountedRef = useRef(true);
  const snapshotRef = useRef<PresentationLiveSnapshot | null>(null);
  const cachedPackageRef = useRef<CachedPresentationPackage | null>(null);
  const offlineStateRef = useRef<PresentationOfflineState | null>(null);
  const activeViewRef = useRef<PresentationPrivateLiveView>(preferredView);
  const networkStateRef = useRef<PresentationNetworkState>("online");
  const offlineContextRef = useRef(offlineContext);
  const commandPendingRef = useRef(false);
  const authoritativeReadyRef = useRef(false);
  const authoritativeReadyScopeRef = useRef("");
  const nativeAppActiveRef = useRef(true);
  const lifecycleRefreshRef = useRef<Promise<PresentationLiveSnapshot | null> | null>(null);
  const lifecycleEventGenerationRef = useRef(0);
  const lastConfirmedOwnerRef = useRef<ConfirmedLiveOwner | null>(null);
  const mutationEpochRef = useRef(0);
  const clientIdRef = useRef<string | null>(null);
  const clientNameRef = useRef<string | null>(null);
  const authorityGenerationRef = useRef(0);
  const authorityScopeRef = useRef("");
  const authorityIdentityRef = useRef("");
  const activeRef = useRef(active);

  const authorityIdentity = [accountId || "signed-out", churchId || "no-church", serviceId || "no-service", preferredView, enabled ? "enabled" : "disabled"].join("::");
  const authorityScope = [authorityIdentity, active ? "live-active" : "live-inactive"].join("::");
  activeRef.current = active;
  authorityIdentityRef.current = authorityIdentity;
  if (authorityScopeRef.current !== authorityScope) {
    authorityScopeRef.current = authorityScope;
    authorityGenerationRef.current += 1;
    authoritativeReadyRef.current = false;
    authoritativeReadyScopeRef.current = "";
    lifecycleRefreshRef.current = null;
    lastConfirmedOwnerRef.current = null;
    lifecycleEventGenerationRef.current += 1;
  }

  offlineContextRef.current = presentationPackage
    ? { ...offlineContext, plannedTiming: presentationPackage.plannedTiming }
    : offlineContext;

  if (clientIdRef.current === null && typeof window !== "undefined") clientIdRef.current = getPresentationClientId();
  if (clientNameRef.current === null && typeof window !== "undefined") clientNameRef.current = getPresentationClientName();

  const clientId = clientIdRef.current || "00000000-0000-4000-8000-000000000000";
  const clientName = clientNameRef.current || "Tchurch Live";

  const setAuthoritativeReady = useCallback((ready: boolean, scope = authorityScopeRef.current) => {
    const nextReady = ready && scope === authorityScopeRef.current;
    authoritativeReadyRef.current = nextReady;
    authoritativeReadyScopeRef.current = nextReady ? scope : "";
    if (mountedRef.current) setAuthoritativeReadyState(nextReady);
  }, []);

  const liveOwnerScope = useCallback((next: PresentationLiveSnapshot) => {
    const session = next.session;
    if (
      !session
      || session.mode !== "live"
      || session.status !== "live"
      || next.serviceId !== serviceId
    ) return null;
    return [accountId || "signed-out", churchId || "no-church", serviceId || "no-service", session.id, session.mode, clientId].join("::");
  }, [accountId, churchId, clientId, serviceId]);

  const recordAuthoritativeOwnership = useCallback((next: PresentationLiveSnapshot | null) => {
    if (!next) {
      lastConfirmedOwnerRef.current = null;
      return;
    }
    const session = next.session;
    const scope = liveOwnerScope(next);
    if (!session || !scope) {
      lastConfirmedOwnerRef.current = null;
      return;
    }
    const previous = lastConfirmedOwnerRef.current;
    if (previous && previous.scope !== scope) lastConfirmedOwnerRef.current = null;
    const controller = session.controller;
    if (controller?.ownedByViewer && controller.clientId === clientId) {
      lastConfirmedOwnerRef.current = { scope, sessionId: session.id };
    } else if (controller) {
      // Another exact controller is authoritative. This client must never use a
      // stale ownership observation to reclaim from it.
      lastConfirmedOwnerRef.current = null;
    }
  }, [clientId, liveOwnerScope]);

  const setSnapshot = useCallback((next: PresentationLiveSnapshot | null, authoritative = false) => {
    const cached = cachedPackageRef.current;
    if (
      next
      && cached
      && (
        !accountId
        || !churchId
        || !serviceId
        || !presentationPackageMatchesLiveViewer(cached.package, next.viewer, { accountId, churchId, serviceId })
      )
    ) {
      cachedPackageRef.current = null;
      if (mountedRef.current) setPresentationPackageState(null);
    }
    if (authoritative) recordAuthoritativeOwnership(next);
    snapshotRef.current = next;
    if (mountedRef.current) setSnapshotState(next);
  }, [accountId, churchId, recordAuthoritativeOwnership, serviceId]);

  const setActiveView = useCallback((next: PresentationPrivateLiveView) => {
    activeViewRef.current = next;
    if (mountedRef.current) setActiveViewState(next);
  }, []);

  const setNetworkState = useCallback((next: PresentationNetworkState) => {
    networkStateRef.current = next;
    if (mountedRef.current) setNetworkStateState(next);
  }, []);

  const setOfflineState = useCallback((next: PresentationOfflineState | null) => {
    offlineStateRef.current = next;
    if (mountedRef.current) setOfflineStateState(next);
  }, []);

  const revokePrivateAuthority = useCallback(async (authorityError: unknown, expectedGeneration?: number) => {
    if (expectedGeneration !== undefined && expectedGeneration !== authorityGenerationRef.current) return;
    mutationEpochRef.current += 1;
    authorityGenerationRef.current += 1;
    const revocationGeneration = authorityGenerationRef.current;
    cachedPackageRef.current = null;
    setPresentationPackageState(null);
    setOfflineState(null);
    setSnapshot(null, true);
    setAuthoritativeReady(false);
    setNetworkState("online");
    await clearPresentationLiveCache();
    if (revocationGeneration !== authorityGenerationRef.current) return;
    if (mountedRef.current) {
      setNotice(null);
      setError(authorityError instanceof ApiError && authorityError.status === 401
        ? "Tu sesión expiró. Inicia sesión otra vez para abrir Tchurch Live."
        : "Ya no tienes permiso para ver esta presentación.");
    }
  }, [setAuthoritativeReady, setNetworkState, setOfflineState, setSnapshot]);

  const cacheAuthoritativeSnapshot = useCallback(async (
    nextSnapshot: PresentationLiveSnapshot,
    cached = cachedPackageRef.current,
    expectedGeneration = authorityGenerationRef.current,
  ) => {
    if (!activeRef.current || expectedGeneration !== authorityGenerationRef.current) return;
    if (
      !cached
      || !nextSnapshot.session
      || offlineStateRef.current?.commands.length
      || !accountId
      || !churchId
      || !serviceId
      || !presentationPackageMatchesLiveViewer(cached.package, nextSnapshot.viewer, { accountId, churchId, serviceId })
    ) return;
    const controller = nextSnapshot.session.controller;
    if (!controller?.ownedByViewer || controller.clientId !== clientId) {
      await removePresentationOfflineState(cached.key);
      if (expectedGeneration === authorityGenerationRef.current) setOfflineState(null);
      return;
    }
    const base = createPresentationOfflineState(cached, nextSnapshot, clientId);
    await savePresentationOfflineState(base, clientId);
    if (expectedGeneration !== authorityGenerationRef.current) {
      if (authorityIdentityRef.current !== authorityIdentity) await removePresentationOfflineState(base.key);
      return;
    }
    setOfflineState(base);
  }, [accountId, authorityIdentity, churchId, clientId, serviceId, setOfflineState]);

  const fetchAllowedSnapshot = useCallback(async (
    sinceRevision?: number,
    viewerVersion?: string,
    controllerVersion?: string,
  ) => {
    const generation = authorityGenerationRef.current;
    if (!activeRef.current) throw new Error("La sesión en vivo está inactiva mientras usas Ensayo.");
    if (!serviceId) throw new Error("Falta el servicio de Tchurch Live.");
    let lastForbidden: unknown = null;
    const candidates = sinceRevision === undefined ? viewCandidates(preferredView) : [activeViewRef.current];
    for (const view of candidates) {
      try {
        const next = await fetchPresentationLiveSnapshot(
          serviceId,
          view,
          clientId,
          sinceRevision,
          viewerVersion,
          controllerVersion,
        );
        if (!activeRef.current || generation !== authorityGenerationRef.current) return null;
        if (next) setActiveView(next.viewer.view === "audience" ? view : next.viewer.view);
        return next;
      } catch (candidateError) {
        if (!activeRef.current || generation !== authorityGenerationRef.current) return null;
        if (candidateError instanceof ApiError && candidateError.status === 403 && sinceRevision === undefined) {
          lastForbidden = candidateError;
          continue;
        }
        throw candidateError;
      }
    }
    throw lastForbidden || new ApiError("Presentación no disponible", 403, { error: "FORBIDDEN" });
  }, [clientId, preferredView, serviceId, setActiveView]);

  const downloadPackage = useCallback(async (nextSnapshot: PresentationLiveSnapshot) => {
    const generation = authorityGenerationRef.current;
    if (!activeRef.current || !serviceId || !churchId || !accountId || nextSnapshot.viewer.view === "audience") return null;
    const view = nextSnapshot.viewer.view;
    const roles = getPresentationViewerRoles(nextSnapshot.viewer);
    const nextPackage = await fetchPresentationPackage(serviceId, view);
    if (!activeRef.current || generation !== authorityGenerationRef.current) return null;
    if (
      nextPackage.scope.accountId !== accountId ||
      nextPackage.scope.churchId !== churchId ||
      nextPackage.scope.view !== view ||
      nextPackage.scope.roleFingerprint !== presentationRoleFingerprint(roles) ||
      nextPackage.service.id !== serviceId
    ) {
      throw new Error("El paquete privado no corresponde a esta cuenta, iglesia o vista.");
    }
    if (snapshotRef.current?.viewerVersion !== nextSnapshot.viewerVersion) return null;
    if (!nextSnapshot.viewer.canEdit && (view === "remote" || view === "stage")) {
      cachedPackageRef.current = null;
      await purgePresentationCacheForViewerDowngrade({ accountId, churchId, serviceId, view, roles });
      if (generation !== authorityGenerationRef.current) return null;
    }
    try {
      const cached = await savePresentationPackage({ accountId, churchId, serviceId, view, roles }, nextPackage);
      if (generation !== authorityGenerationRef.current) {
        if (authorityIdentityRef.current !== authorityIdentity) await removePresentationPackage(cached.key);
        return null;
      }
      if (mountedRef.current) setPresentationPackageState(nextPackage);
      cachedPackageRef.current = cached;
      return cached;
    } catch (cacheError) {
      if (generation !== authorityGenerationRef.current) return null;
      if (cacheError instanceof Error && cacheError.message.includes("WebCrypto")) {
        if (mountedRef.current) setPresentationPackageState(nextPackage);
        if (mountedRef.current) setNotice("Este dispositivo no ofrece almacenamiento criptográficamente verificable; el paquete privado no se guardó offline.");
        return null;
      }
      throw cacheError;
    }
  }, [accountId, authorityIdentity, churchId, serviceId]);

  const restoreOfflinePackage = useCallback(async () => {
    const generation = authorityGenerationRef.current;
    if (!activeRef.current || !serviceId || !churchId || !accountId) return false;
    const trustedViewer = snapshotRef.current?.viewer;
    const expectedRoleFingerprint = trustedViewer && trustedViewer.view !== "audience"
      ? presentationRoleFingerprint(trustedViewer.roles)
      : undefined;
    const cached = await loadLatestPresentationPackageForIdentity(
      accountId,
      churchId,
      serviceId,
      viewCandidates(preferredView),
      expectedRoleFingerprint,
    );
    if (!activeRef.current || generation !== authorityGenerationRef.current) return false;
    if (!cached) return false;
    const savedOffline = await loadPresentationOfflineState(cached.key, clientId);
    if (!activeRef.current || generation !== authorityGenerationRef.current) return false;
    cachedPackageRef.current = cached;
    if (mountedRef.current) setPresentationPackageState(cached.package);
    setActiveView(cached.view);
    if (savedOffline && savedOffline.packageId === cached.package.packageId) {
      setOfflineState(savedOffline);
      setSnapshot(savedOffline.localSnapshot);
    }
    setNetworkState("offline");
    if (mountedRef.current) setNotice(savedOffline
      ? "Modo local activo. Los cambios quedan en este dispositivo hasta reconectar."
      : "Paquete offline disponible en modo lectura; no hay control local guardado.");
    return true;
  }, [accountId, churchId, clientId, preferredView, serviceId, setActiveView, setNetworkState, setOfflineState, setSnapshot]);

  const reconcileOffline = useCallback(async () => {
    const generation = authorityGenerationRef.current;
    const pending = offlineStateRef.current;
    if (!activeRef.current || !serviceId || !pending?.commands.length || commandPendingRef.current) return null;
    commandPendingRef.current = true;
    mutationEpochRef.current += 1;
    setCommandPending(true);
    setNetworkState("reconnecting");
    try {
      const request = buildOfflineReconcileCommand(pending, clientId, clientName);
      const next = await sendPresentationCommand(serviceId, request, activeViewRef.current);
      if (generation !== authorityGenerationRef.current) return null;
      await removePresentationOfflineState(pending.key);
      if (generation !== authorityGenerationRef.current) return null;
      setOfflineState(null);
      setSnapshot(next, true);
      setNetworkState("online");
      setNotice("Cambios locales sincronizados con la sesión en vivo.");
      await cacheAuthoritativeSnapshot(next, undefined, generation);
      return next;
    } catch (reconcileError) {
      if (generation !== authorityGenerationRef.current) return null;
      if (isPresentationAuthorizationError(reconcileError)) {
        await revokePrivateAuthority(reconcileError, generation);
        return null;
      }
      const code = getPresentationApiErrorCode(reconcileError);
      const current = getPresentationConflictSnapshot(reconcileError, activeViewRef.current, clientId, "live");
      if (code === "OFFLINE_DIVERGED" || code === "REVISION_CONFLICT") {
        if (current) setSnapshot(current, true);
        setNetworkState("diverged");
        setNotice("La sesión cambió en otro dispositivo. Conservamos tus acciones locales para revisión; el servidor sigue siendo la fuente oficial.");
        return current;
      }
      if (isConnectivityError(reconcileError)) {
        setNetworkState("offline");
        return null;
      }
      setNetworkState("offline");
      setError(errorMessage(reconcileError));
      return null;
    } finally {
      if (generation === authorityGenerationRef.current) {
        commandPendingRef.current = false;
        if (mountedRef.current) setCommandPending(false);
      }
    }
  }, [cacheAuthoritativeSnapshot, clientId, clientName, revokePrivateAuthority, serviceId, setNetworkState, setOfflineState, setSnapshot]);

  const refresh = useCallback(async (allowReconcile = true) => {
    const generation = authorityGenerationRef.current;
    if (!enabled || !activeRef.current || !serviceId) return null;
    if (commandPendingRef.current) return snapshotRef.current;
    if (networkStateRef.current === "diverged") return snapshotRef.current;
    if (allowReconcile && offlineStateRef.current?.commands.length) return reconcileOffline();
    const pollEpoch = mutationEpochRef.current;
    const currentRevision = snapshotRef.current?.session?.revision;
    const currentViewerVersion = snapshotRef.current?.viewerVersion;
    const currentControllerVersion = snapshotRef.current?.controllerVersion;
    try {
      const next = await fetchAllowedSnapshot(currentRevision, currentViewerVersion, currentControllerVersion);
      if (generation !== authorityGenerationRef.current || pollEpoch !== mutationEpochRef.current || commandPendingRef.current) return snapshotRef.current;
      if (next) {
        setSnapshot(next, true);
        setNetworkState("online");
        await cacheAuthoritativeSnapshot(next, undefined, generation);
      } else {
        setNetworkState("online");
      }
      return next || snapshotRef.current;
    } catch (refreshError) {
      if (generation !== authorityGenerationRef.current) return snapshotRef.current;
      if (isPresentationAuthorizationError(refreshError)) {
        await revokePrivateAuthority(refreshError, generation);
        return null;
      }
      if (pollEpoch !== mutationEpochRef.current || commandPendingRef.current) return snapshotRef.current;
      if (isConnectivityError(refreshError)) {
        const cached = cachedPackageRef.current;
        if (cached && snapshotRef.current?.session) {
          const currentSnapshot = snapshotRef.current;
          const controller = currentSnapshot.session.controller;
          const localBase = offlineStateRef.current || (
            controller?.ownedByViewer && controller.clientId === clientId
              ? createPresentationOfflineState(cached, currentSnapshot, clientId)
              : null
          );
          if (localBase) {
            await savePresentationOfflineState(localBase, clientId);
            if (generation !== authorityGenerationRef.current) {
              if (authorityIdentityRef.current !== authorityIdentity) await removePresentationOfflineState(localBase.key);
              return snapshotRef.current;
            }
            setOfflineState(localBase);
            setSnapshot(localBase.localSnapshot);
          }
        }
        setNetworkState("offline");
        return snapshotRef.current;
      }
      throw refreshError;
    }
  }, [authorityIdentity, cacheAuthoritativeSnapshot, clientId, enabled, fetchAllowedSnapshot, reconcileOffline, revokePrivateAuthority, serviceId, setNetworkState, setOfflineState, setSnapshot]);

  const refreshAfterForeground = useCallback(() => {
    if (!enabled || !activeRef.current || !serviceId || !accountId || !churchId) {
      setAuthoritativeReady(false);
      return Promise.resolve(null);
    }
    if (lifecycleRefreshRef.current) return lifecycleRefreshRef.current;

    const expectedScope = authorityScopeRef.current;
    const eventGeneration = ++lifecycleEventGenerationRef.current;
    const generation = ++authorityGenerationRef.current;
    const reclaimCandidate = lastConfirmedOwnerRef.current;
    mutationEpochRef.current += 1;
    commandPendingRef.current = false;
    if (mountedRef.current) setCommandPending(false);
    setAuthoritativeReady(false);
    setNetworkState("reconnecting");

    const operation = (async (): Promise<PresentationLiveSnapshot | null> => {
      let authoritative: PresentationLiveSnapshot | null = null;
      let claimWasAmbiguous = false;
      try {
        // A lifecycle refresh intentionally omits all validators. A cached 204
        // cannot prove that a 30-second controller lease survived suspension.
        const next = await fetchAllowedSnapshot();
        if (
          !next
          || generation !== authorityGenerationRef.current
          || eventGeneration !== lifecycleEventGenerationRef.current
          || expectedScope !== authorityScopeRef.current
          || !activeRef.current
        ) return null;
        authoritative = next;
        setSnapshot(next, true);
        setNetworkState("online");

        const session = next.session;
        const refreshedOwnerScope = liveOwnerScope(next);
        const eligiblePreviousOwner = Boolean(
          reclaimCandidate
          && refreshedOwnerScope
          && reclaimCandidate.scope === refreshedOwnerScope
          && reclaimCandidate.sessionId === session?.id,
        );

        if (eligiblePreviousOwner && !session?.controller) {
          // Consume before transport. Ambiguous failures, duplicate lifecycle
          // events, or a response without ownership must never retry blindly.
          lastConfirmedOwnerRef.current = null;
          if (session.mode === "live" && session.status === "live" && next.viewer.canControl) {
            const request = buildPresentationCommand(clientId, clientName, "claim_control", {});
            try {
              const claimed = await sendPresentationCommand(serviceId, request, activeViewRef.current);
              if (
                generation !== authorityGenerationRef.current
                || eventGeneration !== lifecycleEventGenerationRef.current
                || expectedScope !== authorityScopeRef.current
              ) return null;
              authoritative = claimed;
              setSnapshot(claimed, true);
              setNetworkState("online");
            } catch (claimError) {
              if (
                generation !== authorityGenerationRef.current
                || eventGeneration !== lifecycleEventGenerationRef.current
                || expectedScope !== authorityScopeRef.current
              ) return null;
              if (isPresentationAuthorizationError(claimError)) {
                await revokePrivateAuthority(claimError, generation);
                return null;
              }
              const conflict = getPresentationConflictSnapshot(claimError, activeViewRef.current, clientId, "live");
              if (conflict) {
                authoritative = conflict;
                setSnapshot(conflict, true);
                setNetworkState("online");
              } else if (isConnectivityError(claimError)) {
                claimWasAmbiguous = true;
                setNetworkState("offline");
              } else {
                claimWasAmbiguous = true;
                if (mountedRef.current) setNotice("No se pudo confirmar nuevamente el control. Actualiza antes de operar.");
              }
            }
          }
        }

        if (claimWasAmbiguous) return null;
        if (offlineStateRef.current?.commands.length) {
          const reconciled = await reconcileOffline();
          if (
            generation !== authorityGenerationRef.current
            || eventGeneration !== lifecycleEventGenerationRef.current
            || expectedScope !== authorityScopeRef.current
            || offlineStateRef.current?.commands.length
            || networkStateRef.current !== "online"
          ) return null;
          authoritative = reconciled || authoritative;
        }
        if (authoritative) await cacheAuthoritativeSnapshot(authoritative, undefined, generation);
        if (
          generation === authorityGenerationRef.current
          && eventGeneration === lifecycleEventGenerationRef.current
          && expectedScope === authorityScopeRef.current
          && activeRef.current
          && nativeAppActiveRef.current
          && (typeof document === "undefined" || document.visibilityState !== "hidden")
          && networkStateRef.current === "online"
        ) setAuthoritativeReady(true, expectedScope);
        return authoritative;
      } catch (lifecycleError) {
        if (
          generation !== authorityGenerationRef.current
          || eventGeneration !== lifecycleEventGenerationRef.current
          || expectedScope !== authorityScopeRef.current
        ) return null;
        if (isPresentationAuthorizationError(lifecycleError)) {
          await revokePrivateAuthority(lifecycleError, generation);
        } else if (isConnectivityError(lifecycleError)) {
          setNetworkState("offline");
        } else if (mountedRef.current) {
          setError(errorMessage(lifecycleError));
        }
        return null;
      } finally {
        if (lifecycleRefreshRef.current === operation) lifecycleRefreshRef.current = null;
      }
    })();

    lifecycleRefreshRef.current = operation;
    return operation;
  }, [accountId, cacheAuthoritativeSnapshot, churchId, clientId, clientName, enabled, fetchAllowedSnapshot, liveOwnerScope, reconcileOffline, revokePrivateAuthority, serviceId, setAuthoritativeReady, setNetworkState, setSnapshot]);

  useEffect(() => {
    if (!enabled || !accountId || !churchId) return;
    // Cache identity is authorization state, not run-mode state. Keeping this
    // active while Live is paused preserves same-scope drafts, while a real
    // account/church transition still purges the previous private cache.
    void activatePresentationCacheIdentity(accountId, churchId);
  }, [accountId, churchId, enabled]);

  useEffect(() => {
    const generation = authorityGenerationRef.current;
    mountedRef.current = true;
    if (!enabled || !serviceId || !churchId || !accountId) {
      setAuthoritativeReady(false);
      cachedPackageRef.current = null;
      commandPendingRef.current = false;
      setPresentationPackageState(null);
      setSnapshot(null);
      setOfflineState(null);
      setCommandPending(false);
      setError(null);
      setNotice(null);
      setNetworkState("online");
      setLoading(false);
      void clearPresentationLiveCache();
      return () => { mountedRef.current = false; };
    }
    if (!active) {
      mutationEpochRef.current += 1;
      setAuthoritativeReady(false);
      cachedPackageRef.current = null;
      commandPendingRef.current = false;
      setPresentationPackageState(null);
      setSnapshot(null);
      setOfflineState(null);
      setCommandPending(false);
      setError(null);
      setNotice(null);
      setNetworkState("online");
      setLoading(false);
      return () => { mountedRef.current = false; };
    }
    let cancelled = false;
    setAuthoritativeReady(false);
    setLoading(true);
    setError(null);
    setNotice(null);
    setSnapshot(null);
    setOfflineState(null);
    setNetworkState("online");
    setActiveView(preferredView);
    commandPendingRef.current = false;
    setCommandPending(false);
    cachedPackageRef.current = null;
    setPresentationPackageState(null);

    void (async () => {
      try {
        await activatePresentationCacheIdentity(accountId, churchId);
        if (cancelled || generation !== authorityGenerationRef.current) return;
        const initial = await fetchAllowedSnapshot();
        if (cancelled || generation !== authorityGenerationRef.current || !initial) return;
        setSnapshot(initial, true);
        setNetworkState("online");
        try {
          const cached = await downloadPackage(initial);
          if (cancelled || generation !== authorityGenerationRef.current) return;
          if (cached) {
            const pending = await loadPresentationOfflineState(cached.key, clientId);
            if (cancelled || generation !== authorityGenerationRef.current) return;
            if (pending?.commands.length) {
              setOfflineState(pending);
              await reconcileOffline();
            } else {
              await cacheAuthoritativeSnapshot(initial, cached, generation);
            }
          }
        } catch (packageError) {
          if (cancelled || generation !== authorityGenerationRef.current) return;
          if (isPresentationAuthorizationError(packageError)) await revokePrivateAuthority(packageError, generation);
          else if (isConnectivityError(packageError)) await restoreOfflinePackage();
          else if (mountedRef.current) setNotice(errorMessage(packageError));
        }
        if (
          !cancelled
          && generation === authorityGenerationRef.current
          && activeRef.current
          && nativeAppActiveRef.current
          && (typeof document === "undefined" || document.visibilityState !== "hidden")
          && networkStateRef.current === "online"
        ) setAuthoritativeReady(true, authorityScopeRef.current);
      } catch (initialError) {
        if (cancelled || generation !== authorityGenerationRef.current) return;
        if (isPresentationAuthorizationError(initialError)) {
          await revokePrivateAuthority(initialError, generation);
          return;
        }
        if (isConnectivityError(initialError)) {
          const restored = await restoreOfflinePackage();
          if (cancelled || generation !== authorityGenerationRef.current) return;
          if (restored) return;
        }
        setError(errorMessage(initialError));
      } finally {
        if (!cancelled && generation === authorityGenerationRef.current && mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [accountId, active, cacheAuthoritativeSnapshot, churchId, clientId, downloadPackage, enabled, fetchAllowedSnapshot, preferredView, reconcileOffline, restoreOfflinePackage, revokePrivateAuthority, serviceId, setActiveView, setAuthoritativeReady, setNetworkState, setOfflineState, setSnapshot]);

  useEffect(() => {
    const current = snapshot;
    if (
      !enabled
      || !active
      || loading
      || networkState !== "online"
      || !serviceId
      || !accountId
      || !churchId
      || !current
      || current.viewer.view === "audience"
    ) return undefined;
    const packageMatches = presentationPackageMatchesLiveViewer(presentationPackage, current.viewer, {
      accountId,
      churchId,
      serviceId,
    });
    if (packageMatches) return undefined;
    const generation = authorityGenerationRef.current;
    let cancelled = false;
    void downloadPackage(current).then(() => {
      if (!cancelled && generation === authorityGenerationRef.current && mountedRef.current) setError(null);
    }).catch(async (packageError) => {
      if (cancelled || generation !== authorityGenerationRef.current) return;
      if (isPresentationAuthorizationError(packageError)) {
        await revokePrivateAuthority(packageError, generation);
        return;
      }
      if (mountedRef.current) setError("No se pudo actualizar el acceso privado de esta presentación.");
    });
    return () => { cancelled = true; };
  }, [accountId, active, churchId, downloadPackage, enabled, loading, networkState, presentationPackage, revokePrivateAuthority, serviceId, snapshot]);

  useEffect(() => {
    if (!enabled || !active || loading || !authoritativeReadyState || !serviceId) return undefined;
    let cancelled = false;
    let timeout: number | undefined;
    let failureCount = 0;

    async function poll() {
      try {
        await refresh();
        failureCount = networkStateRef.current === "offline" ? Math.min(failureCount + 1, 4) : 0;
      } catch {
        failureCount = Math.min(failureCount + 1, 4);
      }
      if (!cancelled) timeout = window.setTimeout(poll, jitteredPollDelay(failureCount));
    }

    timeout = window.setTimeout(poll, jitteredPollDelay(0));
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [active, authoritativeReadyState, enabled, loading, refresh, serviceId]);

  useEffect(() => {
    if (!enabled || !active || loading || !serviceId || !accountId || !churchId) return undefined;
    let disposed = false;
    let nativeListener: { remove: () => Promise<void> } | null = null;

    const suspendTransport = (offline = false) => {
      if (disposed) return;
      lifecycleEventGenerationRef.current += 1;
      authorityGenerationRef.current += 1;
      mutationEpochRef.current += 1;
      lifecycleRefreshRef.current = null;
      commandPendingRef.current = false;
      if (mountedRef.current) setCommandPending(false);
      setAuthoritativeReady(false);
      if (offline) setNetworkState("offline");
    };
    const resumeTransport = () => {
      if (
        disposed
        || !nativeAppActiveRef.current
        || (typeof document !== "undefined" && document.visibilityState === "hidden")
      ) return;
      void refreshAfterForeground().catch(() => undefined);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") suspendTransport();
      else resumeTransport();
    };
    const handlePageShow = () => resumeTransport();
    const handleOnline = () => resumeTransport();
    const handleOffline = () => suspendTransport(true);

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      nativeAppActiveRef.current = isActive;
      if (isActive) resumeTransport();
      else suspendTransport();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else nativeListener = handle;
    }).catch(() => undefined);
    void CapacitorApp.getState().then(({ isActive }) => {
      if (disposed) return;
      nativeAppActiveRef.current = isActive;
      if (!isActive) suspendTransport();
    }).catch(() => undefined);
    if (document.visibilityState === "hidden") suspendTransport();

    return () => {
      disposed = true;
      lifecycleEventGenerationRef.current += 1;
      setAuthoritativeReady(false);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (nativeListener) void nativeListener.remove();
    };
  }, [accountId, active, churchId, enabled, loading, refreshAfterForeground, serviceId, setAuthoritativeReady, setNetworkState]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);

  const sendCommand = useCallback(async <T extends PresentationCommandType>(
    type: T,
    payload: PresentationCommandPayloads[T],
    options?: {
      commandId?: string;
      expectedRevision?: number;
      allowOffline?: boolean;
      mediaBinding?: PresentationMediaCommandBinding;
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ): Promise<CommandResult> => {
    const generation = authorityGenerationRef.current;
    if (!activeRef.current) throw new Error("La sesión en vivo está inactiva mientras usas Ensayo.");
    if (!authoritativeReadyRef.current || authoritativeReadyScopeRef.current !== authorityScopeRef.current) {
      throw new Error("Tchurch Live está confirmando el estado oficial antes de habilitar controles.");
    }
    if (!serviceId || commandPendingRef.current) throw new Error("Espera a que termine la acción anterior.");
    if (networkStateRef.current === "diverged") {
      throw new Error("Resuelve primero el conflicto entre la copia local y la sesión oficial.");
    }
    const current = snapshotRef.current;
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
    if (type !== "start_session" && !current?.session) throw new Error("Inicia la sesión antes de usar este control.");
    const request = buildPresentationCommand(clientId, clientName, type, payload, expectedRevision, options?.commandId);
    commandPendingRef.current = true;
    mutationEpochRef.current += 1;
    setCommandPending(true);
    setError(null);

    try {
      if (networkStateRef.current === "offline") throw new ApiError("Offline", 0, { error: "OFFLINE" });
      const next = options?.signal || options?.timeoutMs !== undefined
        ? await sendPresentationCommand(serviceId, request, activeViewRef.current, {
          signal: options.signal,
          timeoutMs: options.timeoutMs,
        })
        : await sendPresentationCommand(serviceId, request, activeViewRef.current);
      if (generation !== authorityGenerationRef.current) throw new Error("La cuenta activa cambió antes de completar la acción.");
      if (isPresentationMediaCommandType(type)) {
        assertPresentationMediaCommandAcknowledged({
          snapshot: next,
          type,
          payload: payload as PresentationCommandPayloads[typeof type],
          binding: options!.mediaBinding!,
        });
      }
      setSnapshot(next, true);
      setNetworkState("online");
      setNotice(null);
      await cacheAuthoritativeSnapshot(next, undefined, generation);
      return {
        snapshot: next,
        local: false,
        ...(next.idempotent === true ? { idempotent: true as const } : {}),
      };
    } catch (commandError) {
      if (generation !== authorityGenerationRef.current) throw commandError;
      if (isPresentationAuthorizationError(commandError)) {
        await revokePrivateAuthority(commandError, generation);
        throw commandError;
      }
      if (isConnectivityError(commandError) && isOfflinePresentationCommand(type) && options?.allowOffline !== false) {
        const cached = cachedPackageRef.current;
        const base = offlineStateRef.current || (cached && current?.session ? createPresentationOfflineState(cached, current, clientId) : null);
        if (!base) throw new Error("No hay un paquete seguro para continuar offline.");
        const queued = {
          commandId: request.commandId,
          type,
          payload,
        } as PresentationQueuedCommand<typeof type>;
        const nextOffline = queueOfflinePresentationCommand(base, queued, offlineContextRef.current, clientId);
        await savePresentationOfflineState(nextOffline, clientId);
        if (generation !== authorityGenerationRef.current) {
          if (authorityIdentityRef.current !== authorityIdentity) await removePresentationOfflineState(nextOffline.key);
          throw new Error("El modo o la cuenta activa cambió antes de guardar la acción local.");
        }
        setOfflineState(nextOffline);
        setSnapshot(nextOffline.localSnapshot);
        setNetworkState("offline");
        setNotice("Cambio local pendiente. Todavía no está sincronizado con la nube.");
        return { snapshot: nextOffline.localSnapshot, local: true };
      }

      const code = getPresentationApiErrorCode(commandError);
      const conflict = getPresentationConflictSnapshot(commandError, activeViewRef.current, clientId, "live");
      if (conflict) {
        setSnapshot(conflict, true);
        await cacheAuthoritativeSnapshot(conflict, undefined, generation);
      }
      if (code === "CONTROL_HELD") setNotice("Otro dispositivo conserva el control. Solicítalo o espera el traspaso.");
      else if (code === "REVISION_CONFLICT") setNotice("La sesión avanzó en otro dispositivo. Cargamos el estado oficial más reciente.");
      else if (code === "OFFLINE_DIVERGED") setNetworkState("diverged");
      throw commandError;
    } finally {
      if (generation === authorityGenerationRef.current) {
        commandPendingRef.current = false;
        if (mountedRef.current) setCommandPending(false);
      }
    }
  }, [authorityIdentity, cacheAuthoritativeSnapshot, clientId, clientName, revokePrivateAuthority, serviceId, setNetworkState, setOfflineState, setSnapshot]);

  const heartbeatControllerClientId = snapshot?.session?.controller?.clientId;
  const heartbeatControllerOwnedByViewer = snapshot?.session?.controller?.ownedByViewer;
  useEffect(() => {
    if (
      !active
      || !maintainController
      || !authoritativeReadyState
      || !heartbeatControllerOwnedByViewer
      || heartbeatControllerClientId !== clientId
      || networkState !== "online"
    ) return undefined;
    const timer = window.setInterval(() => {
      if (commandPendingRef.current) return;
      void sendCommand("heartbeat", {}).catch(() => undefined);
    }, PRESENTATION_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [active, authoritativeReadyState, clientId, heartbeatControllerClientId, heartbeatControllerOwnedByViewer, maintainController, networkState, sendCommand]);

  const discardOfflineChanges = useCallback(async () => {
    if (!activeRef.current) return;
    const generation = authorityGenerationRef.current;
    const pending = offlineStateRef.current;
    if (pending) await removePresentationOfflineState(pending.key);
    if (generation !== authorityGenerationRef.current) return;
    setOfflineState(null);
    setNetworkState("online");
    setNotice("Se descartó la copia local. La sesión oficial permanece activa.");
    await refresh(false).catch(() => undefined);
  }, [refresh, setNetworkState, setOfflineState]);

  const timing = useMemo(() => projectPresentationTiming(snapshot, nowMs), [nowMs, snapshot]);
  const projectedServerNowMs = snapshot
    ? Date.parse(snapshot.serverNow) + Math.max(0, nowMs - snapshot.receivedAtMs)
    : nowMs;
  const messages = useMemo(
    () => (snapshot?.session?.messages || []).filter((message) => Date.parse(message.expiresAt) > projectedServerNowMs),
    [projectedServerNowMs, snapshot?.session?.messages],
  );
  // A 204 poll intentionally carries no renewed lease timestamp. The server
  // clears an actually expired controller and bumps the session revision, so
  // the presence of a controller in the latest authoritative snapshot is the
  // reliable signal for followers. Locally expiring this cached timestamp can
  // otherwise show a false “Tomar control” action while heartbeats keep the
  // server lease alive.
  const authoritativeReady = Boolean(
    authoritativeReadyState
    && authoritativeReadyRef.current
    && authoritativeReadyScopeRef.current === authorityScope
    && enabled
    && active
    && !loading,
  );
  const controllerLeaseActive = Boolean(authoritativeReady && snapshot?.session?.controller);
  const refreshTransport = useCallback(
    (allowReconcile = true) => authoritativeReadyRef.current
      && authoritativeReadyScopeRef.current === authorityScopeRef.current
      ? refresh(allowReconcile)
      : refreshAfterForeground(),
    [refresh, refreshAfterForeground],
  );

  return {
    active,
    snapshot,
    presentationPackage,
    activeView,
    networkState,
    offlineQueueCount: offlineState?.commands.length || 0,
    isLocalState: networkState === "offline" || Boolean(offlineState?.commands.length),
    authoritativeReady,
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
    refresh: refreshTransport,
    reconcileOffline,
    discardOfflineChanges,
    clearNotice: () => setNotice(null),
  };
}
