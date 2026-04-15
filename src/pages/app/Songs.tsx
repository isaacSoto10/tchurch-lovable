import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { useApi } from "@/hooks/useApi";

export default function Songs() {
  const { fetchApi } = useApi();
  const [songs, setSongs] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi("/songs")
      .then((data) => setSongs(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load songs:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  const filtered = songs.filter((s) =>
    (s.title || s.name || "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Songs</h1>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Song</Button>
      </div>
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search songs..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="grid gap-3">
        {filtered.map((s) => (
          <Card key={s.id} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center text-sm font-bold text-primary">
                  {s.key || "—"}
                </div>
                <span className="font-medium">{s.title || s.name}</span>
              </div>
              {s.bpm && <span className="text-sm text-muted-foreground">{s.bpm} BPM</span>}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No songs found.</p>
        )}
      </div>
    </div>
  );
}
