import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Music, Users, Megaphone, ListChecks, UsersRound, Calendar, ArrowRight, Plus } from "lucide-react";
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

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const { fetchApi } = useApi();
  const { selectedChurch, loading: churchLoading } = useChurch();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!selectedChurch) {
        setLoading(false);
        return;
      }

      try {
        const [statsData, servicesData, eventsData, announcementsData] = await Promise.all([
          fetchApi("/dashboard/stats"),
          fetchApi("/services"),
          fetchApi("/events"),
          fetchApi("/announcements"),
        ]);

        if (statsData && typeof statsData === "object" && !statsData.error) {
          setStats(statsData as Stats);
        }

        const now = new Date().toISOString();
        const svcItems: TimelineItem[] = (Array.isArray(servicesData) ? servicesData : [])
          .filter((s: Record<string, unknown>) => typeof s.date === "string" && s.date >= now)
          .map((s: Record<string, unknown>) => ({
            id: s.id as string,
            _type: "service" as const,
            title: s.title as string,
            date: s.date as string,
            status: s.status as string,
            type: s.type as string,
          }));

        const evtItems: TimelineItem[] = (Array.isArray(eventsData) ? eventsData : [])
          .filter((e: Record<string, unknown>) => typeof e.date === "string" && e.date >= now)
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
      } catch (e) {
        console.error("Failed to load dashboard:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchApi, selectedChurch]);

  if (churchLoading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!selectedChurch) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-muted-foreground mb-2">No church selected</p>
        <p className="text-sm text-muted-foreground">Contact support to join a church</p>
      </div>
    );
  }

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
  const thisWeekItems = timeline.filter((item) => new Date(item.date) <= endOfSunday);
  const comingUpItems = timeline.filter((item) => new Date(item.date) > endOfSunday);

  const statItems = stats
    ? [
        { label: "Ministries", value: stats.ministries, href: "/app/ministries", icon: Users },
        { label: "Events", value: stats.events, href: "/app/events", icon: CalendarDays },
        { label: "Songs", value: stats.songs, href: "/app/songs", icon: Music },
        { label: "Services", value: stats.services, href: "/app/services", icon: ListChecks },
        { label: "Teams", value: stats.teams, href: "/app/teams", icon: UsersRound },
        { label: "Members", value: stats.members, href: "/app/users", icon: Users },
        { label: "Announcements", value: stats.announcements, href: "/app/announcements", icon: Megaphone },
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{selectedChurch.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{selectedChurch.role.toLowerCase()}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate("/app/calendar")}>
          <Calendar className="w-4 h-4 mr-1" /> Calendar
        </Button>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {statItems.map((stat) => (
          <Card
            key={stat.label}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(stat.href)}
          >
            <CardContent className="p-2 text-center">
              <stat.icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-lg font-bold">{stat.value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        <Button size="sm" onClick={() => navigate("/app/services")}>
          <Plus className="w-3 h-3 mr-1" /> New Service
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("/app/events")}>
          <Plus className="w-3 h-3 mr-1" /> New Event
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : timeline.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No upcoming services or events</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {thisWeekItems.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                This Week
              </h2>
              <div className="space-y-2">
                {thisWeekItems.map((item) => (
                  <Card
                    key={`${item._type}-${item.id}`}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => navigate(item._type === "service" ? "/app/services" : "/app/events")}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className={`w-1 h-10 rounded ${item._type === "service" ? "bg-primary" : "bg-amber-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(item.date)} {formatTime(item.date) !== "12:00 AM" && `· ${formatTime(item.date)}`}
                          {item.location && ` · ${item.location}`}
                        </p>
                      </div>
                      {item._type === "service" && item.status && (
                        <span className={`text-xs px-2 py-1 rounded ${getStatusColor(item.status)}`}>
                          {item.status}
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
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Coming Up
              </h2>
              <div className="space-y-2">
                {comingUpItems.map((item) => (
                  <Card
                    key={`${item._type}-${item.id}`}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => navigate(item._type === "service" ? "/app/services" : "/app/events")}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className={`w-1 h-10 rounded ${item._type === "service" ? "bg-primary" : "bg-amber-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(item.date)} {formatTime(item.date) !== "12:00 AM" && `· ${formatTime(item.date)}`}
                          {item.location && ` · ${item.location}`}
                        </p>
                      </div>
                      {item._type === "service" && item.status && (
                        <span className={`text-xs px-2 py-1 rounded ${getStatusColor(item.status)}`}>
                          {item.status}
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

      {announcements.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Announcements
            </h2>
            <Button size="sm" variant="ghost" onClick={() => navigate("/app/announcements")}>
              View All <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          <div className="space-y-3">
            {announcements.slice(0, 10).map((ann) => (
              <Card key={ann.id} className="overflow-hidden">
                <div className="flex">
                  {ann.imageUrl && (
                    <div className="w-24 h-24 shrink-0">
                      <img src={ann.imageUrl} alt={ann.title} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <CardContent className="p-3 flex-1">
                    <p className="font-medium">{ann.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {ann.content}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {ann.createdAt ? new Date(ann.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      }) : ""}
                    </p>
                  </CardContent>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}