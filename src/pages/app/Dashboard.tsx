import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, Music, Users } from "lucide-react";
import { useApi } from "@/hooks/useApi";

export default function Dashboard() {
  const { fetchApi } = useApi();
  const [stats, setStats] = useState({ services: 0, songs: 0, members: 0 });
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [statsData, servicesData] = await Promise.all([
          fetchApi("/dashboard/stats"),
          fetchApi("/services"),
        ]);
        setStats({
          services: statsData?.servicesThisWeek ?? 0,
          songs: statsData?.totalSongs ?? 0,
          members: statsData?.totalMembers ?? 0,
        });
        setServices(Array.isArray(servicesData) ? servicesData.slice(0, 5) : []);
      } catch (e) {
        console.error("Failed to load dashboard:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchApi]);

  const statCards = [
    { label: "This Week", value: `${stats.services} Services`, icon: CalendarDays, color: "text-primary" },
    { label: "Songs", value: String(stats.songs), icon: Music, color: "text-blue-500" },
    { label: "Members", value: String(stats.members), icon: Users, color: "text-orange-500" },
  ];

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
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

      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Upcoming Services
      </h2>
      <div className="space-y-2">
        {services.length === 0 && (
          <p className="text-sm text-muted-foreground">No upcoming services.</p>
        )}
        {services.map((svc: any) => (
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
  );
}
