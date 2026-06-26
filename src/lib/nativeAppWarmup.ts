import { apiFetch, eventCollectionPath } from "@/lib/api";
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
    "/devotionals?includeDrafts=1",
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

async function warmNativeAppData() {
  if (!isNativeMobileAuth || typeof window === "undefined") return;
  if (!getMobileAuthSession()) return;

  const churchId = getStoredChurchId();
  if (!churchId) return;

  const paths = warmupPaths(churchId);
  for (let index = 0; index < paths.length; index += WARMUP_BATCH_SIZE) {
    const batch = paths.slice(index, index + WARMUP_BATCH_SIZE);
    await Promise.allSettled(batch.map((path) => apiFetch(path)));
  }
}

export function scheduleNativeAppDataWarmup() {
  if (!isNativeMobileAuth || typeof window === "undefined") return undefined;

  const handle = window.setTimeout(() => {
    void warmNativeAppData();
  }, 1200);

  return () => window.clearTimeout(handle);
}
