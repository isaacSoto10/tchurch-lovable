import { Capacitor } from "@capacitor/core";
import { API_BASE } from "@/lib/apiConfig";
import { actionNow, logApiRequestSummary } from "@/lib/userActionLogger";

const STORAGE_KEY = "tchurch_mobile_auth_session";
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
  return new Date(session.expiresAt).getTime() <= Date.now();
}

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  const startedAt = actionNow();

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

export function getMobileAuthSession(): MobileAuthSession | null {
  if (!isNativeMobileAuth) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw) as MobileAuthSession;
    if (!session?.token || !session?.user?.id || isExpired(session)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveMobileAuthSession(session: MobileAuthSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  emitChange();
}

export function clearMobileAuthSession() {
  localStorage.removeItem(STORAGE_KEY);
  emitChange();
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
  saveMobileAuthSession({
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
  saveMobileAuthSession({
    token: session.token,
    expiresAt: session.expiresAt,
    user: session.user,
  });
  return session;
}
