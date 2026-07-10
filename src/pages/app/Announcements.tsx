import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ImageIcon, Loader2, Megaphone, MessageCircle, Plus, Send, Trash2, X } from "lucide-react";
import { AnnouncementAiImageField } from "@/components/AnnouncementAiImageField";
import { SectionNav } from "@/components/SectionNav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";

type AnnouncementStatus = "PENDING" | "PUBLISHED" | "REJECTED";
type Locale = "en" | "es";

interface Announcement {
  id: string;
  title: string;
  content: string;
  imageUrl?: string | null;
  ministryId?: string | null;
  ministryName?: string | null;
  status: AnnouncementStatus;
  createdAt: string;
  publishedAt?: string | null;
  creatorFirstName?: string | null;
  creatorLastName?: string | null;
  creatorEmail?: string | null;
}

interface Ministry {
  id: string;
  name: string;
  color?: string | null;
}

interface MyMinistriesResponse {
  ministries?: Ministry[];
  role?: string | null;
  ministryRoles?: Record<string, string>;
}

type AnnouncementsSnapshot = {
  announcements: Announcement[];
  ministries: Ministry[];
  role: string | null;
  ministryRoles: Record<string, string>;
};

const ANNOUNCEMENTS_SNAPSHOT_PREFIX = "tchurch_ios_announcements_snapshot_v2";

function isAnnouncementsSnapshot(value: unknown): value is AnnouncementsSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<AnnouncementsSnapshot>;
  return Array.isArray(snapshot.announcements) && Array.isArray(snapshot.ministries) && Boolean(snapshot.ministryRoles);
}

function statusClasses(status: AnnouncementStatus) {
  if (status === "PUBLISHED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "REJECTED") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusLabel(status: AnnouncementStatus) {
  if (status === "PUBLISHED") return "Publicado";
  if (status === "REJECTED") return "Rechazado";
  return "Pendiente";
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("es-US", { month: "short", day: "numeric", year: "numeric" });
}

function creatorName(announcement: Announcement) {
  return [announcement.creatorFirstName, announcement.creatorLastName].filter(Boolean).join(" ")
    || announcement.creatorEmail
    || "Un miembro";
}

function whatsappShareLink(title: string, content: string, imageUrl?: string | null) {
  const imageLine = imageUrl ? `\n\n${imageUrl}` : "";
  return `https://wa.me/?text=${encodeURIComponent(`📣 ${title}\n\n${content}${imageLine}`)}`;
}

interface AnnouncementCardProps {
  announcement: Announcement;
  onDelete?: () => void;
  actions?: React.ReactNode;
}

function AnnouncementCard({ announcement, onDelete, actions }: AnnouncementCardProps) {
  const date = formatDate(announcement.publishedAt || announcement.createdAt);
  return (
    <Card className="app-card overflow-hidden">
      <div className={announcement.imageUrl ? "md:grid md:grid-cols-[14rem_minmax(0,1fr)]" : ""}>
        {announcement.imageUrl ? (
          <div className="aspect-video overflow-hidden bg-secondary md:aspect-auto md:min-h-48">
            <img src={announcement.imageUrl} alt={`Arte del anuncio ${announcement.title}`} className="h-full w-full object-cover" />
          </div>
        ) : null}
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            {!announcement.imageUrl && (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <ImageIcon className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={statusClasses(announcement.status)}>{statusLabel(announcement.status)}</Badge>
                <Badge variant="secondary">{announcement.ministryName || "Toda la iglesia"}</Badge>
              </div>
              <h3 className="mt-3 text-lg font-semibold leading-tight text-foreground">{announcement.title}</h3>
            </div>
            {onDelete && (
              <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Eliminar ${announcement.title}`} className="shrink-0 text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/85">{announcement.content}</p>
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="h-4 w-4 shrink-0" />
              <span className="truncate">{date ? `${date} · ` : ""}{creatorName(announcement)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={whatsappShareLink(announcement.title, announcement.content, announcement.imageUrl)} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
              </Button>
              {actions}
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

export default function Announcements() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [ministryRoles, setMinistryRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("es");
  const [audience, setAudience] = useState<"general" | "ministry">("general");
  const [ministryId, setMinistryId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const isAdmin = role === "ADMIN";
  const leaderMinistries = useMemo(
    () => ministries.filter((ministry) => ["LEADER", "CO_LEADER"].includes(String(ministryRoles[ministry.id] || "").toUpperCase())),
    [ministries, ministryRoles],
  );
  const selectedMinistry = ministries.find((ministry) => ministry.id === ministryId);
  const pending = announcements.filter((announcement) => announcement.status === "PENDING");
  const published = announcements.filter((announcement) => announcement.status === "PUBLISHED");
  const rejected = announcements.filter((announcement) => announcement.status === "REJECTED");
  const snapshotKey = sessionSnapshotKey(ANNOUNCEMENTS_SNAPSHOT_PREFIX, getChurchId() || "default");

  const applyPageData = useCallback((snapshot: AnnouncementsSnapshot) => {
    setAnnouncements(snapshot.announcements);
    setMinistries(snapshot.ministries);
    setRole(snapshot.role);
    setMinistryRoles(snapshot.ministryRoles);
  }, []);

  const loadPage = useCallback(async (preferSnapshot = true) => {
    const snapshot = preferSnapshot
      ? readSessionSnapshot<AnnouncementsSnapshot>(snapshotKey, { validate: isAnnouncementsSnapshot })
      : null;
    if (snapshot) {
      applyPageData(snapshot.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setLoadError(null);

    try {
      const [announcementResult, mineResult] = await Promise.allSettled([
        fetchApi<Announcement[]>("/announcements?includePending=1&limit=40"),
        fetchApi<MyMinistriesResponse>("/my-ministries"),
      ]);
      if (announcementResult.status === "rejected") throw announcementResult.reason;
      const nextSnapshot: AnnouncementsSnapshot = {
        announcements: Array.isArray(announcementResult.value) ? announcementResult.value : [],
        ministries: mineResult.status === "fulfilled" ? mineResult.value.ministries || [] : snapshot?.data.ministries || [],
        role: mineResult.status === "fulfilled" ? mineResult.value.role || null : snapshot?.data.role || null,
        ministryRoles: mineResult.status === "fulfilled" ? mineResult.value.ministryRoles || {} : snapshot?.data.ministryRoles || {},
      };
      applyPageData(nextSnapshot);
      writeSessionSnapshot(snapshotKey, nextSnapshot);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los anuncios.");
    } finally {
      setLoading(false);
    }
  }, [applyPageData, fetchApi, snapshotKey]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (audience === "ministry" && !ministryId && leaderMinistries.length > 0) setMinistryId(leaderMinistries[0].id);
  }, [audience, leaderMinistries, ministryId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    if (audience === "ministry" && !ministryId) return;
    setSubmitting(true);
    try {
      const created = await fetchApi<Announcement>("/announcements", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          imageUrl,
          ministryId: audience === "ministry" ? ministryId : null,
        }),
      });
      setTitle("");
      setContent("");
      setImageUrl(null);
      setComposerOpen(false);
      toast({
        title: created.status === "PENDING" ? "Enviado para aprobación" : "Anuncio publicado",
        description: created.status === "PENDING" ? "Un administrador lo revisará antes de publicarlo." : "Los miembros ya pueden verlo.",
      });
      await loadPage(false);
    } catch (error) {
      toast({ title: "No se pudo publicar", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(id: string, action: "approve" | "reject") {
    setProcessingId(id);
    try {
      await fetchApi(`/announcements/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      toast({ title: action === "approve" ? "Anuncio aprobado" : "Anuncio rechazado" });
      await loadPage(false);
    } catch (error) {
      toast({ title: "No se pudo revisar el anuncio", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await fetchApi(`/announcements/${deleteId}`, { method: "DELETE" });
      setDeleteId(null);
      toast({ title: "Anuncio eliminado" });
      await loadPage(false);
    } catch (error) {
      toast({ title: "No se pudo eliminar el anuncio", variant: "destructive" });
    }
  }

  return (
    <div className="mobile-page mx-auto max-w-5xl space-y-5">
      <SectionNav section="community" label="Comunidad" />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mobile-section-title">Comunidad</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Anuncios</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Avisos importantes de tu iglesia y sus ministerios.</p>
        </div>
        <Button onClick={() => setComposerOpen((open) => !open)}>
          {composerOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {composerOpen ? "Cerrar" : "Nuevo anuncio"}
        </Button>
      </header>

      {composerOpen && (
        <Card className="app-card">
          <CardHeader className="border-b border-border p-4 sm:p-5">
            <CardTitle className="text-lg">Crear anuncio</CardTitle>
            <p className="text-sm text-muted-foreground">Elige la audiencia y comparte un mensaje claro.</p>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1">
                  <button type="button" onClick={() => setAudience("general")} className={`min-h-11 rounded-[10px] px-3 text-sm font-semibold ${audience === "general" ? "bg-primary text-white" : "text-muted-foreground"}`}>Toda la iglesia</button>
                  <button type="button" onClick={() => setAudience("ministry")} disabled={leaderMinistries.length === 0} className={`min-h-11 rounded-[10px] px-3 text-sm font-semibold disabled:opacity-40 ${audience === "ministry" ? "bg-primary text-white" : "text-muted-foreground"}`}>Ministerio</button>
                </div>
                {audience === "ministry" && (
                  <Select value={ministryId} onValueChange={setMinistryId}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Elige ministerio" /></SelectTrigger>
                    <SelectContent>{leaderMinistries.map((ministry) => <SelectItem key={ministry.id} value={ministry.id}>{ministry.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título" className="h-11 rounded-xl" />
                <Textarea required rows={6} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Escribe el anuncio..." className="resize-none rounded-xl" />
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Idioma del arte generado</p>
                  <div className="mt-2 inline-flex rounded-xl border border-border bg-card p-1">
                    {(["es", "en"] as const).map((value) => (
                      <button key={value} type="button" onClick={() => setLocale(value)} className={`min-h-11 min-w-16 rounded-[10px] px-3 text-sm font-semibold ${locale === value ? "bg-secondary text-primary" : "text-muted-foreground"}`}>{value.toUpperCase()}</button>
                    ))}
                  </div>
                </div>
                <AnnouncementAiImageField
                  title={title}
                  content={content}
                  audience={audience}
                  ministryName={selectedMinistry?.name}
                  imageUrl={imageUrl}
                  locale={locale}
                  onImageUrlChange={setImageUrl}
                />
                <Button type="submit" className="w-full" disabled={submitting || !title.trim() || !content.trim() || (audience === "ministry" && !ministryId)}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? "Publicando..." : audience === "general" && !isAdmin ? "Enviar para aprobación" : "Publicar anuncio"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p className="font-semibold">No pudimos cargar los anuncios.</p>
          <p className="mt-1">{loadError}</p>
          <Button size="sm" variant="outline" className="mt-3 border-red-200 bg-white text-red-700" onClick={() => loadPage(false)}>Reintentar</Button>
        </div>
      )}

      {loading && announcements.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Cargando anuncios">
          {[0, 1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      ) : (
        <div className="space-y-8">
          {isAdmin && pending.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-700">Pendientes de aprobación</h2>
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{pending.length}</Badge>
              </div>
              {pending.map((announcement) => (
                <AnnouncementCard
                  key={announcement.id}
                  announcement={announcement}
                  onDelete={() => setDeleteId(announcement.id)}
                  actions={(
                    <>
                      <Button size="sm" onClick={() => handleReview(announcement.id, "approve")} disabled={processingId === announcement.id}><Check className="h-4 w-4" /> Aprobar</Button>
                      <Button size="sm" variant="outline" onClick={() => handleReview(announcement.id, "reject")} disabled={processingId === announcement.id}><X className="h-4 w-4" /> Rechazar</Button>
                    </>
                  )}
                />
              ))}
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Publicados</h2>
              <Badge variant="outline">{published.length}</Badge>
            </div>
            {published.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
                <Megaphone className="mx-auto h-9 w-9 text-primary" />
                <p className="mt-3 font-semibold text-foreground">Todavía no hay anuncios</p>
                <p className="mt-1 text-sm text-muted-foreground">Los anuncios publicados aparecerán aquí.</p>
              </div>
            ) : published.map((announcement) => (
              <AnnouncementCard key={announcement.id} announcement={announcement} onDelete={isAdmin ? () => setDeleteId(announcement.id) : undefined} />
            ))}
          </section>

          {!isAdmin && rejected.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-red-700">Requieren cambios</h2>
              {rejected.map((announcement) => <AnnouncementCard key={announcement.id} announcement={announcement} onDelete={() => setDeleteId(announcement.id)} />)}
            </section>
          )}
        </div>
      )}

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar anuncio</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
