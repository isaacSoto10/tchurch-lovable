// Use deployed API in production, localhost in development
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
const CHURCH_ID_KEY = "tchurch_church_id";

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
  const resolvedToken = token ?? (await window.Clerk?.session?.getToken?.()) ?? null;
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
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data;
}

export async function fetchUserChurches<T = unknown>(token: string): Promise<T[]> {
  const url = `${API_BASE}/churches/mine`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch churches: ${res.status}`);
  }

  const data = await res.json();
  return data.churches || [];
}
