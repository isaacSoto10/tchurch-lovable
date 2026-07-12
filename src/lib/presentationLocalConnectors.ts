import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const DEFAULT_PROPRESENTER_ENDPOINT = "http://localhost:50001";
export const DEFAULT_OBS_WEBSOCKET_ENDPOINT = "ws://localhost:4455";
export const PRESENTATION_CONNECTOR_STORAGE_PREFIX = "tchurch_live_connectors_v1";

export type PresentationLocalConnectorKind = "propresenter" | "obs" | "studio_bridge";
export type PresentationExternalRole = "worship_leader" | "band" | "vocals" | "av" | "speaker" | "operator" | "stage" | "all";
export type ProPresenterAction = "status" | "next" | "previous" | "clear_slide";
export type ObsRequestType =
  | "GetVersion"
  | "GetSceneList"
  | "GetCurrentProgramScene"
  | "SetCurrentProgramScene"
  | "GetStreamStatus"
  | "StartStream"
  | "StopStream";

export type PresentationLocalConnectorSettings = {
  schemaVersion: 1;
  propresenterEndpoint: string;
  obsEndpoint: string;
  studioBridgeEndpoint: string;
};

export type ProPresenterStatus = {
  connected: true;
  host: string;
  version: string | null;
  platform: string | null;
  name: string | null;
};

export type PresentationLocalHttpRuntime = {
  isNativePlatform: () => boolean;
  nativeGet: (options: Parameters<typeof CapacitorHttp.get>[0]) => ReturnType<typeof CapacitorHttp.get>;
  browserFetch: typeof fetch;
};

const presentationLocalHttpRuntime: PresentationLocalHttpRuntime = {
  isNativePlatform: () => Capacitor.isNativePlatform(),
  nativeGet: (options) => CapacitorHttp.get(options),
  browserFetch: (input, init) => fetch(input, init),
};

const PRESENTATION_EXTERNAL_ROLES = new Set<PresentationExternalRole>(["av", "operator", "all"]);

export function canOperatePresentationExternalSystems(input: {
  mode: "live" | "rehearsal";
  controllerOwned: boolean;
  canEdit: boolean;
  roles: readonly string[];
}) {
  if (input.mode !== "live" || !input.controllerOwned) return false;
  if (input.canEdit) return true;
  return input.roles.some((role) => PRESENTATION_EXTERNAL_ROLES.has(role as PresentationExternalRole));
}

export function presentationExternalAuthorityScope(input: {
  baseScope: string;
  mode: "live" | "rehearsal";
  controllerOwned: boolean;
  canEdit: boolean;
  roles: readonly string[];
}) {
  const roles = [...new Set(input.roles.filter((role): role is PresentationExternalRole => [
    "worship_leader", "band", "vocals", "av", "speaker", "operator", "stage", "all",
  ].includes(role)))].sort();
  return [
    input.baseScope,
    input.mode,
    input.controllerOwned ? "controller" : "observer",
    input.canEdit ? "editor" : "viewer",
    roles.join(",") || "no-role",
  ].map(encodeURIComponent).join("::");
}

type ObsHello = {
  op: 0;
  d: {
    obsWebSocketVersion: string;
    rpcVersion: number;
    authentication?: { challenge: string; salt: string };
  };
};

type ObsIdentified = { op: 2; d: { negotiatedRpcVersion: number } };
type ObsRequestResponse = {
  op: 7;
  d: {
    requestType: string;
    requestId: string;
    requestStatus: { result: boolean; code: number; comment?: string };
    responseData?: Record<string, unknown>;
  };
};

export type ObsProtocolFrame = ObsHello | ObsIdentified | ObsRequestResponse;

const PROPRESENTER_ACTION_PATHS: Record<ProPresenterAction, string> = {
  status: "/version",
  next: "/v1/presentation/active/next/trigger",
  previous: "/v1/presentation/active/previous/trigger",
  clear_slide: "/v1/clear/layer/slide",
};
const OBS_REQUESTS = new Set<ObsRequestType>([
  "GetVersion",
  "GetSceneList",
  "GetCurrentProgramScene",
  "SetCurrentProgramScene",
  "GetStreamStatus",
  "StartStream",
  "StopStream",
]);

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

export function isPrivatePresentationConnectorHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host === "::1"
    || host.endsWith(".local")
    || /^(fc|fd)[0-9a-f:]+$/i.test(host)
    || /^fe[89ab][0-9a-f:]+$/i.test(host)
    || isPrivateIpv4(host);
}

export function normalizePresentationConnectorEndpoint(value: string, kind: PresentationLocalConnectorKind) {
  const fallback = kind === "propresenter"
    ? DEFAULT_PROPRESENTER_ENDPOINT
    : kind === "obs"
      ? DEFAULT_OBS_WEBSOCKET_ENDPOINT
      : "http://localhost:4317";
  let url: URL;
  try {
    url = new URL(value.trim() || fallback);
  } catch {
    throw new Error("Escribe una dirección local válida.");
  }
  const allowedProtocols = kind === "obs" ? new Set(["ws:", "wss:"]) : new Set(["http:", "https:"]);
  if (!allowedProtocols.has(url.protocol)) throw new Error(kind === "obs" ? "OBS necesita una dirección ws:// o wss://." : "El conector necesita una dirección http:// o https://.");
  if (url.username || url.password) throw new Error("No incluyas credenciales en la dirección del conector.");
  if (!isPrivatePresentationConnectorHost(url.hostname)) throw new Error("Por seguridad, el conector solo acepta localhost o una dirección privada de tu red local.");
  if (url.search || url.hash) throw new Error("La dirección local no puede incluir parámetros ni fragmentos.");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("Usa solo la dirección base y el puerto del conector.");
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizePresentationLocalConnectorSettings(value: unknown): PresentationLocalConnectorSettings {
  const source = recordValue(value);
  if (source?.schemaVersion !== 1) {
    return {
      schemaVersion: 1,
      propresenterEndpoint: DEFAULT_PROPRESENTER_ENDPOINT,
      obsEndpoint: DEFAULT_OBS_WEBSOCKET_ENDPOINT,
      studioBridgeEndpoint: "http://localhost:4317",
    };
  }
  const fallback = normalizePresentationLocalConnectorSettings(null);
  const normalizeOrFallback = (candidate: unknown, kind: PresentationLocalConnectorKind, defaultValue: string) => {
    try {
      return normalizePresentationConnectorEndpoint(stringValue(candidate) || defaultValue, kind);
    } catch {
      return defaultValue;
    }
  };
  return {
    schemaVersion: 1,
    propresenterEndpoint: normalizeOrFallback(source.propresenterEndpoint, "propresenter", fallback.propresenterEndpoint),
    obsEndpoint: normalizeOrFallback(source.obsEndpoint, "obs", fallback.obsEndpoint),
    studioBridgeEndpoint: normalizeOrFallback(source.studioBridgeEndpoint, "studio_bridge", fallback.studioBridgeEndpoint),
  };
}

export function presentationConnectorStorageKey(churchId?: string | null) {
  return `${PRESENTATION_CONNECTOR_STORAGE_PREFIX}:${encodeURIComponent(churchId?.trim() || "none")}`;
}

export function readPresentationLocalConnectorSettings(churchId?: string | null) {
  if (typeof localStorage === "undefined") return normalizePresentationLocalConnectorSettings(null);
  try {
    const value = localStorage.getItem(presentationConnectorStorageKey(churchId));
    return normalizePresentationLocalConnectorSettings(value ? JSON.parse(value) : null);
  } catch {
    return normalizePresentationLocalConnectorSettings(null);
  }
}

export function writePresentationLocalConnectorSettings(churchId: string | null | undefined, value: PresentationLocalConnectorSettings) {
  const normalized = normalizePresentationLocalConnectorSettings(value);
  if (typeof localStorage !== "undefined") localStorage.setItem(presentationConnectorStorageKey(churchId), JSON.stringify(normalized));
  return normalized;
}

function timeoutSignal(timeoutMs = 5_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => window.clearTimeout(timeout) };
}

export function validatePresentationConnectorResponseUrl(value: string, endpoint: string, path: string, kind: PresentationLocalConnectorKind) {
  const expectedBase = normalizePresentationConnectorEndpoint(endpoint, kind);
  let received: URL;
  let expected: URL;
  try {
    received = new URL(value);
    expected = new URL(`${expectedBase}${path}`);
  } catch {
    throw new Error("El conector devolvió una dirección inválida.");
  }
  const allowedProtocols = kind === "obs" ? new Set(["ws:", "wss:"]) : new Set(["http:", "https:"]);
  if (!allowedProtocols.has(received.protocol)
    || !isPrivatePresentationConnectorHost(received.hostname)
    || received.username || received.password || received.hash
    || received.origin !== expected.origin
    || received.pathname !== expected.pathname
    || received.search !== expected.search) {
    throw new Error("El conector intentó responder desde otra dirección.");
  }
  return received.toString();
}

export function normalizeProPresenterStatus(value: unknown, endpoint: string): ProPresenterStatus {
  const source = recordValue(value);
  if (!source) throw new Error("ProPresenter respondió con un estado inválido.");
  const version = stringValue(source.version) || stringValue(source.applicationVersion) || stringValue(source.build) || null;
  const platform = stringValue(source.platform) || stringValue(source.os) || null;
  const name = stringValue(source.name) || stringValue(source.application) || "ProPresenter";
  return { connected: true, host: new URL(endpoint).host, version, platform, name };
}

export async function requestProPresenter(
  endpoint: string,
  action: ProPresenterAction,
  options: { mode: "live" | "rehearsal" },
  runtime: PresentationLocalHttpRuntime = presentationLocalHttpRuntime,
) {
  const normalizedEndpoint = normalizePresentationConnectorEndpoint(endpoint, "propresenter");
  if (options.mode === "rehearsal" && action !== "status") {
    return { simulated: true as const, action };
  }
  const path = PROPRESENTER_ACTION_PATHS[action];
  const requestUrl = `${normalizedEndpoint}${path}`;
  if (runtime.isNativePlatform()) {
    const response = await runtime.nativeGet({
      url: requestUrl,
      headers: { Accept: "application/json, text/plain" },
      connectTimeout: 5_000,
      readTimeout: 5_000,
      disableRedirects: true,
      responseType: action === "status" ? "text" : "text",
    });
    validatePresentationConnectorResponseUrl(response.url, normalizedEndpoint, path, "propresenter");
    if (response.status < 200 || response.status >= 300) throw new Error(`ProPresenter respondió ${response.status}.`);
    if (action !== "status") return { simulated: false as const, action };
    let body: unknown = response.data;
    if (typeof body === "string") {
      try { body = body ? JSON.parse(body) : {}; } catch { body = { version: body }; }
    }
    return normalizeProPresenterStatus(body, normalizedEndpoint);
  }
  const timeout = timeoutSignal();
  try {
    const response = await runtime.browserFetch(requestUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: timeout.signal,
    });
    validatePresentationConnectorResponseUrl(response.url, normalizedEndpoint, path, "propresenter");
    if (!response.ok) throw new Error(`ProPresenter respondió ${response.status}.`);
    if (action !== "status") return { simulated: false as const, action };
    const text = await response.text();
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { version: text }; }
    return normalizeProPresenterStatus(body, normalizedEndpoint);
  } finally {
    timeout.clear();
  }
}

export function normalizeObsProtocolFrame(value: unknown): ObsProtocolFrame {
  const source = recordValue(value);
  const data = recordValue(source?.d);
  if (!source || !data || !Number.isInteger(source.op)) throw new Error("OBS envió un mensaje inválido.");
  if (source.op === 0) {
    const version = stringValue(data.obsWebSocketVersion);
    const rpcVersion = Number(data.rpcVersion);
    if (!version || !Number.isInteger(rpcVersion) || rpcVersion < 1) throw new Error("OBS envió un saludo incompatible.");
    const rawAuthentication = recordValue(data.authentication);
    const authentication = rawAuthentication
      ? { challenge: stringValue(rawAuthentication.challenge), salt: stringValue(rawAuthentication.salt) }
      : undefined;
    if (authentication && (!authentication.challenge || !authentication.salt)) throw new Error("OBS envió un reto de autenticación inválido.");
    return { op: 0, d: { obsWebSocketVersion: version, rpcVersion, ...(authentication ? { authentication } : {}) } };
  }
  if (source.op === 2) {
    const negotiatedRpcVersion = Number(data.negotiatedRpcVersion);
    if (negotiatedRpcVersion !== 1) throw new Error("OBS no confirmó exactamente RPC 1.");
    return { op: 2, d: { negotiatedRpcVersion } };
  }
  if (source.op === 7) {
    const requestType = stringValue(data.requestType);
    const requestId = stringValue(data.requestId);
    const status = recordValue(data.requestStatus);
    if (!requestType || !requestId || !status || typeof status.result !== "boolean" || !Number.isInteger(status.code) || (status.result && Number(status.code) !== 100)) {
      throw new Error("OBS envió una respuesta inválida.");
    }
    return {
      op: 7,
      d: {
        requestType,
        requestId,
        requestStatus: { result: status.result, code: Number(status.code), ...(stringValue(status.comment) ? { comment: stringValue(status.comment) } : {}) },
        ...(recordValue(data.responseData) ? { responseData: recordValue(data.responseData)! } : {}),
      },
    };
  }
  throw new Error("OBS envió una operación no esperada.");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function sha256Base64(value: string) {
  if (!globalThis.crypto?.subtle) throw new Error("Este dispositivo no puede autenticar OBS de forma segura.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

export async function computeObsAuthentication(password: string, salt: string, challenge: string) {
  const secret = await sha256Base64(`${password}${salt}`);
  return sha256Base64(`${secret}${challenge}`);
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Este dispositivo no puede crear solicitudes OBS de forma segura.");
}

export class ObsWebSocketClient {
  private socket: WebSocket | null = null;
  private requests = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timeout: number }>();
  private connected = false;

  get isConnected() {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(endpoint: string, suppliedPassword: string) {
    this.disconnect();
    const normalizedEndpoint = normalizePresentationConnectorEndpoint(endpoint, "obs");
    let password = suppliedPassword;
    return new Promise<{ version: string; rpcVersion: number }>((resolve, reject) => {
      const socket = new WebSocket(normalizedEndpoint, "obswebsocket.json");
      this.socket = socket;
      let version = "";
      const timeout = window.setTimeout(() => {
        password = "";
        socket.close();
        reject(new Error("OBS no respondió a tiempo."));
      }, 7_500);
      socket.onmessage = (event) => {
        void (async () => {
          let raw: unknown;
          try { raw = JSON.parse(String(event.data)); } catch { throw new Error("OBS envió datos que no son JSON."); }
          const frame = normalizeObsProtocolFrame(raw);
          if (frame.op === 0) {
            version = frame.d.obsWebSocketVersion;
            const authentication = frame.d.authentication
              ? await computeObsAuthentication(password, frame.d.authentication.salt, frame.d.authentication.challenge)
              : undefined;
            password = "";
            // This client implements RPC 1. Never advertise a newer server
            // version whose request/response semantics we have not audited.
            socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, ...(authentication ? { authentication } : {}) } }));
          } else if (frame.op === 2) {
            window.clearTimeout(timeout);
            this.connected = true;
            resolve({ version, rpcVersion: frame.d.negotiatedRpcVersion });
          } else if (frame.op === 7) {
            const pending = this.requests.get(frame.d.requestId);
            if (!pending) return;
            window.clearTimeout(pending.timeout);
            this.requests.delete(frame.d.requestId);
            if (frame.d.requestStatus.result) pending.resolve(frame.d.responseData || {});
            else pending.reject(new Error(frame.d.requestStatus.comment || `OBS rechazó la acción (${frame.d.requestStatus.code}).`));
          }
        })().catch((error) => {
          window.clearTimeout(timeout);
          password = "";
          socket.close();
          reject(error instanceof Error ? error : new Error("No se pudo autenticar OBS."));
        });
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        password = "";
        reject(new Error("No se pudo conectar con OBS en la red local."));
      };
      socket.onclose = () => {
        window.clearTimeout(timeout);
        password = "";
        this.connected = false;
        for (const pending of this.requests.values()) {
          window.clearTimeout(pending.timeout);
          pending.reject(new Error("OBS cerró la conexión."));
        }
        this.requests.clear();
      };
    });
  }

  async request(type: ObsRequestType, data: Record<string, unknown> = {}, options: { mode: "live" | "rehearsal" }) {
    if (!OBS_REQUESTS.has(type)) throw new Error("Acción OBS no permitida.");
    if (options.mode === "rehearsal" && type !== "GetVersion" && type !== "GetSceneList" && type !== "GetCurrentProgramScene" && type !== "GetStreamStatus") {
      return { simulated: true as const, requestType: type };
    }
    if (!this.isConnected || !this.socket) throw new Error("Conecta OBS antes de usar este control.");
    const id = requestId();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("OBS no confirmó la acción a tiempo."));
      }, 5_000);
      this.requests.set(id, { resolve, reject, timeout });
      try {
        this.socket!.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data } }));
      } catch {
        window.clearTimeout(timeout);
        this.requests.delete(id);
        reject(new Error("OBS no aceptó la solicitud en el socket local."));
      }
    });
  }

  disconnect() {
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    for (const pending of this.requests.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("Se desconectó OBS."));
    }
    this.requests.clear();
  }
}

export type PresentationObsConnection = {
  client: ObsWebSocketClient;
  endpoint: string;
  version: string;
  scope: string;
};

let activeObsConnection: PresentationObsConnection | null = null;

/**
 * The authenticated socket may survive production-panel tab changes, but the
 * password never does: ObsWebSocketClient erases it during the handshake.
 */
export function setActivePresentationObsConnection(connection: PresentationObsConnection) {
  if (activeObsConnection?.client !== connection.client) activeObsConnection?.client.disconnect();
  activeObsConnection = connection;
  return connection;
}

export function getActivePresentationObsConnection(expectedScope?: string) {
  if (activeObsConnection && !activeObsConnection.client.isConnected) activeObsConnection = null;
  if (activeObsConnection && expectedScope !== undefined && activeObsConnection.scope !== expectedScope) return null;
  return activeObsConnection;
}

export function disconnectActivePresentationObsConnection(expectedScope?: string) {
  if (expectedScope !== undefined && activeObsConnection?.scope !== expectedScope) return;
  activeObsConnection?.client.disconnect();
  activeObsConnection = null;
}

/** Disconnects an OBS socket whenever its dynamic account/church/service/role
 * authority no longer matches. This guard lives above the panel so it also
 * runs while the Broadcast tab is closed. */
export function reconcileActivePresentationObsAuthority(expectedScope: string, authorized: boolean) {
  const active = getActivePresentationObsConnection();
  if (!active || (authorized && active.scope === expectedScope)) return false;
  disconnectActivePresentationObsConnection();
  return true;
}

export type PresentationObsLifecycleRuntime = {
  addAppStateListener: (listener: (state: { isActive: boolean }) => void) => Promise<{ remove: () => void | Promise<void> }>;
  addVisibilityListener: (listener: () => void) => () => void;
  isDocumentHidden: () => boolean;
};

/** Keeps OBS cleanup alive at the presentation-page level, even when the hub
 * or Broadcast tab is unmounted. It never reconnects without a password. */
export function installPresentationObsBackgroundLifecycle(runtime: PresentationObsLifecycleRuntime) {
  let disposed = false;
  let appListener: { remove: () => void | Promise<void> } | null = null;
  const removeVisibility = runtime.addVisibilityListener(() => {
    if (runtime.isDocumentHidden()) disconnectActivePresentationObsConnection();
  });
  void runtime.addAppStateListener(({ isActive }) => {
    if (!isActive) disconnectActivePresentationObsConnection();
  }).then((listener) => {
    if (disposed) void listener.remove();
    else appListener = listener;
  });
  return () => {
    disposed = true;
    removeVisibility();
    void appListener?.remove();
    disconnectActivePresentationObsConnection();
  };
}
