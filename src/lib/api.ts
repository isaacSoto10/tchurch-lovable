import { API_BASE } from "@/lib/apiConfig";
import { getMobileAuthSession, isNativeMobileAuth } from "@/lib/mobileAuth";
import { clearNativeApiCache, isNativeApiCacheableGet, readNativeApiCache, writeNativeApiCache } from "@/lib/nativeApiCache";
import { actionNow, logApiRequestSummary } from "@/lib/userActionLogger";
import type {
  ChurchEvent,
  EventCheckInPayload,
  EventCheckInResponse,
  EventManualCheckInPayload,
  EventQrResponse,
  EventRsvpPayload,
  EventRsvpResponse,
  EventRsvpStatus,
  EventSignupItem,
  EventSignupItemPayload,
  EventSignupItemUpdatePayload,
} from "@/types/events";

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

type ClerkTokenWindow = Window & {
  Clerk?: {
    session?: {
      getToken?: () => Promise<string | null>;
    } | null;
  };
};

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
    (await (window as ClerkTokenWindow).Clerk?.session?.getToken?.()) ??
    null;
  const shouldUseNativeCache =
    method === "GET" &&
    Boolean(resolvedToken) &&
    options.cache !== "no-store" &&
    options.cache !== "reload" &&
    options.cache !== "no-cache" &&
    isNativeApiCacheableGet(path);
  const nativeCache = shouldUseNativeCache ? readNativeApiCache<T>(path) : null;

  if (nativeCache?.fresh) {
    return nativeCache.value;
  }

  const headers: Record<string, string> = {
    ...(!isFormData ? { "Content-Type": "application/json" } : {}),
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
  const startedAt = actionNow();
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      cache: options.cache ?? (shouldNoStore ? "no-store" : undefined),
      headers,
    });
  } catch (error) {
    logApiRequestSummary({
      path,
      method,
      status: 0,
      ok: false,
      durationMs: actionNow() - startedAt,
      body: options.body,
      source: "apiFetch",
    });
    if (nativeCache?.stale) {
      console.warn("[apiFetch] Using stale native cache after network failure", { path });
      return nativeCache.value;
    }
    console.error("API request failed before receiving a response", { path, url, error });
    throw new ApiError(
      "No se pudo conectar con Tchurch. Revisa tu conexión e intenta otra vez.",
      0,
      { error: error instanceof Error ? error.message : String(error), path }
    );
  }

  logApiRequestSummary({
    path,
    method,
    status: res.status,
    ok: res.ok,
    durationMs: actionNow() - startedAt,
    body: options.body,
    source: "apiFetch",
  });

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

    if (nativeCache?.stale && res.status >= 500) {
      console.warn("[apiFetch] Using stale native cache after server error", { path, status: res.status });
      return nativeCache.value;
    }

    throw new ApiError(message, res.status, parsed);
  }

  if (isNativeMobileAuth && method !== "GET") clearNativeApiCache();

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;

  try {
    const data = JSON.parse(text) as T;
    if (shouldUseNativeCache) writeNativeApiCache(path, data);
    return data;
  } catch {
    const data = text as T;
    if (shouldUseNativeCache) writeNativeApiCache(path, data);
    return data;
  }
}

export async function fetchUserChurchSelection<T = unknown>(token: string): Promise<{
  churches: T[];
  selectedChurchId: string | null;
}> {
  const path = "/churches/mine";
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const churchId = isNativeMobileAuth ? getChurchId() : null;
  if (churchId) {
    headers["x-church-id"] = churchId;
  }

  const startedAt = actionNow();
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers,
    });
  } catch (error) {
    logApiRequestSummary({
      path,
      method: "GET",
      status: 0,
      ok: false,
      durationMs: actionNow() - startedAt,
      source: "church-selection",
    });
    throw error;
  }

  logApiRequestSummary({
    path,
    method: "GET",
    status: res.status,
    ok: res.ok,
    durationMs: actionNow() - startedAt,
    source: "church-selection",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch churches: ${res.status}`);
  }

  const data = await res.json();
  return {
    churches: Array.isArray(data.churches) ? data.churches : [],
    selectedChurchId: typeof data.selectedChurchId === "string" ? data.selectedChurchId : null,
  };
}

export async function fetchUserChurches<T = unknown>(token: string): Promise<T[]> {
  return (await fetchUserChurchSelection<T>(token)).churches;
}

export function eventCollectionPath(search?: string) {
  const query = search?.trim().replace(/^\?/, "");
  return query ? `/events?${query}` : "/events";
}

export function eventDetailPath(eventId: string) {
  return `/events/${encodeURIComponent(eventId)}`;
}

export type EventCrudOperation = "create" | "read" | "update" | "delete";

export function eventCrudRequest(
  operation: EventCrudOperation,
  eventIdOrPayload?: string | Record<string, unknown>,
  payload?: Record<string, unknown>,
): { path: string; options: RequestInit } {
  if (operation === "create") {
    return {
      path: eventCollectionPath(),
      options: { method: "POST", body: JSON.stringify(eventIdOrPayload ?? {}) },
    };
  }

  const eventId = String(eventIdOrPayload || "");
  if (!eventId) throw new Error(`Missing event id for ${operation}`);

  if (operation === "read") {
    return { path: eventDetailPath(eventId), options: {} };
  }

  if (operation === "update") {
    return {
      path: eventDetailPath(eventId),
      options: { method: "PUT", body: JSON.stringify(payload ?? {}) },
    };
  }

  return { path: eventDetailPath(eventId), options: { method: "DELETE" } };
}

export function createEvent(payload: Record<string, unknown>, token?: string | null) {
  const request = eventCrudRequest("create", payload);
  return apiFetch<ChurchEvent>(request.path, request.options, token);
}

export function fetchEvent(eventId: string, token?: string | null) {
  const request = eventCrudRequest("read", eventId);
  return apiFetch<ChurchEvent>(request.path, request.options, token);
}

export function updateEvent(eventId: string, payload: Record<string, unknown>, token?: string | null) {
  const request = eventCrudRequest("update", eventId, payload);
  return apiFetch<ChurchEvent>(request.path, request.options, token);
}

export function deleteEvent(eventId: string, token?: string | null) {
  const request = eventCrudRequest("delete", eventId);
  return apiFetch<{ success?: boolean }>(request.path, request.options, token);
}

export function fetchEventRsvp(eventId: string, token?: string | null) {
  return apiFetch<EventRsvpResponse>(`${eventDetailPath(eventId)}/rsvp`, {}, token);
}

export function updateEventRsvp(eventId: string, payload: EventRsvpStatus | EventRsvpPayload, token?: string | null) {
  const body = typeof payload === "string" ? { status: payload } : payload;

  return apiFetch<EventRsvpResponse>(
    `${eventDetailPath(eventId)}/rsvp`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token
  );
}

export function deleteEventRsvp(eventId: string, token?: string | null) {
  return apiFetch<{ success?: boolean }>(`${eventDetailPath(eventId)}/rsvp`, { method: "DELETE" }, token);
}

export function fetchMyEventQr(eventId: string, token?: string | null) {
  return apiFetch<EventQrResponse>(`${eventDetailPath(eventId)}/my-qr`, {}, token);
}

export function scanEventCheckIn(eventId: string, payload: EventCheckInPayload, token?: string | null) {
  return apiFetch<EventCheckInResponse>(
    `/events/${eventId}/check-ins/scan`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export function manualEventCheckIn(eventId: string, payload: EventManualCheckInPayload, token?: string | null) {
  return apiFetch<EventCheckInResponse>(
    `/events/${eventId}/check-ins/manual`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export function fetchEventSignupItems(eventId: string, token?: string | null) {
  return apiFetch<EventSignupItem[]>(`/events/${eventId}/signup-items`, {}, token);
}

export function createEventSignupItem(eventId: string, payload: EventSignupItemPayload, token?: string | null) {
  return apiFetch<EventSignupItem>(
    `/events/${eventId}/signup-items`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export function updateEventSignupItem(eventId: string, itemId: string, payload: EventSignupItemUpdatePayload, token?: string | null) {
  return apiFetch<EventSignupItem>(
    `/events/${eventId}/signup-items/${itemId}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
    token
  );
}

export function deleteEventSignupItem(eventId: string, itemId: string, token?: string | null) {
  return apiFetch<{ success?: boolean }>(
    `/events/${eventId}/signup-items/${itemId}`,
    { method: "DELETE" },
    token
  );
}

export function claimEventSignupItem(eventId: string, itemId: string, token?: string | null) {
  return apiFetch(
    `/events/${eventId}/signup-items`,
    {
      method: "POST",
      body: JSON.stringify({ action: "claim", itemId, quantity: 1 }),
    },
    token
  );
}
