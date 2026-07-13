import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IDLE_PRESENTATION_REMOTE_INTENT_STATE,
  canSendPresentationRemoteIntent,
  dispatchPresentationRemoteIntent,
  presentationRemoteIntentScopeKey,
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
  enabled: boolean;
  online: boolean;
  viewerCanControl: boolean;
  controllerOwned: boolean;
  request?: PresentationRemoteIntentRequest;
};

export function usePresentationRemoteIntents(options: UsePresentationRemoteIntentsOptions) {
  const [status, setStatus] = useState<PresentationRemoteIntentUiState>(IDLE_PRESENTATION_REMOTE_INTENT_STATE);
  const scopeGenerationRef = useRef(0);
  const pendingRef = useRef(false);
  const inFlightAbortRef = useRef<AbortController | null>(null);
  const scopeKey = presentationRemoteIntentScopeKey(options);
  const scopeKeyRef = useRef(scopeKey);
  const available = canSendPresentationRemoteIntent(options);

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

  const send = useCallback(async <T extends PresentationRemoteIntentType>(
    type: T,
    payload: PresentationRemoteIntentPayloads[T],
  ) => {
    if (!canSendPresentationRemoteIntent(options)) {
      const rejected: PresentationRemoteIntentUiState = {
        phase: "rejected",
        intentId: null,
        type,
        message: options.online
          ? "No hay otro controlador en vivo disponible."
          : "Conéctate a internet para enviar controles remotos.",
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
  }, [options]);

  return useMemo(() => ({
    available,
    pending: status.phase === "sending" || status.phase === "pending",
    status,
    send,
    clearStatus: () => setStatus(IDLE_PRESENTATION_REMOTE_INTENT_STATE),
  }), [available, send, status]);
}
