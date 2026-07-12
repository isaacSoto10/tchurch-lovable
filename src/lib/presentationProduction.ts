import { apiFetch } from "@/lib/api";
import {
  normalizePresentationTheme,
  safePresentationAssetUrl,
  type PresentationAudienceSlide,
  type PresentationMediaPlayback,
  type PresentationResolvedTheme,
} from "@/lib/presentationOutput";

export const PRESENTATION_PRODUCTION_SCHEMA_VERSION = 4 as const;
export const PRESENTATION_CHAT_CHANNELS = ["all", "worship", "production"] as const;
export const PRESENTATION_AUTOMATION_TRIGGER_TYPES = ["session_started", "session_ended", "slide_entered", "countdown_elapsed", "item_elapsed"] as const;
export const PRESENTATION_AUTOMATION_ACTION_TYPES = ["stage_message", "set_blackout", "set_chords", "obs_scene", "broadcast_visibility"] as const;
export const PRESENTATION_SLIDE_KINDS: PresentationOutputSlideKind[] = ["lyrics", "scripture", "image", "video", "audio", "countdown", "sermon", "announcement", "blank"];
export const PRESENTATION_PRODUCTION_MAX_RULES = 20;
export const PRESENTATION_PRODUCTION_MAX_ACTIONS = 4;

export type PresentationRunMode = "live" | "rehearsal";
export type PresentationChatChannel = (typeof PRESENTATION_CHAT_CHANNELS)[number];
export type PresentationOutputSlideKind = PresentationAudienceSlide["kind"];
export type PresentationAutomationTriggerType = (typeof PRESENTATION_AUTOMATION_TRIGGER_TYPES)[number];
export type PresentationAutomationActionType = (typeof PRESENTATION_AUTOMATION_ACTION_TYPES)[number];

export type PresentationChatMessage = {
  id: string;
  clientMessageId: string;
  channel: PresentationChatChannel;
  body: string;
  sender: { id: string; displayName: string };
  sentAt: string;
};

export type PresentationChatEnvelope = {
  schemaVersion: 4;
  serviceId: string;
  mode: PresentationRunMode;
  serverNow: string;
  messages: PresentationChatMessage[];
  nextCursor: string | null;
};

export type PresentationAutomationTrigger =
  | { type: "session_started" | "session_ended" | "countdown_elapsed" }
  | { type: "slide_entered"; slideKinds: PresentationOutputSlideKind[] }
  | { type: "item_elapsed"; afterSeconds: number };

export type PresentationAutomationAction =
  | { type: "stage_message"; body: string; tone: "info" | "urgent"; roles: PresentationStageMessageRole[]; lifetimeSeconds: number }
  | { type: "set_blackout"; enabled: boolean }
  | { type: "set_chords"; visible: boolean }
  | { type: "obs_scene"; sceneName: string }
  | { type: "broadcast_visibility"; visible: boolean };

export type PresentationStageMessageRole = "worship_leader" | "band" | "vocals" | "av" | "speaker" | "operator" | "stage" | "all";

export type PresentationAutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  modes: { live: boolean; rehearsal: boolean };
  priority: number;
  trigger: PresentationAutomationTrigger;
  actions: PresentationAutomationAction[];
  version: number;
  updatedAt: string;
};

export type PresentationAutomationEnvelope = {
  schemaVersion: 4;
  serviceId: string;
  revision: number;
  rules: PresentationAutomationRule[];
};

export type PresentationAutomationDispatch = {
  schemaVersion: 4;
  serviceId: string;
  mode: PresentationRunMode;
  idempotent: boolean;
  simulated: boolean;
  actions: Array<{
    deliveryId: string;
    ruleId: string;
    type: PresentationAutomationActionType;
    payload: Omit<PresentationAutomationAction, "type">;
  }>;
};

export type PresentationAutomationPending = PresentationAutomationDispatch & {
  simulated: false;
  leaseExpiresAt: string | null;
};

type PresentationAutomationEventBase = {
  id: string;
  occurredAt: string;
  sessionId: string;
  revision: number;
};

export type PresentationAutomationEventInput =
  | (PresentationAutomationEventBase & { type: "session_started" | "session_ended" | "slide_entered" | "countdown_elapsed" })
  | (PresentationAutomationEventBase & { type: "item_elapsed"; thresholdSeconds: number; elapsedSeconds: number });

export type PresentationAutomationAcknowledgement = {
  schemaVersion: 4;
  deliveryId: string;
  status: "applied" | "failed";
  idempotent: boolean;
};

export type PlanningCenterConnectResponse = {
  schemaVersion: 4;
  provider: "planning_center";
  authorizeUrl: string;
  expiresAt: string;
};

export const PRESENTATION_PLANNING_CENTER_RELAY_EVENT = "tchurch:planning-center-relay";

export type PlanningCenterMobileRelay =
  | { serviceId: string; route: string; outcome: "complete"; handoff: string }
  | { serviceId: string; route: string; outcome: "error"; code: "OAUTH_DECLINED" };

export type PlanningCenterRelayEventDetail =
  | { serviceId: string; outcome: "complete"; summary: PresentationIntegrationSummary }
  | { serviceId: string; outcome: "error"; code: "OAUTH_DECLINED" | "HANDOFF_FAILED" };

export type PresentationServiceReport = {
  schemaVersion: 4;
  generatedAt: string;
  service: { id: string; title: string; date: string };
  status: "not_started" | "in_progress" | "completed";
  session: null | { id: string; startedAt: string; endedAt: string | null; durationSeconds: number };
  timing: { plannedSeconds: number; actualSeconds: number; overrunSeconds: number };
  activity: {
    commands: number;
    navigations: number;
    blackoutChanges: number;
    mediaPlays: number;
    stageMessages: number;
    chatMessages: number;
    automationEvents: number;
    automationApplied: number;
    automationFailed: number;
  };
  operators: { uniqueCount: number };
  privacy: { containsMessageBodies: false; containsTokens: false; containsNotes: false; containsUserEmails: false };
};

export type PresentationIntegrationSummary = {
  schemaVersion: 4;
  integrations: Array<
    | { provider: "planning_center"; status: "connected" | "not_connected" | "reauthorization_required" | "unavailable"; externalOrganization: { id: string; name: string } | null; scopes: ["services"]; connectedAt: string | null; lastSyncAt: string | null }
    | { provider: "propresenter"; status: "local_only"; capabilities: ["text_export", "local_api"] }
    | { provider: "obs"; status: "local_only"; capabilities: ["browser_source", "obs_websocket_5"] }
    | { provider: "ndi_bridge"; status: "requires_tchurch_studio"; capabilities: ["frame_feed"] }
  >;
};

export type PlanningCenterCatalogResponse =
  | { schemaVersion: 4; provider: "planning_center"; resource: "service_types"; items: Array<{ id: string; name: string }>; nextOffset: number | null }
  | { schemaVersion: 4; provider: "planning_center"; resource: "plans"; serviceTypeId: string; items: Array<{ id: string; title: string; dates: string; sortDate: string | null }>; nextOffset: number | null }
  | { schemaVersion: 4; provider: "planning_center"; resource: "plan"; serviceTypeId: string; plan: { id: string; title: string; dates: string; sortDate: string | null }; items: Array<{ id: string; title: string; itemType: string; lengthSeconds: number | null; sequence: number; keyName: string | null }> };

export type PlanningCenterImportResponse = {
  schemaVersion: 4;
  provider: "planning_center";
  operation: "preview" | "import";
  source: { serviceTypeId: string; planId: string; title: string; dates: string };
  changes: { create: number; update: number; unchanged: number; reorderedLocal: number };
  applied: boolean;
  syncedAt: string | null;
};

export type PresentationBroadcastLink = {
  id: string;
  label: string;
  scope: "browser_source";
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type PresentationBroadcastLinksResponse = { schemaVersion: 4; links: PresentationBroadcastLink[] };
export type PresentationBroadcastLinkCreated = { schemaVersion: 4; link: PresentationBroadcastLink; token: string; url: string };

export type PresentationBroadcastVisual = {
  id: string;
  kind: PresentationOutputSlideKind;
  title: string;
  lines: string[];
  media: null | { src: string; posterSrc: string | null; fit: "contain" | "cover" | null; muted: boolean | null; loop: boolean | null };
};

export type PresentationBroadcastEnvelope = {
  schemaVersion: 4;
  serverNow: string;
  serviceId: string;
  status: "idle" | "live" | "ended";
  revision: number;
  contentVersion: string;
  frame: {
    visible: boolean;
    blackout: boolean;
    current: PresentationBroadcastVisual | null;
    next: null | Pick<PresentationBroadcastVisual, "id" | "kind" | "title">;
    theme: PresentationResolvedTheme;
    playback: PresentationMediaPlayback | null;
    countdown: { durationSeconds: number; targetAt: string } | null;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (missing || extra) throw new Error(missing ? `Falta el campo ${missing}.` : `El campo ${extra} no está permitido.`);
}

function text(value: unknown, label: string, max = 4_000, allowEmpty = false) {
  const hasDisallowedControl = typeof value === "string" && [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
  if (typeof value !== "string" || value.length > max || hasDisallowedControl) throw new Error(`${label} es inválido.`);
  const normalized = value.trim();
  if (!normalized && !allowEmpty) throw new Error(`${label} es obligatorio.`);
  return normalized;
}

function iso(value: unknown, label: string) {
  const candidate = text(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) || !Number.isFinite(Date.parse(candidate))) throw new Error(`${label} debe incluir zona horaria.`);
  return new Date(candidate).toISOString();
}

function nullableIso(value: unknown, label: string) {
  return value === null ? null : iso(value, label);
}

function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} es inválido.`);
  return Number(value);
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} es inválido.`);
  return value;
}

function runMode(value: unknown): PresentationRunMode {
  if (value !== "live" && value !== "rehearsal") throw new Error("El modo de presentación es inválido.");
  return value;
}

function channel(value: unknown): PresentationChatChannel {
  if (!PRESENTATION_CHAT_CHANNELS.includes(value as PresentationChatChannel)) throw new Error("El canal privado es inválido.");
  return value as PresentationChatChannel;
}

function slideKind(value: unknown): PresentationOutputSlideKind {
  if (!PRESENTATION_SLIDE_KINDS.includes(value as PresentationOutputSlideKind)) throw new Error("El tipo de slide es inválido.");
  return value as PresentationOutputSlideKind;
}

function stageRole(value: unknown): PresentationStageMessageRole {
  const roles: PresentationStageMessageRole[] = ["worship_leader", "band", "vocals", "av", "speaker", "operator", "stage", "all"];
  if (!roles.includes(value as PresentationStageMessageRole)) throw new Error("La función de escenario es inválida.");
  return value as PresentationStageMessageRole;
}

function normalizeChatMessage(value: unknown): PresentationChatMessage {
  const source = record(value);
  const sender = record(source?.sender);
  if (!source || !sender) throw new Error("Tchurch recibió un mensaje privado inválido.");
  exact(source, ["id", "clientMessageId", "channel", "body", "sender", "sentAt"]);
  exact(sender, ["id", "displayName"]);
  return {
    id: text(source.id, "message.id", 120),
    clientMessageId: text(source.clientMessageId, "message.clientMessageId", 120),
    channel: channel(source.channel),
    body: text(source.body, "message.body", 500),
    sender: { id: text(sender.id, "message.sender.id", 120), displayName: text(sender.displayName, "message.sender.displayName", 120) },
    sentAt: iso(source.sentAt, "message.sentAt"),
  };
}

export function normalizePresentationChatEnvelope(value: unknown): PresentationChatEnvelope {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || !Array.isArray(source.messages)) throw new Error("Tchurch recibió un chat privado incompatible.");
  exact(source, ["schemaVersion", "serviceId", "mode", "serverNow", "messages", "nextCursor"]);
  const messages = source.messages.map(normalizeChatMessage);
  return {
    schemaVersion: 4,
    serviceId: text(source.serviceId, "chat.serviceId", 120),
    mode: runMode(source.mode),
    serverNow: iso(source.serverNow, "chat.serverNow"),
    messages: mergePresentationChatMessages([], messages),
    nextCursor: source.nextCursor === null ? null : text(source.nextCursor, "chat.nextCursor", 500),
  };
}

/** Stable reconnect merge: sender/client id dedupe, then total sentAt/id order. */
export function mergePresentationChatMessages(current: PresentationChatMessage[], incoming: PresentationChatMessage[]) {
  const byId = new Map<string, PresentationChatMessage>();
  const byClient = new Map<string, string>();
  for (const message of [...current, ...incoming]) {
    const dedupeKey = `${message.sender.id}:${message.clientMessageId}`;
    const priorId = byClient.get(dedupeKey);
    if (priorId && priorId !== message.id) byId.delete(priorId);
    byClient.set(dedupeKey, message.id);
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt) || left.id.localeCompare(right.id));
}

function normalizeTrigger(value: unknown): PresentationAutomationTrigger {
  const source = record(value);
  if (!source) throw new Error("El disparador automático es inválido.");
  if (source.type === "slide_entered") {
    exact(source, ["type", "slideKinds"]);
    if (!Array.isArray(source.slideKinds) || source.slideKinds.length > PRESENTATION_SLIDE_KINDS.length) throw new Error("Los tipos de slide son inválidos.");
    return { type: "slide_entered", slideKinds: [...new Set(source.slideKinds.map(slideKind))] };
  }
  if (source.type === "item_elapsed") {
    exact(source, ["type", "afterSeconds"]);
    return { type: "item_elapsed", afterSeconds: integer(source.afterSeconds, "trigger.afterSeconds", 1, 21_600) };
  }
  if (source.type === "session_started" || source.type === "session_ended" || source.type === "countdown_elapsed") {
    exact(source, ["type"]);
    return { type: source.type };
  }
  throw new Error("El disparador automático es inválido.");
}

function normalizeAction(value: unknown): PresentationAutomationAction {
  const source = record(value);
  if (!source) throw new Error("La acción automática es inválida.");
  if (source.type === "stage_message") {
    exact(source, ["type", "body", "tone", "roles", "lifetimeSeconds"]);
    if (source.tone !== "info" && source.tone !== "urgent") throw new Error("El tono automático es inválido.");
    if (!Array.isArray(source.roles) || !source.roles.length || source.roles.length > 8) throw new Error("Las funciones automáticas son inválidas.");
    return { type: "stage_message", body: text(source.body, "action.body", 160), tone: source.tone, roles: [...new Set(source.roles.map(stageRole))], lifetimeSeconds: integer(source.lifetimeSeconds, "action.lifetimeSeconds", 5, 600) };
  }
  if (source.type === "set_blackout") {
    exact(source, ["type", "enabled"]);
    return { type: "set_blackout", enabled: boolean(source.enabled, "action.enabled") };
  }
  if (source.type === "set_chords") {
    exact(source, ["type", "visible"]);
    return { type: "set_chords", visible: boolean(source.visible, "action.visible") };
  }
  if (source.type === "obs_scene") {
    exact(source, ["type", "sceneName"]);
    return { type: "obs_scene", sceneName: text(source.sceneName, "action.sceneName", 120) };
  }
  if (source.type === "broadcast_visibility") {
    exact(source, ["type", "visible"]);
    return { type: "broadcast_visibility", visible: boolean(source.visible, "action.visible") };
  }
  throw new Error("La acción automática es inválida.");
}

function normalizeRule(value: unknown): PresentationAutomationRule {
  const source = record(value);
  const modes = record(source?.modes);
  if (!source || !modes || !Array.isArray(source.actions)) throw new Error("La regla automática es inválida.");
  exact(source, ["id", "name", "enabled", "modes", "priority", "trigger", "actions", "version", "updatedAt"]);
  exact(modes, ["live", "rehearsal"]);
  if (!source.actions.length || source.actions.length > PRESENTATION_PRODUCTION_MAX_ACTIONS) throw new Error("La regla tiene demasiadas acciones.");
  return {
    id: text(source.id, "rule.id", 120),
    name: text(source.name, "rule.name", 100),
    enabled: boolean(source.enabled, "rule.enabled"),
    modes: { live: boolean(modes.live, "rule.modes.live"), rehearsal: boolean(modes.rehearsal, "rule.modes.rehearsal") },
    priority: integer(source.priority, "rule.priority", 0, 1_000),
    trigger: normalizeTrigger(source.trigger),
    actions: source.actions.map(normalizeAction),
    version: integer(source.version, "rule.version", 1, Number.MAX_SAFE_INTEGER),
    updatedAt: iso(source.updatedAt, "rule.updatedAt"),
  };
}

export function normalizePresentationAutomationEnvelope(value: unknown): PresentationAutomationEnvelope {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || !Array.isArray(source.rules) || source.rules.length > PRESENTATION_PRODUCTION_MAX_RULES) throw new Error("Tchurch recibió automatizaciones incompatibles.");
  exact(source, ["schemaVersion", "serviceId", "revision", "rules"]);
  const rules = source.rules.map(normalizeRule);
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new Error("Las automatizaciones contienen ids duplicados.");
  return { schemaVersion: 4, serviceId: text(source.serviceId, "automations.serviceId", 120), revision: integer(source.revision, "automations.revision"), rules };
}

function normalizeDispatchAction(value: unknown) {
  const source = record(value);
  const payload = record(source?.payload);
  if (!source || !payload) throw new Error("Tchurch recibió una entrega automática inválida.");
  exact(source, ["deliveryId", "ruleId", "type", "payload"]);
  const type = source.type as PresentationAutomationActionType;
  if (!PRESENTATION_AUTOMATION_ACTION_TYPES.includes(type)) throw new Error("Tchurch recibió una acción automática desconocida.");
  if (Object.prototype.hasOwnProperty.call(payload, "type")) throw new Error("El payload automático no puede redefinir su acción.");
  const action = normalizeAction({ ...payload, type });
  if (action.type !== type) throw new Error("La entrega automática no coincide con su acción.");
  const { type: ignored, ...normalizedPayload } = action;
  void ignored;
  return { deliveryId: text(source.deliveryId, "delivery.id", 120), ruleId: text(source.ruleId, "delivery.ruleId", 120), type, payload: normalizedPayload } as PresentationAutomationDispatch["actions"][number];
}

export function normalizePresentationAutomationDispatch(value: unknown): PresentationAutomationDispatch {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || !Array.isArray(source.actions) || source.actions.length > 80) throw new Error("Tchurch recibió una entrega automática incompatible.");
  exact(source, ["schemaVersion", "serviceId", "mode", "idempotent", "simulated", "actions"]);
  const mode = runMode(source.mode);
  const simulated = boolean(source.simulated, "dispatch.simulated");
  if (mode === "rehearsal" && !simulated) throw new Error("Una automatización de ensayo nunca puede ejecutar efectos externos.");
  return { schemaVersion: 4, serviceId: text(source.serviceId, "dispatch.serviceId", 120), mode, idempotent: boolean(source.idempotent, "dispatch.idempotent"), simulated, actions: source.actions.map(normalizeDispatchAction) };
}

export function normalizePresentationAutomationPending(value: unknown): PresentationAutomationPending {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || !Array.isArray(source.actions) || source.actions.length > 80) throw new Error("Tchurch recibió entregas pendientes incompatibles.");
  exact(source, ["schemaVersion", "serviceId", "mode", "idempotent", "simulated", "actions", "leaseExpiresAt"]);
  if (source.mode !== "live" || source.simulated !== false) throw new Error("Las entregas recuperables deben pertenecer a la sesión en vivo.");
  const { leaseExpiresAt, ...dispatchSource } = source;
  const base = normalizePresentationAutomationDispatch(dispatchSource);
  return { ...base, simulated: false, leaseExpiresAt: nullableIso(leaseExpiresAt, "pending.leaseExpiresAt") };
}

export function normalizePresentationAutomationAcknowledgement(value: unknown): PresentationAutomationAcknowledgement {
  const source = record(value);
  if (!source || source.schemaVersion !== 4) throw new Error("Tchurch recibió una confirmación automática incompatible.");
  exact(source, ["schemaVersion", "deliveryId", "status", "idempotent"]);
  if (source.status !== "applied" && source.status !== "failed") throw new Error("La confirmación automática tiene un estado inválido.");
  return {
    schemaVersion: 4,
    deliveryId: text(source.deliveryId, "ack.deliveryId", 120),
    status: source.status,
    idempotent: boolean(source.idempotent, "ack.idempotent"),
  };
}

export function normalizePresentationServiceReport(value: unknown): PresentationServiceReport {
  const source = record(value);
  const service = record(source?.service);
  const timing = record(source?.timing);
  const activity = record(source?.activity);
  const operators = record(source?.operators);
  const privacy = record(source?.privacy);
  if (!source || !service || !timing || !activity || !operators || !privacy || source.schemaVersion !== 4) throw new Error("Tchurch recibió un reporte incompatible.");
  exact(source, ["schemaVersion", "generatedAt", "service", "status", "session", "timing", "activity", "operators", "privacy"]);
  exact(service, ["id", "title", "date"]);
  exact(timing, ["plannedSeconds", "actualSeconds", "overrunSeconds"]);
  exact(activity, ["commands", "navigations", "blackoutChanges", "mediaPlays", "stageMessages", "chatMessages", "automationEvents", "automationApplied", "automationFailed"]);
  exact(operators, ["uniqueCount"]);
  exact(privacy, ["containsMessageBodies", "containsTokens", "containsNotes", "containsUserEmails"]);
  if (source.status !== "not_started" && source.status !== "in_progress" && source.status !== "completed") throw new Error("El estado del reporte es inválido.");
  if (privacy.containsMessageBodies !== false || privacy.containsTokens !== false || privacy.containsNotes !== false || privacy.containsUserEmails !== false) throw new Error("El reporte contiene información privada no permitida.");
  let session: PresentationServiceReport["session"] = null;
  if (source.session !== null) {
    const rawSession = record(source.session);
    if (!rawSession) throw new Error("La sesión del reporte es inválida.");
    exact(rawSession, ["id", "startedAt", "endedAt", "durationSeconds"]);
    session = { id: text(rawSession.id, "report.session.id", 120), startedAt: iso(rawSession.startedAt, "report.session.startedAt"), endedAt: nullableIso(rawSession.endedAt, "report.session.endedAt"), durationSeconds: integer(rawSession.durationSeconds, "report.session.durationSeconds", 0, 604_800) };
  }
  const counters = Object.fromEntries(Object.entries(activity).map(([key, count]) => [key, integer(count, `report.activity.${key}`, 0)])) as PresentationServiceReport["activity"];
  return {
    schemaVersion: 4,
    generatedAt: iso(source.generatedAt, "report.generatedAt"),
    service: { id: text(service.id, "report.service.id", 120), title: text(service.title, "report.service.title", 500), date: iso(service.date, "report.service.date") },
    status: source.status,
    session,
    timing: { plannedSeconds: integer(timing.plannedSeconds, "report.timing.plannedSeconds"), actualSeconds: integer(timing.actualSeconds, "report.timing.actualSeconds"), overrunSeconds: integer(timing.overrunSeconds, "report.timing.overrunSeconds") },
    activity: counters,
    operators: { uniqueCount: integer(operators.uniqueCount, "report.operators.uniqueCount") },
    privacy: { containsMessageBodies: false, containsTokens: false, containsNotes: false, containsUserEmails: false },
  };
}

export function normalizePresentationIntegrationSummary(value: unknown): PresentationIntegrationSummary {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || !Array.isArray(source.integrations)) throw new Error("Tchurch recibió integraciones incompatibles.");
  exact(source, ["schemaVersion", "integrations"]);
  const integrations = source.integrations.map((entry) => {
    const item = record(entry);
    if (!item) throw new Error("La integración es inválida.");
    if (item.provider === "planning_center") {
      exact(item, ["provider", "status", "externalOrganization", "scopes", "connectedAt", "lastSyncAt"]);
      if (!["connected", "not_connected", "reauthorization_required", "unavailable"].includes(String(item.status)) || !Array.isArray(item.scopes) || item.scopes.length !== 1 || item.scopes[0] !== "services") throw new Error("Planning Center devolvió un estado inválido.");
      const organization = item.externalOrganization === null ? null : record(item.externalOrganization);
      if (item.externalOrganization !== null && !organization) throw new Error("La organización de Planning Center es inválida.");
      if (organization) exact(organization, ["id", "name"]);
      return { provider: "planning_center" as const, status: item.status as "connected" | "not_connected" | "reauthorization_required" | "unavailable", externalOrganization: organization ? { id: text(organization.id, "organization.id", 120), name: text(organization.name, "organization.name", 200) } : null, scopes: ["services"] as ["services"], connectedAt: nullableIso(item.connectedAt, "integration.connectedAt"), lastSyncAt: nullableIso(item.lastSyncAt, "integration.lastSyncAt") };
    }
    if (item.provider === "propresenter") {
      exact(item, ["provider", "status", "capabilities"]);
      if (item.status !== "local_only" || JSON.stringify(item.capabilities) !== JSON.stringify(["text_export", "local_api"])) throw new Error("ProPresenter devolvió capacidades inválidas.");
      return { provider: "propresenter" as const, status: "local_only" as const, capabilities: ["text_export", "local_api"] as ["text_export", "local_api"] };
    }
    if (item.provider === "obs") {
      exact(item, ["provider", "status", "capabilities"]);
      if (item.status !== "local_only" || JSON.stringify(item.capabilities) !== JSON.stringify(["browser_source", "obs_websocket_5"])) throw new Error("OBS devolvió capacidades inválidas.");
      return { provider: "obs" as const, status: "local_only" as const, capabilities: ["browser_source", "obs_websocket_5"] as ["browser_source", "obs_websocket_5"] };
    }
    if (item.provider === "ndi_bridge") {
      exact(item, ["provider", "status", "capabilities"]);
      if (item.status !== "requires_tchurch_studio" || JSON.stringify(item.capabilities) !== JSON.stringify(["frame_feed"])) throw new Error("El bridge de Studio devolvió capacidades inválidas.");
      return { provider: "ndi_bridge" as const, status: "requires_tchurch_studio" as const, capabilities: ["frame_feed"] as ["frame_feed"] };
    }
    throw new Error("Tchurch recibió un proveedor desconocido.");
  });
  return { schemaVersion: 4, integrations };
}

export function normalizePlanningCenterConnect(value: unknown): PlanningCenterConnectResponse {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || source.provider !== "planning_center") throw new Error("Planning Center devolvió una autorización incompatible.");
  exact(source, ["schemaVersion", "provider", "authorizeUrl", "expiresAt"]);
  const rawUrl = text(source.authorizeUrl, "planningCenter.authorizeUrl", 2_048);
  const url = new URL(rawUrl);
  const expectedKeys = ["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method"];
  const keys = [...url.searchParams.keys()];
  const exactQuery = keys.length === expectedKeys.length
    && expectedKeys.every((key) => url.searchParams.getAll(key).length === 1)
    && keys.every((key) => expectedKeys.includes(key));
  if (url.origin !== "https://api.planningcenteronline.com"
    || url.pathname !== "/oauth/authorize"
    || url.username || url.password || url.hash
    || !exactQuery
    || url.searchParams.get("response_type") !== "code"
    || url.searchParams.get("scope") !== "services"
    || url.searchParams.get("code_challenge_method") !== "S256"
    || url.searchParams.get("redirect_uri") !== "https://www.tchurchapp.com/api/presentation-integrations/planning-center/callback"
    || !/^[A-Za-z0-9_-]{8,200}$/.test(url.searchParams.get("client_id") || "")
    || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") || "")
    || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") || "")) throw new Error("Planning Center devolvió una dirección OAuth inválida.");
  return { schemaVersion: 4, provider: "planning_center", authorizeUrl: url.toString(), expiresAt: iso(source.expiresAt, "planningCenter.expiresAt") };
}

export function parsePlanningCenterMobileRelay(value: unknown): PlanningCenterMobileRelay | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "tchurchapp:" || url.hostname !== "tchurchapp.com" || url.pathname !== "/" || url.search || url.username || url.password || !url.hash.startsWith("#/")) return null;
  let route: URL;
  try { route = new URL(url.hash.slice(1), "https://www.tchurchapp.com"); } catch { return null; }
  const match = route.pathname.match(/^\/app\/services\/([^/]+)\/presentation$/);
  if (!match?.[1]) return null;
  let serviceId: string;
  try { serviceId = decodeURIComponent(match[1]).trim(); } catch { return null; }
  const unsafeServiceId = [...serviceId].some((character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "?" || character === "#" || code <= 31 || code === 127;
  });
  if (!serviceId || serviceId.length > 120 || unsafeServiceId) return null;
  const cleanRoute = `/app/services/${encodeURIComponent(serviceId)}/presentation`;
  const keys = [...route.searchParams.keys()];
  const planningCenter = route.searchParams.get("planningCenter");
  if (planningCenter === "complete") {
    if (keys.length !== 2 || route.searchParams.getAll("planningCenter").length !== 1 || route.searchParams.getAll("handoff").length !== 1 || keys.some((key) => key !== "planningCenter" && key !== "handoff")) return null;
    const handoff = route.searchParams.get("handoff") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(handoff)) return null;
    return { serviceId, route: cleanRoute, outcome: "complete", handoff };
  }
  if (planningCenter === "error") {
    if (keys.length !== 2 || route.searchParams.getAll("planningCenter").length !== 1 || route.searchParams.getAll("code").length !== 1 || keys.some((key) => key !== "planningCenter" && key !== "code") || route.searchParams.get("code") !== "OAUTH_DECLINED") return null;
    return { serviceId, route: cleanRoute, outcome: "error", code: "OAUTH_DECLINED" };
  }
  return null;
}

function nullableText(value: unknown, label: string, max: number) {
  return value === null ? null : text(value, label, max);
}

export function normalizePlanningCenterCatalog(value: unknown): PlanningCenterCatalogResponse {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || source.provider !== "planning_center" || !Array.isArray(source.items)) throw new Error("Planning Center devolvió un catálogo incompatible.");
  if (source.resource === "service_types") {
    exact(source, ["schemaVersion", "provider", "resource", "items", "nextOffset"]);
    return { schemaVersion: 4, provider: "planning_center", resource: "service_types", items: source.items.map((entry) => { const item = record(entry); if (!item) throw new Error("El tipo de servicio es inválido."); exact(item, ["id", "name"]); return { id: text(item.id, "serviceType.id", 120), name: text(item.name, "serviceType.name", 200) }; }), nextOffset: source.nextOffset === null ? null : integer(source.nextOffset, "nextOffset") };
  }
  if (source.resource === "plans") {
    exact(source, ["schemaVersion", "provider", "resource", "serviceTypeId", "items", "nextOffset"]);
    return { schemaVersion: 4, provider: "planning_center", resource: "plans", serviceTypeId: text(source.serviceTypeId, "serviceTypeId", 120), items: source.items.map((entry) => { const item = record(entry); if (!item) throw new Error("El plan es inválido."); exact(item, ["id", "title", "dates", "sortDate"]); return { id: text(item.id, "plan.id", 120), title: text(item.title, "plan.title", 200), dates: text(item.dates, "plan.dates", 200, true), sortDate: item.sortDate === null ? null : iso(item.sortDate, "plan.sortDate") }; }), nextOffset: source.nextOffset === null ? null : integer(source.nextOffset, "nextOffset") };
  }
  if (source.resource === "plan") {
    const rawPlan = record(source.plan);
    if (!rawPlan) throw new Error("El plan es inválido.");
    exact(source, ["schemaVersion", "provider", "resource", "serviceTypeId", "plan", "items"]);
    exact(rawPlan, ["id", "title", "dates", "sortDate"]);
    return { schemaVersion: 4, provider: "planning_center", resource: "plan", serviceTypeId: text(source.serviceTypeId, "serviceTypeId", 120), plan: { id: text(rawPlan.id, "plan.id", 120), title: text(rawPlan.title, "plan.title", 200), dates: text(rawPlan.dates, "plan.dates", 200, true), sortDate: rawPlan.sortDate === null ? null : iso(rawPlan.sortDate, "plan.sortDate") }, items: source.items.map((entry) => { const item = record(entry); if (!item) throw new Error("El elemento del plan es inválido."); exact(item, ["id", "title", "itemType", "lengthSeconds", "sequence", "keyName"]); return { id: text(item.id, "item.id", 120), title: text(item.title, "item.title", 300), itemType: text(item.itemType, "item.itemType", 120), lengthSeconds: item.lengthSeconds === null ? null : integer(item.lengthSeconds, "item.lengthSeconds", 0, 86_400), sequence: integer(item.sequence, "item.sequence", 0), keyName: nullableText(item.keyName, "item.keyName", 80) }; }) };
  }
  throw new Error("Planning Center devolvió un recurso desconocido.");
}

export function normalizePlanningCenterImport(value: unknown): PlanningCenterImportResponse {
  const source = record(value);
  const input = record(source?.source);
  const changes = record(source?.changes);
  if (!source || !input || !changes || source.schemaVersion !== 4 || source.provider !== "planning_center" || (source.operation !== "preview" && source.operation !== "import")) throw new Error("Planning Center devolvió una importación incompatible.");
  exact(source, ["schemaVersion", "provider", "operation", "source", "changes", "applied", "syncedAt"]);
  exact(input, ["serviceTypeId", "planId", "title", "dates"]);
  exact(changes, ["create", "update", "unchanged", "reorderedLocal"]);
  const applied = boolean(source.applied, "import.applied");
  if (source.operation === "preview" && applied) throw new Error("Una vista previa no puede marcarse como aplicada.");
  return { schemaVersion: 4, provider: "planning_center", operation: source.operation, source: { serviceTypeId: text(input.serviceTypeId, "source.serviceTypeId", 120), planId: text(input.planId, "source.planId", 120), title: text(input.title, "source.title", 300), dates: text(input.dates, "source.dates", 200, true) }, changes: { create: integer(changes.create, "changes.create"), update: integer(changes.update, "changes.update"), unchanged: integer(changes.unchanged, "changes.unchanged"), reorderedLocal: integer(changes.reorderedLocal, "changes.reorderedLocal") }, applied, syncedAt: nullableIso(source.syncedAt, "import.syncedAt") };
}

function normalizeBroadcastLink(value: unknown): PresentationBroadcastLink {
  const source = record(value);
  if (!source) throw new Error("El enlace de broadcast es inválido.");
  exact(source, ["id", "label", "scope", "expiresAt", "revokedAt", "lastUsedAt", "createdAt"]);
  if (source.scope !== "browser_source") throw new Error("El enlace no es una fuente de navegador.");
  return { id: text(source.id, "link.id", 120), label: text(source.label, "link.label", 80), scope: "browser_source", expiresAt: iso(source.expiresAt, "link.expiresAt"), revokedAt: nullableIso(source.revokedAt, "link.revokedAt"), lastUsedAt: nullableIso(source.lastUsedAt, "link.lastUsedAt"), createdAt: iso(source.createdAt, "link.createdAt") };
}

export function normalizePresentationBroadcastLinks(value: unknown): PresentationBroadcastLinksResponse {
  const source = record(value);
  if (!source || source.schemaVersion !== 4 || !Array.isArray(source.links)) throw new Error("Tchurch recibió enlaces de broadcast incompatibles.");
  exact(source, ["schemaVersion", "links"]);
  return { schemaVersion: 4, links: source.links.map(normalizeBroadcastLink) };
}

export function normalizePresentationBroadcastLinkCreated(value: unknown): PresentationBroadcastLinkCreated {
  const source = record(value);
  if (!source || source.schemaVersion !== 4) throw new Error("Tchurch no pudo crear una fuente de navegador válida.");
  exact(source, ["schemaVersion", "link", "token", "url"]);
  const token = text(source.token, "broadcast.token", 500);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("La fuente de navegador no contiene un token opaco con suficiente entropía.");
  const rawUrl = text(source.url, "broadcast.url", 2_048);
  const url = new URL(rawUrl);
  if (
    url.origin !== "https://www.tchurchapp.com" ||
    url.pathname !== "/broadcast" ||
    url.search ||
    !url.hash ||
    url.hash.slice(1) !== token ||
    url.username ||
    url.password
  ) throw new Error("La fuente de navegador no contiene un token fragment seguro.");
  return { schemaVersion: 4, link: normalizeBroadcastLink(source.link), token, url: url.toString() };
}

function normalizeBroadcastVisual(value: unknown): PresentationBroadcastVisual {
  const source = record(value);
  if (!source || !Array.isArray(source.lines)) throw new Error("El frame de broadcast es inválido.");
  exact(source, ["id", "kind", "title", "lines", "media"]);
  let media: PresentationBroadcastVisual["media"] = null;
  if (source.media !== null) {
    const rawMedia = record(source.media);
    if (!rawMedia) throw new Error("El medio de broadcast es inválido.");
    exact(rawMedia, ["src", "posterSrc", "fit", "muted", "loop"]);
    const src = safePresentationAssetUrl(rawMedia.src, "media");
    const posterSrc = rawMedia.posterSrc === null ? null : safePresentationAssetUrl(rawMedia.posterSrc, "image");
    if (!src || (rawMedia.posterSrc !== null && !posterSrc) || (rawMedia.fit !== null && rawMedia.fit !== "contain" && rawMedia.fit !== "cover") || (rawMedia.muted !== null && typeof rawMedia.muted !== "boolean") || (rawMedia.loop !== null && typeof rawMedia.loop !== "boolean")) throw new Error("El medio de broadcast no es seguro.");
    media = { src, posterSrc, fit: rawMedia.fit as "contain" | "cover" | null, muted: rawMedia.muted as boolean | null, loop: rawMedia.loop as boolean | null };
  }
  return { id: text(source.id, "frame.current.id", 500), kind: slideKind(source.kind), title: text(source.title, "frame.current.title", 500, true), lines: source.lines.map((line, index) => text(line, `frame.current.lines.${index}`, 1_000, true)).slice(0, 24), media };
}

function normalizeBroadcastPlayback(value: unknown): PresentationMediaPlayback | null {
  if (value === null) return null;
  const source = record(value);
  if (!source) throw new Error("La reproducción de broadcast es inválida.");
  exact(source, ["itemId", "slideId", "kind", "status", "positionMs", "startedAt", "rate", "loop"]);
  if (!["video", "audio", "announcement"].includes(String(source.kind)) || !["idle", "playing", "paused", "ended"].includes(String(source.status)) || source.rate !== 1 || typeof source.loop !== "boolean") throw new Error("La reproducción de broadcast es incompatible.");
  const startedAt = source.startedAt === null ? null : iso(source.startedAt, "playback.startedAt");
  if (source.status === "playing" && !startedAt) throw new Error("La reproducción activa no tiene ancla.");
  return { itemId: text(source.itemId, "playback.itemId", 120), slideId: text(source.slideId, "playback.slideId", 500), kind: source.kind as PresentationMediaPlayback["kind"], status: source.status as PresentationMediaPlayback["status"], positionMs: integer(source.positionMs, "playback.positionMs", 0, 86_400_000), startedAt, rate: 1, loop: source.loop };
}

export function normalizePresentationBroadcastEnvelope(value: unknown): PresentationBroadcastEnvelope {
  const source = record(value);
  const frame = record(source?.frame);
  if (!source || !frame || source.schemaVersion !== 4) throw new Error("Tchurch recibió un feed de broadcast incompatible.");
  exact(source, ["schemaVersion", "serverNow", "serviceId", "status", "revision", "contentVersion", "frame"]);
  exact(frame, ["visible", "blackout", "current", "next", "theme", "playback", "countdown"]);
  if (source.status !== "idle" && source.status !== "live" && source.status !== "ended") throw new Error("El feed de broadcast tiene un estado inválido.");
  const contentVersion = text(source.contentVersion, "broadcast.contentVersion", 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(contentVersion)) throw new Error("El feed de broadcast no tiene una versión firmada.");
  const current = frame.current === null ? null : normalizeBroadcastVisual(frame.current);
  let next: PresentationBroadcastEnvelope["frame"]["next"] = null;
  if (frame.next !== null) {
    const rawNext = record(frame.next);
    if (!rawNext) throw new Error("El siguiente frame es inválido.");
    exact(rawNext, ["id", "kind", "title"]);
    next = { id: text(rawNext.id, "frame.next.id", 500), kind: slideKind(rawNext.kind), title: text(rawNext.title, "frame.next.title", 500, true) };
  }
  let countdown: PresentationBroadcastEnvelope["frame"]["countdown"] = null;
  if (frame.countdown !== null) {
    const rawCountdown = record(frame.countdown);
    if (!rawCountdown) throw new Error("La cuenta de broadcast es inválida.");
    exact(rawCountdown, ["durationSeconds", "targetAt"]);
    countdown = { durationSeconds: integer(rawCountdown.durationSeconds, "countdown.durationSeconds", 5, 86_400), targetAt: iso(rawCountdown.targetAt, "countdown.targetAt") };
  }
  return { schemaVersion: 4, serverNow: iso(source.serverNow, "broadcast.serverNow"), serviceId: text(source.serviceId, "broadcast.serviceId", 120), status: source.status, revision: integer(source.revision, "broadcast.revision"), contentVersion, frame: { visible: boolean(frame.visible, "frame.visible"), blackout: boolean(frame.blackout, "frame.blackout"), current, next, theme: normalizePresentationTheme(frame.theme), playback: normalizeBroadcastPlayback(frame.playback), countdown } };
}

function servicePath(serviceId: string, suffix: string) {
  return `/services/${encodeURIComponent(serviceId)}/${suffix}`;
}

export async function fetchPresentationChat(serviceId: string, mode: PresentationRunMode, cursor?: string | null, limit = 100) {
  const query = new URLSearchParams({ mode, limit: String(Math.min(100, Math.max(1, Math.floor(limit)))) });
  if (cursor) query.set("cursor", cursor);
  return normalizePresentationChatEnvelope(await apiFetch<unknown>(`${servicePath(serviceId, "presentation-chat")}?${query}`, { cache: "no-store" }));
}

export async function sendPresentationChatMessage(serviceId: string, input: { mode: PresentationRunMode; clientMessageId: string; channel: PresentationChatChannel; body: string }) {
  return normalizePresentationChatEnvelope(await apiFetch<unknown>(servicePath(serviceId, "presentation-chat"), { method: "POST", body: JSON.stringify({ schemaVersion: 4, ...input }) }));
}

export async function fetchPresentationAutomations(serviceId: string) {
  return normalizePresentationAutomationEnvelope(await apiFetch<unknown>(servicePath(serviceId, "presentation-automations"), { cache: "no-store" }));
}

export async function updatePresentationAutomations(serviceId: string, envelope: PresentationAutomationEnvelope) {
  const rules = envelope.rules.map(({ version: ignoredVersion, updatedAt: ignoredUpdatedAt, ...rule }) => { void ignoredVersion; void ignoredUpdatedAt; return rule; });
  return normalizePresentationAutomationEnvelope(await apiFetch<unknown>(servicePath(serviceId, "presentation-automations"), { method: "PUT", body: JSON.stringify({ schemaVersion: 4, expectedRevision: envelope.revision, rules }) }));
}

export async function dispatchPresentationAutomation(serviceId: string, input: { mode: PresentationRunMode; clientId: string; event: PresentationAutomationEventInput }) {
  return normalizePresentationAutomationDispatch(await apiFetch<unknown>(servicePath(serviceId, "presentation-automations/dispatch"), { method: "POST", body: JSON.stringify({ schemaVersion: 4, ...input }) }));
}

export async function acknowledgePresentationAutomation(serviceId: string, input: { deliveryId: string; clientId: string; status: "applied" | "failed"; errorCode?: string }) {
  return normalizePresentationAutomationAcknowledgement(await apiFetch<unknown>(servicePath(serviceId, "presentation-automations/ack"), { method: "POST", body: JSON.stringify({ schemaVersion: 4, ...input }) }));
}

export async function fetchPendingPresentationAutomations(serviceId: string, clientId: string) {
  const query = new URLSearchParams({ clientId });
  return normalizePresentationAutomationPending(await apiFetch<unknown>(`${servicePath(serviceId, "presentation-automations/pending")}?${query}`, { cache: "no-store" }));
}

export async function fetchPresentationReport(serviceId: string) {
  return normalizePresentationServiceReport(await apiFetch<unknown>(servicePath(serviceId, "presentation-report"), { cache: "no-store" }));
}

export async function fetchPresentationIntegrations() {
  return normalizePresentationIntegrationSummary(await apiFetch<unknown>("/presentation-integrations", { cache: "no-store" }));
}

export async function connectPlanningCenter(serviceId: string) {
  return normalizePlanningCenterConnect(await apiFetch<unknown>("/presentation-integrations/planning-center/connect", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: 4, returnPath: `/services/${encodeURIComponent(serviceId)}/presentation` }),
  }));
}

export async function completePlanningCenterHandoff(handoff: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(handoff)) throw new Error("El relevo móvil de Planning Center es inválido.");
  return normalizePresentationIntegrationSummary(await apiFetch<unknown>("/presentation-integrations/planning-center/complete", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: 4, handoff }),
  }));
}

export async function disconnectPlanningCenter() {
  return normalizePresentationIntegrationSummary(await apiFetch<unknown>("/presentation-integrations?provider=planning_center", { method: "DELETE" }));
}

export async function fetchPlanningCenterCatalog(query: { serviceTypeId?: string; planId?: string; offset?: number }) {
  const params = new URLSearchParams();
  if (query.serviceTypeId) params.set("serviceTypeId", query.serviceTypeId);
  if (query.planId) params.set("planId", query.planId);
  if (typeof query.offset === "number") params.set("offset", String(Math.max(0, Math.floor(query.offset))));
  return normalizePlanningCenterCatalog(await apiFetch<unknown>(`/presentation-integrations/planning-center/catalog?${params}`, { cache: "no-store" }));
}

export async function importPlanningCenterPlan(serviceId: string, input: { serviceTypeId: string; planId: string; operation: "preview" | "import" }) {
  return normalizePlanningCenterImport(await apiFetch<unknown>(servicePath(serviceId, "presentation-integrations/planning-center"), { method: "POST", body: JSON.stringify({ schemaVersion: 4, mode: "live", ...input }) }));
}

export async function fetchProPresenterExport(serviceId: string) {
  const value = await apiFetch<unknown>(servicePath(serviceId, "presentation-integrations/propresenter-export"), { cache: "no-store" });
  if (typeof value !== "string" || !value.trim() || value.length > 2_000_000) throw new Error("Tchurch recibió una exportación de ProPresenter inválida.");
  return value;
}

export async function fetchPresentationBroadcastLinks(serviceId: string) {
  return normalizePresentationBroadcastLinks(await apiFetch<unknown>(servicePath(serviceId, "presentation-broadcast-links"), { cache: "no-store" }));
}

export async function createPresentationBroadcastLink(serviceId: string, input: { label: string; ttlHours: number }) {
  return normalizePresentationBroadcastLinkCreated(await apiFetch<unknown>(servicePath(serviceId, "presentation-broadcast-links"), { method: "POST", body: JSON.stringify({ schemaVersion: 4, ...input }) }));
}

export async function revokePresentationBroadcastLink(serviceId: string, linkId: string) {
  return normalizePresentationBroadcastLinks(await apiFetch<unknown>(servicePath(serviceId, "presentation-broadcast-links"), { method: "DELETE", body: JSON.stringify({ schemaVersion: 4, linkId }) }));
}
