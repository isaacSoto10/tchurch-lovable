import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { useApi } from "@/hooks/useApi";

export default function Ministries() {
  const { fetchApi } = useApi();
  const [ministries, setMinistries] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi("/ministries")
      .then((data) => setMinistries(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load ministries:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  const filtered = ministries.filter((m) =>
    (m.name || m.title || "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Ministries</h1>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Ministry</Button>
      </div>
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search ministries..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="grid gap-3">
        {filtered.map((m: any) => (
          <Card key={m.id} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-1">{m.name || m.title}</h3>
              <p className="text-sm text-muted-foreground">{m.description || m.desc || ""}</p>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No ministries found.</p>
        )}
      </div>
    </div>
  );
}
