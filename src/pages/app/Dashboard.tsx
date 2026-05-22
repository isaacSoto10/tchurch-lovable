/* Hallmark · pre-emit critique: P4 H4 E4 S4 R4 V4 */
import { CSSProperties, ReactNode, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  Clock3,
  Inbox,
  ListChecks,
  Megaphone,
  Music,
  Plus,
  ShieldCheck,
  Users,
  UsersRound,
  X,
  Loader2,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useNavigate } from "react-router-dom";

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

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  read?: boolean;
  createdAt?: string;
  data?: {
    route?: string;
  } | null;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-US", {
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("es-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getItemTime(value: unknown) {
  if (typeof value !== "string") return null;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
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
  if (status === "confirmed") return "confirmado";
  if (status === "completed") return "completado";
  if (status === "draft") return "";
  return status;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 18) return "Buenas tardes";
  return "Buenas noches";
}

function getEndOfSunday() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

function getRoleLabel(role?: string) {
  if (role === "ADMIN") return "Administrador";
  if (role === "PLANNER") return "Planificación";
  if (role === "LEADER") return "Liderazgo";
  return "Miembro";
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "T";
}

function getBrandAccent(value: string | null | undefined) {
  const color = value?.trim();
  if (!color) return "hsl(var(--primary))";
  if (/^(#(?:[0-9a-f]{3,8})|rgb\(|hsl\(|oklch\()/i.test(color)) return color;
  return "hsl(var(--primary))";
}

function getTimelineRoute(item: TimelineItem) {
  return item._type === "service" ? `/app/services/${item.id}` : "/app/events";
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
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
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

      setLoading(true);
      try {
        const [statsData, servicesData, eventsData, announcementsData, ministriesData, assignmentsData, notificationsData] = await Promise.all([
          safeDashboardFetch("stats", () => fetchApi("/dashboard/stats"), null),
          safeDashboardFetch("services", () => fetchApi("/services"), []),
          safeDashboardFetch("events", () => fetchApi("/events"), []),
          safeDashboardFetch("announcements", () => fetchApi("/announcements"), []),
          safeDashboardFetch("ministries", () => fetchApi("/my-ministries"), []),
          safeDashboardFetch("asignaciones", () => fetchApi("/service-assignments/mine"), []),
          safeDashboardFetch("notificaciones", () => fetchApi("/notifications"), []),
        ]);

        if (statsData && typeof statsData === "object" && !("error" in statsData)) {
          setStats(statsData as Stats);
        }

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
            type: e.type as string,
            location: e.location as string | null,
          }));

        const merged = [...svcItems, ...evtItems].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        setTimeline(merged.slice(0, 10));

        setAnnouncements(Array.isArray(announcementsData) ? announcementsData.slice(0, 10) : []);
        const ministryPayload = ministriesData as MinistriesResponse;
        setMinistries(Array.isArray(ministriesData) ? ministriesData : Array.isArray(ministryPayload?.ministries) ? ministryPayload.ministries : []);
        setNotifications(Array.isArray(notificationsData) ? notificationsData.slice(0, 5) : []);
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
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!selectedChurch) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Card className="dashboard-panel w-full max-w-md border-dashed">
          <CardContent className="flex flex-col items-start gap-5 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-xl font-semibold">No hay iglesia seleccionada</p>
              <p className="text-sm leading-6 text-muted-foreground">
                Únete a una iglesia existente o crea tu propio espacio para comenzar a usar la app.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              <Button onClick={() => navigate("/join-church")}>
                Unirme a una iglesia
              </Button>
              <Button variant="outline" onClick={() => navigate("/create-church")}>
                Crear iglesia
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const endOfSunday = getEndOfSunday();
  const thisWeekItems = timeline.filter((item) => new Date(item.date) <= endOfSunday);
  const comingUpItems = timeline.filter((item) => new Date(item.date) > endOfSunday);
  const pendingAssignments = assignments
    .filter((assignment) => (assignment.responseStatus || (assignment.confirmed ? "accepted" : "pending")) === "pending")
    .filter((assignment) => assignment.service?.date && new Date(assignment.service.date).getTime() >= Date.now())
    .slice(0, 5);
  const unreadNotifications = notifications.filter((notification) => !notification.read).slice(0, 3);
  const nextItem = timeline[0] || null;

  const statItems = stats
    ? [
        { label: "Ministerios", value: stats.ministries, href: "/app/ministries", icon: Users },
        { label: "Eventos", value: stats.events, href: "/app/events", icon: CalendarDays },
        { label: "Canciones", value: stats.songs, href: "/app/songs", icon: Music },
        { label: "Servicios", value: stats.services, href: "/app/services", icon: ListChecks },
        { label: "Equipos", value: stats.teams, href: "/app/teams", icon: UsersRound },
        { label: "Miembros", value: stats.members, href: "/app/users", icon: Users },
        { label: "Anuncios", value: stats.announcements, href: "/app/announcements", icon: Megaphone },
      ]
    : [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "completed":
        return "border-border bg-secondary text-muted-foreground";
      default:
        return "border-amber-200 bg-amber-50 text-amber-700";
    }
  };

  const dashboardStyle = {
    "--dashboard-accent": getBrandAccent(selectedChurch.brandColor),
  } as CSSProperties;

  const renderSectionHeading = (title: string, action?: ReactNode) => (
    <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
      <div className="dashboard-section-heading min-w-0">
        <span className="dashboard-section-mark" aria-hidden="true" />
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );

  const renderTimelineGroup = (title: string, items: TimelineItem[]) => {
    if (items.length === 0) return null;

    return (
      <section className="dashboard-panel p-4 sm:p-5">
        {renderSectionHeading(title)}
        <div className="divide-y divide-border">
          {items.map((item) => (
            <button
              key={`${item._type}-${item.id}`}
              className="dashboard-row group flex w-full min-w-0 items-center gap-3 py-3 text-left"
              onClick={() => navigate(getTimelineRoute(item))}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                {item._type === "service" ? <ListChecks className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {formatDate(item.date)} {formatTime(item.date) !== "12:00 AM" && `- ${formatTime(item.date)}`}
                  {item.location && ` - ${item.location}`}
                </span>
              </span>
              {item._type === "service" && item.status && statusLabel(item.status) && (
                <span className={`hidden rounded-full border px-2 py-1 text-xs font-medium sm:inline-flex ${getStatusColor(item.status)}`}>
                  {statusLabel(item.status)}
                </span>
              )}
              {item._type === "event" && item.type && (
                <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 sm:inline-flex">
                  {item.type}
                </span>
              )}
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="mobile-page dashboard-shell" style={dashboardStyle}>
      <section className="dashboard-hero p-4 sm:p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-card">
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-sm bg-[var(--dashboard-accent)]" aria-hidden="true" />
              {selectedChurch.logoUrl ? (
                <img src={selectedChurch.logoUrl} alt="" className="h-9 w-9 rounded object-cover" />
              ) : (
                <span className="text-sm font-bold text-foreground">{getInitials(selectedChurch.name)}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{formatDate(new Date().toISOString())}</p>
              <h1 className="mt-1 text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{getGreeting()}</h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">{selectedChurch.name}</p>
            </div>
          </div>

          <div className="grid w-full max-w-full gap-2 sm:grid-cols-3 lg:w-[min(440px,100%)]">
            <Button className="h-10 rounded-md font-semibold" onClick={() => navigate("/app/services")}>
              <Plus className="h-4 w-4" /> Servicio
            </Button>
            <Button className="h-10 rounded-md font-semibold" variant="outline" onClick={() => navigate("/app/events")}>
              <Plus className="h-4 w-4" /> Evento
            </Button>
            <Button className="h-10 rounded-md font-semibold" variant="outline" onClick={() => navigate("/app/calendar")}>
              <Calendar className="h-4 w-4" /> Calendario
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="dashboard-mini">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span>{getRoleLabel(selectedChurch.role)}</span>
          </div>
          <div className="dashboard-mini">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <span>{pendingAssignments.length} pendientes</span>
          </div>
          <div className="dashboard-mini">
            <Clock3 className="h-4 w-4 text-muted-foreground" />
            <span>{timeline.length} próximos</span>
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="dashboard-panel p-4 sm:p-5">
          {renderSectionHeading("Siguiente en agenda")}
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando agenda
            </div>
          ) : nextItem ? (
            <button
              className="dashboard-next group w-full text-left"
              onClick={() => navigate(getTimelineRoute(nextItem))}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                {nextItem._type === "service" ? <ListChecks className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-muted-foreground">
                  {nextItem._type === "service" ? "Servicio" : "Evento"}
                </span>
                <span className="mt-1 block truncate text-lg font-semibold text-foreground">{nextItem.title}</span>
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatDate(nextItem.date)}</span>
                  {formatTime(nextItem.date) !== "12:00 AM" && <span>{formatTime(nextItem.date)}</span>}
                  {nextItem.location && <span>{nextItem.location}</span>}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ) : (
            <div className="flex items-start gap-3 py-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
                <CalendarDays className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">Agenda tranquila</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">No hay servicios o eventos próximos.</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <button className="dashboard-panel dashboard-action-tile text-left" onClick={() => navigate("/app/my-assignments")}>
            <span className="dashboard-action-icon">
              <ListChecks className="h-5 w-5" />
            </span>
            <span>
              <span className="dashboard-metric block text-2xl font-semibold">{pendingAssignments.length}</span>
              <span className="text-sm text-muted-foreground">Asignaciones por responder</span>
            </span>
          </button>
          <button className="dashboard-panel dashboard-action-tile text-left" onClick={() => navigate("/app/messages")}>
            <span className="dashboard-action-icon">
              <Bell className="h-5 w-5" />
            </span>
            <span>
              <span className="dashboard-metric block text-2xl font-semibold">{unreadNotifications.length}</span>
              <span className="text-sm text-muted-foreground">Notificaciones nuevas</span>
            </span>
          </button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <main className="min-w-0 space-y-4">
          {pendingAssignments.length > 0 && (
            <section className="dashboard-panel p-4 sm:p-5">
              {renderSectionHeading("Asignaciones pendientes")}
              <div className="divide-y divide-border">
                {pendingAssignments.map((assignment) => (
                  <div key={assignment.id} className="dashboard-row flex min-w-0 items-center gap-3 py-3">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => navigate(`/app/services/${assignment.serviceId}`)}
                    >
                      <p className="truncate text-sm font-semibold">{assignment.service?.title || "Servicio"}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {assignment.position}
                        {assignment.service?.date ? ` - ${formatDate(assignment.service.date)}` : ""}
                      </p>
                    </button>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 rounded-md text-destructive"
                        disabled={respondingId === assignment.id}
                        aria-label="Declinar asignación"
                        onClick={() => handleRespond(assignment.id, "decline")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        className="h-9 w-9 rounded-md"
                        disabled={respondingId === assignment.id}
                        aria-label="Aceptar asignación"
                        onClick={() => handleRespond(assignment.id, "accept")}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {unreadNotifications.length > 0 && (
            <section className="dashboard-panel p-4 sm:p-5">
              {renderSectionHeading("Notificaciones")}
              <div className="divide-y divide-border">
                {unreadNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    className="dashboard-row flex w-full min-w-0 items-start gap-3 py-3 text-left"
                    onClick={() => {
                      if (notification.data?.route) {
                        navigate(notification.data.route.replace(/^\/app/, "/app"));
                      }
                    }}
                  >
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-sm bg-[var(--dashboard-accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{notification.title}</span>
                      {notification.body && (
                        <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{notification.body}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {loading ? (
            <section className="dashboard-panel p-6">
              <div className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Cargando panel
              </div>
            </section>
          ) : timeline.length === 0 ? (
            <section className="dashboard-panel p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
                  <CalendarDays className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">No hay agenda próxima</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Crea un servicio o evento para llenar el panel.</p>
                </div>
              </div>
            </section>
          ) : (
            <>
              {renderTimelineGroup("Esta semana", thisWeekItems)}
              {renderTimelineGroup("Próximamente", comingUpItems)}
            </>
          )}

          {announcements.length > 0 && (
            <section className="dashboard-panel p-4 sm:p-5">
              {renderSectionHeading(
                "Anuncios recientes",
                <Button className="h-8 rounded-md px-2 text-xs font-semibold" size="sm" variant="ghost" onClick={() => navigate("/app/announcements")}>
                  Ver todos <ArrowRight className="h-3 w-3" />
                </Button>
              )}
              <div className="grid gap-3">
                {announcements.slice(0, 4).map((ann) => (
                  <article key={ann.id} className="dashboard-row grid min-w-0 gap-3 py-3 sm:grid-cols-[88px_minmax(0,1fr)]">
                    {ann.imageUrl ? (
                      <img src={ann.imageUrl} alt="" className="h-20 w-full rounded-md object-cover sm:w-[88px]" />
                    ) : (
                      <div className="hidden h-20 rounded-md bg-secondary sm:block" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{ann.title}</p>
                      {ann.content && (
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{ann.content}</p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {ann.createdAt ? formatShortDate(ann.createdAt) : ""}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </main>

        <aside className="min-w-0 space-y-4">
          {ministries.length > 0 && (
            <section className="dashboard-panel p-4 sm:p-5">
              {renderSectionHeading("Mis ministerios")}
              <div className="grid gap-2">
                {ministries.map((m) => (
                  <button
                    key={m.id}
                    className="dashboard-row flex w-full min-w-0 items-center gap-3 p-2 text-left"
                    onClick={() => navigate(`/app/ministries/${m.id}`)}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: getBrandAccent(m.color) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.name}</span>
                      {m.memberCount != null && (
                        <span className="text-xs text-muted-foreground">{m.memberCount} miembros</span>
                      )}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {statItems.length > 0 && (
            <section className="dashboard-panel p-4 sm:p-5">
              {renderSectionHeading("Resumen")}
              <div className="grid grid-cols-2 gap-2">
                {statItems.map((stat) => (
                  <button
                    key={stat.label}
                    className="dashboard-stat text-left"
                    onClick={() => navigate(stat.href)}
                  >
                    <stat.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="dashboard-metric mt-3 block text-xl font-semibold">{stat.value}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{stat.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="dashboard-panel dashboard-panel-muted p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-card">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Pulso de la iglesia</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Agenda, asignaciones y comunicación en una sola vista operativa.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
