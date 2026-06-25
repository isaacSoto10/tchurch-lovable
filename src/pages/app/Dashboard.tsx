import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Music, Users, Megaphone, ListChecks, UsersRound, Calendar, ArrowRight, Plus, Check, X, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useNavigate } from "react-router-dom";
import { formatServiceDate, formatServiceTime, parseServiceDate } from "@/lib/serviceDates";
import { isNativeMobileAuth } from "@/lib/mobileAuth";
import { getEventTypeLabel } from "@/types/events";

interface TimelineItem {
  id: string;
  _type: "service" | "event";
  title: string;
  date: string;
  status?: string;
  type?: string;
  location?: string | null;
}

interface Stats {
  ministries: number;
  events: number;
  songs: number;
  services: number;
  teams: number;
  members: number;
  announcements: number;
}

interface Announcement {
  id: string;
  title: string;
  content?: string;
  imageUrl?: string | null;
  createdAt: string;
}

interface Ministry {
  id: string;
  name: string;
  color: string;
  memberCount?: number;
}

type MinistriesResponse = {
  ministries?: Ministry[];
};

interface Assignment {
  id: string;
  serviceId: string;
  position: string;
  confirmed: boolean;
  responseStatus?: "pending" | "accepted" | "declined" | null;
  respondedAt?: string | null;
  service?: {
    id: string;
    title: string;
    date: string;
    type?: string;
    status?: string;
  };
}

const DASHBOARD_SERVICE_PREVIEW_LIMIT = 2;
const DASHBOARD_SNAPSHOT_TTL_MS = 2 * 60 * 1000;
const DASHBOARD_SNAPSHOT_PREFIX = "tchurch_ios_dashboard_snapshot_v1";
const DASHBOARD_SERVICES_PATH = "/services?summary=1&from=today&order=asc&limit=60";
const DASHBOARD_EVENTS_PATH = "/events?startDate=today&limit=25";

type DashboardSnapshot = {
  savedAt: number;
  stats: Stats | null;
  timeline: TimelineItem[];
  announcements: Announcement[];
  ministries: Ministry[];
  assignments: Assignment[];
};

function dashboardSnapshotKey(churchId: string) {
  return `${DASHBOARD_SNAPSHOT_PREFIX}:${churchId}`;
}

function readDashboardSnapshot(churchId: string): DashboardSnapshot | null {
  if (!isNativeMobileAuth) return null;

  try {
    const raw = window.sessionStorage.getItem(dashboardSnapshotKey(churchId));
    if (!raw) return null;

    const snapshot = JSON.parse(raw) as DashboardSnapshot;
    if (!snapshot?.savedAt || Date.now() - snapshot.savedAt > DASHBOARD_SNAPSHOT_TTL_MS) return null;
    if (!Array.isArray(snapshot.timeline) || !Array.isArray(snapshot.announcements)) return null;
    if (!Array.isArray(snapshot.ministries) || !Array.isArray(snapshot.assignments)) return null;

    return snapshot;
  } catch {
    return null;
  }
}

function saveDashboardSnapshot(churchId: string, snapshot: Omit<DashboardSnapshot, "savedAt">) {
  if (!isNativeMobileAuth) return;

  try {
    window.sessionStorage.setItem(
      dashboardSnapshotKey(churchId),
      JSON.stringify({ ...snapshot, savedAt: Date.now() } satisfies DashboardSnapshot),
    );
  } catch {
    // Snapshot restore is only a native perceived-performance hint.
  }
}

function formatDate(dateStr: string) {
  return formatServiceDate(dateStr, "es-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateStr: string) {
  return formatServiceTime(dateStr);
}

function getItemTime(value: unknown) {
  if (typeof value !== "string") return null;

  const time = parseServiceDate(value)?.getTime();
  return typeof time === "number" && Number.isFinite(time) ? time : null;
}

async function safeDashboardFetch<T>(
  label: string,
  request: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    console.warn(`[Panel] No se pudo cargar ${label}:`, error);
    return fallback;
  }
}

function statusLabel(status: string) {
  if (status === "completed") return "completado";
  return "confirmado";
}

function getTimelineItemHref(item: TimelineItem) {
  return item._type === "service" ? `/app/services/${item.id}` : `/app/events/${item.id}`;
}

function DashboardTimelineSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div>
        <div className="mb-3 h-3 w-24 animate-pulse rounded-full bg-zinc-200" />
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <Card key={item} className="app-card">
              <CardContent className="flex items-center gap-3 p-3.5">
                <div className="h-12 w-1.5 rounded-full bg-zinc-200" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded-full bg-zinc-200" />
                  <div className="h-3 w-1/2 animate-pulse rounded-full bg-zinc-100" />
                </div>
                <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-100" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardAsideSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div>
        <div className="mb-3 h-3 w-32 animate-pulse rounded-full bg-zinc-200" />
        <Card className="app-card overflow-hidden">
          <div className="h-44 animate-pulse bg-zinc-100" />
          <CardContent className="space-y-3 p-4">
            <div className="h-5 w-4/5 animate-pulse rounded-full bg-zinc-200" />
            <div className="h-3 w-full animate-pulse rounded-full bg-zinc-100" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-zinc-100" />
          </CardContent>
        </Card>
      </div>
      <div>
        <div className="mb-3 h-3 w-20 animate-pulse rounded-full bg-zinc-200" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item} className="app-card">
              <CardContent className="space-y-2 p-3 text-center">
                <div className="mx-auto h-4 w-4 animate-pulse rounded-full bg-zinc-200" />
                <div className="mx-auto h-5 w-8 animate-pulse rounded-full bg-zinc-200" />
                <div className="mx-auto h-3 w-14 animate-pulse rounded-full bg-zinc-100" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { fetchApi } = useApi();
  const { selectedChurch, loading: churchLoading } = useChurch();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (churchLoading) {
        setLoading(true);
        return;
      }

      if (!selectedChurch) {
        setLoading(false);
        return;
      }

      const cachedSnapshot = readDashboardSnapshot(selectedChurch.id);
      if (cachedSnapshot) {
        setStats(cachedSnapshot.stats);
        setTimeline(cachedSnapshot.timeline);
        setAnnouncements(cachedSnapshot.announcements);
        setMinistries(cachedSnapshot.ministries);
        setAssignments(cachedSnapshot.assignments);
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        const [statsData, servicesData, eventsData, announcementsData, ministriesData, assignmentsData] = await Promise.all([
          safeDashboardFetch("stats", () => fetchApi("/dashboard/stats"), null),
          safeDashboardFetch("services", () => fetchApi(DASHBOARD_SERVICES_PATH), []),
          safeDashboardFetch("events", () => fetchApi(DASHBOARD_EVENTS_PATH), []),
          safeDashboardFetch("announcements", () => fetchApi("/announcements"), []),
          safeDashboardFetch("ministries", () => fetchApi("/my-ministries"), []),
          safeDashboardFetch("asignaciones", () => fetchApi("/service-assignments/mine"), []),
        ]);

        const nextStats = statsData && typeof statsData === "object" && !("error" in statsData)
          ? statsData as Stats
          : cachedSnapshot?.stats ?? null;
        setStats(nextStats);

        const assignmentList = Array.isArray(assignmentsData) ? assignmentsData as Assignment[] : [];
        setAssignments(assignmentList);
        const isPlanner = selectedChurch.role === "ADMIN" || selectedChurch.role === "PLANNER";
        const assignedServiceIds = new Set(
          assignmentList
            .filter((assignment) => assignment.responseStatus !== "declined")
            .map((assignment) => assignment.serviceId || assignment.service?.id)
            .filter(Boolean)
        );

        const now = Date.now();
        const svcItems: TimelineItem[] = (Array.isArray(servicesData) ? servicesData : [])
          .filter((s: Record<string, unknown>) => {
            const time = getItemTime(s.date);
            if (time == null || time < now) return false;
            if (!isPlanner && assignedServiceIds.size === 0) return false;
            if (!isPlanner && !assignedServiceIds.has(s.id as string)) return false;
            return true;
          })
          .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
            return (getItemTime(a.date) ?? Number.POSITIVE_INFINITY) - (getItemTime(b.date) ?? Number.POSITIVE_INFINITY);
          })
          .slice(0, DASHBOARD_SERVICE_PREVIEW_LIMIT)
          .map((s: Record<string, unknown>) => ({
            id: s.id as string,
            _type: "service" as const,
            title: s.title as string,
            date: s.date as string,
            status: s.status as string,
            type: s.type as string,
          }));

        const evtItems: TimelineItem[] = (Array.isArray(eventsData) ? eventsData : [])
          .filter((e: Record<string, unknown>) => {
            const time = getItemTime(e.date);
            return time != null && time >= now;
          })
          .map((e: Record<string, unknown>) => ({
            id: e.id as string,
            _type: "event" as const,
            title: e.title as string,
            date: e.date as string,
            type: getEventTypeLabel(e.type as string | null),
            location: e.location as string | null,
          }));

        const merged = [...svcItems, ...evtItems].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        const nextTimeline = merged.slice(0, 10);
        setTimeline(nextTimeline);

        const nextAnnouncements = Array.isArray(announcementsData) ? announcementsData.slice(0, 10) : [];
        setAnnouncements(nextAnnouncements);
        const ministryPayload = ministriesData as MinistriesResponse;
        const nextMinistries = Array.isArray(ministriesData) ? ministriesData : Array.isArray(ministryPayload?.ministries) ? ministryPayload.ministries : [];
        setMinistries(nextMinistries);
        saveDashboardSnapshot(selectedChurch.id, {
          stats: nextStats,
          timeline: nextTimeline,
          announcements: nextAnnouncements,
          ministries: nextMinistries,
          assignments: assignmentList,
        });
      } catch (e) {
        console.error("No se pudo cargar el panel:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [churchLoading, fetchApi, selectedChurch]);

  async function handleRespond(assignmentId: string, action: "accept" | "decline") {
    setRespondingId(assignmentId);
    try {
      await fetchApi(`/service-assignments/${assignmentId}/respond`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.id === assignmentId
            ? {
                ...assignment,
                confirmed: action === "accept",
                responseStatus: action === "accept" ? "accepted" : "declined",
                respondedAt: new Date().toISOString(),
              } as Assignment
            : assignment
        )
      );
    } catch (error) {
      console.error("No se pudo responder la asignación:", error);
    } finally {
      setRespondingId(null);
    }
  }

  if (churchLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!selectedChurch) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Card className="w-full max-w-md border-dashed">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Users className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-xl font-semibold">No hay iglesia seleccionada</p>
              <p className="text-sm text-muted-foreground">
                {isNativeMobileAuth
                  ? "Únete a la iglesia que te invitó para comenzar a usar la app."
                  : "Únete a una iglesia existente o crea tu propio espacio para comenzar a usar la app."}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:flex-row">
              <Button className="flex-1" onClick={() => navigate("/join-church")}>
                Unirme a una iglesia
              </Button>
              {!isNativeMobileAuth && (
                <Button className="flex-1" variant="outline" onClick={() => navigate("/create-church")}>
                  Crear iglesia
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 18) return "Buenas tardes";
    return "Buenas noches";
  };

  const getEndOfSunday = () => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilSunday = day === 0 ? 0 : 7 - day;
    const sunday = new Date(now);
    sunday.setDate(now.getDate() + daysUntilSunday);
    sunday.setHours(23, 59, 59, 999);
    return sunday;
  };

  const endOfSunday = getEndOfSunday();
  const thisWeekItems = timeline.filter((item) => (parseServiceDate(item.date)?.getTime() || 0) <= endOfSunday.getTime());
  const comingUpItems = timeline.filter((item) => (parseServiceDate(item.date)?.getTime() || 0) > endOfSunday.getTime());
  const pendingAssignments = assignments
    .filter((assignment) => (assignment.responseStatus || (assignment.confirmed ? "accepted" : "pending")) === "pending")
    .filter((assignment) => assignment.service?.date && (parseServiceDate(assignment.service.date)?.getTime() || 0) >= Date.now())
    .slice(0, 5);

  const statItems = stats
    ? [
        { label: "Anuncios", value: stats.announcements, href: "/app/announcements", icon: Megaphone },
        { label: "Ministerios", value: stats.ministries, href: "/app/ministries", icon: Users },
        { label: "Eventos", value: stats.events, href: "/app/events", icon: CalendarDays },
        { label: "Canciones", value: stats.songs, href: "/app/songs", icon: Music },
        { label: "Servicios", value: stats.services, href: "/app/services", icon: ListChecks },
        { label: "Equipos", value: stats.teams, href: "/app/teams", icon: UsersRound },
        { label: "Miembros", value: stats.members, href: "/app/users", icon: Users },
      ]
    : [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed":
        return "bg-emerald-100 text-emerald-700";
      case "completed":
        return "bg-zinc-100 text-muted-foreground";
      default:
        return "bg-amber-100 text-amber-700";
    }
  };

  return (
    <div className="mobile-page space-y-6 md:space-y-7">
      <div className="rounded-[1.75rem] border border-zinc-200/80 bg-gradient-to-br from-white via-white to-primary/5 p-4 shadow-sm shadow-zinc-200/60 sm:p-5 md:p-6">
        <div>
          <p className="mobile-section-title mb-2">Panel</p>
          <h1 className="text-[1.85rem] font-black leading-none tracking-tight text-zinc-950 sm:text-3xl">{getGreeting()}</h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">{selectedChurch.name}</p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:max-w-2xl">
          <Button className="h-11 rounded-2xl font-bold sm:w-auto" onClick={() => navigate("/app/services")}>
            <Plus className="h-4 w-4" /> Nuevo servicio
          </Button>
          <Button className="h-11 rounded-2xl font-bold sm:w-auto" variant="outline" onClick={() => navigate("/app/events")}>
            <Plus className="h-4 w-4" /> Nuevo evento
          </Button>
          <Button className="h-11 rounded-2xl font-bold sm:w-auto" variant="outline" onClick={() => navigate("/app/calendar")}>
            <Calendar className="h-4 w-4" /> Calendario
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <section className="min-w-0 space-y-6">
          {pendingAssignments.length > 0 && (
            <div>
          <h2 className="mobile-section-title mb-3">Mis asignaciones pendientes</h2>
          <div className="space-y-3">
            {pendingAssignments.map((assignment) => (
              <Card key={assignment.id} className="app-card border-amber-100 bg-gradient-to-br from-white to-amber-50/60">
                <CardContent className="flex items-center gap-3 p-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1" onClick={() => navigate(`/app/services/${assignment.serviceId}`)}>
                    <p className="truncate text-base font-bold leading-tight">{assignment.service?.title || "Servicio"}</p>
                    <p className="mt-1 text-[0.8rem] text-muted-foreground">
                      {assignment.position}
                      {assignment.service?.date ? ` · ${formatDate(assignment.service.date)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl px-2 text-red-600"
                      disabled={respondingId === assignment.id}
                      onClick={() => handleRespond(assignment.id, "decline")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-9 rounded-xl px-2"
                      disabled={respondingId === assignment.id}
                      onClick={() => handleRespond(assignment.id, "accept")}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
            </div>
          )}

          {loading ? (
            <DashboardTimelineSkeleton />
          ) : timeline.length === 0 ? (
            <Card className="app-card">
              <CardContent className="p-8 text-center">
                <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No hay servicios o eventos próximos</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
          {thisWeekItems.length > 0 && (
            <div>
              <h2 className="mobile-section-title mb-3">
                Esta semana
              </h2>
              <div className="space-y-3">
                {thisWeekItems.map((item) => (
                  <Card
                    key={`${item._type}-${item.id}`}
                    className="app-card min-w-0 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                    onClick={() => navigate(getTimelineItemHref(item))}
                  >
                    <CardContent className="flex items-center gap-3 p-3.5">
                      <div className={`h-12 w-1.5 rounded-full ${item._type === "service" ? "bg-primary" : "bg-amber-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-base font-bold leading-tight">{item.title}</p>
                        <p className="mt-1 text-[0.8rem] text-muted-foreground">
                          {formatDate(item.date)} {formatTime(item.date) !== "12:00 AM" && `· ${formatTime(item.date)}`}
                          {item.location && ` · ${item.location}`}
                        </p>
                      </div>
                      {item._type === "service" && item.status && statusLabel(item.status) && (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      )}
                      {item._type === "event" && item.type && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                          {item.type}
                        </span>
                      )}
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {comingUpItems.length > 0 && (
            <div>
              <h2 className="mobile-section-title mb-3">
                Próximamente
              </h2>
              <div className="space-y-3">
                {comingUpItems.map((item) => (
                  <Card
                    key={`${item._type}-${item.id}`}
                    className="app-card min-w-0 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                    onClick={() => navigate(getTimelineItemHref(item))}
                  >
                    <CardContent className="flex items-center gap-3 p-3.5">
                      <div className={`h-12 w-1.5 rounded-full ${item._type === "service" ? "bg-primary" : "bg-amber-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-base font-bold leading-tight">{item.title}</p>
                        <p className="mt-1 text-[0.8rem] text-muted-foreground">
                          {formatDate(item.date)} {formatTime(item.date) !== "12:00 AM" && `· ${formatTime(item.date)}`}
                          {item.location && ` · ${item.location}`}
                        </p>
                      </div>
                      {item._type === "service" && item.status && statusLabel(item.status) && (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      )}
                      {item._type === "event" && item.type && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                          {item.type}
                        </span>
                      )}
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-[calc(env(safe-area-inset-top)+1rem)] lg:self-start">
          {loading ? (
            <DashboardAsideSkeleton />
          ) : (
            <>
          {announcements.length > 0 && (
            <div>
          <div className="flex min-w-0 items-center justify-between gap-3 mb-4">
            <h2 className="mobile-section-title">
              Anuncios recientes
            </h2>
            <Button className="h-9 shrink-0 rounded-full px-3 font-bold" size="sm" variant="ghost" onClick={() => navigate("/app/announcements")}>
              Ver todos <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          <div className="space-y-4">
            {announcements.slice(0, 3).map((ann, index) => {
              const featured = index === 0;

              return (
                <Card
                  key={ann.id}
                  className={`app-card min-w-0 cursor-pointer overflow-hidden border-[#eadacc] bg-[#fffefa] shadow-[0_16px_42px_rgba(88,64,44,0.10)] transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                    featured ? "rounded-[1.7rem]" : "rounded-[1.35rem]"
                  }`}
                  onClick={() => navigate("/app/announcements")}
                >
                  <div className={`relative overflow-hidden bg-[#f4eee8] ${featured ? "h-60" : "h-40"}`}>
                    {ann.imageUrl ? (
                      <img src={ann.imageUrl} alt={ann.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-end bg-[linear-gradient(135deg,#fff1d6_0%,#f8fafc_52%,#dff7ed_100%)] p-5">
                        <div>
                          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 text-[#7a4f1c] shadow-sm">
                            <Megaphone className="h-6 w-6" />
                          </span>
                          <p className="mt-3 text-xs font-black uppercase text-[#8a6a4f]">Boletín de la iglesia</p>
                        </div>
                      </div>
                    )}
                    {ann.imageUrl && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/70 via-zinc-950/15 to-transparent p-4 pt-16">
                        <p className="text-[0.68rem] font-black uppercase text-white/80">Boletín de la iglesia</p>
                        {featured && <p className="mt-1 line-clamp-2 text-2xl font-black leading-tight text-white">{ann.title}</p>}
                      </div>
                    )}
                  </div>
                  <CardContent className={featured ? "min-w-0 p-5" : "min-w-0 p-4"}>
                    <p className={`font-black leading-tight text-[#211915] ${featured ? "text-xl" : "text-lg"}`}>{ann.title}</p>
                    <p className={`mt-2 text-sm leading-6 text-[#675b52] ${featured ? "line-clamp-3" : "line-clamp-2"}`}>
                      {ann.content}
                    </p>
                    <p className="mt-3 text-xs font-bold text-[#8a6a4f]">
                      {ann.createdAt ? new Date(ann.createdAt).toLocaleDateString("es-US", {
                        month: "short",
                        day: "numeric",
                      }) : ""}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
            </div>
          )}

          {ministries.length > 0 && (
            <div>
          <h2 className="mobile-section-title mb-3">
            Mis ministerios
          </h2>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {ministries.map((m) => (
              <Card
                key={m.id}
                className="app-card min-w-0 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => navigate("/app/ministries")}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm"
                    style={{ backgroundColor: m.color || "#6366f1" }}
                  >
                    {m.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{m.name}</p>
                    {m.memberCount != null && (
                      <p className="text-xs text-muted-foreground">{m.memberCount} miembros</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
            </div>
          )}

          {statItems.length > 0 && (
            <div>
          <h2 className="mobile-section-title mb-3">
            Resumen
          </h2>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            {statItems.map((stat) => (
              <Card
                key={stat.label}
                className="app-card min-w-0 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => navigate(stat.href)}
              >
                <CardContent className="p-3 text-center">
                  <stat.icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-lg font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground truncate">{stat.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
            </div>
          )}
            </>
          )}
        </aside>
        </div>
    </div>
  );
}
