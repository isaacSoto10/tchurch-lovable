import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, Music, Users } from "lucide-react";

const stats = [
  { label: "This Week", value: "3 Services", icon: CalendarDays, color: "text-primary" },
  { label: "Songs", value: "303", icon: Music, color: "text-blue-500" },
  { label: "Members", value: "8", icon: Users, color: "text-orange-500" },
];

const services = [
  { name: "Sunday Worship", time: "Sun, Apr 13 · 10:00 AM" },
  { name: "Wednesday Bible Study", time: "Wed, Apr 16 · 7:00 PM" },
  { name: "Youth Service", time: "Fri, Apr 18 · 7:30 PM" },
];

export default function Dashboard() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <span className="text-xs font-medium bg-accent text-accent-foreground px-3 py-1 rounded-full">
          FREE
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats.map((s) => (
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
        This Week
      </h2>
      <div className="space-y-2">
        {services.map((svc) => (
          <Card key={svc.name}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-1 h-10 rounded bg-primary" />
              <div>
                <p className="font-medium">{svc.name}</p>
                <p className="text-sm text-muted-foreground">{svc.time}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
