import { apiFetch, eventCollectionPath } from "@/lib/api";
import { devotionalsCollectionPath } from "@/lib/devotionalsPagination";
import { getMobileAuthSession, isNativeMobileAuth } from "@/lib/mobileAuth";

const CHURCH_ID_KEY = "tchurch_church_id";
const WARMUP_BATCH_SIZE = 4;

function getStoredChurchId() {
  try {
    return window.localStorage.getItem(CHURCH_ID_KEY);
  } catch {
    return null;
  }
}

function currentCalendarPath() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0);
  const startOfWeek = new Date(startOfMonth);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const endOfWeek = new Date(endOfMonth);
  endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay()));

  return `/calendar?start=${startOfWeek.toISOString()}&end=${endOfWeek.toISOString()}`;
}

function warmupPaths(churchId: string) {
  return [
    "/dashboard/stats",
    "/services",
    "/service-assignments/mine",
    "/songs?limit=400&sort=lastUsed",
    eventCollectionPath("limit=120"),
    "/announcements?includePending=1&limit=40",
    devotionalsCollectionPath(1),
    "/service-media?limit=140",
    "/live-destinations",
    "/ministries",
    "/my-ministries",
    "/groups",
    "/teams",
    "/users/me",
    "/users",
    `/churches/${encodeURIComponent(churchId)}/members`,
    "/channels",
    "/training/materials",
    "/training/categories",
    "/prayer-requests?status=active",
    currentCalendarPath(),
  ];
}

function isStudioLANRouteActive() {
  if (typeof window === "undefined") return false;
  const route = window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : window.location.pathname;
  const pathname = route.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return pathname === "/app/studio-stage";
}

async function warmNativeAppData(signal: AbortSignal) {
  if (!isNativeMobileAuth || typeof window === "undefined" || signal.aborted || isStudioLANRouteActive()) return;
  if (!getMobileAuthSession()) return;

  const churchId = getStoredChurchId();
  if (!churchId) return;

  const paths = warmupPaths(churchId);
  for (let index = 0; index < paths.length; index += WARMUP_BATCH_SIZE) {
    if (signal.aborted || isStudioLANRouteActive()) return;
    const batch = paths.slice(index, index + WARMUP_BATCH_SIZE);
    await Promise.allSettled(batch.map((path) => apiFetch(path, { signal })));
  }
}

export function scheduleNativeAppDataWarmup() {
  if (!isNativeMobileAuth || typeof window === "undefined") return undefined;

  const controller = new AbortController();

  const handle = window.setTimeout(() => {
    void warmNativeAppData(controller.signal);
  }, 1200);

  return () => {
    window.clearTimeout(handle);
    controller.abort();
  };
}
