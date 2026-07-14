import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IDLE_PRESENTATION_REMOTE_INTENT_STATE,
  PRESENTATION_REMOTE_INTENT_CAPABILITY_POLL_MS,
  canSendPresentationRemoteIntent,
  dispatchPresentationRemoteIntent,
  fetchPresentationRemoteIntentCapabilities,
  presentationRemoteIntentMonotonicNow,
  presentationRemoteIntentPollDelayMs,
  presentationRemoteIntentScopeKey,
  type PresentationRemoteIntentCapabilitiesRequest,
  type PresentationRemoteIntentPayloads,
  type PresentationRemoteIntentRequest,
  type PresentationRemoteIntentType,
  type PresentationRemoteIntentUiState,
} from "@/lib/presentationRemoteIntents";

type UsePresentationRemoteIntentsOptions = {
  accountId?: string | null;
  churchId?: string | null;
  serviceId?: string | null;
  sessionId?: string | null;
  clientId?: string | null;
  controllerClientId?: string | null;
  viewerVersion?: string | null;
  controllerAuthorityVersion?: string | null;
  controllerVersion?: string | null;
  mode: "live" | "rehearsal";
  enabled: boolean;
  online: boolean;
  viewerCanControl: boolean;
  controllerOwned: boolean;
  request?: PresentationRemoteIntentRequest;
  capabilitiesRequest?: PresentationRemoteIntentCapabilitiesRequest;
};

type CapabilityState = {
  scopeKey: string;
  supportedIntents: readonly PresentationRemoteIntentType[];
  expiresAtMonotonicMs: number;
};

const NO_SUPPORTED_REMOTE_INTENTS: readonly PresentationRemoteIntentType[] = [];

export function usePresentationRemoteIntents(options: UsePresentationRemoteIntentsOptions) {
  const [status, setStatus] = useState<PresentationRemoteIntentUiState>(IDLE_PRESENTATION_REMOTE_INTENT_STATE);
  const scopeGenerationRef = useRef(0);
  const pendingRef = useRef(false);
  const inFlightAbortRef = useRef<AbortController | null>(null);
  const capabilityGenerationRef = useRef(0);
  const capabilityRequestAbortRef = useRef<AbortController | null>(null);
  const [capabilityRefreshVersion, setCapabilityRefreshVersion] = useState(0);
  const scopeKey = presentationRemoteIntentScopeKey(options);
  const scopeKeyRef = useRef(scopeKey);
  const authorityAvailable = canSendPresentationRemoteIntent(options);
  const [capabilityState, setCapabilityState] = useState<CapabilityState>({
    scopeKey,
    supportedIntents: [],
    expiresAtMonotonicMs: 0,
  });
  const supportedIntents = capabilityState.scopeKey === scopeKey
    && capabilityState.expiresAtMonotonicMs > presentationRemoteIntentMonotonicNow()
    ? capabilityState.supportedIntents
    : NO_SUPPORTED_REMOTE_INTENTS;
  const available = authorityAvailable && supportedIntents.length > 0;

  useEffect(() => {
    inFlightAbortRef.current?.abort();
    inFlightAbortRef.current = null;
    pendingRef.current = false;
    scopeKeyRef.current = scopeKey;
    scopeGenerationRef.current += 1;
    setStatus(IDLE_PRESENTATION_REMOTE_INTENT_STATE);
    return () => {
      scopeGenerationRef.current += 1;
      pendingRef.current = false;
      inFlightAbortRef.current?.abort();
      inFlightAbortRef.current = null;
    };
  }, [scopeKey]);

  useEffect(() => {
    capabilityGenerationRef.current += 1;
    const generation = capabilityGenerationRef.current;
    let disposed = false;
    let suspended = typeof document !== "undefined" && document.visibilityState === "hidden";
    let requestInFlight = false;
    let requestSequence = 0;
    let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let expiryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const isCurrent = () => !disposed && capabilityGenerationRef.current === generation;
    const isForeground = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const clearPoll = () => {
      if (pollTimer !== null) globalThis.clearTimeout(pollTimer);
      pollTimer = null;
    };
    const clearExpiry = () => {
      if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
      expiryTimer = null;
    };
    const publishUnavailable = () => {
      if (isCurrent()) setCapabilityState({ scopeKey, supportedIntents: [], expiresAtMonotonicMs: 0 });
    };
    const invalidateRequest = () => {
      requestSequence += 1;
      requestInFlight = false;
      const controller = capabilityRequestAbortRef.current;
      capabilityRequestAbortRef.current = null;
      controller?.abort();
    };
    const schedulePoll = (delayMs: number) => {
      clearPoll();
      if (!isCurrent() || suspended || !isForeground()) return;
      pollTimer = globalThis.setTimeout(() => {
        pollTimer = null;
        void poll();
      }, Math.max(0, delayMs));
    };
    const suspend = () => {
      if (!isCurrent()) return;
      suspended = true;
      clearPoll();
      clearExpiry();
      invalidateRequest();
      publishUnavailable();
    };
    const resume = () => {
      if (!isCurrent() || !authorityAvailable || !isForeground()) return;
      suspended = false;
      clearPoll();
      clearExpiry();
      invalidateRequest();
      publishUnavailable();
      void poll();
    };
    const handleVisibilityChange = () => {
      if (!isForeground()) {
        if (!suspended) suspend();
        return;
      }
      if (suspended) resume();
    };
    async function poll() {
      if (!isCurrent() || suspended || !isForeground() || requestInFlight) return;
      clearPoll();
      requestInFlight = true;
      const requestId = ++requestSequence;
      const controller = new AbortController();
      capabilityRequestAbortRef.current = controller;
      const requestedAtMs = Date.now();
      try {
        const capabilities = await fetchPresentationRemoteIntentCapabilities({
          churchId: options.churchId!,
          serviceId: options.serviceId!,
          sessionId: options.sessionId!,
          controllerAuthorityVersion: options.controllerAuthorityVersion!,
          request: options.capabilitiesRequest,
          signal: controller.signal,
        });
        if (!isCurrent() || requestSequence !== requestId || controller.signal.aborted || scopeKeyRef.current !== scopeKey) return;
        if (!isForeground()) {
          suspend();
          return;
        }
        clearExpiry();
        const receiver = capabilities.receiver;
        if (!receiver) {
          publishUnavailable();
          return;
        }
        const remainingMs = Math.max(0, receiver.expiresAtMonotonicMs - presentationRemoteIntentMonotonicNow());
        if (!remainingMs) {
          publishUnavailable();
          return;
        }
        setCapabilityState({
          scopeKey,
          supportedIntents: receiver.supportedIntents,
          expiresAtMonotonicMs: receiver.expiresAtMonotonicMs,
        });
        expiryTimer = globalThis.setTimeout(() => {
          if (isCurrent() && scopeKeyRef.current === scopeKey) {
            setCapabilityState({ scopeKey, supportedIntents: [], expiresAtMonotonicMs: 0 });
          }
        }, remainingMs);
      } catch {
        if (!isCurrent() || requestSequence !== requestId || controller.signal.aborted || scopeKeyRef.current !== scopeKey) return;
        if (!isForeground()) {
          suspend();
          return;
        }
        clearExpiry();
        publishUnavailable();
      } finally {
        if (capabilityRequestAbortRef.current === controller) capabilityRequestAbortRef.current = null;
        if (isCurrent() && requestSequence === requestId) {
          requestInFlight = false;
          if (!suspended && isForeground()) {
            schedulePoll(presentationRemoteIntentPollDelayMs(
              PRESENTATION_REMOTE_INTENT_CAPABILITY_POLL_MS,
              requestedAtMs,
              Date.now(),
            ));
          }
        }
      }
    }

    publishUnavailable();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange);
    if (authorityAvailable && !suspended) void poll();

    return () => {
      disposed = true;
      capabilityGenerationRef.current += 1;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearPoll();
      clearExpiry();
      invalidateRequest();
    };
  }, [authorityAvailable, capabilityRefreshVersion, options.capabilitiesRequest, options.churchId, options.controllerAuthorityVersion, options.serviceId, options.sessionId, scopeKey]);

  const invalidateCapabilities = useCallback(() => {
    capabilityGenerationRef.current += 1;
    capabilityRequestAbortRef.current?.abort();
    capabilityRequestAbortRef.current = null;
    setCapabilityState({ scopeKey, supportedIntents: [], expiresAtMonotonicMs: 0 });
    setCapabilityRefreshVersion((current) => current + 1);
  }, [scopeKey]);

  const send = useCallback(async <T extends PresentationRemoteIntentType>(
    type: T,
    payload: PresentationRemoteIntentPayloads[T],
  ) => {
    const capabilityConfirmed = capabilityState.scopeKey === scopeKey
      && capabilityState.expiresAtMonotonicMs > presentationRemoteIntentMonotonicNow()
      && capabilityState.supportedIntents.includes(type);
    if (!canSendPresentationRemoteIntent(options) || !capabilityConfirmed) {
      const rejected: PresentationRemoteIntentUiState = {
        phase: "rejected",
        intentId: null,
        type,
        message: !options.online
          ? "Conéctate a internet para enviar controles remotos."
          : canSendPresentationRemoteIntent(options)
            ? "El controlador no confirmó compatibilidad con esa acción."
            : "No hay otro controlador en vivo disponible.",
      };
      setStatus(rejected);
      return rejected;
    }
    if (pendingRef.current) {
      const busy: PresentationRemoteIntentUiState = {
        phase: "error",
        intentId: null,
        type,
        message: "Espera la confirmación de la acción anterior.",
      };
      setStatus(busy);
      return busy;
    }

    const generation = scopeGenerationRef.current;
    const expectedScopeKey = scopeKeyRef.current;
    const isScopeCurrent = () => generation === scopeGenerationRef.current && expectedScopeKey === scopeKeyRef.current;
    const abortController = new AbortController();
    inFlightAbortRef.current = abortController;
    pendingRef.current = true;
    try {
      return await dispatchPresentationRemoteIntent({
        churchId: options.churchId!,
        serviceId: options.serviceId!,
        sessionId: options.sessionId!,
        clientId: options.clientId!,
        type,
        payload,
        request: options.request,
        signal: abortController.signal,
        isScopeCurrent,
        onState: (next) => {
          if (isScopeCurrent()) setStatus(next);
        },
        onReceiverContractRejected: invalidateCapabilities,
      });
    } finally {
      if (inFlightAbortRef.current === abortController) inFlightAbortRef.current = null;
      if (isScopeCurrent()) pendingRef.current = false;
    }
  }, [capabilityState, invalidateCapabilities, options, scopeKey]);

  return useMemo(() => ({
    available,
    supportedIntents,
    pending: status.phase === "sending" || status.phase === "pending",
    status,
    send,
    clearStatus: () => setStatus(IDLE_PRESENTATION_REMOTE_INTENT_STATE),
  }), [available, send, status, supportedIntents]);
}
