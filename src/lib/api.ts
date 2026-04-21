import { mockFetch } from "./mock-api";

const API_BASE = "https://www.tchurchapp.com/api";
const CHURCH_ID_KEY = "tchurch_church_id";
export const USE_MOCK = true;

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
  if (USE_MOCK) {
    return mockFetch<T>(path, options, token);
  }

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
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data;
}

export async function fetchUserChurches(token: string): Promise<any[]> {
  if (USE_MOCK) {
    return mockFetch<any>("/churches/mine", undefined, token).then(d => d.churches || []);
  }

  const url = `${API_BASE}/churches/mine`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch churches: ${res.status}`);
  }

  const data = await res.json();
  return data.churches || [];
}
