import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";

export default function Announcements() {
  const { fetchApi } = useApi();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi("/announcements")
      .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load announcements:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Announcements</h1>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New</Button>
      </div>
      <div className="grid gap-3">
        {announcements.length === 0 && (
          <p className="text-sm text-muted-foreground">No announcements yet.</p>
        )}
        {announcements.map((a: any) => (
          <Card key={a.id} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-1">{a.title}</h3>
              <p className="text-sm text-muted-foreground">{a.description || a.content || a.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
