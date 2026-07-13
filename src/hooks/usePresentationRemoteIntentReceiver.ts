import { useEffect, useMemo, useRef, useState } from "react";
import {
  PRESENTATION_REMOTE_INTENT_RECEIVER_POLL_MS,
  activatePresentationRemoteIntentReceiverIdentity,
  canReceivePresentationRemoteIntents,
  clearPresentationRemoteIntentReceiverStorage,
  createPresentationRemoteIntentReceiverClock,
  presentationRemoteIntentReceiverAuthorityScope,
  processPresentationRemoteIntentOnce,
  type PresentationRemoteIntentReceiverAuthority,
  type PresentationRemoteIntentReceiverCommandSender,
  type PresentationRemoteIntentReceiverRequest,
  type PresentationRemoteIntentReceiverResult,
} from "@/lib/presentationRemoteIntentReceiver";

type UsePresentationRemoteIntentReceiverOptions = PresentationRemoteIntentReceiverAuthority & {
  currentRevision: number;
  sendCommand: PresentationRemoteIntentReceiverCommandSender;
  request?: PresentationRemoteIntentReceiverRequest;
  pollMs?: number;
};

const IDLE_RESULT: PresentationRemoteIntentReceiverResult = { phase: "idle" };

export function usePresentationRemoteIntentReceiver(options: UsePresentationRemoteIntentReceiverOptions) {
  const [lastResult, setLastResult] = useState<PresentationRemoteIntentReceiverResult>(IDLE_RESULT);
  const authority: PresentationRemoteIntentReceiverAuthority = options;
  const authorityScope = presentationRemoteIntentReceiverAuthorityScope(authority);
  const available = canReceivePresentationRemoteIntents(authority);
  const optionsRef = useRef(options);
  const scopeRef = useRef(authorityScope);
  const generationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);
  const clockRef = useRef<(() => number) | null>(null);
  clockRef.current ||= createPresentationRemoteIntentReceiverClock();
  optionsRef.current = options;

  if (scopeRef.current !== authorityScope) {
    scopeRef.current = authorityScope;
    generationRef.current += 1;
    inFlightRef.current?.abort();
    inFlightRef.current = null;
  }

  useEffect(() => {
    if (options.accountId && options.churchId) {
      activatePresentationRemoteIntentReceiverIdentity(options.accountId, options.churchId);
      return;
    }
    clearPresentationRemoteIntentReceiverStorage();
  }, [options.accountId, options.churchId]);

  useEffect(() => {
    setLastResult(available ? IDLE_RESULT : { phase: "inactive" });
    if (!available) return undefined;
    let cancelled = false;
    let halted = false;
    let timer: number | undefined;
    const generation = generationRef.current;
    const expectedScope = authorityScope;

    const poll = async () => {
      if (cancelled || generation !== generationRef.current || expectedScope !== scopeRef.current) return;
      const current = optionsRef.current;
      const controller = new AbortController();
      inFlightRef.current = controller;
      try {
        const result = await processPresentationRemoteIntentOnce({
          authority: current,
          currentRevision: current.currentRevision,
          sendCommand: current.sendCommand,
          request: current.request,
          signal: controller.signal,
          now: clockRef.current!,
          isAuthorityCurrent: () => !cancelled
            && generation === generationRef.current
            && expectedScope === scopeRef.current,
        });
        if (!cancelled && generation === generationRef.current && expectedScope === scopeRef.current) {
          setLastResult(result);
          halted = result.phase === "halted";
        }
      } catch (error) {
        if (!controller.signal.aborted && !cancelled && generation === generationRef.current && expectedScope === scopeRef.current) {
          setLastResult({ phase: "retry", deliveryId: "" });
        }
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null;
        if (!cancelled && !halted && generation === generationRef.current && expectedScope === scopeRef.current) {
          timer = window.setTimeout(poll, Math.max(250, current.pollMs ?? PRESENTATION_REMOTE_INTENT_RECEIVER_POLL_MS));
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      generationRef.current += 1;
      if (timer) window.clearTimeout(timer);
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, [authorityScope, available]);

  return useMemo(() => ({ available, lastResult }), [available, lastResult]);
}
