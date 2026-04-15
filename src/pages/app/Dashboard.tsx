import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, Music, Users, Megaphone } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";

export default function Dashboard() {
  const { fetchApi } = useApi();
  const { selectedChurch, loading: churchLoading } = useChurch();
  const [stats, setStats] = useState({ services: 0, songs: 0, members: 0 });
  const [services, setServices] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!selectedChurch) {
        setLoading(false);
        return;
      }

      try {
        const [statsData, servicesData, announcementsData] = await Promise.all([
          fetchApi("/dashboard/stats"),
          fetchApi("/services"),
          fetchApi("/announcements"),
        ]);
        
        setStats({
          services: statsData?.services ?? 0,
          songs: statsData?.songs ?? 0,
          members: statsData?.members ?? 0,
        });
        setServices(Array.isArray(servicesData) ? servicesData.slice(0, 5) : []);
        setAnnouncements(Array.isArray(announcementsData) ? announcementsData.slice(0, 3) : []);
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

  const statCards = [
    { label: "This Week", value: `${stats.services} Services`, icon: CalendarDays, color: "text-primary" },
    { label: "Songs", value: String(stats.songs), icon: Music, color: "text-blue-500" },
    { label: "Members", value: String(stats.members), icon: Users, color: "text-orange-500" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{selectedChurch.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{selectedChurch.role.toLowerCase()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-semibold">{s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Upcoming Services
          </h2>
          <div className="space-y-2">
            {loading && <div className="text-center py-8"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" /></div>}
            {!loading && services.length === 0 && (
              <p className="text-sm text-muted-foreground">No upcoming services.</p>
            )}
            {!loading && services.map((svc: any) => (
              <Card key={svc.id}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-1 h-10 rounded bg-primary" />
                  <div>
                    <p className="font-medium">{svc.name || svc.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {svc.date ? new Date(svc.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""}
                      {svc.time ? ` · ${svc.time}` : ""}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Megaphone className="w-4 h-4" /> Recent Announcements
          </h2>
          <div className="space-y-3">
            {loading && <div className="text-center py-8"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" /></div>}
            {!loading && announcements.length === 0 && (
              <p className="text-sm text-muted-foreground">No recent announcements.</p>
            )}
            {!loading && announcements.map((ann: any) => (
              <Card key={ann.id} className="overflow-hidden">
                <div className="flex">
                  {ann.imageUrl && (
                    <div className="w-24 h-24 shrink-0">
                      <img 
                        src={ann.imageUrl} 
                        alt={ann.title} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <CardContent className="p-3 flex-1">
                    <p className="font-medium text-sm line-clamp-1">{ann.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {ann.content}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      {ann.createdAt ? new Date(ann.createdAt).toLocaleDateString("en-US", { month: 'short', day: 'numeric' }) : ""}
                    </p>
                  </CardContent>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}