import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Heart, Check } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useToast } from "@/components/ui/use-toast";

interface PrayerRequest {
  id: string;
  title: string;
  content: string;
  requesterName?: string;
  status: "active" | "answered";
  prayCount?: number;
  createdAt: string;
}

export default function Prayer() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();
  const [prayerRequests, setPrayerRequests] = useState<PrayerRequest[]>([]);
  const [filter, setFilter] = useState<"active" | "answered">("active");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newRequest, setNewRequest] = useState({ title: "", content: "" });
  const [submitting, setSubmitting] = useState(false);

  const loadPrayerRequests = useCallback(() => {
    setLoading(true);
    fetchApi(`/prayer-requests?status=${filter}`)
      .then((data) => setPrayerRequests(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load prayer requests:", e))
      .finally(() => setLoading(false));
  }, [fetchApi, filter]);

  useEffect(() => {
    loadPrayerRequests();
  }, [loadPrayerRequests, selectedChurch]);

  const handlePray = async (id: string) => {
    try {
      await fetchApi(`/prayer-requests/${id}/pray`, { method: "POST" });
      loadPrayerRequests();
    } catch (e) {
      console.error("Failed to pray:", e);
    }
  };

  const handleMarkAnswered = async (id: string) => {
    try {
      await fetchApi(`/prayer-requests/${id}/answer`, { method: "PUT" });
      toast({ title: "Marcada como contestada" });
      loadPrayerRequests();
    } catch (e) {
      toast({ title: "No se pudo marcar como contestada", variant: "destructive" });
    }
  };

  const handleSubmitRequest = async () => {
    if (!newRequest.title.trim() || !newRequest.content.trim()) return;

    setSubmitting(true);
    try {
      await fetchApi("/prayer-requests", {
        method: "POST",
        body: JSON.stringify(newRequest),
      });
      setNewRequest({ title: "", content: "" });
      setShowForm(false);
      loadPrayerRequests();
    } catch (e) {
      toast({ title: "No se pudo enviar la petición", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-page space-y-5">
      <div className="app-page-header p-4 sm:p-5">
        <div className="app-page-header-grid">
          <div className="min-w-0">
            <p className="app-page-kicker">Cuidado pastoral</p>
            <h1 className="app-page-title">Oración</h1>
            <p className="app-page-copy">Peticiones activas y respuestas para acompañar a la comunidad.</p>
          </div>
          <Button size="sm" className="rounded-md" onClick={() => setShowForm(!showForm)}>
            <Plus className="w-4 h-4 mr-1" /> Nueva petición
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="app-list-card">
          <CardContent className="p-4 space-y-3">
            <Input
              placeholder="Título de la petición"
              value={newRequest.title}
              onChange={(e) => setNewRequest({ ...newRequest, title: e.target.value })}
              className="app-control"
            />
            <Textarea
              placeholder="Describe la petición..."
              value={newRequest.content}
              onChange={(e) => setNewRequest({ ...newRequest, content: e.target.value })}
              className="rounded-md"
            />
            <div className="flex gap-2">
              <Button className="rounded-md" onClick={handleSubmitRequest} disabled={submitting}>
                {submitting ? "Enviando..." : "Enviar"}
              </Button>
              <Button variant="outline" className="rounded-md" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="active" onValueChange={(v) => setFilter(v as "active" | "answered")}>
        <TabsList className="rounded-md bg-muted p-1">
          <TabsTrigger value="active" className="rounded-sm">Activas</TabsTrigger>
          <TabsTrigger value="answered" className="rounded-sm">Contestadas</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {!loading && prayerRequests.length === 0 && (
          <div className="app-empty-state">
            <Heart className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No hay peticiones {filter === "active" ? "activas" : "contestadas"}.
            </p>
          </div>
        )}
        {!loading && prayerRequests.map((pr) => (
          <Card key={pr.id} className="app-list-card">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h3 className="font-medium">{pr.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{pr.content}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">
                      {pr.requesterName || "Anónimo"}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(pr.createdAt).toLocaleDateString("es-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </div>
                {filter === "active" && (
                  <div className="flex gap-2 shrink-0">
                    {selectedChurch?.role === "ADMIN" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkAnswered(pr.id)}
                        className="shrink-0 rounded-md"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePray(pr.id)}
                      className="shrink-0 rounded-md"
                    >
                      <Heart className="w-4 h-4 mr-1" />
                      {pr.prayCount || 0}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
