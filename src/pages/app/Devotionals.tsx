import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle, Loader2, PlayCircle, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { getYoutubeEmbedUrl } from "@/lib/youtube";

type DevotionalStatus = "draft" | "published";

interface Devotional {
  id: string;
  title: string;
  scriptureRef?: string | null;
  bibleText?: string | null;
  body: string;
  videoUrl?: string | null;
  videoTitle?: string | null;
  publishDate: string;
  status: DevotionalStatus;
  readAt?: string | null;
  authorFirstName?: string | null;
  authorLastName?: string | null;
  authorEmail?: string | null;
}

interface DevotionalsResponse {
  devotionals?: Devotional[];
  permissions?: {
    canManage?: boolean;
  };
}

const emptyForm = {
  title: "",
  scriptureRef: "",
  bibleText: "",
  body: "",
  videoUrl: "",
  videoTitle: "",
  publishDate: new Date().toISOString().slice(0, 10),
  status: "published" as DevotionalStatus,
};

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("es-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function authorName(devotional: Devotional) {
  return [devotional.authorFirstName, devotional.authorLastName].filter(Boolean).join(" ").trim() ||
    devotional.authorEmail ||
    "Pastor";
}

export default function Devotionals() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [devotionals, setDevotionals] = useState<Devotional[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const published = useMemo(() => devotionals.filter((devotional) => devotional.status === "published"), [devotionals]);
  const todayDevotional = published[0] || devotionals[0] || null;
  const pastDevotionals = devotionals.filter((devotional) => devotional.id !== todayDevotional?.id);

  const loadDevotionals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<DevotionalsResponse>("/devotionals?includeDrafts=1");
      setDevotionals(Array.isArray(data.devotionals) ? data.devotionals : []);
      setCanManage(Boolean(data.permissions?.canManage));
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "No se pudieron cargar los devocionales",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [fetchApi, toast]);

  useEffect(() => {
    loadDevotionals();
  }, [loadDevotionals]);

  async function createDevotional(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Título y reflexión son obligatorios", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      await fetchApi("/devotionals", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ ...emptyForm, publishDate: new Date().toISOString().slice(0, 10) });
      setShowForm(false);
      toast({ title: "Devocional guardado" });
      await loadDevotionals();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "No se pudo guardar el devocional",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function markAsRead(id: string) {
    setMarkingId(id);
    try {
      const data = await fetchApi<{ readAt?: string }>(`/devotionals/${id}/read`, { method: "POST" });
      setDevotionals((current) =>
        current.map((devotional) =>
          devotional.id === id ? { ...devotional, readAt: data.readAt || new Date().toISOString() } : devotional
        )
      );
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "No se pudo marcar como leído",
        variant: "destructive",
      });
    } finally {
      setMarkingId(null);
    }
  }

  async function deleteDevotional(id: string) {
    if (!window.confirm("¿Eliminar este devocional?")) return;
    try {
      await fetchApi(`/devotionals/${id}`, { method: "DELETE" });
      setDevotionals((current) => current.filter((devotional) => devotional.id !== id));
      toast({ title: "Devocional eliminado" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "No se pudo eliminar",
        variant: "destructive",
      });
    }
  }

  const renderDevotional = (devotional: Devotional, featured = false) => {
    const embedUrl = getYoutubeEmbedUrl(devotional.videoUrl);

    return (
      <Card key={devotional.id} className="app-card overflow-hidden">
        {embedUrl && (
          <div className="bg-zinc-950 p-2">
            <div className="aspect-video overflow-hidden rounded-xl bg-black">
              <iframe
                src={embedUrl}
                title={devotional.videoTitle || devotional.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        )}
        <CardContent className={featured ? "p-5" : "p-4"}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full">
              {formatDate(devotional.publishDate)}
            </Badge>
            {devotional.status === "draft" && (
              <Badge className="rounded-full bg-amber-100 text-amber-800 hover:bg-amber-100">
                Borrador
              </Badge>
            )}
            {devotional.readAt && (
              <Badge className="rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                <CheckCircle className="mr-1 h-3 w-3" />
                Leído
              </Badge>
            )}
          </div>
          <h2 className={`${featured ? "mt-4 text-2xl" : "mt-3 text-lg"} font-black leading-tight tracking-tight text-zinc-950`}>
            {devotional.title}
          </h2>
          {devotional.scriptureRef && (
            <p className="mt-1 text-sm font-bold text-primary">{devotional.scriptureRef}</p>
          )}
          {devotional.bibleText && (
            <div className="mt-4 rounded-2xl bg-primary/10 p-4 text-sm leading-6 text-zinc-700">
              {devotional.bibleText}
            </div>
          )}
          <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">{devotional.body}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Por {authorName(devotional)}</span>
            {!devotional.readAt && devotional.status === "published" && (
              <Button size="sm" onClick={() => markAsRead(devotional.id)} disabled={markingId === devotional.id}>
                {markingId === devotional.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Marcar leído"}
              </Button>
            )}
            {devotional.videoUrl && !embedUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={devotional.videoUrl} target="_blank" rel="noreferrer">
                  <PlayCircle className="mr-1 h-4 w-4" />
                  Video
                </a>
              </Button>
            )}
            {canManage && (
              <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteDevotional(devotional.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge variant="secondary" className="mb-2 gap-1 rounded-full">
            <BookOpen className="h-3.5 w-3.5" />
            Devocional diario
          </Badge>
          <h1 className="text-3xl font-black tracking-tight text-zinc-950">Devocionales</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Biblia, reflexión y enseñanza para caminar con Dios cada día.
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="shrink-0 rounded-2xl" onClick={() => setShowForm((current) => !current)}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {canManage && showForm && (
        <Card className="app-card">
          <CardContent className="p-4">
            <form onSubmit={createDevotional} className="space-y-3">
              <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Título del devocional" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={form.scriptureRef} onChange={(event) => setForm((current) => ({ ...current, scriptureRef: event.target.value }))} placeholder="Juan 14:27" />
                <Input type="date" value={form.publishDate} onChange={(event) => setForm((current) => ({ ...current, publishDate: event.target.value }))} />
              </div>
              <Textarea value={form.bibleText} onChange={(event) => setForm((current) => ({ ...current, bibleText: event.target.value }))} placeholder="Texto bíblico" rows={3} />
              <Textarea value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder="Reflexión pastoral del día" rows={5} />
              <Input value={form.videoUrl} onChange={(event) => setForm((current) => ({ ...current, videoUrl: event.target.value }))} placeholder="Link de YouTube opcional" />
              <Input value={form.videoTitle} onChange={(event) => setForm((current) => ({ ...current, videoTitle: event.target.value }))} placeholder="Título del video opcional" />
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as DevotionalStatus }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="published">Publicado</option>
                <option value="draft">Borrador</option>
              </select>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar devocional"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {devotionals.length === 0 ? (
        <Card className="app-card">
          <CardContent className="p-8 text-center">
            <BookOpen className="mx-auto mb-3 h-9 w-9 text-muted-foreground/50" />
            <p className="font-bold">Aún no hay devocionales</p>
            <p className="mt-1 text-sm text-muted-foreground">Cuando tu pastor publique uno, aparecerá aquí.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {todayDevotional && renderDevotional(todayDevotional, true)}
          {pastDevotionals.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-muted-foreground">Anteriores</p>
              {pastDevotionals.map((devotional) => renderDevotional(devotional))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
