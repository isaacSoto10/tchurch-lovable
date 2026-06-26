import { isNativeMobileAuth } from "@/lib/mobileAuth";

export const APP_PAGE_SNAPSHOT_TTL_MS = 2 * 60 * 1000;

type StoredSnapshot<T> = {
  savedAt: number;
  data: T;
};

type SnapshotOptions<T> = {
  ttlMs?: number;
  nativeOnly?: boolean;
  validate?: (data: unknown) => data is T;
};

function canUseSessionSnapshots(nativeOnly = true) {
  return (
    typeof window !== "undefined" &&
    typeof window.sessionStorage !== "undefined" &&
    (!nativeOnly || isNativeMobileAuth)
  );
}

export function sessionSnapshotKey(prefix: string, scope?: string | null) {
  const safeScope = String(scope || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${prefix}:${safeScope}`;
}

export function readSessionSnapshot<T>(
  key: string,
  options: SnapshotOptions<T> = {},
): StoredSnapshot<T> | null {
  if (!canUseSessionSnapshots(options.nativeOnly)) return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;

    const snapshot = JSON.parse(raw) as StoredSnapshot<unknown>;
    const ttlMs = options.ttlMs ?? APP_PAGE_SNAPSHOT_TTL_MS;
    if (!snapshot?.savedAt || Date.now() - snapshot.savedAt > ttlMs) return null;
    if (options.validate && !options.validate(snapshot.data)) return null;

    return snapshot as StoredSnapshot<T>;
  } catch {
    return null;
  }
}

export function writeSessionSnapshot<T>(key: string, data: T, options: Pick<SnapshotOptions<T>, "nativeOnly"> = {}) {
  if (!canUseSessionSnapshots(options.nativeOnly)) return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data } satisfies StoredSnapshot<T>));
  } catch {
    // Snapshot restore is a best-effort native responsiveness hint.
  }
}
