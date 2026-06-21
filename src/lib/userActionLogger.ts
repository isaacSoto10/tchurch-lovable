import { Capacitor } from "@capacitor/core";
import { API_BASE } from "@/lib/apiConfig";

const SESSION_STORAGE_KEY = "tchurch_action_log_session_id";
const CHURCH_ID_STORAGE_KEY = "tchurch_church_id";
const MAX_QUEUE_SIZE = 60;
const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 800;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 24;
const MAX_STRING_LENGTH = 120;
const DEFAULT_LOG_ENDPOINT = `${API_BASE}/user-action-logs`;

const SAFE_QUERY_VALUE_KEYS = new Set(["tab", "view", "filter", "status", "mode", "locale", "page", "sort", "source"]);
const SENSITIVE_KEY_PATTERN =
  /(authorization|token|secret|password|passcode|verification|code|email|phone|address|card|cvv|cvc|payment|checkout|amount|price|donation|note|message|body|content|description|prompt|lyrics|text|firstName|lastName|safeIdentifier|identifier|query|search|qr|pin|session)/i;
const SAFE_METADATA_KEYS = new Set([
  "action",
  "bodyKind",
  "churchId",
  "controlType",
  "controlTypes",
  "durationMs",
  "fieldCount",
  "formId",
  "from",
  "hasSensitiveFields",
  "href",
  "initial",
  "input",
  "kind",
  "method",
  "mode",
  "ok",
  "path",
  "platform",
  "provider",
  "role",
  "route",
  "runtime",
  "source",
  "state",
  "status",
  "tag",
  "to",
  "type",
]);
const SAFE_SHORT_VALUE_PATTERN = /^[a-zA-Z0-9_.:-]{1,48}$/;
const CLICKABLE_SELECTOR = [
  "a[href]",
  "button",
  "[role='button']",
  "[role='menuitem']",
  "[data-user-action]",
  "input[type='button']",
  "input[type='submit']",
  "input[type='checkbox']",
  "input[type='radio']",
  "select",
  "summary",
].join(",");

type TokenProvider = () => Promise<string | null>;

export type UserActionMetadata = Record<string, unknown>;

type SanitizedMetadataValue =
  | string
  | number
  | boolean
  | null
  | SanitizedMetadataValue[]
  | { [key: string]: SanitizedMetadataValue };

type UserActionPayload = {
  schemaVersion: 1;
  app: "tchurch-app";
  action: string;
  type: string;
  occurredAt: string;
  sessionId: string;
  runtime: "native" | "web";
  platform: string;
  path?: string;
  route?: string;
  churchId?: string;
  metadata?: Record<string, SanitizedMetadataValue>;
};

type LoggerConfig = {
  tokenProvider?: TokenProvider | null;
  endpoint?: string | null;
};

type ApiRequestSummaryInput = {
  path: string;
  method?: string;
  status: number;
  ok: boolean;
  durationMs: number;
  body?: BodyInit | null;
  source?: string;
};

let tokenProvider: TokenProvider | null = null;
let configuredEndpoint: string | null = null;
let transportDisabled = import.meta.env.VITE_USER_ACTION_LOGGING === "false";
let queue: UserActionPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function getActionLogEndpoint() {
  return configuredEndpoint || import.meta.env.VITE_USER_ACTION_LOG_ENDPOINT || DEFAULT_LOG_ENDPOINT;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, "");
}

function getSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function getStoredChurchId() {
  try {
    return window.localStorage.getItem(CHURCH_ID_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function getRuntime() {
  return Capacitor.isNativePlatform() ? "native" : "web";
}

function getPlatform() {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
}

function isLikelySecretString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^Bearer\s+/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;
  if (/\b(?:\d[ -]*?){13,19}\b/.test(trimmed)) return true;
  if (/^(evqr_|tok_|sk_|pk_|sess_|cs_)/i.test(trimmed)) return true;
  return trimmed.length > 96 && /^[A-Za-z0-9._~+/=-]+$/.test(trimmed);
}

function sanitizeString(value: string, maxLength = MAX_STRING_LENGTH) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (isLikelySecretString(trimmed)) return "[redacted]";
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function sanitizePathSegment(segment: string, previousSegment?: string) {
  if (!segment) return segment;

  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }

  if (previousSegment && /(token|code|qr|checkout|session|verify|verification)/i.test(previousSegment)) {
    return "[redacted]";
  }

  if (isLikelySecretString(decoded)) {
    return "[redacted]";
  }

  return segment;
}

function sanitizePathAndSearch(pathAndSearch: string) {
  const [withoutHash] = pathAndSearch.split("#");
  const queryIndex = withoutHash.indexOf("?");
  const rawPathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const rawSearch = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const pathname = rawPathname || "/";
  const sanitizedPathname = pathname
    .split("/")
    .map((segment, index, segments) => sanitizePathSegment(segment, segments[index - 1]))
    .join("/");

  if (!rawSearch) return sanitizedPathname;

  const params = new URLSearchParams(rawSearch);
  const safeParams = new URLSearchParams();

  params.forEach((value, key) => {
    if (SAFE_QUERY_VALUE_KEYS.has(key) && SAFE_SHORT_VALUE_PATTERN.test(value) && !SENSITIVE_KEY_PATTERN.test(key)) {
      safeParams.append(key, value);
    } else {
      safeParams.append(key, "[redacted]");
    }
  });

  const serialized = safeParams.toString();
  return serialized ? `${sanitizedPathname}?${serialized}` : sanitizedPathname;
}

export function sanitizeActionPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";

  const raw = value.trim();
  const hashRouteIndex = raw.indexOf("#/");
  if (hashRouteIndex >= 0) {
    return sanitizePathAndSearch(raw.slice(hashRouteIndex + 1));
  }

  if (raw.startsWith("#")) {
    return sanitizePathAndSearch(raw.slice(1));
  }

  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://www.tchurchapp.com";
    const url = new URL(raw, origin);
    if (url.hash.startsWith("#/")) {
      return sanitizePathAndSearch(url.hash.slice(1));
    }
    return sanitizePathAndSearch(`${url.pathname}${url.search}`);
  } catch {
    return sanitizePathAndSearch(raw);
  }
}

export function getCurrentActionRoute() {
  if (typeof window === "undefined") return "";
  const hashRoute = window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : "";
  return sanitizeActionPath(hashRoute || `${window.location.pathname}${window.location.search}`);
}

function sanitizeMetadataValue(value: unknown, key = "", depth = 0): SanitizedMetadataValue {
  if (value === null || value === undefined) return null;

  if (!SAFE_METADATA_KEYS.has(key) && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (depth >= MAX_METADATA_DEPTH) {
    return "[object]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => sanitizeMetadataValue(item, key, depth + 1));
  }

  if (typeof File !== "undefined" && value instanceof File) {
    return { kind: "file", size: value.size, type: sanitizeString(value.type, 48) };
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return { kind: "blob", size: value.size, type: sanitizeString(value.type, 48) };
  }

  if (value instanceof URLSearchParams) {
    return "[redacted]";
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_METADATA_KEYS)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeMetadataValue(entryValue, entryKey, depth + 1)]),
    );
  }

  return null;
}

export function sanitizeActionMetadata(metadata: UserActionMetadata = {}) {
  return sanitizeMetadataValue(metadata, "", 0) as Record<string, SanitizedMetadataValue>;
}

function scheduleFlush() {
  if (transportDisabled || queue.length === 0 || flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushUserActionLogs();
  }, FLUSH_DELAY_MS);
}

export function configureUserActionLogger(config: LoggerConfig) {
  tokenProvider = config.tokenProvider ?? tokenProvider;
  configuredEndpoint = config.endpoint === null ? null : config.endpoint ? normalizeEndpoint(config.endpoint) : configuredEndpoint;
}

export function resetUserActionLoggerForTests() {
  tokenProvider = null;
  configuredEndpoint = null;
  transportDisabled = import.meta.env.VITE_USER_ACTION_LOGGING === "false";
  queue = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = false;
}

export function logUserAction(type: string, metadata: UserActionMetadata = {}, options: { immediate?: boolean } = {}) {
  if (transportDisabled || typeof window === "undefined") return;

  const route = getCurrentActionRoute();
  queue.push({
    schemaVersion: 1,
    app: "tchurch-app",
    action: type,
    type,
    occurredAt: new Date().toISOString(),
    sessionId: getSessionId(),
    runtime: getRuntime(),
    platform: getPlatform(),
    path: route,
    route,
    churchId: getStoredChurchId(),
    metadata: sanitizeActionMetadata(metadata),
  });

  if (queue.length > MAX_QUEUE_SIZE) {
    queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
  }

  if (options.immediate) {
    void flushUserActionLogs();
  } else {
    scheduleFlush();
  }
}

export async function flushUserActionLogs() {
  if (transportDisabled || flushing || queue.length === 0 || typeof fetch === "undefined") return;

  flushing = true;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  let shouldRetrySoon = true;

  try {
    const token = await tokenProvider?.();
    if (!token) {
      queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE);
      shouldRetrySoon = false;
      return;
    }

    const churchId = getStoredChurchId();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) headers.Authorization = `Bearer ${token}`;
    if (churchId) headers["x-church-id"] = churchId;

    const body = JSON.stringify({ events: batch });
    const response = await fetch(getActionLogEndpoint(), {
      method: "POST",
      headers,
      body,
      keepalive: body.length < 60000,
    });

    if (response.status === 404 || response.status === 405 || response.status === 501) {
      transportDisabled = true;
      queue = [];
      return;
    }

    if (!response.ok) {
      queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE);
      shouldRetrySoon = response.status !== 401 && response.status !== 403;
    }
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE);
  } finally {
    flushing = false;
    if (queue.length > 0 && !transportDisabled && shouldRetrySoon) scheduleFlush();
  }
}

export function summarizeRequestBody(body: BodyInit | null | undefined) {
  if (!body) return "none";
  if (typeof FormData !== "undefined" && body instanceof FormData) return "form_data";
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return "url_encoded";
  if (typeof Blob !== "undefined" && body instanceof Blob) return "blob";
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return "array_buffer";
  if (ArrayBuffer.isView(body)) return "array_buffer_view";
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return "empty_string";
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      return "json";
    }
    return "string";
  }
  return "stream";
}

export function logApiRequestSummary(input: ApiRequestSummaryInput) {
  const endpointPath = sanitizeActionPath(getActionLogEndpoint());
  const requestPath = sanitizeActionPath(input.path);
  if (requestPath && endpointPath && requestPath === endpointPath) return;

  logUserAction("api.request", {
    path: requestPath,
    method: (input.method || "GET").toUpperCase(),
    status: input.status,
    ok: input.ok,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    bodyKind: summarizeRequestBody(input.body),
    source: input.source,
  });
}

export function actionNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function getActionElementFromEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const element = target.closest(CLICKABLE_SELECTOR);
  return element instanceof HTMLElement ? element : null;
}

function getElementKind(element: HTMLElement) {
  const tag = element.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "input") return `input:${(element as HTMLInputElement).type || "unknown"}`;
  if (tag === "select") return "select";
  return element.getAttribute("role") || tag;
}

export function describeElementForAction(element: HTMLElement) {
  const metadata: UserActionMetadata = {
    kind: getElementKind(element),
    tag: element.tagName.toLowerCase(),
  };

  const action = element.getAttribute("data-user-action");
  const role = element.getAttribute("role");
  const type = element.getAttribute("type");
  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");

  if (action) metadata.action = sanitizeString(action, 72);
  if (role) metadata.role = sanitizeString(role, 48);
  if (type) metadata.controlType = sanitizeString(type, 48);
  if (ariaLabel || title) metadata.label = sanitizeString(ariaLabel || title || "", 72);

  if (element instanceof HTMLAnchorElement) {
    metadata.href = sanitizeActionPath(element.getAttribute("href") || "");
  }

  const form = element.closest("form");
  if (form instanceof HTMLFormElement) {
    metadata.formId = sanitizeString(form.id || "", 48);
  }

  return metadata;
}

export function describeFormSubmit(form: HTMLFormElement) {
  const controls = Array.from(form.elements).filter((item): item is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
    return item instanceof HTMLInputElement || item instanceof HTMLSelectElement || item instanceof HTMLTextAreaElement;
  });
  const controlTypes = Array.from(
    new Set(
      controls.map((control) => {
        if (control instanceof HTMLTextAreaElement) return "textarea";
        if (control instanceof HTMLSelectElement) return "select";
        return control.type || "text";
      }),
    ),
  );

  return {
    formId: sanitizeString(form.id || "", 48),
    method: sanitizeString((form.getAttribute("method") || "get").toUpperCase(), 12),
    action: sanitizeActionPath(form.getAttribute("action") || ""),
    fieldCount: controls.length,
    controlTypes,
    hasSensitiveFields: controls.some((control) => {
      const name = "name" in control ? control.name : "";
      const type = control instanceof HTMLInputElement ? control.type : control instanceof HTMLTextAreaElement ? "textarea" : "select";
      return SENSITIVE_KEY_PATTERN.test(name) || SENSITIVE_KEY_PATTERN.test(type);
    }),
  };
}
