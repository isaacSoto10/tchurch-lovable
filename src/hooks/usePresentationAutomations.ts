import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { getActivePresentationObsConnection } from "@/lib/presentationLocalConnectors";
import {
  acknowledgePresentationAutomation,
  dispatchPresentationAutomation,
  fetchPendingPresentationAutomations,
  fetchPresentationAutomations,
  type PresentationAutomationDispatch,
  type PresentationAutomationEventInput,
  type PresentationAutomationPending,
  type PresentationRunMode,
} from "@/lib/presentationProduction";
import {
  getPresentationApiErrorCode,
  projectPresentationTiming,
  type PresentationCommandPayloads,
  type PresentationCommandType,
  type PresentationLiveSnapshot,
  type PresentationNetworkState,
  type PresentationTiming,
} from "@/lib/presentationLive";

const EVENT_RETRY_MS = 3_000;
const EMPTY_DELIVERY_POLL_MS = 4_000;
const RULE_REFRESH_MS = 30_000;
const MAX_DRAIN_BATCHES = 12;
const MAX_AUTOMATION_CLOCK_PROJECTION_MS = 8_000;

type AutomationAction = PresentationAutomationPending["actions"][number];

export type PresentationAutomationCommandSender = <T extends PresentationCommandType>(
  type: T,
  payload: PresentationCommandPayloads[T],
  options?: { commandId?: string; expectedRevision?: number; allowOffline?: boolean },
) => Promise<unknown>;

export type PresentationAutomationRuntimeState = {
  phase: "idle" | "dispatching" | "applying" | "error";
  notice: string | null;
  queuedEvents: number;
  lastAppliedAt: string | null;
};

type RuntimeOptions = {
  serviceId?: string;
  mode: PresentationRunMode;
  clientId: string;
  snapshot: PresentationLiveSnapshot | null;
  timing: PresentationTiming | null;
  controllerOwned: boolean;
  commandPending: boolean;
  networkState: PresentationNetworkState;
  itemElapsedThresholds: number[];
  sendCommand: PresentationAutomationCommandSender;
  privacyScope: string;
  externalConnectorScope: string;
  enabled?: boolean;
};

type CommandResult = {
  snapshot?: PresentationLiveSnapshot;
  local?: boolean;
};

class PermanentAutomationDeliveryError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentAutomationDeliveryError";
    this.code = code;
  }
}

function hashAutomationEvent(value: string) {
  let a = 0x9e3779b9;
  let b = 0x85ebca6b;
  let c = 0xc2b2ae35;
  let d = 0x27d4eb2f;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x85ebca6b);
    b = Math.imul(b ^ code, 0xc2b2ae35);
    c = Math.imul(c ^ code, 0x27d4eb2f);
    d = Math.imul(d ^ code, 0x165667b1);
  }
  return [a, b, c, d].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

export function presentationAutomationEventId(sessionId: string, type: PresentationAutomationEventInput["type"], qualifier: string | number) {
  const hash = hashAutomationEvent(`${sessionId}\u001f${type}\u001f${qualifier}`).split("");
  hash[12] = "5";
  hash[16] = ["8", "9", "a", "b"][Number.parseInt(hash[16], 16) % 4];
  const hex = hash.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function presentationAutomationClockProjectionMs(snapshot: PresentationLiveSnapshot, deviceNowMs: number) {
  return Math.min(
    MAX_AUTOMATION_CLOCK_PROJECTION_MS,
    Math.max(0, deviceNowMs - snapshot.receivedAtMs),
  );
}

export function projectPresentationAutomationOccurredAt(snapshot: PresentationLiveSnapshot, deviceNowMs = Date.now()) {
  const serverNowMs = Date.parse(snapshot.serverNow);
  if (!Number.isFinite(serverNowMs)) throw new Error("La hora oficial de la presentación es inválida.");
  const elapsedSinceReceipt = presentationAutomationClockProjectionMs(snapshot, deviceNowMs);
  return new Date(serverNowMs + elapsedSinceReceipt).toISOString();
}

export function projectPresentationAutomationTiming(snapshot: PresentationLiveSnapshot, deviceNowMs = Date.now()) {
  const projectionMs = presentationAutomationClockProjectionMs(snapshot, deviceNowMs);
  return projectPresentationTiming(snapshot, snapshot.receivedAtMs + projectionMs);
}

function eventErrorIsPermanent(error: unknown) {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

function safeErrorNotice(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function commandSnapshot(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  return (result as CommandResult).snapshot || null;
}

function commandWasLocal(result: unknown) {
  return Boolean(result && typeof result === "object" && !Array.isArray(result) && (result as CommandResult).local);
}

function actionPayload<T extends AutomationAction["type"]>(action: AutomationAction, type: T) {
  if (action.type !== type) throw new PermanentAutomationDeliveryError("ACTION_TYPE_INVALID", "La acción automática cambió de tipo.");
  return action.payload as Extract<AutomationAction, { type: T }>["payload"];
}

async function executeDelivery(
  action: AutomationAction,
  sendCommand: PresentationAutomationCommandSender,
  expectedRevision: number,
  expectedConnectorScope: string,
  assertAuthorized: () => void,
) {
  assertAuthorized();
  if (action.type === "obs_scene") {
    const payload = actionPayload(action, "obs_scene") as { sceneName: string };
    const connection = getActivePresentationObsConnection(expectedConnectorScope);
    if (!connection) throw new PermanentAutomationDeliveryError("OBS_NOT_CONNECTED", "Conecta OBS antes de ejecutar esta escena automática.");
    try {
      assertAuthorized();
      await connection.client.request("SetCurrentProgramScene", { sceneName: payload.sceneName }, { mode: "live" });
      assertAuthorized();
      return expectedRevision;
    } catch {
      throw new PermanentAutomationDeliveryError("OBS_REQUEST_FAILED", "OBS no confirmó la escena automática.");
    }
  }

  let result: unknown;
  if (action.type === "stage_message") {
    const payload = actionPayload(action, "stage_message") as PresentationCommandPayloads["stage_message_send"];
    result = await sendCommand("stage_message_send", payload, { commandId: action.deliveryId, expectedRevision, allowOffline: false });
  } else if (action.type === "set_blackout") {
    const payload = actionPayload(action, "set_blackout") as { enabled: boolean };
    result = await sendCommand("set_blackout", { blackout: payload.enabled }, { commandId: action.deliveryId, expectedRevision, allowOffline: false });
  } else if (action.type === "set_chords") {
    const payload = actionPayload(action, "set_chords") as { visible: boolean };
    result = await sendCommand("set_chords", { chordsVisible: payload.visible }, { commandId: action.deliveryId, expectedRevision, allowOffline: false });
  } else if (action.type === "broadcast_visibility") {
    const payload = actionPayload(action, "broadcast_visibility") as { visible: boolean };
    result = await sendCommand("set_broadcast_visibility", { visible: payload.visible }, { commandId: action.deliveryId, expectedRevision, allowOffline: false });
  } else {
    throw new PermanentAutomationDeliveryError("ACTION_UNSUPPORTED", "La acción automática no es compatible.");
  }

  assertAuthorized();
  if (commandWasLocal(result)) throw new Error("La automatización espera la sesión oficial; no se confirmó en modo local.");
  assertAuthorized();
  return commandSnapshot(result)?.session?.revision ?? expectedRevision + 1;
}

export function usePresentationAutomationRuleThresholds(serviceId?: string, enabled = true) {
  const [thresholds, setThresholds] = useState<{ live: number[]; rehearsal: number[] }>({ live: [], rehearsal: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceId || !enabled) {
      setThresholds({ live: [], rehearsal: [] });
      setError(null);
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const envelope = await fetchPresentationAutomations(serviceId);
        if (cancelled) return;
        const forMode = (mode: PresentationRunMode) => [...new Set(envelope.rules.flatMap((rule) => rule.enabled && rule.modes[mode] && rule.trigger.type === "item_elapsed" ? [rule.trigger.afterSeconds] : []))].sort((a, b) => a - b);
        setThresholds({ live: forMode("live"), rehearsal: forMode("rehearsal") });
        setError(null);
      } catch (loadError) {
        if (!cancelled) setError(safeErrorNotice(loadError, "No se pudieron actualizar los disparadores por tiempo."));
      } finally {
        if (!cancelled) timer = window.setTimeout(load, RULE_REFRESH_MS);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, serviceId]);

  return { thresholds, error };
}

export function usePresentationAutomations({
  serviceId,
  mode,
  clientId,
  snapshot,
  timing,
  controllerOwned,
  commandPending,
  networkState,
  itemElapsedThresholds,
  sendCommand,
  privacyScope,
  externalConnectorScope,
  enabled = true,
}: RuntimeOptions) {
  const [state, setState] = useState<PresentationAutomationRuntimeState>({ phase: "idle", notice: null, queuedEvents: 0, lastAppliedAt: null });
  const [queueVersion, setQueueVersion] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const queueRef = useRef<PresentationAutomationEventInput[]>([]);
  const seenEventsRef = useRef(new Set<string>());
  const lastSlideRef = useRef<string | null>(null);
  const itemEntryRef = useRef<{ generation: string; revision: number; fired: Set<number> } | null>(null);
  const countdownsRef = useRef(new Set<string>());
  const dispatchingRef = useRef<Promise<void> | null>(null);
  const applyingRef = useRef<Promise<number> | null>(null);
  const endingRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const sendCommandRef = useRef(sendCommand);
  const controllerOwnedRef = useRef(controllerOwned);
  const networkStateRef = useRef(networkState);
  const commandPendingRef = useRef(commandPending);
  const scopeRef = useRef("");
  snapshotRef.current = snapshot;
  sendCommandRef.current = sendCommand;
  controllerOwnedRef.current = controllerOwned;
  networkStateRef.current = networkState;
  commandPendingRef.current = commandPending;

  const session = snapshot?.session?.mode === mode ? snapshot.session : null;
  const activeSessionId = session?.id || null;
  const hasActiveSession = session?.status === "live";
  const scope = `${privacyScope}::${serviceId || "none"}::${mode}::${session?.id || "none"}::${clientId}`;
  scopeRef.current = scope;

  useEffect(() => {
    queueRef.current = [];
    seenEventsRef.current.clear();
    lastSlideRef.current = null;
    itemEntryRef.current = null;
    countdownsRef.current.clear();
    endingRef.current = false;
    setQueueVersion((value) => value + 1);
    setState({ phase: "idle", notice: null, queuedEvents: 0, lastAppliedAt: null });
  }, [scope]);

  const enqueue = useCallback((event: PresentationAutomationEventInput) => {
    if (seenEventsRef.current.has(event.id)) return;
    seenEventsRef.current.add(event.id);
    queueRef.current.push(event);
    setQueueVersion((value) => value + 1);
    setState((current) => ({ ...current, queuedEvents: queueRef.current.length }));
  }, []);

  useEffect(() => {
    if (!enabled || !serviceId || !session || session.status !== "live" || !controllerOwned || networkState !== "online" || endingRef.current || applyingRef.current) return;
    const revision = session.revision;
    const deviceNowMs = Date.now();
    const now = projectPresentationAutomationOccurredAt(snapshot, deviceNowMs);
    const authoritativeNowMs = Date.parse(now);
    const eventTiming = projectPresentationAutomationTiming(snapshot, deviceNowMs) || timing;
    if (authoritativeNowMs - Date.parse(session.startedAt) <= 120_000) {
      enqueue({
        id: presentationAutomationEventId(session.id, "session_started", session.startedAt),
        type: "session_started",
        occurredAt: session.startedAt,
        sessionId: session.id,
        revision,
      });
    }

    const cursor = session.cursor;
    const slideIdentity = cursor.itemId ? [cursor.itemId, cursor.stepId || "cue", cursor.partIndex, cursor.sectionAnchorId || "none"].join("::") : null;
    if (slideIdentity && slideIdentity !== lastSlideRef.current) {
      lastSlideRef.current = slideIdentity;
      enqueue({
        id: presentationAutomationEventId(session.id, "slide_entered", `${revision}:${slideIdentity}`),
        type: "slide_entered",
        occurredAt: now,
        sessionId: session.id,
        revision,
      });
    }

    const itemId = eventTiming?.item.itemId || cursor.itemId || null;
    const timerStartedAt = eventTiming?.item.startedAt || null;
    const itemGeneration = itemId && timerStartedAt ? `${itemId}::${timerStartedAt}` : null;
    if (!itemGeneration) itemEntryRef.current = null;
    else if (itemEntryRef.current?.generation !== itemGeneration) itemEntryRef.current = { generation: itemGeneration, revision, fired: new Set() };
    if (itemEntryRef.current && eventTiming?.item.status === "running") {
      const elapsedSeconds = Math.max(0, Math.floor(eventTiming.item.elapsedSeconds));
      for (const threshold of itemElapsedThresholds) {
        if (elapsedSeconds < threshold || itemEntryRef.current.fired.has(threshold)) continue;
        itemEntryRef.current.fired.add(threshold);
        enqueue({
          id: presentationAutomationEventId(session.id, "item_elapsed", `${itemEntryRef.current.revision}:${itemEntryRef.current.generation}:${threshold}`),
          type: "item_elapsed",
          occurredAt: now,
          sessionId: session.id,
          revision,
          thresholdSeconds: threshold,
          elapsedSeconds,
        });
      }
    }

    if (eventTiming?.countdown && eventTiming.countdown.remainingSeconds <= 0 && !countdownsRef.current.has(eventTiming.countdown.targetAt)) {
      countdownsRef.current.add(eventTiming.countdown.targetAt);
      enqueue({
        id: presentationAutomationEventId(session.id, "countdown_elapsed", eventTiming.countdown.targetAt),
        type: "countdown_elapsed",
        occurredAt: now,
        sessionId: session.id,
        revision,
      });
    }
  }, [controllerOwned, enabled, enqueue, itemElapsedThresholds, networkState, retryVersion, serviceId, session, snapshot, timing]);

  const dispatchQueuedEvents = useCallback(async () => {
    while (applyingRef.current) await applyingRef.current;
    while (dispatchingRef.current) await dispatchingRef.current;
    if (!serviceId || !queueRef.current.length) return;
    const authorizedScope = scopeRef.current;
    const operation = (async () => {
      setState((current) => ({ ...current, phase: "dispatching", queuedEvents: queueRef.current.length }));
      while (queueRef.current.length) {
        if (scopeRef.current !== authorizedScope || !controllerOwnedRef.current || networkStateRef.current !== "online") throw new Error("El control o la identidad cambió antes de registrar el evento automático.");
        const event = queueRef.current[0];
        try {
          const result = await dispatchPresentationAutomation(serviceId, { mode, clientId, event });
          if (scopeRef.current !== authorizedScope || !controllerOwnedRef.current || networkStateRef.current !== "online") throw new Error("El control o la identidad cambió durante el evento automático.");
          queueRef.current.shift();
          setState((current) => ({
            ...current,
            phase: "idle",
            queuedEvents: queueRef.current.length,
            notice: result.simulated
              ? `Simulación registrada: ${result.actions.length} acción(es), sin efectos externos.`
              : `Evento registrado: ${result.actions.length} entrega(s) listas para la cola segura.`,
          }));
        } catch (eventError) {
          if (eventErrorIsPermanent(eventError)) {
            queueRef.current.shift();
            setState((current) => ({ ...current, phase: "error", queuedEvents: queueRef.current.length, notice: safeErrorNotice(eventError, "El evento automático ya no coincide con la sesión.") }));
            continue;
          }
          throw eventError;
        }
      }
    })();
    const tracked = operation.finally(() => {
      if (dispatchingRef.current === tracked) dispatchingRef.current = null;
      setQueueVersion((value) => value + 1);
      setRetryVersion((value) => value + 1);
    });
    dispatchingRef.current = tracked;
    return tracked;
  }, [clientId, mode, serviceId]);

  useEffect(() => {
    if (!enabled || !serviceId || !controllerOwned || networkState !== "online" || !queueRef.current.length || applyingRef.current || dispatchingRef.current) return undefined;
    let retryTimer: number | undefined;
    void dispatchQueuedEvents().catch(() => {
      setState((current) => ({ ...current, phase: "error", queuedEvents: queueRef.current.length, notice: "La cola automática perdió conexión; reintentará sin duplicar acciones." }));
      retryTimer = window.setTimeout(() => setRetryVersion((value) => value + 1), EVENT_RETRY_MS);
    });
    return () => { if (retryTimer) window.clearTimeout(retryTimer); };
  }, [controllerOwned, dispatchQueuedEvents, enabled, networkState, queueVersion, retryVersion, serviceId]);

  const applyPendingUntilEmpty = useCallback(async (drainCompletely: boolean, initialRevision = 0) => {
    if (!serviceId || mode !== "live") return snapshotRef.current?.session?.revision || 0;
    const authorizedScope = scopeRef.current;
    const authorizedSessionId = snapshotRef.current?.session?.id || null;
    const assertAuthorized = () => {
      const current = snapshotRef.current?.session;
      if (scopeRef.current !== authorizedScope
        || !controllerOwnedRef.current
        || networkStateRef.current !== "online"
        || commandPendingRef.current
        || !current
        || current.mode !== "live"
        || current.status !== "live"
        || current.id !== authorizedSessionId) throw new Error("El control o la identidad cambió durante la automatización.");
    };
    let revision = Math.max(initialRevision, snapshotRef.current?.session?.revision || 0);
    let batchCount = 0;
    do {
      assertAuthorized();
      const pending = await fetchPendingPresentationAutomations(serviceId, clientId);
      assertAuthorized();
      if (!pending.actions.length) return Math.max(snapshotRef.current?.session?.revision || 0, revision);
      batchCount += 1;
      setState((current) => ({ ...current, phase: "applying", notice: `Aplicando ${pending.actions.length} entrega(s) en orden…` }));
      for (const action of pending.actions) {
        try {
          assertAuthorized();
          revision = await executeDelivery(action, sendCommandRef.current, revision, externalConnectorScope, assertAuthorized);
          assertAuthorized();
          await acknowledgePresentationAutomation(serviceId, { deliveryId: action.deliveryId, clientId, status: "applied" });
          assertAuthorized();
          setState((current) => ({ ...current, lastAppliedAt: new Date().toISOString() }));
        } catch (deliveryError) {
          if (deliveryError instanceof PermanentAutomationDeliveryError) {
            assertAuthorized();
            await acknowledgePresentationAutomation(serviceId, { deliveryId: action.deliveryId, clientId, status: "failed", errorCode: deliveryError.code });
            assertAuthorized();
            setState((current) => ({ ...current, phase: "error", notice: deliveryError.message }));
            continue;
          }
          const code = getPresentationApiErrorCode(deliveryError);
          if (deliveryError instanceof ApiError && deliveryError.status >= 400 && deliveryError.status < 500 && code && !["REVISION_CONFLICT", "CONTROL_REQUIRED", "CONTROL_HELD", "DELIVERY_LEASE_INVALID"].includes(code)) {
            assertAuthorized();
            await acknowledgePresentationAutomation(serviceId, { deliveryId: action.deliveryId, clientId, status: "failed", errorCode: "COMMAND_REJECTED" });
            assertAuthorized();
            setState((current) => ({ ...current, phase: "error", notice: "La sesión rechazó una acción automática y quedó marcada como fallida." }));
            continue;
          }
          throw deliveryError;
        }
      }
      if (!drainCompletely) return revision;
    } while (batchCount < MAX_DRAIN_BATCHES);
    throw new Error("Quedan demasiadas automatizaciones pendientes para terminar la sesión con seguridad.");
  }, [clientId, externalConnectorScope, mode, serviceId]);

  const runApplyExclusive = useCallback(async (drainCompletely: boolean, initialRevision = 0) => {
    while (dispatchingRef.current) await dispatchingRef.current;
    let baseRevision = initialRevision;
    while (applyingRef.current) baseRevision = Math.max(baseRevision, await applyingRef.current);
    const operation = applyPendingUntilEmpty(drainCompletely, baseRevision).finally(() => {
      if (applyingRef.current === operation) applyingRef.current = null;
      setRetryVersion((value) => value + 1);
    });
    applyingRef.current = operation;
    return operation;
  }, [applyPendingUntilEmpty]);

  useEffect(() => {
    if (!enabled || mode !== "live" || !serviceId || !activeSessionId || !hasActiveSession || !controllerOwned || commandPending || networkState !== "online" || endingRef.current || queueRef.current.length || dispatchingRef.current) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        await runApplyExclusive(false);
        if (!cancelled) setState((current) => ({ ...current, phase: current.phase === "error" ? "error" : "idle" }));
      } catch (applyError) {
        if (!cancelled) setState((current) => ({ ...current, phase: "error", notice: safeErrorNotice(applyError, "No se pudo aplicar la cola automática.") }));
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, EMPTY_DELIVERY_POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeSessionId, commandPending, controllerOwned, enabled, hasActiveSession, mode, networkState, queueVersion, retryVersion, runApplyExclusive, serviceId]);

  const prepareSessionEnd = useCallback(async () => {
    endingRef.current = true;
    let preparedRevision = snapshotRef.current?.session?.revision || 0;
    try {
      await dispatchQueuedEvents();
      if (mode === "live") preparedRevision = await runApplyExclusive(true);
    } catch (error) {
      endingRef.current = false;
      throw error;
    }
    const currentSnapshot = snapshotRef.current;
    const current = currentSnapshot?.session;
    if (!serviceId || !currentSnapshot || !current || current.mode !== mode || current.status !== "live") throw new Error("No hay una sesión activa para terminar.");
    const authorizedScope = scopeRef.current;
    const assertAuthorized = () => {
      const latest = snapshotRef.current?.session;
      if (scopeRef.current !== authorizedScope
        || !controllerOwnedRef.current
        || networkStateRef.current !== "online"
        || commandPendingRef.current
        || !latest
        || latest.id !== current.id
        || latest.mode !== mode
        || latest.status !== "live") throw new Error("Necesitas el control activo y la misma identidad para cerrar la sesión.");
    };
    assertAuthorized();
    const event: PresentationAutomationEventInput = {
      id: presentationAutomationEventId(current.id, "session_ended", "final"),
      type: "session_ended",
      occurredAt: projectPresentationAutomationOccurredAt(currentSnapshot),
      sessionId: current.id,
      revision: preparedRevision || current.revision,
    };
    try {
      const result = await dispatchPresentationAutomation(serviceId, { mode, clientId, event });
      assertAuthorized();
      if (mode === "rehearsal") {
        if (!result.simulated) throw new Error("El cierre de ensayo devolvió efectos externos inesperados.");
        return snapshotRef.current?.session?.revision || current.revision;
      }
      if (result.simulated) throw new Error("El cierre en vivo devolvió una simulación inesperada.");
      return runApplyExclusive(true, preparedRevision || current.revision);
    } catch (error) {
      endingRef.current = false;
      throw error;
    }
  }, [clientId, dispatchQueuedEvents, mode, runApplyExclusive, serviceId]);

  const prepareControlRelease = useCallback(async () => {
    endingRef.current = true;
    try {
      await dispatchQueuedEvents();
      if (mode === "live") return runApplyExclusive(true);
      return snapshotRef.current?.session?.revision || 0;
    } catch (error) {
      endingRef.current = false;
      throw error;
    }
  }, [dispatchQueuedEvents, mode, runApplyExclusive]);

  return {
    state,
    prepareSessionEnd,
    prepareControlRelease,
    resumeAfterControlRelease: () => { endingRef.current = false; },
    clearNotice: () => setState((current) => ({ ...current, notice: null, phase: current.phase === "error" ? "idle" : current.phase })),
  };
}
