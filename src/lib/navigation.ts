type UnknownRecord = Record<string, unknown>;

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

export function normalizeAppRoute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const withoutHash = raw.startsWith("#/") ? raw.slice(1) : raw;
  if (!withoutHash.startsWith("/")) return null;
  if (withoutHash.startsWith("/login") || withoutHash.startsWith("/join-") || withoutHash.startsWith("/onboarding")) {
    return withoutHash;
  }
  if (withoutHash.startsWith("/app")) return withoutHash;
  return `/app${withoutHash}`;
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

    if (url.protocol === "https:" && ["tchurchapp.com", "www.tchurchapp.com"].includes(url.hostname)) {
      return normalizeAppRoute(`${url.pathname}${url.search}`);
    }

    if (url.protocol === "tchurchapp:") {
      const host = url.hostname;
      const path = `${url.pathname}${url.search}`;
      if (!host || host === "tchurchapp.com" || host === "www.tchurchapp.com") {
        return normalizeAppRoute(path || "/app");
      }
      return normalizeAppRoute(`/${host}${path}`);
    }
  } catch {
    return normalizeAppRoute(raw);
  }

  return null;
}

function stringFromRecord(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
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

  for (const key of ["data", "payload", "metadata", "notificationData"]) {
    const nested = recordFromUnknown(record[key]);
    if (nested) records.push(nested);
  }

  return records;
}

function eventIdFromRecords(records: UnknownRecord[]) {
  for (const record of records) {
    const directId = stringFromRecord(record, ["eventId", "event_id", "eventID"]);
    if (directId) return directId;

    const nestedEvent = recordFromUnknown(record.event);
    const nestedId = nestedEvent ? stringFromRecord(nestedEvent, ["id", "eventId", "event_id", "eventID"]) : null;
    if (nestedId) return nestedId;
  }

  return null;
}

function routeSuffixFromHint(value: string | null) {
  const hint = value?.toLowerCase() || "";
  if (hint.includes("scanner") || hint.includes("scan")) return "/scanner";
  if (hint.includes("check-in") || hint.includes("check_in") || hint.includes("checkin")) return "/check-in";
  if (hint.includes("admin")) return "/admin";
  if (hint.includes("qr")) return "/qr";
  if (hint.includes("rsvp")) return "/rsvp";
  if (hint.includes("participation")) return "/participation";
  return "";
}

export function routeFromNotificationData(data: unknown): string | null {
  const record = recordFromUnknown(data);
  if (!record) return null;

  const records = notificationRecords(record);
  const explicitRoute = stringFromRecords(records, ["route", "url", "deepLink", "deeplink", "link", "href", "path"]);
  const normalizedExplicitRoute = routeFromAppUrl(explicitRoute);
  if (normalizedExplicitRoute) return normalizedExplicitRoute;

  const eventId = eventIdFromRecords(records);
  if (!eventId) return null;

  const hint = stringFromRecords(records, ["screen", "target", "action", "eventRoute", "tab"]);
  return `/app/events/${encodeURIComponent(eventId)}${routeSuffixFromHint(hint)}`;
}
