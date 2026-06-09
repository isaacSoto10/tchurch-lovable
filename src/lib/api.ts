import { API_BASE } from "@/lib/apiConfig";
import { getMobileAuthSession, isNativeMobileAuth } from "@/lib/mobileAuth";
import type {
  ChurchEvent,
  EventCheckInPayload,
  EventCheckInResponse,
  EventManualCheckInPayload,
  EventQrResponse,
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

export function fetchEvent(eventId: string, token?: string | null) {
  return apiFetch<ChurchEvent>(`/events/${eventId}`, {}, token);
}

export function fetchEventRsvp(eventId: string, token?: string | null) {
  return apiFetch<EventRsvpResponse>(`/events/${eventId}/rsvp`, {}, token);
}

export function updateEventRsvp(eventId: string, status: EventRsvpStatus, token?: string | null) {
  return apiFetch<EventRsvpResponse>(
    `/events/${eventId}/rsvp`,
    {
      method: "POST",
      body: JSON.stringify({ status }),
    },
    token
  );
}

export function deleteEventRsvp(eventId: string, token?: string | null) {
  return apiFetch<{ success?: boolean }>(`/events/${eventId}/rsvp`, { method: "DELETE" }, token);
}

export function fetchMyEventQr(eventId: string, token?: string | null) {
  return apiFetch<EventQrResponse>(`/events/${eventId}/my-qr`, {}, token);
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
