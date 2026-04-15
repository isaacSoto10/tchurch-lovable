import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";

export default function Services() {
  const { fetchApi } = useApi();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi("/services")
      .then((data) => setServices(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load services:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Services</h1>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Service</Button>
      </div>
      <div className="space-y-2">
        {services.length === 0 && (
          <p className="text-sm text-muted-foreground">No services yet.</p>
        )}
        {services.map((svc: any) => (
          <Card key={svc.id} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-1 h-10 rounded bg-primary" />
              <div className="flex-1">
                <p className="font-medium">{svc.name || svc.title}</p>
                <p className="text-sm text-muted-foreground">
                  {svc.date ? new Date(svc.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""}
                  {svc.time ? ` · ${svc.time}` : ""}
                </p>
              </div>
              <span className="text-xs text-muted-foreground capitalize">{svc.status || ""}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
