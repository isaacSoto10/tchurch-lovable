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
import { CalendarDays, Check, Clock3, ImageIcon, Loader2, Megaphone, MessageCircle, Send, Sparkles, Trash2, Users, X, type LucideIcon } from "lucide-react";

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

function announcementDateLabel(announcement: Announcement) {
  const date = formatDate(announcement.publishedAt || announcement.createdAt);
  const prefix = announcement.status === "PUBLISHED" ? "Publicado" : "Creado";
  return date ? `${prefix} ${date}` : prefix;
}

function scopeLabel(announcement: Announcement) {
  return announcement.ministryName || "Toda la iglesia";
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
      <div className="mobile-page flex min-h-[55svh] items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-5 pb-2">
      <section className="overflow-hidden rounded-[1.75rem] border border-[#ecdccd] bg-[linear-gradient(135deg,#fff8ef_0%,#ffffff_46%,#edf8f1_100%)] shadow-[0_18px_50px_rgba(83,64,44,0.08)]">
        <div className="h-1 bg-[linear-gradient(90deg,#7b3f58,#d99536,#2f6f5e)]" />
        <div className="grid gap-5 p-4 sm:p-5 md:p-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:items-end">
          <div className="min-w-0 space-y-4">
            <Badge variant="secondary" className="w-fit gap-1 border-[#ead7c4] bg-white/80 text-[#6c3f2e]">
              <Megaphone className="h-3.5 w-3.5" />
              Anuncios
            </Badge>
            <div className="space-y-2">
              <h1 className="text-2xl font-extrabold leading-tight text-[#211915] sm:text-3xl">
                Un tablón cálido para la vida de la iglesia.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[#675b52]">
                Noticias de domingo, avisos de ministerio y llamados a servir con una lectura clara para miembros y líderes.
              </p>
            </div>
            {posted[0] && (
              <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-3 py-2 shadow-sm">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#274d43] text-white">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[0.68rem] font-bold uppercase text-[#8a6a4f]">Último comunicado</p>
                  <p className="truncate text-sm font-bold text-[#211915]">{posted[0].title}</p>
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <CanvasStat label="Publicados" value={posted.length} icon={Megaphone} accent="bg-[#274d43] text-white" />
            <CanvasStat label="Revisión" value={pending.length} icon={Clock3} accent="bg-[#a65f1a] text-white" />
            <CanvasStat label="Ministerios" value={ministries.length} icon={Users} accent="bg-[#6d3f58] text-white" />
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(18rem,0.92fr)_minmax(0,1.35fr)] xl:items-start">
        <Card className="app-card-soft overflow-hidden border-[#eadacc] bg-white/95 shadow-[0_18px_45px_rgba(88,64,44,0.08)] xl:sticky xl:top-4">
          <CardHeader className="space-y-3 border-b border-[#f0e4d9] bg-[linear-gradient(135deg,#fffaf6,#ffffff)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant="outline" className="w-fit gap-1 border-[#dfc6ad] bg-white text-[#6c3f2e]">
                <Sparkles className="h-3.5 w-3.5" />
                Crear comunicado
              </Badge>
              <div className="grid grid-cols-2 rounded-full border border-[#eadacc] bg-white p-1 shadow-sm">
                {(["en", "es"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLocale(value)}
                    className={`min-h-11 rounded-full px-3 text-xs font-bold transition-colors ${
                      locale === value ? "bg-[#2f6f5e] text-white shadow-sm" : "text-[#6f655d]"
                    }`}
                  >
                    {value === "en" ? "EN" : "ES"}
                  </button>
                ))}
              </div>
            </div>
            <CardTitle className="text-xl leading-tight text-[#211915]">
              Comparte noticias con las personas correctas.
            </CardTitle>
            <p className="text-sm leading-6 text-[#675b52]">
              Los administradores publican de inmediato. Los anuncios generales de otros usuarios pasan por aprobación.
              Los líderes pueden publicar directamente a su ministerio.
            </p>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-[1.1rem] bg-[#f2ebe4] p-1">
                <button
                  type="button"
                  onClick={() => setAudience("general")}
                  className={`min-h-11 rounded-xl px-3 text-sm font-bold transition ${
                    audience === "general" ? "bg-white text-[#274d43] shadow-sm" : "text-[#756a60]"
                  }`}
                >
                  Toda la iglesia
                </button>
                <button
                  type="button"
                  onClick={() => setAudience("ministry")}
                  disabled={leaderMinistries.length === 0}
                  className={`min-h-11 rounded-xl px-3 text-sm font-bold transition disabled:opacity-40 ${
                    audience === "ministry" ? "bg-white text-[#274d43] shadow-sm" : "text-[#756a60]"
                  }`}
                >
                  Ministerio
                </button>
              </div>

              {audience === "general" && (
                <p className="rounded-[1.1rem] border border-[#efe1d3] bg-[#fffaf6] px-4 py-3 text-xs leading-5 text-[#675b52]">
                  {isAdmin
                    ? "Esto se publicará de inmediato y notificará a la iglesia."
                    : "Esto esperará aprobación antes de que los miembros lo vean."}
                </p>
              )}

              {audience === "ministry" && (
                <Select value={ministryId} onValueChange={setMinistryId}>
                  <SelectTrigger className="h-12 rounded-[1.1rem] border-[#eadacc] bg-white">
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
                className="h-12 rounded-[1.1rem] border-[#eadacc] bg-white"
              />
              <Textarea
                required
                rows={5}
                placeholder="Escribe el anuncio..."
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-36 resize-none rounded-[1.1rem] border-[#eadacc] bg-white"
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
                className="h-12 w-full rounded-[1.1rem] bg-[#274d43] text-white hover:bg-[#1f3f36]"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? "Enviando..." : audience === "general" && !isAdmin ? "Enviar para aprobación" : "Publicar anuncio"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-5">
          {isAdmin && pending.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                eyebrow="Necesita revisión"
                title="Aprobación pendiente"
                count={pending.length}
                tone="border-amber-200 bg-amber-50 text-amber-800"
              />
              {pending.map((announcement) => (
                <AnnouncementCard
                  key={announcement.id}
                  announcement={announcement}
                  onDelete={() => setDeleteId(announcement.id)}
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => handleReview(announcement.id, "approve")} disabled={processingId === announcement.id} className="rounded-full bg-[#274d43] hover:bg-[#1f3f36]">
                        <Check className="h-4 w-4" />
                        Aprobar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleReview(announcement.id, "reject")} disabled={processingId === announcement.id} className="rounded-full">
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
            <SectionHeader
              eyebrow="Tablón público"
              title="Publicados"
              count={posted.length}
              tone="border-emerald-200 bg-emerald-50 text-emerald-800"
            />
            {posted.length === 0 ? (
              <Card className="app-card border-[#eadacc] bg-white/90">
                <CardContent className="p-8 text-center text-sm text-[#675b52]">
                  Todavía no hay anuncios publicados.
                </CardContent>
              </Card>
            ) : (
              posted.map((announcement, index) => (
                <AnnouncementCard
                  key={announcement.id}
                  announcement={announcement}
                  featured={index === 0}
                  onDelete={isAdmin ? () => setDeleteId(announcement.id) : undefined}
                />
              ))
            )}
          </section>

          {!isAdmin && rejected.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                eyebrow="No aprobados"
                title="Requieren cambios"
                count={rejected.length}
                tone="border-red-200 bg-red-50 text-red-700"
              />
              {rejected.map((announcement) => (
                <AnnouncementCard key={announcement.id} announcement={announcement} />
              ))}
            </section>
          )}
        </div>
      </div>

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

function CanvasStat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm">
      <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-xl font-extrabold leading-none text-[#211915]">{value}</p>
      <p className="mt-1 truncate text-[0.66rem] font-bold uppercase text-[#7a6c60]">{label}</p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  count,
  tone,
}: {
  eyebrow: string;
  title: string;
  count: number;
  tone: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[0.68rem] font-bold uppercase text-[#8a6a4f]">{eyebrow}</p>
        <h2 className="text-lg font-extrabold leading-tight text-[#211915]">{title}</h2>
      </div>
      <Badge variant="outline" className={`shrink-0 ${tone}`}>{count}</Badge>
    </div>
  );
}

function AnnouncementCard({
  announcement,
  actions,
  onDelete,
  featured = false,
}: {
  announcement: Announcement;
  actions?: React.ReactNode;
  onDelete?: () => void;
  featured?: boolean;
}) {
  return (
    <Card className={`overflow-hidden border-[#eadacc] bg-white/95 shadow-[0_14px_38px_rgba(88,64,44,0.08)] ${featured ? "rounded-[1.6rem]" : "rounded-[1.35rem]"}`}>
      <div className={featured ? "grid gap-0 md:grid-cols-[0.86fr_1fr]" : ""}>
        <div className={`relative overflow-hidden bg-[#f4eee8] ${featured ? "min-h-[16rem] md:min-h-full" : "h-44"}`}>
          {announcement.imageUrl ? (
            <img
              src={announcement.imageUrl}
              alt={`Arte del anuncio ${announcement.title}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,#f7eadb,#edf6ef)] px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#274d43] shadow-sm">
                <ImageIcon className="h-6 w-6" />
              </span>
              <p className="text-xs font-bold uppercase text-[#8a6a4f]">Comunicacion de la iglesia</p>
            </div>
          )}
          {announcement.imageUrl && <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/0 to-black/0" />}
          <Badge className="absolute left-3 top-3 border border-white/40 bg-white/90 text-[#274d43] shadow-sm hover:bg-white">
            {scopeLabel(announcement)}
          </Badge>
        </div>
        <CardContent className={`space-y-3 ${featured ? "p-4 sm:p-5" : "p-4"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={statusVariant(announcement.status)}>
                  {statusLabel(announcement.status)}
                </Badge>
                {announcement.ministryName && <Badge variant="secondary">{announcement.ministryName}</Badge>}
              </div>
              <h3 className={`font-extrabold leading-tight text-[#211915] ${featured ? "text-xl sm:text-2xl" : "text-lg"}`}>
                {announcement.title}
              </h3>
            </div>
            {onDelete && (
              <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Eliminar ${announcement.title}`} className="h-10 w-10 shrink-0 rounded-full text-destructive hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-[#5f5750]">{announcement.content}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eee0d4] pt-3">
            <p className="flex min-w-0 items-center gap-2 text-xs leading-5 text-[#746a61]">
              <CalendarDays className="h-4 w-4 shrink-0 text-[#8a6a4f]" />
              <span>{announcementDateLabel(announcement)} por {creatorName(announcement)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild className="rounded-full border-[#ded0c2] bg-white">
                <a href={whatsappShareLink(announcement.title, announcement.content, announcement.imageUrl)} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
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
