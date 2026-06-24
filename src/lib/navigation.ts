type UnknownRecord = Record<string, unknown>;

const TRUSTED_LINK_HOSTS = ["tchurchapp.com", "www.tchurchapp.com"];
const ROUTE_KEYS = ["route", "url", "deepLink", "deeplink", "link", "href", "path", "appRoute", "targetUrl"];
const EVENT_ID_KEYS = ["eventId", "event_id", "eventID"];
const NESTED_EVENT_ID_KEYS = [...EVENT_ID_KEYS, "id", "_id"];
const ACTION_KEYS = ["screen", "target", "action", "eventRoute", "tab", "click_action", "clickAction", "type", "view"];
const NESTED_PAYLOAD_KEYS = ["data", "payload", "metadata", "notificationData", "notification", "customData"];

function encodeRouteSegment(value: string) {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}

function recordFromUnknown(value: unknown): UnknownRecord | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as UnknownRecord;

  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      return recordFromUnknown(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return null;
}

function eventRegistrationRouteFromPath(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value, "https://tchurchapp.com");
  } catch {
    return null;
  }

  const tab = (parsed.searchParams.get("tab") || parsed.searchParams.get("view") || "").trim().toLowerCase();
  if (!["registration", "rsvp"].includes(tab)) return null;

  const path = parsed.pathname.replace(/\/+$/, "");
  const match = path.match(/^\/(?:app\/)?events\/([^/]+)$/);
  return match?.[1] ? `/app/events/${encodeRouteSegment(match[1])}/rsvp` : null;
}

export function normalizeAppRoute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const withoutHash = raw.startsWith("#/") ? raw.slice(1) : raw;
  if (!withoutHash.startsWith("/")) return null;
  if ((withoutHash === "/" || withoutHash.startsWith("/?")) && withoutHash.includes("code=")) {
    return `/join-church${withoutHash.slice(1)}`;
  }
  const registrationRoute = eventRegistrationRouteFromPath(withoutHash);
  if (registrationRoute) return registrationRoute;
  if (withoutHash.startsWith("/login") || withoutHash.startsWith("/join-") || withoutHash.startsWith("/onboarding")) {
    return withoutHash;
  }
  if (withoutHash.startsWith("/app")) return withoutHash;
  return `/app${withoutHash}`;
}

function normalizeMaybeRelativeRoute(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return normalizeAppRoute(trimmed);
  if (/^(app|events?|login|join|join-church|onboarding|create-church)(\/|\?|$)/.test(trimmed)) {
    return normalizeAppRoute(`/${trimmed}`);
  }
  return null;
}

export function routeFromAppUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.hash.startsWith("#/")) {
      return normalizeAppRoute(url.hash.slice(1));
    }

    if (url.protocol === "https:" && TRUSTED_LINK_HOSTS.includes(url.hostname)) {
      return normalizeAppRoute(`${url.pathname}${url.search}`);
    }

    if (url.protocol === "tchurchapp:") {
      const host = url.hostname;
      const path = `${url.pathname}${url.search}`;
      if (!host || TRUSTED_LINK_HOSTS.includes(host)) {
        if ((!url.pathname || url.pathname === "/") && url.search) {
          return normalizeAppRoute(`/${url.search}`);
        }
        return normalizeAppRoute(path || "/app");
      }
      return normalizeAppRoute(`/${host}${path}`);
    }
  } catch {
    return normalizeMaybeRelativeRoute(raw);
  }

  return null;
}

function routeComparisonKey(route: string) {
  const trimmed = route.trim();
  if (!trimmed || trimmed === "/") return trimmed || "/";

  const hashIndex = trimmed.indexOf("#");
  const searchIndex = trimmed.indexOf("?");
  const suffixIndex =
    hashIndex === -1
      ? searchIndex
      : searchIndex === -1
        ? hashIndex
        : Math.min(hashIndex, searchIndex);
  const path = suffixIndex === -1 ? trimmed : trimmed.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : trimmed.slice(suffixIndex);
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, "") : path;

  return `${normalizedPath}${suffix}`;
}

export function areAppRoutesEquivalent(left: string, right: string) {
  return routeComparisonKey(left) === routeComparisonKey(right);
}

export function shouldApplyNativeLaunchRoute(route: string | null, initialRoute: string, currentRoute: string) {
  return Boolean(route) &&
    areAppRoutesEquivalent(initialRoute, currentRoute) &&
    !areAppRoutesEquivalent(route!, currentRoute);
}

function stringFromRecord(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function stringFromRecords(records: UnknownRecord[], keys: string[]) {
  for (const record of records) {
    const value = stringFromRecord(record, keys);
    if (value) return value;
  }
  return null;
}

function notificationRecords(record: UnknownRecord) {
  const records = [record];

  for (const key of NESTED_PAYLOAD_KEYS) {
    const nested = recordFromUnknown(record[key]);
    if (nested) records.push(nested);
  }

  return records;
}

function eventIdFromRecords(records: UnknownRecord[]) {
  for (const record of records) {
    const directId = stringFromRecord(record, EVENT_ID_KEYS);
    if (directId) return directId;

    const nestedEvent = recordFromUnknown(record.event);
    const nestedId = nestedEvent ? stringFromRecord(nestedEvent, NESTED_EVENT_ID_KEYS) : null;
    if (nestedId) return nestedId;
  }

  return null;
}

function routeSuffixFromHint(value: string | null) {
  const hint = (value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (["scan", "scanner", "event-scan", "event-scanner", "check-in-scanner"].includes(hint)) return "/scanner";
  if (["check-in", "checkin", "event-check-in"].includes(hint)) return "/check-in";
  if (hint === "admin") return "/admin";
  if (["qr", "my-qr", "ticket", "event-qr", "event-ticket"].includes(hint)) return "/qr";
  if (["rsvp", "registration"].includes(hint)) return "/rsvp";
  if (["participation", "signup", "signup-items"].includes(hint)) return "/participation";
  return "";
}

export function routeFromNotificationData(data: unknown): string | null {
  const directRoute = routeFromAppUrl(data);
  if (directRoute) return directRoute;

  const record = recordFromUnknown(data);
  if (!record) return null;

  const records = notificationRecords(record);
  const explicitRoute = stringFromRecords(records, ROUTE_KEYS);
  const normalizedExplicitRoute = routeFromAppUrl(explicitRoute);
  if (normalizedExplicitRoute) return normalizedExplicitRoute;

  const eventId = eventIdFromRecords(records);
  if (!eventId) return null;

  const hint = stringFromRecords(records, ACTION_KEYS);
  return `/app/events/${encodeURIComponent(eventId)}${routeSuffixFromHint(hint)}`;
}
