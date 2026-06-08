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

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function routeSuffixFromHint(value: string | null) {
  const hint = value?.toLowerCase() || "";
  if (hint.includes("scanner") || hint.includes("scan")) return "/scanner";
  if (hint.includes("check-in") || hint.includes("checkin")) return "/check-in";
  if (hint.includes("admin")) return "/admin";
  if (hint.includes("qr")) return "/qr";
  if (hint.includes("rsvp")) return "/rsvp";
  if (hint.includes("participation")) return "/participation";
  return "";
}

export function routeFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  const explicitRoute = stringFromRecord(record, ["route", "url", "deepLink", "deeplink", "link", "href"]);
  const normalizedExplicitRoute = routeFromAppUrl(explicitRoute);
  if (normalizedExplicitRoute) return normalizedExplicitRoute;

  const nestedEvent = record.event && typeof record.event === "object"
    ? record.event as Record<string, unknown>
    : null;
  const eventId =
    stringFromRecord(record, ["eventId", "event_id"]) ||
    (nestedEvent ? stringFromRecord(nestedEvent, ["id", "eventId", "event_id"]) : null);

  if (!eventId) return null;

  const hint = stringFromRecord(record, ["screen", "target", "action", "eventRoute", "tab"]);
  return `/app/events/${encodeURIComponent(eventId)}${routeSuffixFromHint(hint)}`;
}
