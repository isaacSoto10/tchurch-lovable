import { Capacitor } from "@capacitor/core";
import { API_BASE } from "@/lib/apiConfig";
import { actionNow, logApiRequestSummary } from "@/lib/userActionLogger";

const STORAGE_KEY = "tchurch_mobile_auth_session";
const PRINCIPAL_STORAGE_KEY = "tchurch_mobile_auth_principal";
const PENDING_CLEAR_STORAGE_KEY = "tchurch_mobile_auth_pending_clear";
const CHANGE_EVENT = "tchurch-mobile-auth-change";

export type MobileAuthUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
};

export type MobileAuthSession = {
  token: string;
  expiresAt: string;
  user: MobileAuthUser;
};

export type MobileJoinChurch = {
  id: string;
  name: string;
  joinCode?: string;
};

export type MobileJoinStartResponse = {
  ok: true;
  email: string;
  expiresAt: string;
  church: MobileJoinChurch;
};

export type MobileJoinVerifyResponse = MobileAuthSession & {
  ok: true;
  church: MobileJoinChurch;
};

export const isNativeMobileAuth = Capacitor.isNativePlatform();

let activeSession: MobileAuthSession | null = null;
let sessionRevision = 0;
let initialization: Promise<void> | undefined;
let vaultQueue: Promise<unknown> = Promise.resolve();

function enqueueVaultOperation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = vaultQueue.then(operation);
  vaultQueue = pending.catch(() => undefined);
  return pending;
}

export class MobileAuthApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "MobileAuthApiError";
    this.status = status;
    this.code = code;
  }
}

type MobileAuthErrorBody = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
};

function isBackendDiagnosticMessage(message: string) {
  return [
    /column .+ does not exist/i,
    /relation .+ does not exist/i,
    /syntax error at or near/i,
    /invalid input syntax for type/i,
    /violates .+ constraint/i,
    /duplicate key value violates unique constraint/i,
    /\bpostgres\b/i,
    /\bprisma\b/i,
    /\bsqlstate\b/i,
    /\bquery failed\b/i,
  ].some((pattern) => pattern.test(message));
}

function mobileAuthErrorMessage(data: unknown, status: number) {
  const error = data as MobileAuthErrorBody | null | undefined;
  const rawMessage =
    error && typeof error === "object"
      ? error.error || error.message
      : typeof data === "string"
        ? data
        : "";
  const message = String(rawMessage || "").trim();
  const lowerMessage = message.toLowerCase();

  if (
    !message ||
    status >= 500 ||
    lowerMessage.includes("unprocessable entity") ||
    lowerMessage.startsWith("unable to ") ||
    isBackendDiagnosticMessage(message)
  ) {
    return `No pudimos completar la autenticación móvil (${status}). Intenta de nuevo.`;
  }

  return message;
}

function isExpired(session: MobileAuthSession) {
  const expiration = Date.parse(session.expiresAt);
  return !Number.isFinite(expiration) || expiration <= Date.now();
}

function validPrincipalId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    // eslint-disable-next-line no-control-regex -- Reject control characters in stored principal identifiers.
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function rememberPrincipal(principalId: string) {
  if (validPrincipalId(principalId) && localStorage.getItem(PRINCIPAL_STORAGE_KEY) !== principalId) {
    localStorage.setItem(PRINCIPAL_STORAGE_KEY, principalId);
  }
}

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function clearMobileViewStorage() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key && /^(tchurch_(?:native_api_cache_|ios_\w+_snapshot_v\d+:|service_media_snapshot_v\d+:|action_log_session_id$))/.test(key)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Cache cleanup must not prevent completing an authentication change.
  }
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  const startedAt = actionNow();

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
    });
  } catch (error) {
    logApiRequestSummary({
      path,
      method: "POST",
      status: 0,
      ok: false,
      durationMs: actionNow() - startedAt,
      body: JSON.stringify(body),
      source: "mobile-auth",
    });
    console.error("[mobileAuth] Network request failed", { path, error });
    throw new Error("The app could not reach the Tchurch sign-in server. Please check your connection and try again.");
  }

  logApiRequestSummary({
    path,
    method: "POST",
    status: response.status,
    ok: response.ok,
    durationMs: actionNow() - startedAt,
    body: JSON.stringify(body),
    source: "mobile-auth",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data as MobileAuthErrorBody;
    throw new MobileAuthApiError(
      mobileAuthErrorMessage(data, response.status),
      response.status,
      typeof error?.code === "string" ? error.code : undefined
    );
  }

  return data as T;
}

function parseStoredSession(raw: string | null | undefined): MobileAuthSession | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as MobileAuthSession;
    return typeof session?.token === "string" && session.token && validPrincipalId(session?.user?.id) ? session : null;
  } catch {
    return null;
  }
}

export function initializeMobileAuthSession(): Promise<void> {
  if (!isNativeMobileAuth) return Promise.resolve();
  if (initialization) return initialization;

  const revision = sessionRevision;
  initialization = enqueueVaultOperation(async () => {
    const legacy = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    const { mobileSessionVault } = await import("./mobileSessionVault");
    if (localStorage.getItem(PENDING_CLEAR_STORAGE_KEY)) {
      await mobileSessionVault.clear();
      localStorage.removeItem(PENDING_CLEAR_STORAGE_KEY);
      return;
    }

    const secure = (await mobileSessionVault.load())?.session;
    const session = parseStoredSession(secure ?? legacy);
    if (revision !== sessionRevision) return;
    if (session) rememberPrincipal(session.user.id);
    if (!session || isExpired(session)) {
      if (secure) await mobileSessionVault.clear();
      return;
    }
    if (!secure) await mobileSessionVault.save({ session: JSON.stringify(session) });
    if (revision === sessionRevision) {
      activeSession = session;
      emitChange();
    }
  }).catch(() => undefined);
  return initialization;
}

export function getMobileAuthSession(): MobileAuthSession | null {
  if (!isNativeMobileAuth || !activeSession) return null;
  if (!isExpired(activeSession)) return activeSession;

  // Studio LAN retains the non-secret principal hint after token expiry.
  activeSession = null;
  const revision = ++sessionRevision;
  void enqueueVaultOperation(async () => {
    if (revision !== sessionRevision) return;
    const { mobileSessionVault } = await import("./mobileSessionVault");
    await mobileSessionVault.clear();
  }).catch(() => undefined);
  queueMicrotask(emitChange);
  return null;
}

export function getMobileAuthPrincipalId(): string | null {
  if (!isNativeMobileAuth) return null;

  const session = getMobileAuthSession();
  if (session) return session.user.id;

  try {
    const principalId = localStorage.getItem(PRINCIPAL_STORAGE_KEY);
    if (validPrincipalId(principalId)) return principalId;
    localStorage.removeItem(PRINCIPAL_STORAGE_KEY);
  } catch {
    return null;
  }
  return null;
}

export function saveMobileAuthSession(session: MobileAuthSession): Promise<void> {
  const revision = ++sessionRevision;
  return enqueueVaultOperation(async () => {
    if (revision !== sessionRevision) return;
    try {
      const { mobileSessionVault } = await import("./mobileSessionVault");
      await mobileSessionVault.save({ session: JSON.stringify(session) });
      if (revision !== sessionRevision) return;
      if (localStorage.getItem(PRINCIPAL_STORAGE_KEY) !== session.user.id) clearMobileViewStorage();
      rememberPrincipal(session.user.id);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PENDING_CLEAR_STORAGE_KEY);
      activeSession = session;
      emitChange();
    } catch {
      throw new Error("No se pudo guardar el inicio de sesión de forma segura. Intenta de nuevo.");
    }
  });
}

export function clearMobileAuthSession(): Promise<boolean> {
  const revision = ++sessionRevision;
  activeSession = null;
  try {
    localStorage.setItem(PENDING_CLEAR_STORAGE_KEY, "1");
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PRINCIPAL_STORAGE_KEY);
  } catch {
    // Still attempt to delete the native entry if WebView storage is unavailable.
  }
  clearMobileViewStorage();
  emitChange();
  return enqueueVaultOperation(async () => {
    try {
      const { mobileSessionVault } = await import("./mobileSessionVault");
      await mobileSessionVault.clear();
      if (revision === sessionRevision) localStorage.removeItem(PENDING_CLEAR_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  });
}

export function onMobileAuthChange(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export async function requestMobileAuthCode(email: string) {
  return postJson<{ ok: true; email: string; expiresAt: string }>("/mobile-auth/start", { email });
}

export async function verifyMobileAuthCode(email: string, code: string) {
  const session = await postJson<MobileAuthSession & { ok: true }>("/mobile-auth/verify", { email, code });
  await saveMobileAuthSession({
    token: session.token,
    expiresAt: session.expiresAt,
    user: session.user,
  });
  return session;
}

export async function requestMobileJoinAuthCode(email: string, joinCode: string) {
  return postJson<MobileJoinStartResponse>("/mobile-auth/join/start", { email, joinCode });
}

export async function verifyMobileJoinAuthCode(email: string, joinCode: string, verificationCode: string) {
  const session = await postJson<MobileJoinVerifyResponse>("/mobile-auth/join/verify", {
    email,
    joinCode,
    verificationCode,
  });
  await saveMobileAuthSession({
    token: session.token,
    expiresAt: session.expiresAt,
    user: session.user,
  });
  return session;
}
