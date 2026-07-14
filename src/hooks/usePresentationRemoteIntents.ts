import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IDLE_PRESENTATION_REMOTE_INTENT_STATE,
  PRESENTATION_REMOTE_INTENT_CAPABILITY_POLL_MS,
  canSendPresentationRemoteIntent,
  dispatchPresentationRemoteIntent,
  fetchPresentationRemoteIntentCapabilities,
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
  deadlineAtMs: number;
};

const NO_SUPPORTED_REMOTE_INTENTS: readonly PresentationRemoteIntentType[] = [];

export function usePresentationRemoteIntents(options: UsePresentationRemoteIntentsOptions) {
  const [status, setStatus] = useState<PresentationRemoteIntentUiState>(IDLE_PRESENTATION_REMOTE_INTENT_STATE);
  const scopeGenerationRef = useRef(0);
  const pendingRef = useRef(false);
  const inFlightAbortRef = useRef<AbortController | null>(null);
  const capabilityAbortRef = useRef<AbortController | null>(null);
  const scopeKey = presentationRemoteIntentScopeKey(options);
  const scopeKeyRef = useRef(scopeKey);
  const authorityAvailable = canSendPresentationRemoteIntent(options);
  const [capabilityState, setCapabilityState] = useState<CapabilityState>({
    scopeKey,
    supportedIntents: [],
    deadlineAtMs: 0,
  });
  const supportedIntents = capabilityState.scopeKey === scopeKey && capabilityState.deadlineAtMs > Date.now()
    ? capabilityState.supportedIntents
    : NO_SUPPORTED_REMOTE_INTENTS;
  const available = authorityAvailable && supportedIntents.length > 0;

  useEffect(() => {
    inFlightAbortRef.current?.abort();
    inFlightAbortRef.current = null;
    capabilityAbortRef.current?.abort();
    capabilityAbortRef.current = null;
    pendingRef.current = false;
    scopeKeyRef.current = scopeKey;
    scopeGenerationRef.current += 1;
    setStatus(IDLE_PRESENTATION_REMOTE_INTENT_STATE);
    setCapabilityState({ scopeKey, supportedIntents: [], deadlineAtMs: 0 });
    return () => {
      scopeGenerationRef.current += 1;
      pendingRef.current = false;
      inFlightAbortRef.current?.abort();
      inFlightAbortRef.current = null;
      capabilityAbortRef.current?.abort();
      capabilityAbortRef.current = null;
    };
  }, [scopeKey]);

  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let expiryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    capabilityAbortRef.current?.abort();
    capabilityAbortRef.current = null;
    setCapabilityState({ scopeKey, supportedIntents: [], deadlineAtMs: 0 });

    if (!authorityAvailable) return () => undefined;

    const schedulePoll = (delayMs: number) => {
      if (disposed) return;
      pollTimer = globalThis.setTimeout(() => { void poll(); }, Math.max(250, delayMs));
    };
    const poll = async () => {
      if (disposed) return;
      const controller = new AbortController();
      capabilityAbortRef.current = controller;
      try {
        const capabilities = await fetchPresentationRemoteIntentCapabilities({
          churchId: options.churchId!,
          serviceId: options.serviceId!,
          sessionId: options.sessionId!,
          controllerAuthorityVersion: options.controllerAuthorityVersion!,
          request: options.capabilitiesRequest,
          signal: controller.signal,
        });
        if (disposed || controller.signal.aborted || scopeKeyRef.current !== scopeKey) return;
        if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
        const receiver = capabilities.receiver;
        if (!receiver) {
          setCapabilityState({ scopeKey, supportedIntents: [], deadlineAtMs: 0 });
          schedulePoll(PRESENTATION_REMOTE_INTENT_CAPABILITY_POLL_MS);
          return;
        }
        const remainingMs = Math.max(0, receiver.deadlineAtMs - Date.now());
        setCapabilityState({
          scopeKey,
          supportedIntents: receiver.supportedIntents,
          deadlineAtMs: receiver.deadlineAtMs,
        });
        expiryTimer = globalThis.setTimeout(() => {
          if (!disposed && scopeKeyRef.current === scopeKey) {
            setCapabilityState({ scopeKey, supportedIntents: [], deadlineAtMs: 0 });
          }
        }, remainingMs);
        schedulePoll(Math.min(PRESENTATION_REMOTE_INTENT_CAPABILITY_POLL_MS, remainingMs));
      } catch {
        if (disposed || controller.signal.aborted || scopeKeyRef.current !== scopeKey) return;
        setCapabilityState({ scopeKey, supportedIntents: [], deadlineAtMs: 0 });
        schedulePoll(PRESENTATION_REMOTE_INTENT_CAPABILITY_POLL_MS);
      } finally {
        if (capabilityAbortRef.current === controller) capabilityAbortRef.current = null;
      }
    };
    void poll();

    return () => {
      disposed = true;
      if (pollTimer !== null) globalThis.clearTimeout(pollTimer);
      if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
      capabilityAbortRef.current?.abort();
      capabilityAbortRef.current = null;
    };
  }, [authorityAvailable, options.capabilitiesRequest, options.churchId, options.controllerAuthorityVersion, options.serviceId, options.sessionId, scopeKey]);

  const send = useCallback(async <T extends PresentationRemoteIntentType>(
    type: T,
    payload: PresentationRemoteIntentPayloads[T],
  ) => {
    const capabilityConfirmed = capabilityState.scopeKey === scopeKey
      && capabilityState.deadlineAtMs > Date.now()
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
      });
    } finally {
      if (inFlightAbortRef.current === abortController) inFlightAbortRef.current = null;
      if (isScopeCurrent()) pendingRef.current = false;
    }
  }, [capabilityState, options, scopeKey]);

  return useMemo(() => ({
    available,
    supportedIntents,
    pending: status.phase === "sending" || status.phase === "pending",
    status,
    send,
    clearStatus: () => setStatus(IDLE_PRESENTATION_REMOTE_INTENT_STATE),
  }), [available, send, status, supportedIntents]);
}
