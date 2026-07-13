type RouteLoader = () => Promise<unknown>;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export const appRouteLoaders = {
  Landing: () => import("@/pages/Landing"),
  Login: () => import("@/pages/Login"),
  Signup: () => import("@/pages/Signup"),
  AppLayout: () => import("@/layouts/AppLayout"),
  Dashboard: () => import("@/pages/app/Dashboard"),
  Songs: () => import("@/pages/app/Songs"),
  SongLyricsProposals: () => import("@/pages/app/SongLyricsProposals"),
  SongDetail: () => import("@/pages/app/SongDetail"),
  Services: () => import("@/pages/app/Services"),
  ServiceDetail: () => import("@/pages/app/ServiceDetail"),
  ServicePresentation: () => import("@/pages/app/ServicePresentation"),
  Announcements: () => import("@/pages/app/Announcements"),
  Devotionals: () => import("@/pages/app/Devotionals"),
  Media: () => import("@/pages/app/Media"),
  MediaDetail: () => import("@/pages/app/MediaDetail"),
  Giving: () => import("@/pages/app/Giving"),
  Ministries: () => import("@/pages/app/Ministries"),
  MinistryDetail: () => import("@/pages/app/MinistryDetail"),
  Events: () => import("@/pages/app/Events"),
  EventDetail: () => import("@/pages/app/EventDetail"),
  EventQr: () => import("@/pages/app/EventQr"),
  EventScanner: () => import("@/pages/app/EventScanner"),
  Teams: () => import("@/pages/app/Teams"),
  TeamDetail: () => import("@/pages/app/TeamDetail"),
  MyAssignments: () => import("@/pages/app/MyAssignments"),
  Settings: () => import("@/pages/app/Settings"),
  Messages: () => import("@/pages/app/Messages"),
  Prayer: () => import("@/pages/app/Prayer"),
  Training: () => import("@/pages/app/Training"),
  Calendar: () => import("@/pages/app/Calendar"),
  Users: () => import("@/pages/app/Users"),
  Blockouts: () => import("@/pages/app/Blockouts"),
  Onboarding: () => import("@/pages/app/Onboarding"),
  JoinChurch: () => import("@/pages/app/JoinChurch"),
  CreateChurchForm: () => import("@/pages/app/CreateChurchForm"),
  Presets: () => import("@/pages/app/Presets"),
  NotFound: () => import("@/pages/NotFound"),
} as const;

const preloadedRoutes = new WeakSet<RouteLoader>();

function preload(loaders: RouteLoader[]) {
  for (const loader of loaders) {
    if (preloadedRoutes.has(loader)) continue;

    preloadedRoutes.add(loader);
    void loader().catch(() => {
      preloadedRoutes.delete(loader);
    });
  }
}

function normalizeRoute(route: string) {
  return route.replace(/^#/, "").replace(/\?.*$/, "").replace(/\/$/, "") || "/";
}

export function preloadAppRoute(route: string) {
  const path = normalizeRoute(route);
  const baseLoaders = [appRouteLoaders.AppLayout];

  if (path === "/app") {
    preload([...baseLoaders, appRouteLoaders.Dashboard]);
    return;
  }

  if (path === "/app/services") {
    preload([...baseLoaders, appRouteLoaders.Services]);
    return;
  }

  if (path.startsWith("/app/services/") && path.endsWith("/presentation")) {
    preload([...baseLoaders, appRouteLoaders.ServicePresentation]);
    return;
  }

  if (path.startsWith("/app/services/")) {
    preload([...baseLoaders, appRouteLoaders.ServiceDetail]);
    return;
  }

  if (path === "/app/songs") {
    preload([...baseLoaders, appRouteLoaders.Songs]);
    return;
  }

  if (path === "/app/songs/proposals") {
    preload([...baseLoaders, appRouteLoaders.SongLyricsProposals]);
    return;
  }

  if (path.startsWith("/app/songs/")) {
    preload([...baseLoaders, appRouteLoaders.SongDetail]);
    return;
  }

  if (path === "/app/giving") {
    preload([...baseLoaders, appRouteLoaders.Giving]);
    return;
  }

  if (path === "/app/ministries") {
    preload([...baseLoaders, appRouteLoaders.Ministries]);
    return;
  }

  if (path.startsWith("/app/ministries/")) {
    preload([...baseLoaders, appRouteLoaders.MinistryDetail]);
    return;
  }

  if (path === "/app/devotionals") {
    preload([...baseLoaders, appRouteLoaders.Devotionals]);
    return;
  }

  if (path === "/app/media") {
    preload([...baseLoaders, appRouteLoaders.Media]);
    return;
  }

  if (path.startsWith("/app/media/")) {
    preload([...baseLoaders, appRouteLoaders.MediaDetail]);
    return;
  }

  if (path === "/app/announcements") {
    preload([...baseLoaders, appRouteLoaders.Announcements]);
    return;
  }

  if (path === "/app/events") {
    preload([...baseLoaders, appRouteLoaders.Events]);
    return;
  }

  if (path.startsWith("/app/events/") && path.endsWith("/qr")) {
    preload([...baseLoaders, appRouteLoaders.EventQr]);
    return;
  }

  if (path.startsWith("/app/events/") && path.endsWith("/scanner")) {
    preload([...baseLoaders, appRouteLoaders.EventScanner]);
    return;
  }

  if (path.startsWith("/app/events/")) {
    preload([...baseLoaders, appRouteLoaders.EventDetail]);
    return;
  }

  if (path === "/app/messages") {
    preload([...baseLoaders, appRouteLoaders.Messages]);
    return;
  }

  if (path === "/app/teams") {
    preload([...baseLoaders, appRouteLoaders.Teams]);
    return;
  }

  if (path.startsWith("/app/teams/")) {
    preload([...baseLoaders, appRouteLoaders.TeamDetail]);
    return;
  }

  if (path === "/app/my-assignments") {
    preload([...baseLoaders, appRouteLoaders.MyAssignments]);
    return;
  }

  if (path === "/app/settings") {
    preload([...baseLoaders, appRouteLoaders.Settings]);
    return;
  }

  if (path === "/app/prayer") {
    preload([...baseLoaders, appRouteLoaders.Prayer]);
    return;
  }

  if (path === "/app/training") {
    preload([...baseLoaders, appRouteLoaders.Training]);
    return;
  }

  if (path === "/app/calendar") {
    preload([...baseLoaders, appRouteLoaders.Calendar]);
    return;
  }

  if (path === "/app/users") {
    preload([...baseLoaders, appRouteLoaders.Users]);
    return;
  }

  if (path === "/app/blockouts") {
    preload([...baseLoaders, appRouteLoaders.Blockouts]);
  }
}

export function preloadPrimaryAppRoutes() {
  preload([
    appRouteLoaders.AppLayout,
    appRouteLoaders.Dashboard,
    appRouteLoaders.Songs,
    appRouteLoaders.SongLyricsProposals,
    appRouteLoaders.SongDetail,
    appRouteLoaders.Services,
    appRouteLoaders.ServiceDetail,
    appRouteLoaders.ServicePresentation,
    appRouteLoaders.Giving,
    appRouteLoaders.Ministries,
    appRouteLoaders.MinistryDetail,
    appRouteLoaders.Devotionals,
    appRouteLoaders.Media,
    appRouteLoaders.MediaDetail,
    appRouteLoaders.Announcements,
    appRouteLoaders.Events,
    appRouteLoaders.EventDetail,
    appRouteLoaders.EventQr,
    appRouteLoaders.EventScanner,
    appRouteLoaders.Calendar,
    appRouteLoaders.Messages,
    appRouteLoaders.Teams,
    appRouteLoaders.TeamDetail,
    appRouteLoaders.MyAssignments,
    appRouteLoaders.Settings,
    appRouteLoaders.Prayer,
    appRouteLoaders.Training,
    appRouteLoaders.Users,
    appRouteLoaders.Blockouts,
  ]);
}

export function scheduleNativeAppPreload() {
  if (typeof window === "undefined") return undefined;

  const idleWindow = window as IdleWindow;

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(preloadPrimaryAppRoutes, { timeout: 2200 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(preloadPrimaryAppRoutes, 800);
  return () => window.clearTimeout(handle);
}
