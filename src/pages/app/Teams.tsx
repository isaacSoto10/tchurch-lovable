import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { useApi } from "@/hooks/useApi";

export default function Teams() {
  const { fetchApi } = useApi();
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi("/teams")
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load teams:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Teams</h1>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Team</Button>
      </div>
      <div className="grid gap-3">
        {teams.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        )}
        {teams.map((t: any) => (
          <Card key={t.id} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">{t.name || t.title}</h3>
                <p className="text-sm text-muted-foreground">{t.description || t.desc || ""}</p>
              </div>
              {t.memberCount != null && (
                <span className="text-sm text-muted-foreground">{t.memberCount} members</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
