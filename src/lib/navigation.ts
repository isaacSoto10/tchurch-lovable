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
