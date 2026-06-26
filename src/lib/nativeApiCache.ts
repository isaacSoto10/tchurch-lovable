import { isNativeMobileAuth } from "@/lib/mobileAuth";

const CHURCH_ID_KEY = "tchurch_church_id";
const CACHE_PREFIX = "tchurch_native_api_cache_v1";
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const SHORT_TTL_MS = 20 * 1000;
const MEMBER_TTL_MS = 60 * 1000;
const MAX_STALE_MS = 30 * 60 * 1000;

type CacheEntry<T> = {
  savedAt: number;
  value: T;
};

export type NativeApiCacheHit<T> = {
  value: T;
  ageMs: number;
  fresh: boolean;
  stale: boolean;
};

function storageAvailable() {
  return isNativeMobileAuth && typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function currentChurchId() {
  try {
    return window.localStorage.getItem(CHURCH_ID_KEY) || "no-church";
  } catch {
    return "no-church";
  }
}

function cacheKey(path: string) {
  return `${CACHE_PREFIX}:${currentChurchId()}:${path}`;
}

export function nativeApiCacheTtlMs(path: string) {
  if (path.startsWith("/channels") || path.includes("/messages")) return SHORT_TTL_MS;
  if (path.includes("/users") || path.includes("/members")) return MEMBER_TTL_MS;
  return DEFAULT_TTL_MS;
}

export function isNativeApiCacheableGet(path: string) {
  if (!storageAvailable()) return false;
  if (!path || !path.startsWith("/")) return false;

  const lowerPath = path.toLowerCase();
  if (lowerPath.includes("token")) return false;
  if (lowerPath.includes("realtime")) return false;
  if (lowerPath.includes("/qr")) return false;
  if (lowerPath.includes("scanner")) return false;
  if (lowerPath.includes("check-in")) return false;
  if (lowerPath.includes("device-token")) return false;

  return true;
}

export function readNativeApiCache<T>(path: string): NativeApiCacheHit<T> | null {
  if (!isNativeApiCacheableGet(path)) return null;

  try {
    const raw = window.sessionStorage.getItem(cacheKey(path));
    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.savedAt !== "number") return null;

    const ageMs = Date.now() - entry.savedAt;
    if (ageMs > MAX_STALE_MS) return null;

    return {
      value: entry.value,
      ageMs,
      fresh: ageMs <= nativeApiCacheTtlMs(path),
      stale: ageMs <= MAX_STALE_MS,
    };
  } catch {
    return null;
  }
}

export function writeNativeApiCache<T>(path: string, value: T) {
  if (!isNativeApiCacheableGet(path)) return;

  try {
    window.sessionStorage.setItem(cacheKey(path), JSON.stringify({ savedAt: Date.now(), value } satisfies CacheEntry<T>));
  } catch {
    // Cache storage is best-effort and must never block app data.
  }
}

export function clearNativeApiCache() {
  if (!storageAvailable()) return;

  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // A failed cache clear should not interrupt mutations.
  }
}
