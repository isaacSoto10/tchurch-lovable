import { API_BASE } from "@/lib/apiConfig";
import { getMobileAuthSession, isNativeMobileAuth } from "@/lib/mobileAuth";

const CHURCH_ID_KEY = "tchurch_church_id";

export class ApiError extends Error {
  status: number;
  body: unknown;
  blocked?: boolean;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;

    if (body && typeof body === "object" && "blocked" in body) {
      this.blocked = Boolean((body as { blocked?: unknown }).blocked);
    }
  }
}

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken: () => Promise<string | null>;
      } | null;
    };
  }
}

export function getChurchId(): string | null {
  return localStorage.getItem(CHURCH_ID_KEY);
}

export function setChurchId(id: string | null): void {
  if (id) {
    localStorage.setItem(CHURCH_ID_KEY, id);
  } else {
    localStorage.removeItem(CHURCH_ID_KEY);
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const method = (options.method || "GET").toUpperCase();
  const shouldNoStore = method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  const resolvedToken =
    token ??
    (isNativeMobileAuth ? getMobileAuthSession()?.token : null) ??
    (await window.Clerk?.session?.getToken?.()) ??
    null;
  const headers: Record<string, string> = {
    ...(!isFormData ? { "Content-Type": "application/json" } : {}),
    ...(shouldNoStore ? { "Cache-Control": "no-store", Pragma: "no-cache" } : {}),
    ...(options.headers as Record<string, string>),
  };

  if (resolvedToken) {
    headers["Authorization"] = `Bearer ${resolvedToken}`;
  }

  const churchId = getChurchId();
  if (churchId) {
    headers["x-church-id"] = churchId;
  }

  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      cache: options.cache ?? (shouldNoStore ? "no-store" : undefined),
      headers,
    });
  } catch (error) {
    console.error("API request failed before receiving a response", { path, url, error });
    throw new ApiError(
      "No se pudo conectar con Tchurch. Revisa tu conexión e intenta otra vez.",
      0,
      { error: error instanceof Error ? error.message : String(error), path }
    );
  }

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    const message =
      parsed && typeof parsed === "object"
        ? String(
            (parsed as { error?: unknown; message?: unknown }).error ||
              (parsed as { message?: unknown }).message ||
              `API error ${res.status}`
          )
        : String(parsed || `API error ${res.status}`);

    throw new ApiError(message, res.status, parsed);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function fetchUserChurches<T = unknown>(token: string): Promise<T[]> {
  const url = `${API_BASE}/churches/mine`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const churchId = getChurchId();
  if (churchId) {
    headers["x-church-id"] = churchId;
  }

  const res = await fetch(url, {
    cache: "no-store",
    headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch churches: ${res.status}`);
  }

  const data = await res.json();
  return data.churches || [];
}
