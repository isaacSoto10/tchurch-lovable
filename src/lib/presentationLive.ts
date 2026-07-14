import { ApiError, apiFetch } from "@/lib/api";
import type { PresentationService } from "@/lib/servicePresentation";
import {
  normalizePresentationWorkspace,
  type PresentationTargetRole,
  type PresentationWorkspace,
} from "@/lib/presentationWorkspace";
import { presentationStageRoleForViewer, type PresentationMediaPlayback, type PresentationStageMode, type PresentationStageRole } from "@/lib/presentationOutput";

export const PRESENTATION_LIVE_SCHEMA_VERSION = 2 as const;
export const PRESENTATION_CONTROLLER_LEASE_MS = 30_000;
export const PRESENTATION_HEARTBEAT_MS = 10_000;
export const PRESENTATION_POLL_MS = 1_100;
export const PRESENTATION_BACKGROUND_POLL_MS = 8_000;
export const MAX_OFFLINE_PRESENTATION_COMMANDS = 100;
export const MAX_STAGE_MESSAGE_LENGTH = 160;

const CLIENT_ID_KEY = "tchurch_live_installation_client_id";
const PRESENTATION_UUID_RFC4122_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_CACHE_IDENTITY_KEY = "tchurch_live_active_cache_identity";
const FALLBACK_PACKAGES_KEY = "tchurch_live_packages_v1";
const FALLBACK_OFFLINE_KEY = "tchurch_live_offline_v1";
const LIVE_DB_NAME = "tchurch_live";
const LIVE_DB_VERSION = 1;
const PACKAGE_STORE = "packages";
const OFFLINE_STORE = "offline_states";

export type PresentationLiveView = "operator" | "stage" | "remote" | "audience";
export type PresentationPrivateLiveView = Exclude<PresentationLiveView, "audience">;
export type PresentationSessionStatus = "live" | "ended";
export type PresentationTimerStatus = "running" | "paused";
export type PresentationNetworkState = "online" | "offline" | "reconnecting" | "diverged";

export type PresentationLiveViewer =
  | {
      view: "audience";
      canEdit: false;
      canStart: false;
      canControl: false;
      canForceTakeover: false;
    }
  | {
      view: PresentationPrivateLiveView;
      roles: PresentationTargetRole[];
      canEdit: boolean;
      canStart: boolean;
      canControl: boolean;
      canForceTakeover: boolean;
    };

export type PresentationController = {
  clientId: string;
  displayName: string;
  leaseExpiresAt: string;
  ownedByViewer: boolean;
};

export type PresentationPresence = {
  clientId: string;
  displayName: string;
  view: PresentationPrivateLiveView;
  lastSeenAt: string;
  controlRequestedAt: string | null;
};

export type PresentationCursor = {
  itemId: string | null;
  itemIndex: number;
  stepId: string | null;
  stepIndex: number;
  partIndex: number;
  sectionAnchorId: string | null;
};

export type PresentationDisplay = {
  blackout: boolean;
  chordsVisible: boolean;
  broadcastVisible: boolean;
};

export type PresentationTimer = {
  status: PresentationTimerStatus;
  plannedSeconds: number;
  elapsedSeconds: number;
  overrunSeconds: number;
  startedAt: string | null;
  pausedAt: string | null;
  accumulatedPausedMs: number;
};

export type PresentationServiceTimer = PresentationTimer & {
  remainingSeconds: number;
  projectedEndAt: string | null;
};

export type PresentationItemTimer = PresentationTimer & {
  itemId: string | null;
};

export type PresentationCountdown = {
  durationSeconds: number;
  targetAt: string;
  remainingSeconds: number;
};

export type PresentationTiming = {
  service: PresentationServiceTimer;
  item: PresentationItemTimer;
  countdown: PresentationCountdown | null;
};

export type PresentationStageMessage = {
  id: string;
  body: string;
  tone: "info" | "urgent";
  roles: PresentationTargetRole[];
  sentAt: string;
  expiresAt: string;
};

export type PresentationSession = {
  id: string;
  mode: "live" | "rehearsal";
  status: PresentationSessionStatus;
  revision: number;
  startedAt: string;
  endedAt: string | null;
  controller: PresentationController | null;
  presence?: PresentationPresence[];
  cursor: PresentationCursor;
  display: PresentationDisplay;
  playback: PresentationMediaPlayback | null;
  timing: PresentationTiming;
  messages: PresentationStageMessage[];
  lastCommand: {
    id: string;
    type: PresentationCommandType;
    at: string;
  } | null;
};

export type PresentationLiveSnapshot = {
  schemaVersion: 2;
  serviceId: string;
  serviceVersion: string;
  /** Opaque authorization/view fingerprint. Empty only while rolling against a legacy backend. */
  viewerVersion: string;
  /** Opaque controller/presence fingerprint. Empty only while rolling against a legacy backend. */
  controllerVersion: string;
  /** Stable controller session/owner/generation fingerprint. Empty values fail closed. */
  controllerAuthorityVersion: string;
  serverNow: string;
  viewer: PresentationLiveViewer;
  viewerLayout: PresentationViewerLayout | null;
  session: PresentationSession | null;
  /** Present only on an authoritative idempotent command response. */
  idempotent?: true;
  /** Local receipt time used only to project server clocks between revisions. */
  receivedAtMs: number;
};

export type PresentationViewerLayout = {
  schemaVersion: 3;
  id: string;
  name: string;
  targetRole: PresentationStageRole;
  mode: PresentationStageMode;
  fontScale: number;
  show: {
    current: boolean;
    next: boolean;
    notes: boolean;
    chords: boolean;
    clock: boolean;
    serviceTimer: boolean;
    itemTimer: boolean;
    messages: boolean;
  };
  version: number;
};

export type PresentationPlannedTiming = {
  serviceSeconds: number;
  itemSecondsById: Record<string, number>;
};

export type PresentationPackageLiveSeed = {
  cursor: PresentationCursor;
  display: PresentationDisplay;
  timing: PresentationTiming;
  countdown: PresentationCountdown | null;
};

export type PresentationPackage = {
  schemaVersion: 2;
  packageId: string;
  generatedAt: string;
  scope: {
    accountId: string;
    churchId: string;
    view: PresentationPrivateLiveView;
    roleFingerprint: string;
  };
  serviceVersion: string;
  service: PresentationService;
  presentation: PresentationWorkspace;
  plannedTiming: PresentationPlannedTiming;
  liveSeed: PresentationPackageLiveSeed;
  checksum: string;
};

export type PresentationCommandType =
  | "start_session"
  | "end_session"
  | "heartbeat"
  | "claim_control"
  | "request_control"
  | "handoff_control"
  | "release_control"
  | "next"
  | "previous"
  | "jump"
  | "set_blackout"
  | "set_chords"
  | "set_broadcast_visibility"
  | "timer_start"
  | "timer_pause"
  | "timer_reset"
  | "countdown_set"
  | "countdown_clear"
  | "media_play"
  | "media_pause"
  | "media_seek"
  | "media_restart"
  | "media_stop"
  | "stage_message_send"
  | "stage_message_dismiss"
  | "offline_reconcile";

export type PresentationMediaCommandType =
  | "media_play"
  | "media_pause"
  | "media_seek"
  | "media_restart"
  | "media_stop";

export type PresentationMediaCommandTarget = {
  sessionId: string;
  itemId: string;
  slideId: string;
};

export type PresentationMediaCursorAnchor = Pick<PresentationCursor, "itemId" | "stepId" | "partIndex">;

export type PresentationMediaCommandBinding = {
  target: PresentationMediaCommandTarget;
  activeCursor: PresentationMediaCursorAnchor;
  expectedRevision: number;
  playbackMatches: boolean;
};

export type PresentationOfflineCommandType =
  | "next"
  | "previous"
  | "jump"
  | "set_blackout"
  | "set_chords"
  | "timer_start"
  | "timer_pause"
  | "timer_reset"
  | "countdown_set"
  | "countdown_clear";

export type PresentationCommandPayloads = {
  start_session: Record<string, never>;
  end_session: Record<string, never>;
  heartbeat: Record<string, never>;
  claim_control: { force?: boolean };
  request_control: Record<string, never>;
  handoff_control: { targetClientId: string };
  release_control: Record<string, never>;
  next: Record<string, never>;
  previous: Record<string, never>;
  jump: { itemId: string; stepId?: string | null; partIndex?: number };
  set_blackout: { blackout: boolean };
  set_chords: { chordsVisible: boolean };
  set_broadcast_visibility: { visible: boolean };
  timer_start: { scope: "service" | "item" };
  timer_pause: { scope: "service" | "item" };
  timer_reset: { scope: "service" | "item" };
  countdown_set: { durationSeconds: number };
  countdown_clear: Record<string, never>;
  media_play: PresentationMediaCommandTarget & { kind: "video" | "audio" | "announcement"; positionMs: number; loop: boolean };
  media_pause: PresentationMediaCommandTarget;
  media_seek: PresentationMediaCommandTarget & { positionMs: number };
  media_restart: PresentationMediaCommandTarget;
  media_stop: PresentationMediaCommandTarget;
  stage_message_send: {
    body: string;
    tone: "info" | "urgent";
    lifetimeSeconds: number;
    roles: PresentationTargetRole[];
  };
  stage_message_dismiss: { messageId: string };
  offline_reconcile: {
    baseRevision: number;
    commands: PresentationQueuedCommand[];
  };
};

export type PresentationQueuedCommand<T extends PresentationOfflineCommandType = PresentationOfflineCommandType> = {
  commandId: string;
  type: T;
  payload: PresentationCommandPayloads[T];
};

export type PresentationCommandRequest<T extends PresentationCommandType = PresentationCommandType> = {
  schemaVersion: 2;
  clientId: string;
  clientName: string;
  commandId: string;
  expectedRevision?: number;
  type: T;
  payload: PresentationCommandPayloads[T];
};

export type PresentationCommandTransportOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

const PRESENTATION_MEDIA_COMMAND_TYPES = new Set<PresentationMediaCommandType>([
  "media_play",
  "media_pause",
  "media_seek",
  "media_restart",
  "media_stop",
]);

export function isPresentationMediaCommandType(type: PresentationCommandType): type is PresentationMediaCommandType {
  return PRESENTATION_MEDIA_COMMAND_TYPES.has(type as PresentationMediaCommandType);
}

export function bindPresentationMediaCommand(params: {
  snapshot: PresentationLiveSnapshot | null;
  activeCursor: PresentationMediaCursorAnchor | null;
  itemId: string;
  slideId: string;
  kind: PresentationMediaPlayback["kind"];
}): PresentationMediaCommandBinding | null {
  const session = params.snapshot?.session;
  const activeCursor = params.activeCursor;
  if (
    !session
    || !activeCursor
    || activeCursor.itemId !== params.itemId
    || session.cursor.itemId !== activeCursor.itemId
    || session.cursor.stepId !== activeCursor.stepId
    || session.cursor.partIndex !== activeCursor.partIndex
  ) return null;
  const target = { sessionId: session.id, itemId: params.itemId, slideId: params.slideId };
  return {
    target,
    activeCursor: {
      itemId: activeCursor.itemId,
      stepId: activeCursor.stepId,
      partIndex: activeCursor.partIndex,
    },
    expectedRevision: session.revision,
    playbackMatches: session.playback?.itemId === target.itemId
      && session.playback.slideId === target.slideId
      && session.playback.kind === params.kind,
  };
}

export function assertPresentationMediaCommandBound<T extends PresentationMediaCommandType>(params: {
  snapshot: PresentationLiveSnapshot | null;
  type: T;
  payload: PresentationCommandPayloads[T];
  binding: PresentationMediaCommandBinding | undefined;
}) {
  const session = params.snapshot?.session;
  if (!session) throw new Error("La sesión multimedia ya no está activa.");
  const binding = params.binding;
  if (!binding) {
    throw new Error("Actualiza la presentación antes de usar este control multimedia.");
  }
  if (binding.expectedRevision !== session.revision) {
    throw new Error("La presentación cambió antes de aplicar el control multimedia.");
  }
  const target = params.payload as PresentationMediaCommandTarget;
  if (
    binding.target.sessionId !== target.sessionId
    || binding.target.itemId !== target.itemId
    || binding.target.slideId !== target.slideId
  ) {
    throw new Error("El control multimedia ya no corresponde al contenido renderizado.");
  }
  if (target.sessionId !== session.id) {
    throw new Error("Este control multimedia pertenece a otra sesión.");
  }
  if (
    target.itemId !== session.cursor.itemId
    || binding.activeCursor.itemId !== target.itemId
    || binding.activeCursor.stepId !== session.cursor.stepId
    || binding.activeCursor.partIndex !== session.cursor.partIndex
  ) {
    throw new Error("El contenido en Program cambió antes de aplicar el control multimedia.");
  }
  if (
    params.type !== "media_play"
    && (session.playback?.itemId !== target.itemId || session.playback.slideId !== target.slideId)
  ) {
    throw new Error("La reproducción activa cambió antes de aplicar el control multimedia.");
  }
}

export function assertPresentationMediaCommandAcknowledged<T extends PresentationMediaCommandType>(params: {
  snapshot: PresentationLiveSnapshot;
  type: T;
  payload: PresentationCommandPayloads[T];
  binding: PresentationMediaCommandBinding;
}) {
  const session = params.snapshot.session;
  const target = params.payload as PresentationMediaCommandTarget;
  if (!session || session.id !== target.sessionId || session.id !== params.binding.target.sessionId) {
    throw new Error("La confirmación multimedia pertenece a otra sesión.");
  }
  if (session.revision <= params.binding.expectedRevision) {
    throw new Error("La confirmación multimedia no avanzó la revisión de la sesión.");
  }
  if (
    session.cursor.itemId !== target.itemId
    || params.binding.activeCursor.itemId !== target.itemId
    || session.cursor.stepId !== params.binding.activeCursor.stepId
    || session.cursor.partIndex !== params.binding.activeCursor.partIndex
  ) {
    throw new Error("Program cambió antes de confirmar el control multimedia.");
  }
  if (params.type === "media_stop") {
    if (session.playback !== null) throw new Error("El servidor no confirmó que la reproducción se detuvo.");
    return;
  }
  const playback = session.playback;
  if (!playback || playback.itemId !== target.itemId || playback.slideId !== target.slideId) {
    throw new Error("La confirmación multimedia apunta a otra reproducción.");
  }
  if (params.type === "media_play") {
    const payload = params.payload as PresentationCommandPayloads["media_play"];
    if (
      playback.kind !== payload.kind
      || playback.status !== "playing"
      || playback.positionMs !== payload.positionMs
      || playback.loop !== payload.loop
    ) throw new Error("El servidor no confirmó la reproducción solicitada.");
  } else if (params.type === "media_pause" && playback.status !== "paused") {
    throw new Error("El servidor no confirmó la pausa solicitada.");
  } else if (params.type === "media_seek") {
    const payload = params.payload as PresentationCommandPayloads["media_seek"];
    if (playback.positionMs !== payload.positionMs) throw new Error("El servidor no confirmó la posición solicitada.");
  } else if (params.type === "media_restart" && (playback.status !== "playing" || playback.positionMs !== 0)) {
    throw new Error("El servidor no confirmó el reinicio solicitado.");
  }
}

export type PresentationOfflineStep = {
  itemId: string;
  stepId: string | null;
  partIndex: number;
  sectionAnchorId: string | null;
};

export type PresentationOfflineContext = {
  steps: PresentationOfflineStep[];
  plannedTiming: PresentationPlannedTiming;
};

export type PresentationCacheScope = {
  accountId: string;
  churchId: string;
  serviceId: string;
  view: PresentationPrivateLiveView;
  roles: PresentationTargetRole[];
};

export type CachedPresentationPackage = {
  key: string;
  accountId: string;
  churchId: string;
  serviceId: string;
  view: PresentationPrivateLiveView;
  roleFingerprint: string;
  savedAt: string;
  package: PresentationPackage;
};

type StoredPresentationPackage = Omit<CachedPresentationPackage, "package"> & {
  rawPackage: unknown;
};

export type PresentationOfflineState = {
  key: string;
  packageKey: string;
  clientId: string;
  accountId: string;
  churchId: string;
  serviceId: string;
  view: PresentationPrivateLiveView;
  roleFingerprint: string;
  packageId: string;
  baseRevision: number;
  localSnapshot: PresentationLiveSnapshot;
  commands: PresentationQueuedCommand[];
  updatedAt: string;
};

const PRIVATE_VIEWS = new Set<PresentationPrivateLiveView>(["operator", "stage", "remote"]);
const TARGET_ROLES = new Set<PresentationTargetRole>([
  "worship_leader",
  "band",
  "vocals",
  "av",
  "speaker",
  "operator",
  "stage",
  "all",
]);
const COMMAND_TYPES = new Set<PresentationCommandType>([
  "start_session",
  "end_session",
  "heartbeat",
  "claim_control",
  "request_control",
  "handoff_control",
  "release_control",
  "next",
  "previous",
  "jump",
  "set_blackout",
  "set_chords",
  "set_broadcast_visibility",
  "timer_start",
  "timer_pause",
  "timer_reset",
  "countdown_set",
  "countdown_clear",
  "media_play",
  "media_pause",
  "media_seek",
  "media_restart",
  "media_stop",
  "stage_message_send",
  "stage_message_dismiss",
  "offline_reconcile",
]);
const OFFLINE_COMMAND_TYPES = new Set<PresentationOfflineCommandType>([
  "next",
  "previous",
  "jump",
  "set_blackout",
  "set_chords",
  "timer_start",
  "timer_pause",
  "timer_reset",
  "countdown_set",
  "countdown_clear",
]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sha256DigestValue(value: unknown) {
  const digest = stringValue(value);
  return /^sha256:[0-9a-f]{64}$/.test(digest) ? digest : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function integer(value: unknown, fallback = 0) {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

function isoValue(value: unknown, fallback: string | null = null) {
  const text = nullableString(value);
  return text && Number.isFinite(Date.parse(text)) ? text : fallback;
}

function normalizeRole(value: unknown): PresentationTargetRole | null {
  const token = String(value || "").trim().toLowerCase();
  return TARGET_ROLES.has(token as PresentationTargetRole) ? token as PresentationTargetRole : null;
}

function normalizeRoles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeRole).filter((role): role is PresentationTargetRole => Boolean(role)))];
}

function normalizeView(value: unknown, fallback: PresentationLiveView): PresentationLiveView {
  return value === "operator" || value === "stage" || value === "remote" || value === "audience" ? value : fallback;
}

function normalizeCursor(value: unknown): PresentationCursor {
  const raw = recordValue(value);
  return {
    itemId: nullableString(raw?.itemId),
    itemIndex: integer(raw?.itemIndex),
    stepId: nullableString(raw?.stepId),
    stepIndex: integer(raw?.stepIndex),
    partIndex: integer(raw?.partIndex),
    sectionAnchorId: nullableString(raw?.sectionAnchorId),
  };
}

function normalizeDisplay(value: unknown): PresentationDisplay {
  const raw = recordValue(value);
  return {
    blackout: raw?.blackout === true,
    chordsVisible: raw?.chordsVisible !== false,
    broadcastVisible: raw?.broadcastVisible !== false,
  };
}

function normalizeMediaPlayback(value: unknown): PresentationMediaPlayback | null {
  const raw = recordValue(value);
  const itemId = nullableString(raw?.itemId);
  const slideId = nullableString(raw?.slideId);
  const kind = raw?.kind;
  const status = raw?.status;
  if (!raw || !itemId || !slideId || (kind !== "video" && kind !== "audio" && kind !== "announcement") || (status !== "idle" && status !== "playing" && status !== "paused" && status !== "ended")) return null;
  return {
    itemId,
    slideId,
    kind,
    status,
    positionMs: integer(raw.positionMs),
    startedAt: isoValue(raw.startedAt),
    rate: 1,
    loop: raw.loop === true,
  };
}

function normalizeViewerLayout(value: unknown, viewer: PresentationLiveViewer): PresentationViewerLayout | null {
  if (viewer.view === "audience") return null;
  const raw = recordValue(value);
  const show = recordValue(raw?.show);
  const id = nullableString(raw?.id);
  const name = nullableString(raw?.name);
  const targetRole = raw?.targetRole;
  const mode = raw?.mode;
  const expectedRole = presentationStageRoleForViewer(viewer.roles, viewer.canEdit);
  if (
    !raw || raw.schemaVersion !== 3 || !show || !id || !name || targetRole !== expectedRole ||
    (mode !== "confidence" && mode !== "lyrics" && mode !== "speaker" && mode !== "production") ||
    typeof raw.fontScale !== "number" || !Number.isFinite(raw.fontScale) || raw.fontScale < 0.7 || raw.fontScale > 1.5
  ) return null;
  return {
    schemaVersion: 3,
    id,
    name,
    targetRole: expectedRole,
    mode,
    fontScale: raw.fontScale,
    show: {
      current: show.current === true,
      next: show.next === true,
      notes: show.notes === true,
      chords: show.chords === true,
      clock: show.clock === true,
      serviceTimer: show.serviceTimer === true,
      itemTimer: show.itemTimer === true,
      messages: show.messages === true,
    },
    version: integer(raw.version),
  };
}

function normalizeTimer(value: unknown): PresentationTimer {
  const raw = recordValue(value);
  return {
    status: raw?.status === "paused" ? "paused" : "running",
    plannedSeconds: nonNegativeNumber(raw?.plannedSeconds),
    elapsedSeconds: nonNegativeNumber(raw?.elapsedSeconds),
    overrunSeconds: nonNegativeNumber(raw?.overrunSeconds),
    startedAt: isoValue(raw?.startedAt),
    pausedAt: isoValue(raw?.pausedAt),
    accumulatedPausedMs: nonNegativeNumber(raw?.accumulatedPausedMs),
  };
}

function normalizeTiming(value: unknown): PresentationTiming {
  const raw = recordValue(value);
  const serviceRaw = recordValue(raw?.service);
  const itemRaw = recordValue(raw?.item);
  const countdownRaw = recordValue(raw?.countdown);
  const service = normalizeTimer(serviceRaw);
  const item = normalizeTimer(itemRaw);
  const targetAt = isoValue(countdownRaw?.targetAt);
  return {
    service: {
      ...service,
      remainingSeconds: nonNegativeNumber(serviceRaw?.remainingSeconds, Math.max(0, service.plannedSeconds - service.elapsedSeconds)),
      projectedEndAt: isoValue(serviceRaw?.projectedEndAt),
    },
    item: {
      ...item,
      itemId: nullableString(itemRaw?.itemId),
    },
    countdown: countdownRaw && targetAt ? {
      durationSeconds: nonNegativeNumber(countdownRaw.durationSeconds),
      targetAt,
      remainingSeconds: nonNegativeNumber(countdownRaw.remainingSeconds),
    } : null,
  };
}

function normalizeController(value: unknown): PresentationController | null {
  const raw = recordValue(value);
  const controllerClientId = nullableString(raw?.clientId);
  const leaseExpiresAt = isoValue(raw?.leaseExpiresAt);
  if (!raw || !controllerClientId || !leaseExpiresAt) return null;
  return {
    clientId: controllerClientId,
    displayName: stringValue(raw.displayName, "Otro dispositivo"),
    leaseExpiresAt,
    ownedByViewer: raw.ownedByViewer === true,
  };
}

function normalizePresence(value: unknown): PresentationPresence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const raw = recordValue(candidate);
    const clientId = nullableString(raw?.clientId);
    const lastSeenAt = isoValue(raw?.lastSeenAt);
    const view = normalizeView(raw?.view, "stage");
    if (!raw || !clientId || !lastSeenAt || view === "audience") return [];
    return [{
      clientId,
      displayName: stringValue(raw.displayName, "Dispositivo"),
      view,
      lastSeenAt,
      controlRequestedAt: isoValue(raw.controlRequestedAt),
    }];
  }).slice(0, 50);
}

function rolesCanSeeMessage(messageRoles: PresentationTargetRole[], viewerRoles: PresentationTargetRole[]) {
  if (!messageRoles.length || messageRoles.includes("all") || viewerRoles.includes("all")) return true;
  const viewers = new Set(viewerRoles);
  return messageRoles.some((role) => viewers.has(role));
}

function normalizeMessages(value: unknown, viewer: PresentationLiveViewer, serverNow: string): PresentationStageMessage[] {
  if (viewer.view === "audience" || !Array.isArray(value)) return [];
  const nowMs = Date.parse(serverNow);
  return value.flatMap((candidate) => {
    const raw = recordValue(candidate);
    const id = nullableString(raw?.id);
    const body = stringValue(raw?.body).slice(0, MAX_STAGE_MESSAGE_LENGTH);
    const sentAt = isoValue(raw?.sentAt);
    const expiresAt = isoValue(raw?.expiresAt);
    const roles = normalizeRoles(raw?.roles);
    if (!raw || !id || !body || !sentAt || !expiresAt || Date.parse(expiresAt) <= nowMs) return [];
    if (!rolesCanSeeMessage(roles, viewer.roles)) return [];
    return [{ id, body, tone: raw.tone === "urgent" ? "urgent" as const : "info" as const, roles, sentAt, expiresAt }];
  });
}

export function getPresentationViewerRoles(viewer: PresentationLiveViewer | null | undefined) {
  return viewer && viewer.view !== "audience" ? viewer.roles : [];
}

export function normalizePresentationLiveSnapshot(
  value: unknown,
  requestedView: PresentationLiveView,
  clientId?: string,
  receivedAtMs = Date.now(),
  expectedMode?: "live" | "rehearsal",
): PresentationLiveSnapshot {
  const raw = recordValue(value);
  if (!raw) throw new Error("La sesión en vivo devolvió una respuesta inválida.");
  const viewerRaw = recordValue(raw.viewer);
  const view = normalizeView(viewerRaw?.view, requestedView);
  const viewer: PresentationLiveViewer = view === "audience" ? {
    view,
    canEdit: false,
    canStart: false,
    canControl: false,
    canForceTakeover: false,
  } : {
    view,
    roles: normalizeRoles(viewerRaw?.roles),
    canEdit: viewerRaw?.canEdit === true,
    canStart: viewerRaw?.canStart === true,
    canControl: viewerRaw?.canControl === true,
    canForceTakeover: viewerRaw?.canForceTakeover === true,
  };
  const serverNow = isoValue(raw.serverNow, new Date(receivedAtMs).toISOString())!;
  const sessionRaw = recordValue(raw.session);
  let session: PresentationSession | null = null;

  if (sessionRaw) {
    const sessionMode = sessionRaw.mode === "live" || sessionRaw.mode === "rehearsal" ? sessionRaw.mode : null;
    if (expectedMode && sessionMode !== expectedMode) {
      throw new Error(`SESSION_MODE_MISMATCH: se esperaba ${expectedMode} y la sesión devolvió ${sessionMode || "sin modo"}.`);
    }
    const timing = normalizeTiming(sessionRaw.timing);
    const lastCommandRaw = recordValue(sessionRaw.lastCommand);
    const lastCommandType = lastCommandRaw && COMMAND_TYPES.has(lastCommandRaw.type as PresentationCommandType)
      ? lastCommandRaw.type as PresentationCommandType
      : null;
    session = {
      id: stringValue(sessionRaw.id),
      mode: sessionMode || "live",
      status: sessionRaw.status === "ended" ? "ended" : "live",
      revision: integer(sessionRaw.revision),
      startedAt: isoValue(sessionRaw.startedAt, serverNow)!,
      endedAt: isoValue(sessionRaw.endedAt),
      controller: normalizeController(sessionRaw.controller),
      ...(view === "operator" || view === "remote" ? { presence: normalizePresence(sessionRaw.presence) } : {}),
      cursor: normalizeCursor(sessionRaw.cursor),
      display: normalizeDisplay(sessionRaw.display),
      playback: normalizeMediaPlayback(sessionRaw.playback),
      timing,
      messages: normalizeMessages(sessionRaw.messages, viewer, serverNow),
      lastCommand: lastCommandRaw && lastCommandType ? {
        id: stringValue(lastCommandRaw.id),
        type: lastCommandType,
        at: isoValue(lastCommandRaw.at, serverNow)!,
      } : null,
    };

    if (view === "audience") {
      session.controller = null;
      session.messages = [];
      delete session.presence;
    }
  }

  return {
    schemaVersion: PRESENTATION_LIVE_SCHEMA_VERSION,
    serviceId: stringValue(raw.serviceId),
    serviceVersion: stringValue(raw.serviceVersion),
    viewerVersion: stringValue(raw.viewerVersion),
    controllerVersion: stringValue(raw.controllerVersion),
    controllerAuthorityVersion: sha256DigestValue(raw.controllerAuthorityVersion),
    serverNow,
    viewer,
    viewerLayout: normalizeViewerLayout(raw.viewerLayout, viewer),
    session,
    ...(raw.idempotent === true ? { idempotent: true as const } : {}),
    receivedAtMs,
  };
}

function projectedElapsed(timer: PresentationTimer, serverNowMs: number) {
  const startedAtMs = timer.startedAt ? Date.parse(timer.startedAt) : Number.NaN;
  if (!Number.isFinite(startedAtMs)) return timer.elapsedSeconds;
  const effectiveNowMs = timer.status === "paused" && timer.pausedAt
    ? Date.parse(timer.pausedAt)
    : serverNowMs;
  return Math.max(0, (effectiveNowMs - startedAtMs - timer.accumulatedPausedMs) / 1_000);
}

export function projectPresentationTiming(snapshot: PresentationLiveSnapshot | null, localNowMs = Date.now()): PresentationTiming | null {
  const timing = snapshot?.session?.timing;
  if (!snapshot || !timing) return null;
  const serverNowAtReceipt = Date.parse(snapshot.serverNow);
  const projectedServerNow = Number.isFinite(serverNowAtReceipt)
    ? serverNowAtReceipt + Math.max(0, localNowMs - snapshot.receivedAtMs)
    : localNowMs;
  const serviceElapsed = projectedElapsed(timing.service, projectedServerNow);
  const itemElapsed = projectedElapsed(timing.item, projectedServerNow);
  const serviceRemaining = Math.max(0, timing.service.plannedSeconds - serviceElapsed);
  const itemOverrun = Math.max(0, itemElapsed - timing.item.plannedSeconds);
  const itemElapsedAtReceipt = projectedElapsed(
    timing.item,
    Number.isFinite(serverNowAtReceipt) ? serverNowAtReceipt : projectedServerNow,
  );
  const itemOverrunAtReceipt = Math.max(
    timing.item.overrunSeconds,
    itemElapsedAtReceipt - timing.item.plannedSeconds,
  );
  const incrementalItemOverrun = Math.max(0, itemOverrun - itemOverrunAtReceipt);
  const baseProjectedEndMs = timing.service.projectedEndAt
    ? Date.parse(timing.service.projectedEndAt)
    : Number.NaN;
  const projectedEndAt = Number.isFinite(baseProjectedEndMs)
    ? new Date(baseProjectedEndMs + incrementalItemOverrun * 1_000).toISOString()
    : timing.service.projectedEndAt;
  const countdownRemaining = timing.countdown
    ? Math.max(0, (Date.parse(timing.countdown.targetAt) - projectedServerNow) / 1_000)
    : 0;

  return {
    service: {
      ...timing.service,
      elapsedSeconds: serviceElapsed,
      remainingSeconds: serviceRemaining,
      overrunSeconds: Math.max(0, serviceElapsed - timing.service.plannedSeconds),
      projectedEndAt,
    },
    item: {
      ...timing.item,
      elapsedSeconds: itemElapsed,
      overrunSeconds: itemOverrun,
    },
    countdown: timing.countdown ? {
      ...timing.countdown,
      remainingSeconds: countdownRemaining,
    } : null,
  };
}

export function getPresentationClientId(storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  const saved = storage.getItem(CLIENT_ID_KEY)?.trim();
  if (saved && isPresentationUuid(saved)) {
    const normalized = saved.toLowerCase();
    if (normalized !== saved) storage.setItem(CLIENT_ID_KEY, normalized);
    return normalized;
  }
  let id = createPresentationId().toLowerCase();
  // randomUUID is required to return an RFC 4122 UUID. Keep the installation
  // identity fail-closed if a polyfill violates that contract.
  if (!isPresentationUuid(id)) id = formatPresentationUuidV4(cryptoRandomBytes());
  storage.setItem(CLIENT_ID_KEY, id);
  return id;
}

export function isPresentationUuid(value: unknown): value is string {
  return typeof value === "string" && PRESENTATION_UUID_RFC4122_PATTERN.test(value);
}

export function formatPresentationUuidV4(randomBytes: ArrayLike<number>) {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => Number(randomBytes[index] || 0) & 0xff);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cryptoRandomBytes() {
  const bytes = new Uint8Array(16);
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

export function createPresentationId() {
  const cryptoApi = typeof globalThis !== "undefined"
    ? globalThis.crypto as Crypto & { randomUUID?: () => string }
    : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return formatPresentationUuidV4(cryptoRandomBytes());
}

export function getPresentationClientName() {
  if (typeof navigator === "undefined") return "Tchurch Live";
  const platform = `${navigator.userAgent || ""} ${navigator.platform || ""}`;
  if (/iPad|Macintosh.*Mobile/i.test(platform)) return "Tchurch iPad";
  if (/iPhone/i.test(platform)) return "Tchurch iPhone";
  return "Tchurch Live";
}

export function presentationSessionPath(
  serviceId: string,
  view: PresentationLiveView,
  clientId: string,
  sinceRevision?: number,
  viewerVersion?: string,
  controllerVersion?: string,
) {
  const query = new URLSearchParams({ view, clientId });
  if (typeof sinceRevision === "number") query.set("sinceRevision", String(Math.max(0, Math.floor(sinceRevision))));
  if (viewerVersion?.trim()) query.set("viewerVersion", viewerVersion.trim());
  if (controllerVersion?.trim()) query.set("controllerVersion", controllerVersion.trim());
  return `/services/${encodeURIComponent(serviceId)}/presentation-session?${query.toString()}`;
}

export function presentationRehearsalSessionPath(
  serviceId: string,
  view: PresentationLiveView,
  clientId: string,
  sinceRevision?: number,
  viewerVersion?: string,
  controllerVersion?: string,
) {
  const query = new URLSearchParams({ view, clientId });
  if (typeof sinceRevision === "number") query.set("sinceRevision", String(Math.max(0, Math.floor(sinceRevision))));
  if (viewerVersion?.trim()) query.set("viewerVersion", viewerVersion.trim());
  if (controllerVersion?.trim()) query.set("controllerVersion", controllerVersion.trim());
  return `/services/${encodeURIComponent(serviceId)}/presentation-rehearsal-session?${query.toString()}`;
}

export async function fetchPresentationLiveSnapshot(
  serviceId: string,
  view: PresentationLiveView,
  clientId: string,
  sinceRevision?: number,
  viewerVersion?: string,
  controllerVersion?: string,
) {
  const raw = await apiFetch<unknown>(presentationSessionPath(serviceId, view, clientId, sinceRevision, viewerVersion, controllerVersion), { cache: "no-store" });
  return raw === undefined ? null : normalizePresentationLiveSnapshot(raw, view, clientId, Date.now(), "live");
}

export async function fetchPresentationRehearsalSnapshot(
  serviceId: string,
  view: PresentationLiveView,
  clientId: string,
  sinceRevision?: number,
  viewerVersion?: string,
  controllerVersion?: string,
) {
  const raw = await apiFetch<unknown>(presentationRehearsalSessionPath(serviceId, view, clientId, sinceRevision, viewerVersion, controllerVersion), { cache: "no-store" });
  return raw === undefined ? null : normalizePresentationLiveSnapshot(raw, view, clientId, Date.now(), "rehearsal");
}

export async function sendPresentationCommand<T extends PresentationCommandType>(
  serviceId: string,
  request: PresentationCommandRequest<T>,
  view: PresentationLiveView,
  transport?: PresentationCommandTransportOptions,
) {
  const raw = await apiFetch<unknown>(`/services/${encodeURIComponent(serviceId)}/presentation-session?view=${view}`, {
    method: "POST",
    body: JSON.stringify(request),
    signal: transport?.signal,
    timeoutMs: transport?.timeoutMs,
  });
  const responseRaw = recordValue(raw);
  const snapshotRaw = responseRaw?.snapshot || responseRaw?.current || raw;
  const snapshot = normalizePresentationLiveSnapshot(snapshotRaw, view, request.clientId, Date.now(), "live");
  return responseRaw?.idempotent === true && snapshot.idempotent !== true
    ? { ...snapshot, idempotent: true as const }
    : snapshot;
}

export async function sendPresentationRehearsalCommand<T extends PresentationCommandType>(
  serviceId: string,
  request: PresentationCommandRequest<T>,
  view: PresentationLiveView,
  transport?: PresentationCommandTransportOptions,
) {
  const raw = await apiFetch<unknown>(`/services/${encodeURIComponent(serviceId)}/presentation-rehearsal-session?view=${view}`, {
    method: "POST",
    body: JSON.stringify(request),
    signal: transport?.signal,
    timeoutMs: transport?.timeoutMs,
  });
  const responseRaw = recordValue(raw);
  const snapshotRaw = responseRaw?.snapshot || responseRaw?.current || raw;
  const snapshot = normalizePresentationLiveSnapshot(snapshotRaw, view, request.clientId, Date.now(), "rehearsal");
  return responseRaw?.idempotent === true && snapshot.idempotent !== true
    ? { ...snapshot, idempotent: true as const }
    : snapshot;
}

function normalizePresentationService(value: unknown): PresentationService {
  const raw = recordValue(value);
  const id = nullableString(raw?.id);
  const title = nullableString(raw?.title);
  const date = isoValue(raw?.date);
  if (!raw || !id || !title || !date) throw new Error("El paquete offline no contiene un servicio válido.");
  const items = Array.isArray(raw.items) ? raw.items.flatMap((candidate) => {
    const item = recordValue(candidate);
    const itemId = nullableString(item?.id);
    if (!item || !itemId) return [];
    return [{
      id: itemId,
      title: stringValue(item.title, "Elemento"),
      type: stringValue(item.type, "other"),
      position: integer(item.position),
      duration: typeof item.duration === "number" && Number.isFinite(item.duration) ? item.duration : null,
      details: recordValue(item.details),
      song: recordValue(item.song) as PresentationService["items"][number]["song"],
    }];
  }) : [];
  return {
    id,
    title,
    date,
    type: stringValue(raw.type, "service"),
    notes: nullableString(raw.notes),
    items: items.sort((a, b) => a.position - b.position),
    assignments: Array.isArray(raw.assignments) ? raw.assignments as PresentationService["assignments"] : undefined,
  };
}

export function normalizePresentationPackage(value: unknown, view: PresentationPrivateLiveView): PresentationPackage {
  const raw = recordValue(value);
  const packageId = nullableString(raw?.packageId);
  const checksum = nullableString(raw?.checksum);
  const generatedAt = isoValue(raw?.generatedAt);
  const serviceVersion = nullableString(raw?.serviceVersion);
  const scopeRaw = recordValue(raw?.scope);
  const scopeView = PRIVATE_VIEWS.has(scopeRaw?.view as PresentationPrivateLiveView)
    ? scopeRaw?.view as PresentationPrivateLiveView
    : null;
  const scopeAccountId = nullableString(scopeRaw?.accountId);
  const scopeChurchId = nullableString(scopeRaw?.churchId);
  const scopeRoleFingerprint = nullableString(scopeRaw?.roleFingerprint);
  if (
    !raw ||
    raw.schemaVersion !== PRESENTATION_LIVE_SCHEMA_VERSION ||
    !packageId?.startsWith("sha256:") ||
    !checksum?.startsWith("sha256:") ||
    !generatedAt ||
    !serviceVersion ||
    !scopeRaw ||
    !scopeAccountId ||
    !scopeChurchId ||
    !scopeView ||
    !scopeRoleFingerprint
  ) {
    throw new Error("Tchurch recibió un paquete offline inválido.");
  }
  const service = normalizePresentationService(raw.service);
  const presentationView = view === "operator" ? "operator" : "stage";
  const presentation = normalizePresentationWorkspace(raw.presentation, service, presentationView);
  const timingRaw = recordValue(raw.plannedTiming);
  const itemSecondsRaw = recordValue(timingRaw?.itemSecondsById);
  const itemSecondsById = Object.fromEntries(
    Object.entries(itemSecondsRaw || {}).flatMap(([itemId, seconds]) =>
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? [[itemId, seconds]] : []
    ),
  );
  const liveSeedRaw = recordValue(raw.liveSeed);
  if (!liveSeedRaw) throw new Error("El paquete offline no contiene el estado inicial en vivo.");
  const timing = normalizeTiming({
    ...recordValue(liveSeedRaw.timing),
    countdown: liveSeedRaw.countdown,
  });
  return {
    schemaVersion: PRESENTATION_LIVE_SCHEMA_VERSION,
    packageId,
    generatedAt,
    scope: {
      accountId: scopeAccountId,
      churchId: scopeChurchId,
      view: scopeView,
      roleFingerprint: scopeRoleFingerprint,
    },
    serviceVersion,
    service,
    presentation,
    plannedTiming: {
      serviceSeconds: nonNegativeNumber(timingRaw?.serviceSeconds),
      itemSecondsById,
    },
    liveSeed: {
      cursor: normalizeCursor(liveSeedRaw.cursor),
      display: normalizeDisplay(liveSeedRaw.display),
      timing,
      countdown: timing.countdown,
    },
    checksum,
  };
}

function stableCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(record[key])}`).join(",")}}`;
}

export function canonicalPresentationPackageJson(value: unknown) {
  const raw = recordValue(value);
  if (!raw) throw new Error("Tchurch recibió un paquete offline inválido.");
  return stableCanonicalJson({
    schemaVersion: raw.schemaVersion,
    scope: raw.scope,
    serviceVersion: raw.serviceVersion,
    service: raw.service,
    presentation: raw.presentation,
    plannedTiming: raw.plannedTiming,
    liveSeed: raw.liveSeed,
  });
}

export async function computePresentationPackageDigest(value: unknown) {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!cryptoApi?.subtle) return null;
  const encoded = new TextEncoder().encode(canonicalPresentationPackageJson(value));
  const hash = await cryptoApi.subtle.digest("SHA-256", encoded);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function verifyPresentationPackageIntegrity(value: unknown) {
  const raw = recordValue(value);
  const packageId = nullableString(raw?.packageId);
  const checksum = nullableString(raw?.checksum);
  if (!packageId || !checksum || packageId !== checksum || !/^sha256:[0-9a-f]{64}$/.test(packageId)) return false;
  const digest = await computePresentationPackageDigest(value);
  return digest !== null && digest === packageId;
}

const verifiedPackageSources = new WeakMap<PresentationPackage, unknown>();

export async function fetchPresentationPackage(serviceId: string, view: PresentationPrivateLiveView) {
  const raw = await apiFetch<unknown>(
    `/services/${encodeURIComponent(serviceId)}/presentation-package?view=${view}`,
    { cache: "no-store" },
  );
  const normalized = normalizePresentationPackage(raw, view);
  const digest = await computePresentationPackageDigest(raw);
  if (digest !== null && (digest !== normalized.packageId || normalized.packageId !== normalized.checksum)) {
    throw new Error("No se pudo verificar la integridad del paquete offline. No se guardó contenido privado.");
  }
  if (digest !== null) verifiedPackageSources.set(normalized, raw);
  return normalized;
}

export function buildPresentationCommand<T extends PresentationCommandType>(
  clientId: string,
  clientName: string,
  type: T,
  payload: PresentationCommandPayloads[T],
  expectedRevision?: number,
  commandId = createPresentationId(),
): PresentationCommandRequest<T> {
  return {
    schemaVersion: PRESENTATION_LIVE_SCHEMA_VERSION,
    clientId,
    clientName,
    commandId,
    ...(typeof expectedRevision === "number" ? { expectedRevision } : {}),
    type,
    payload,
  };
}

export function isOfflinePresentationCommand(type: PresentationCommandType): type is PresentationOfflineCommandType {
  return OFFLINE_COMMAND_TYPES.has(type as PresentationOfflineCommandType);
}

function projectSnapshotAt(snapshot: PresentationLiveSnapshot, nowMs: number) {
  const timing = projectPresentationTiming(snapshot, nowMs);
  if (!snapshot.session || !timing) return snapshot;
  return {
    ...snapshot,
    serverNow: new Date(Date.parse(snapshot.serverNow) + Math.max(0, nowMs - snapshot.receivedAtMs)).toISOString(),
    receivedAtMs: nowMs,
    session: { ...snapshot.session, timing },
  };
}

function startTimer(timer: PresentationTimer, now: string): PresentationTimer {
  if (!timer.startedAt) return { ...timer, status: "running", startedAt: now, pausedAt: null, accumulatedPausedMs: 0, elapsedSeconds: 0, overrunSeconds: 0 };
  const pausedFor = timer.pausedAt ? Math.max(0, Date.parse(now) - Date.parse(timer.pausedAt)) : 0;
  return {
    ...timer,
    status: "running",
    pausedAt: null,
    accumulatedPausedMs: timer.accumulatedPausedMs + pausedFor,
  };
}

function pauseTimer(timer: PresentationTimer, now: string): PresentationTimer {
  return timer.status === "paused" ? timer : { ...timer, status: "paused", pausedAt: now };
}

function resetTimer(timer: PresentationTimer): PresentationTimer {
  return { ...timer, status: "paused", elapsedSeconds: 0, overrunSeconds: 0, startedAt: null, pausedAt: null, accumulatedPausedMs: 0 };
}

function withTimerUpdate(
  timing: PresentationTiming,
  scope: "service" | "item",
  update: (timer: PresentationTimer) => PresentationTimer,
): PresentationTiming {
  if (scope === "service") {
    const next = update(timing.service);
    return {
      ...timing,
      service: {
        ...timing.service,
        ...next,
        remainingSeconds: Math.max(0, next.plannedSeconds - next.elapsedSeconds),
        projectedEndAt: timing.service.projectedEndAt,
      },
    };
  }
  return { ...timing, item: { ...timing.item, ...update(timing.item) } };
}

function moveOfflineCursor(
  cursor: PresentationCursor,
  type: "next" | "previous" | "jump",
  payload: unknown,
  context: PresentationOfflineContext,
) {
  if (!context.steps.length) return cursor;
  let nextIndex = resolvePresentationCursorIndex(cursor, context.steps);
  if (type === "next") nextIndex = Math.min(context.steps.length - 1, nextIndex + 1);
  if (type === "previous") nextIndex = Math.max(0, nextIndex - 1);
  if (type === "jump") {
    const jump = payload as PresentationCommandPayloads["jump"];
    const found = context.steps.findIndex((step) =>
      step.itemId === jump.itemId &&
      (jump.stepId == null || step.stepId === jump.stepId) &&
      (typeof jump.partIndex !== "number" || step.partIndex === jump.partIndex)
    );
    if (found >= 0) nextIndex = found;
  }
  const step = context.steps[nextIndex];
  const itemStepIds = new Set<string>();
  for (const candidate of context.steps.slice(0, nextIndex + 1)) {
    if (candidate.itemId !== step.itemId) continue;
    itemStepIds.add(candidate.stepId || "__cue__");
  }
  return {
    itemId: step.itemId,
    itemIndex: new Set(context.steps.slice(0, nextIndex + 1).map((candidate) => candidate.itemId)).size - 1,
    stepId: step.stepId,
    stepIndex: Math.max(0, itemStepIds.size - 1),
    partIndex: step.partIndex,
    sectionAnchorId: step.sectionAnchorId,
  };
}

export function resolvePresentationCursorIndex(
  cursor: PresentationCursor,
  steps: PresentationOfflineStep[],
) {
  if (!steps.length) return 0;
  const exact = steps.findIndex((step) =>
    step.itemId === cursor.itemId &&
    step.stepId === cursor.stepId &&
    step.partIndex === cursor.partIndex
  );
  if (exact >= 0) return exact;
  const sameStepIndexes = steps.flatMap((step, index) =>
    step.itemId === cursor.itemId && step.stepId === cursor.stepId ? [index] : []
  );
  if (sameStepIndexes.length) return sameStepIndexes[Math.min(cursor.partIndex, sameStepIndexes.length - 1)];
  if (cursor.sectionAnchorId) {
    const bySection = steps.findIndex((step) => step.itemId === cursor.itemId && step.sectionAnchorId === cursor.sectionAnchorId);
    if (bySection >= 0) return bySection;
  }
  const byItem = steps.findIndex((step) => step.itemId === cursor.itemId);
  return byItem >= 0 ? byItem : 0;
}

export function applyOfflinePresentationCommand<T extends PresentationOfflineCommandType>(
  snapshot: PresentationLiveSnapshot,
  command: PresentationQueuedCommand<T>,
  context: PresentationOfflineContext,
  nowMs = Date.now(),
): PresentationLiveSnapshot {
  const projected = projectSnapshotAt(snapshot, nowMs);
  if (!projected.session) return projected;
  const session = projected.session;
  let cursor = session.cursor;
  let display = session.display;
  let timing = session.timing;
  const now = projected.serverNow;

  if (command.type === "next" || command.type === "previous" || command.type === "jump") {
    const previousItemId = cursor.itemId;
    cursor = moveOfflineCursor(cursor, command.type, command.payload, context);
    if (cursor.itemId !== previousItemId) {
      const plannedSeconds = context.plannedTiming.itemSecondsById[cursor.itemId || ""] || 0;
      timing = {
        ...timing,
        item: {
          itemId: cursor.itemId,
          status: timing.service.status,
          plannedSeconds,
          elapsedSeconds: 0,
          overrunSeconds: 0,
          startedAt: now,
          pausedAt: timing.service.status === "paused" ? now : null,
          accumulatedPausedMs: 0,
        },
      };
    }
  } else if (command.type === "set_blackout") {
    display = { ...display, blackout: (command.payload as PresentationCommandPayloads["set_blackout"]).blackout };
  } else if (command.type === "set_chords") {
    display = { ...display, chordsVisible: (command.payload as PresentationCommandPayloads["set_chords"]).chordsVisible };
  } else if (command.type === "timer_start") {
    timing = withTimerUpdate(timing, (command.payload as PresentationCommandPayloads["timer_start"]).scope, (timer) => startTimer(timer, now));
  } else if (command.type === "timer_pause") {
    timing = withTimerUpdate(timing, (command.payload as PresentationCommandPayloads["timer_pause"]).scope, (timer) => pauseTimer(timer, now));
  } else if (command.type === "timer_reset") {
    timing = withTimerUpdate(timing, (command.payload as PresentationCommandPayloads["timer_reset"]).scope, resetTimer);
  } else if (command.type === "countdown_set") {
    const durationSeconds = Math.max(5, Math.min(86_400, Math.floor((command.payload as PresentationCommandPayloads["countdown_set"]).durationSeconds)));
    timing = {
      ...timing,
      countdown: { durationSeconds, remainingSeconds: durationSeconds, targetAt: new Date(Date.parse(now) + durationSeconds * 1_000).toISOString() },
    };
  } else if (command.type === "countdown_clear") {
    timing = { ...timing, countdown: null };
  }

  return {
    ...projected,
    session: {
      ...session,
      cursor,
      display,
      timing,
      lastCommand: { id: command.commandId, type: command.type, at: now },
    },
  };
}

function presentationOfflineStateMatchesClient(state: PresentationOfflineState, clientId: string) {
  const controller = state.localSnapshot?.session?.controller;
  return Boolean(
    clientId
    && state.clientId === clientId
    && controller?.ownedByViewer
    && controller.clientId === clientId,
  );
}

export function queueOfflinePresentationCommand<T extends PresentationOfflineCommandType>(
  state: PresentationOfflineState,
  command: PresentationQueuedCommand<T>,
  context: PresentationOfflineContext,
  clientId: string,
  nowMs = Date.now(),
): PresentationOfflineState {
  if (!isOfflinePresentationCommand(command.type as PresentationCommandType)) {
    throw new Error("Este control requiere conexión con la sesión oficial.");
  }
  if (!presentationOfflineStateMatchesClient(state, clientId)) {
    throw new Error("Este dispositivo no tenía el control cuando se perdió la conexión.");
  }
  if (state.commands.length >= MAX_OFFLINE_PRESENTATION_COMMANDS) {
    throw new Error("La cola offline llegó a 100 acciones. Reconecta antes de continuar.");
  }
  const commands = [...state.commands, command];
  return {
    ...state,
    localSnapshot: applyOfflinePresentationCommand(state.localSnapshot, command, context, nowMs),
    commands,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function buildOfflineReconcileCommand(
  state: PresentationOfflineState,
  clientId: string,
  clientName: string,
) {
  if (!presentationOfflineStateMatchesClient(state, clientId)) {
    throw new Error("La cola offline pertenece a otro dispositivo y no se puede reconciliar aquí.");
  }
  if (!state.commands.length) throw new Error("No hay acciones offline pendientes.");
  return buildPresentationCommand(
    clientId,
    clientName,
    "offline_reconcile",
    { baseRevision: state.baseRevision, commands: state.commands.slice(0, MAX_OFFLINE_PRESENTATION_COMMANDS) },
    state.baseRevision,
  );
}

export function presentationRoleFingerprint(roles: PresentationTargetRole[]) {
  return [...new Set(roles)].sort().join(",") || "none";
}

export function presentationWorkspaceMatchesLiveViewer(
  workspace: PresentationWorkspace | null | undefined,
  viewer: PresentationLiveViewer | null | undefined,
) {
  if (!workspace || !viewer || viewer.view === "audience") return false;
  return workspace.viewer.canEdit === viewer.canEdit
    && presentationRoleFingerprint(workspace.viewer.roles) === presentationRoleFingerprint(viewer.roles);
}

export function presentationPackageMatchesLiveViewer(
  presentationPackage: PresentationPackage | null | undefined,
  viewer: PresentationLiveViewer | null | undefined,
  scope: { accountId: string; churchId: string; serviceId: string },
) {
  if (!presentationPackage || !viewer || viewer.view === "audience") return false;
  return presentationPackage.scope.accountId === scope.accountId
    && presentationPackage.scope.churchId === scope.churchId
    && presentationPackage.service.id === scope.serviceId
    && presentationPackage.scope.view === viewer.view
    && presentationPackage.scope.roleFingerprint === presentationRoleFingerprint(viewer.roles)
    && presentationWorkspaceMatchesLiveViewer(presentationPackage.presentation, viewer);
}

export function presentationPackageCacheKey(scope: PresentationCacheScope) {
  return [scope.accountId, scope.churchId, scope.serviceId, scope.view, presentationRoleFingerprint(scope.roles)]
    .map((part) => encodeURIComponent(part))
    .join("::");
}

export function createPresentationOfflineState(
  cachedPackage: CachedPresentationPackage,
  snapshot: PresentationLiveSnapshot,
  clientId: string,
): PresentationOfflineState {
  if (!snapshot.session) throw new Error("No hay una sesión activa para continuar offline.");
  const controller = snapshot.session.controller;
  if (!controller?.ownedByViewer || controller.clientId !== clientId) {
    throw new Error("Este dispositivo no tiene el control exacto para continuar offline.");
  }
  return {
    key: cachedPackage.key,
    packageKey: cachedPackage.key,
    clientId,
    accountId: cachedPackage.accountId,
    churchId: cachedPackage.churchId,
    serviceId: cachedPackage.serviceId,
    view: cachedPackage.view,
    roleFingerprint: cachedPackage.roleFingerprint,
    packageId: cachedPackage.package.packageId,
    baseRevision: snapshot.session.revision,
    localSnapshot: snapshot,
    commands: [],
    updatedAt: new Date().toISOString(),
  };
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openLiveDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(LIVE_DB_NAME, LIVE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PACKAGE_STORE)) db.createObjectStore(PACKAGE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readFallbackRecords<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeFallbackRecord<T extends { key: string }>(storageKey: string, record: T) {
  const records = readFallbackRecords<T>(storageKey).filter((candidate) => candidate.key !== record.key);
  localStorage.setItem(storageKey, JSON.stringify([...records, record]));
}

async function putLiveRecord<T extends { key: string }>(storeName: string, fallbackKey: string, record: T) {
  if (!hasIndexedDb()) {
    writeFallbackRecord(fallbackKey, record);
    return;
  }
  const db = await openLiveDb();
  try {
    const transaction = db.transaction(storeName, "readwrite");
    const done = transactionPromise(transaction);
    transaction.objectStore(storeName).put(record);
    await done;
  } finally {
    db.close();
  }
}

async function getAllLiveRecords<T>(storeName: string, fallbackKey: string): Promise<T[]> {
  if (!hasIndexedDb()) return readFallbackRecords<T>(fallbackKey);
  const db = await openLiveDb();
  try {
    const transaction = db.transaction(storeName, "readonly");
    const done = transactionPromise(transaction);
    const records = await requestPromise<T[]>(transaction.objectStore(storeName).getAll());
    await done;
    return records;
  } finally {
    db.close();
  }
}

async function deleteLiveRecord(storeName: string, fallbackKey: string, key: string) {
  if (!hasIndexedDb()) {
    localStorage.setItem(fallbackKey, JSON.stringify(readFallbackRecords<{ key: string }>(fallbackKey).filter((record) => record.key !== key)));
    return;
  }
  const db = await openLiveDb();
  try {
    const transaction = db.transaction(storeName, "readwrite");
    const done = transactionPromise(transaction);
    transaction.objectStore(storeName).delete(key);
    await done;
  } finally {
    db.close();
  }
}

let presentationLiveCacheReset: Promise<void> = Promise.resolve();

async function clearPresentationLiveCacheStorage() {
  localStorage.removeItem(FALLBACK_PACKAGES_KEY);
  localStorage.removeItem(FALLBACK_OFFLINE_KEY);
  if (!hasIndexedDb()) return;
  const db = await openLiveDb();
  try {
    const transaction = db.transaction([PACKAGE_STORE, OFFLINE_STORE], "readwrite");
    const done = transactionPromise(transaction);
    transaction.objectStore(PACKAGE_STORE).clear();
    transaction.objectStore(OFFLINE_STORE).clear();
    await done;
  } finally {
    db.close();
  }
}

export function clearPresentationLiveCache() {
  const reset = presentationLiveCacheReset
    .catch(() => undefined)
    .then(clearPresentationLiveCacheStorage);
  presentationLiveCacheReset = reset.catch(() => undefined);
  return reset;
}

export async function purgePresentationCacheForViewerDowngrade(scope: PresentationCacheScope) {
  await activatePresentationCacheIdentity(scope.accountId, scope.churchId);
  const expectedRoleFingerprint = presentationRoleFingerprint(scope.roles);
  const packageRecords = await getAllLiveRecords<StoredPresentationPackage>(PACKAGE_STORE, FALLBACK_PACKAGES_KEY);
  const offlineRecords = await getAllLiveRecords<PresentationOfflineState>(OFFLINE_STORE, FALLBACK_OFFLINE_KEY);
  const stalePackageKeys = new Set(
    packageRecords
      .filter((record) =>
        record.accountId === scope.accountId
        && record.churchId === scope.churchId
        && record.serviceId === scope.serviceId
        && (record.view === "operator" || record.roleFingerprint !== expectedRoleFingerprint)
      )
      .map((record) => record.key),
  );

  for (const key of stalePackageKeys) {
    await deleteLiveRecord(PACKAGE_STORE, FALLBACK_PACKAGES_KEY, key);
  }
  for (const record of offlineRecords) {
    const staleScope = record.accountId === scope.accountId
      && record.churchId === scope.churchId
      && record.serviceId === scope.serviceId
      && (record.view === "operator" || record.roleFingerprint !== expectedRoleFingerprint);
    if (staleScope || stalePackageKeys.has(record.key)) {
      await deleteLiveRecord(OFFLINE_STORE, FALLBACK_OFFLINE_KEY, record.key);
    }
  }
}

export async function activatePresentationCacheIdentity(accountId: string, churchId: string) {
  await presentationLiveCacheReset;
  const identity = `${accountId}::${churchId}`;
  const previous = localStorage.getItem(ACTIVE_CACHE_IDENTITY_KEY);
  if (previous && previous !== identity) await clearPresentationLiveCache();
  localStorage.setItem(ACTIVE_CACHE_IDENTITY_KEY, identity);
}

export async function savePresentationPackage(scope: PresentationCacheScope, presentationPackage: PresentationPackage) {
  await activatePresentationCacheIdentity(scope.accountId, scope.churchId);
  const rawPackage = verifiedPackageSources.get(presentationPackage) || presentationPackage;
  const digest = await computePresentationPackageDigest(rawPackage);
  if (digest === null) {
    throw new Error("WebCrypto no está disponible; el paquete privado se mantiene sólo en memoria.");
  }
  const rawRecord = recordValue(rawPackage);
  if (digest !== rawRecord?.packageId || rawRecord?.packageId !== rawRecord?.checksum) {
    throw new Error("No se guardó el paquete porque su firma de contenido no coincide.");
  }
  const expectedRoleFingerprint = presentationRoleFingerprint(scope.roles);
  if (
    presentationPackage.scope.accountId !== scope.accountId ||
    presentationPackage.scope.churchId !== scope.churchId ||
    presentationPackage.scope.view !== scope.view ||
    presentationPackage.scope.roleFingerprint !== expectedRoleFingerprint ||
    presentationPackage.service.id !== scope.serviceId
  ) {
    throw new Error("No se guardó el paquete porque su alcance privado no coincide con la sesión actual.");
  }
  const key = presentationPackageCacheKey(scope);
  const record: CachedPresentationPackage = {
    key,
    accountId: scope.accountId,
    churchId: scope.churchId,
    serviceId: scope.serviceId,
    view: scope.view,
    roleFingerprint: presentationRoleFingerprint(scope.roles),
    savedAt: new Date().toISOString(),
    package: presentationPackage,
  };
  const stored: StoredPresentationPackage = {
    key: record.key,
    accountId: record.accountId,
    churchId: record.churchId,
    serviceId: record.serviceId,
    view: record.view,
    roleFingerprint: record.roleFingerprint,
    savedAt: record.savedAt,
    rawPackage,
  };
  await putLiveRecord(PACKAGE_STORE, FALLBACK_PACKAGES_KEY, stored);
  return record;
}

export function removePresentationPackage(packageKey: string) {
  return deleteLiveRecord(PACKAGE_STORE, FALLBACK_PACKAGES_KEY, packageKey);
}

export async function loadPresentationPackage(scope: PresentationCacheScope) {
  const key = presentationPackageCacheKey(scope);
  const records = await getAllLiveRecords<StoredPresentationPackage>(PACKAGE_STORE, FALLBACK_PACKAGES_KEY);
  const cached = records.find((record) => record.key === key);
  if (!cached) return null;
  try {
    if (!await verifyPresentationPackageIntegrity(cached.rawPackage)) throw new Error("Checksum mismatch");
    const presentationPackage = normalizePresentationPackage(cached.rawPackage, scope.view);
    const expectedRoleFingerprint = presentationRoleFingerprint(scope.roles);
    if (
      cached.accountId !== presentationPackage.scope.accountId ||
      cached.churchId !== presentationPackage.scope.churchId ||
      cached.serviceId !== presentationPackage.service.id ||
      cached.view !== presentationPackage.scope.view ||
      cached.roleFingerprint !== presentationPackage.scope.roleFingerprint ||
      presentationPackage.scope.accountId !== scope.accountId ||
      presentationPackage.scope.churchId !== scope.churchId ||
      presentationPackage.service.id !== scope.serviceId ||
      presentationPackage.scope.view !== scope.view ||
      presentationPackage.scope.roleFingerprint !== expectedRoleFingerprint
    ) {
      throw new Error("Scope mismatch");
    }
    return {
      key: cached.key,
      accountId: cached.accountId,
      churchId: cached.churchId,
      serviceId: cached.serviceId,
      view: cached.view,
      roleFingerprint: cached.roleFingerprint,
      savedAt: cached.savedAt,
      package: presentationPackage,
    };
  } catch {
    await deleteLiveRecord(PACKAGE_STORE, FALLBACK_PACKAGES_KEY, cached.key);
    return null;
  }
}

export async function loadLatestPresentationPackageForIdentity(
  accountId: string,
  churchId: string,
  serviceId: string,
  views: PresentationPrivateLiveView[],
  expectedRoleFingerprint?: string,
) {
  await activatePresentationCacheIdentity(accountId, churchId);
  const allowedViews = new Set(views);
  const records = await getAllLiveRecords<StoredPresentationPackage>(PACKAGE_STORE, FALLBACK_PACKAGES_KEY);
  const candidates = records
    .filter((record) =>
      record.accountId === accountId &&
      record.churchId === churchId &&
      record.serviceId === serviceId &&
      allowedViews.has(record.view) &&
      (!expectedRoleFingerprint || record.roleFingerprint === expectedRoleFingerprint)
    )
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  for (const cached of candidates) {
    try {
      if (!await verifyPresentationPackageIntegrity(cached.rawPackage)) throw new Error("Checksum mismatch");
      const presentationPackage = normalizePresentationPackage(cached.rawPackage, cached.view);
      if (
        cached.accountId !== presentationPackage.scope.accountId ||
        cached.churchId !== presentationPackage.scope.churchId ||
        cached.serviceId !== presentationPackage.service.id ||
        cached.view !== presentationPackage.scope.view ||
        cached.roleFingerprint !== presentationPackage.scope.roleFingerprint ||
        presentationPackage.scope.accountId !== accountId ||
        presentationPackage.scope.churchId !== churchId ||
        presentationPackage.service.id !== serviceId ||
        !allowedViews.has(presentationPackage.scope.view) ||
        (expectedRoleFingerprint && presentationPackage.scope.roleFingerprint !== expectedRoleFingerprint)
      ) {
        throw new Error("Scope mismatch");
      }
      return {
        key: cached.key,
        accountId: cached.accountId,
        churchId: cached.churchId,
        serviceId: cached.serviceId,
        view: cached.view,
        roleFingerprint: cached.roleFingerprint,
        savedAt: cached.savedAt,
        package: presentationPackage,
      };
    } catch {
      await deleteLiveRecord(PACKAGE_STORE, FALLBACK_PACKAGES_KEY, cached.key);
    }
  }
  return null;
}

export async function savePresentationOfflineState(state: PresentationOfflineState, clientId: string) {
  if (!presentationOfflineStateMatchesClient(state, clientId)) {
    throw new Error("La cola offline no pertenece a este dispositivo.");
  }
  await putLiveRecord(OFFLINE_STORE, FALLBACK_OFFLINE_KEY, state);
  return state;
}

export async function loadPresentationOfflineState(packageKey: string, clientId: string) {
  const records = await getAllLiveRecords<PresentationOfflineState>(OFFLINE_STORE, FALLBACK_OFFLINE_KEY);
  const saved = records.find((record) => record.key === packageKey) || null;
  if (!saved) return null;
  if (saved.packageKey !== packageKey || !presentationOfflineStateMatchesClient(saved, clientId)) {
    await deleteLiveRecord(OFFLINE_STORE, FALLBACK_OFFLINE_KEY, saved.key);
    return null;
  }
  return saved;
}

export function removePresentationOfflineState(packageKey: string) {
  return deleteLiveRecord(OFFLINE_STORE, FALLBACK_OFFLINE_KEY, packageKey);
}

export function getPresentationApiErrorCode(error: unknown) {
  if (!(error instanceof ApiError)) return null;
  const body = recordValue(error.body);
  return stringValue(body?.error) || stringValue(body?.code) || null;
}

export function isPresentationAuthorizationError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export function getPresentationConflictSnapshot(
  error: unknown,
  view: PresentationLiveView,
  clientId: string,
  expectedMode?: "live" | "rehearsal",
) {
  if (!(error instanceof ApiError)) return null;
  const body = recordValue(error.body);
  const raw = body?.current || body?.snapshot;
  if (!raw) return null;
  try {
    return normalizePresentationLiveSnapshot(raw, view, clientId, Date.now(), expectedMode);
  } catch {
    return null;
  }
}
