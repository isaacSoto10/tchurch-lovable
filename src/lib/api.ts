// Use deployed API in production, localhost in development
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
const CHURCH_ID_KEY = "tchurch_church_id";

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

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const churchId = getChurchId();
  if (churchId) {
    headers["x-church-id"] = churchId;
  }

  const url = `${API_BASE}${path}`;
  console.log(`[apiFetch] Requesting: ${url}`);
  console.log(`[apiFetch] Headers:`, headers);

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[apiFetch] Error ${res.status}: ${body}`);
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  console.log(`[apiFetch] Response from ${path}:`, data);
  return data;
}

export async function fetchUserChurches(token: string): Promise<any[]> {
  const url = `${API_BASE}/churches/mine`;
  console.log(`[fetchUserChurches] Requesting: ${url}`);
  
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[fetchUserChurches] Error ${res.status}: ${body}`);
    throw new Error(`Failed to fetch churches: ${res.status}`);
  }

  const data = await res.json();
  console.log(`[fetchUserChurches] Response:`, data);
  return data.churches || [];
}