export type PrimaryNavigationGroup = "home" | "agenda" | "services" | "community" | "more";
export type SecondaryNavigationSection = "agenda" | "community" | "people";

export type SecondaryNavigationItem = {
  label: string;
  href: string;
  prefixes: readonly string[];
  adminOnly?: boolean;
};

export const SECONDARY_NAVIGATION: Record<SecondaryNavigationSection, readonly SecondaryNavigationItem[]> = {
  agenda: [
    { label: "Agenda", href: "/app/calendar", prefixes: ["/app/calendar"] },
    { label: "Eventos", href: "/app/events", prefixes: ["/app/events"] },
    { label: "Asignaciones", href: "/app/my-assignments", prefixes: ["/app/my-assignments"] },
  ],
  community: [
    { label: "Anuncios", href: "/app/announcements", prefixes: ["/app/announcements"] },
    { label: "Oración", href: "/app/prayer", prefixes: ["/app/prayer"] },
    { label: "Sermones", href: "/app/media", prefixes: ["/app/media"] },
  ],
  people: [
    { label: "Equipos", href: "/app/teams", prefixes: ["/app/teams"] },
    { label: "Miembros", href: "/app/users", prefixes: ["/app/users"], adminOnly: true },
  ],
};

const PRIMARY_PREFIXES: ReadonlyArray<{
  group: Exclude<PrimaryNavigationGroup, "home" | "more">;
  prefixes: readonly string[];
}> = [
  { group: "agenda", prefixes: ["/app/calendar", "/app/events", "/app/my-assignments"] },
  { group: "services", prefixes: ["/app/services"] },
  { group: "community", prefixes: ["/app/announcements", "/app/prayer", "/app/media"] },
];

function normalizePath(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return path || "/";
}

export function routeMatchesPrefix(pathname: string, prefix: string) {
  const path = normalizePath(pathname);
  const normalizedPrefix = normalizePath(prefix);
  return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);
}

export function getPrimaryNavigationGroup(pathname: string): PrimaryNavigationGroup {
  const path = normalizePath(pathname);
  if (path === "/app") return "home";

  for (const item of PRIMARY_PREFIXES) {
    if (item.prefixes.some((prefix) => routeMatchesPrefix(path, prefix))) return item.group;
  }

  return "more";
}

export function isSecondaryNavigationItemActive(pathname: string, item: SecondaryNavigationItem) {
  return item.prefixes.some((prefix) => routeMatchesPrefix(pathname, prefix));
}
