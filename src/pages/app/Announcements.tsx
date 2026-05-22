import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { AnnouncementAiImageField } from "@/components/AnnouncementAiImageField";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { Check, Loader2, Megaphone, MessageCircle, Send, Trash2, X } from "lucide-react";

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

function statusVariant(status: AnnouncementStatus) {
  if (status === "PUBLISHED") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (status === "REJECTED") return "bg-red-50 text-red-700 border-red-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
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
  return [announcement.creatorFirstName, announcement.creatorLastName].filter(Boolean).join(" ") ||
    announcement.creatorEmail ||
    "Un miembro";
}

function whatsappShareLink(title: string, content: string, imageUrl?: string | null) {
  const imageLine = imageUrl ? `\n\nImage: ${imageUrl}` : "";
  return `https://wa.me/?text=${encodeURIComponent(`📣 ${title}\n\n${content}${imageLine}`)}`;
}

export default function Announcements() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [ministryRoles, setMinistryRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
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
    () => ministries.filter((ministry) => ministryRoles[ministry.id] === "LEADER"),
    [ministries, ministryRoles]
  );
  const selectedMinistry = ministries.find((ministry) => ministry.id === ministryId);
  const pending = announcements.filter((announcement) => announcement.status === "PENDING");
  const posted = announcements.filter((announcement) => announcement.status === "PUBLISHED");
  const rejected = announcements.filter((announcement) => announcement.status === "REJECTED");

  const loadPage = useCallback(async () => {
    setLoading(true);
    try {
      const [announcementResult, mineResult] = await Promise.allSettled([
        fetchApi<Announcement[]>("/announcements?includePending=1"),
        fetchApi<MyMinistriesResponse>("/my-ministries"),
      ]);

      if (announcementResult.status === "fulfilled") {
        setAnnouncements(Array.isArray(announcementResult.value) ? announcementResult.value : []);
      } else {
        throw announcementResult.reason;
      }

      if (mineResult.status === "fulfilled") {
        setMinistries(mineResult.value.ministries || []);
        setRole(mineResult.value.role || null);
        setMinistryRoles(mineResult.value.ministryRoles || {});
      } else {
        console.warn("Ministry context unavailable for announcements:", mineResult.reason);
        setMinistries([]);
        setRole(null);
        setMinistryRoles({});
      }
    } catch (error) {
      console.error("Failed to load announcements:", error);
      toast({
        title: error instanceof Error ? error.message : "No se pudieron cargar los anuncios",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [fetchApi, toast]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (audience === "ministry" && !ministryId && leaderMinistries.length > 0) {
      setMinistryId(leaderMinistries[0].id);
    }
  }, [audience, leaderMinistries, ministryId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast({ title: "El título y el contenido son obligatorios", variant: "destructive" });
      return;
    }
    if (audience === "ministry" && !ministryId) {
      toast({ title: "Elige un ministerio primero", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const data = await fetchApi<Announcement>("/announcements", {
        method: "POST",
        body: JSON.stringify({
          title,
          content,
          imageUrl,
          ministryId: audience === "ministry" ? ministryId : null,
        }),
      });

      setTitle("");
      setContent("");
      setImageUrl(null);
      toast({
        title: data.status === "PENDING" ? "Enviado para aprobación" : "Anuncio publicado",
        description: data.status === "PENDING"
          ? "Un administrador lo aprobará antes de que aparezca en el app."
          : "Los miembros fueron notificados automáticamente.",
      });
      await loadPage();
    } catch (error) {
      console.error("Failed to submit announcement:", error);
      toast({
        title: error instanceof Error ? error.message : "No se pudo enviar el anuncio",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(id: string, action: "approve" | "reject") {
    setProcessingId(id);
    try {
      await fetchApi(`/announcements/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      toast({ title: action === "approve" ? "Anuncio aprobado" : "Anuncio rechazado" });
      await loadPage();
    } catch (error) {
      console.error("Failed to review announcement:", error);
      toast({
        title: error instanceof Error ? error.message : "No se pudo revisar el anuncio",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await fetchApi(`/announcements/${deleteId}`, { method: "DELETE" });
      toast({ title: "Anuncio eliminado" });
      setDeleteId(null);
      await loadPage();
    } catch (error) {
      console.error("Failed to delete announcement:", error);
      toast({
        title: error instanceof Error ? error.message : "No se pudo eliminar el anuncio",
        variant: "destructive",
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-6">
      <Card className="app-page-header overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="secondary" className="w-fit gap-1 rounded-md">
              <Megaphone className="h-3.5 w-3.5" />
              Anuncios
            </Badge>
            <div className="grid grid-cols-2 rounded-md border border-border bg-secondary/50 p-1">
              {(["en", "es"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocale(value)}
                  className={`rounded-sm px-3 py-1.5 text-xs font-bold transition-colors ${
                    locale === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {value === "en" ? "EN" : "ES"}
                </button>
              ))}
            </div>
          </div>
          <CardTitle className="app-page-title">
            Comparte noticias con las personas correctas.
          </CardTitle>
          <p className="app-page-copy">
            Los administradores publican de inmediato. Los anuncios generales de otros usuarios pasan por aprobación.
            Los líderes pueden publicar directamente a su ministerio.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
              <button
                type="button"
                onClick={() => setAudience("general")}
                className={`rounded-sm px-3 py-2 text-sm font-bold ${
                  audience === "general" ? "bg-white text-primary shadow-sm" : "text-muted-foreground"
                }`}
              >
                Toda la iglesia
              </button>
              <button
                type="button"
                onClick={() => setAudience("ministry")}
                disabled={leaderMinistries.length === 0}
                className={`rounded-sm px-3 py-2 text-sm font-bold disabled:opacity-40 ${
                  audience === "ministry" ? "bg-white text-primary shadow-sm" : "text-muted-foreground"
                }`}
              >
                Ministerio
              </button>
            </div>

            {audience === "general" && (
              <p className="rounded-md border border-border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground">
                {isAdmin
                  ? "Esto se publicará de inmediato y notificará a la iglesia."
                  : "Esto esperará aprobación antes de que los miembros lo vean."}
              </p>
            )}

            {audience === "ministry" && (
              <Select value={ministryId} onValueChange={setMinistryId}>
                <SelectTrigger className="app-control">
                  <SelectValue placeholder="Elige ministerio" />
                </SelectTrigger>
                <SelectContent>
                  {leaderMinistries.map((ministry) => (
                    <SelectItem key={ministry.id} value={ministry.id}>{ministry.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Input
              required
              placeholder="Título"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="app-control"
            />
            <Textarea
              required
              rows={5}
              placeholder="Escribe el anuncio..."
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="resize-none rounded-md bg-card"
            />

            <AnnouncementAiImageField
              title={title}
              content={content}
              audience={audience}
              ministryName={selectedMinistry?.name}
              imageUrl={imageUrl}
              locale={locale}
              onImageUrlChange={setImageUrl}
            />

            <Button
              type="submit"
              disabled={submitting || (audience === "ministry" && !ministryId)}
              className="w-full rounded-md"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Enviando..." : audience === "general" && !isAdmin ? "Enviar para aprobación" : "Publicar anuncio"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isAdmin && pending.length > 0 && (
        <section className="space-y-3">
          <div className="app-section-heading">
            <h2 className="app-section-title text-amber-700">Necesita revisión</h2>
            <Badge variant="secondary">{pending.length}</Badge>
          </div>
          {pending.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              onDelete={() => setDeleteId(announcement.id)}
              actions={
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleReview(announcement.id, "approve")} disabled={processingId === announcement.id}>
                    <Check className="h-4 w-4" />
                    Aprobar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleReview(announcement.id, "reject")} disabled={processingId === announcement.id}>
                    <X className="h-4 w-4" />
                    Rechazar
                  </Button>
                </div>
              }
            />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="app-section-heading">
          <h2 className="app-section-title">Publicados</h2>
          <Badge variant="outline">{posted.length}</Badge>
        </div>
        {posted.length === 0 ? (
          <Card className="app-card">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Todavía no hay anuncios publicados.
            </CardContent>
          </Card>
        ) : (
          posted.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              onDelete={isAdmin ? () => setDeleteId(announcement.id) : undefined}
            />
          ))
        )}
      </section>

      {!isAdmin && rejected.length > 0 && (
        <section className="space-y-3">
          <h2 className="app-section-title">No aprobados</h2>
          {rejected.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))}
        </section>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
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

function AnnouncementCard({
  announcement,
  actions,
  onDelete,
}: {
  announcement: Announcement;
  actions?: React.ReactNode;
  onDelete?: () => void;
}) {
  return (
    <Card className="app-list-card overflow-hidden">
      {announcement.imageUrl ? (
        <img src={announcement.imageUrl} alt="" className="h-44 w-full object-cover" />
      ) : (
        <div className="h-1.5 bg-primary" />
      )}
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={statusVariant(announcement.status)}>
                {statusLabel(announcement.status)}
              </Badge>
              {announcement.ministryName && <Badge variant="secondary">{announcement.ministryName}</Badge>}
            </div>
            <h3 className="font-semibold leading-tight text-foreground">{announcement.title}</h3>
          </div>
          {onDelete && (
            <Button variant="ghost" size="icon" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{announcement.content}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {announcement.status === "PUBLISHED" ? "Publicado" : "Creado"} {formatDate(announcement.publishedAt || announcement.createdAt)} por {creatorName(announcement)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={whatsappShareLink(announcement.title, announcement.content, announcement.imageUrl)} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            </Button>
            {actions}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
