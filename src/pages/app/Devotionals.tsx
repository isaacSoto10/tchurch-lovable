import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle, ChevronLeft, ChevronRight, Loader2, Pencil, PlayCircle, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import {
  DEVOTIONALS_PAGE_SIZE,
  DevotionalsPagination,
  devotionalPageAfterDeletion,
  devotionalsCollectionPath,
  normalizeDevotionalsPagination,
  parseDevotionalsPage,
} from "@/lib/devotionalsPagination";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import { getYoutubeEmbedUrl } from "@/lib/youtube";

type DevotionalStatus = "draft" | "published";

interface Devotional {
  id: string;
  title: string;
  scriptureRef?: string | null;
  bibleText?: string | null;
  body: string;
  ministryId?: string | null;
  ministryName?: string | null;
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
  pagination?: Partial<DevotionalsPagination>;
  permissions?: {
    canManage?: boolean;
  };
}

interface Ministry {
  id: string;
  name: string;
  color?: string | null;
}

interface MyMinistriesResponse {
  ministries?: Ministry[];
}

type DevotionalsSnapshot = {
  devotionals: Devotional[];
  ministries: Ministry[];
  canManage: boolean;
  pagination: DevotionalsPagination;
};

const DEVOTIONALS_SNAPSHOT_PREFIX = "tchurch_ios_devotionals_snapshot_v2";

function isDevotionalsSnapshot(data: unknown): data is DevotionalsSnapshot {
  if (!data || typeof data !== "object") return false;
  const snapshot = data as Partial<DevotionalsSnapshot>;
  return Array.isArray(snapshot.devotionals) &&
    Array.isArray(snapshot.ministries) &&
    typeof snapshot.canManage === "boolean" &&
    Boolean(snapshot.pagination) &&
    Number.isInteger(snapshot.pagination?.page) &&
    snapshot.pagination?.page === 1;
}

const initialPagination: DevotionalsPagination = {
  page: 1,
  pageSize: DEVOTIONALS_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
};

const emptyForm = {
  title: "",
  scriptureRef: "",
  bibleText: "",
  body: "",
  ministryId: "",
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
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseDevotionalsPage(searchParams.get("page"));
  const [devotionals, setDevotionals] = useState<Devotional[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [pagination, setPagination] = useState<DevotionalsPagination>(initialPagination);
  const requestSequenceRef = useRef(0);
  const paginationNavigationRef = useRef(false);
  const listStartRef = useRef<HTMLDivElement | null>(null);

  const published = useMemo(() => devotionals.filter((devotional) => devotional.status === "published"), [devotionals]);
  const todayDevotional = page === 1 ? published[0] || devotionals[0] || null : null;
  const pastDevotionals = devotionals.filter((devotional) => devotional.id !== todayDevotional?.id);
  const snapshotKey = sessionSnapshotKey(DEVOTIONALS_SNAPSHOT_PREFIX, getChurchId());

  const applyDevotionalsData = useCallback((snapshot: DevotionalsSnapshot) => {
    setDevotionals(snapshot.devotionals);
    setMinistries(snapshot.ministries);
    setCanManage(snapshot.canManage);
    setPagination(snapshot.pagination);
  }, []);

  const loadDevotionals = useCallback(async (requestedPage: number) => {
    const requestSequence = ++requestSequenceRef.current;
    const snapshot = requestedPage === 1
      ? readSessionSnapshot<DevotionalsSnapshot>(snapshotKey, { validate: isDevotionalsSnapshot })
      : null;
    if (snapshot) {
      applyDevotionalsData(snapshot.data);
      setLoading(false);
    } else {
      setLoading(true);
      setDevotionals([]);
    }

    try {
      setLoadError(null);
      const [devotionalsResult, ministriesResult] = await Promise.allSettled([
        fetchApi<DevotionalsResponse>(devotionalsCollectionPath(requestedPage)),
        fetchApi<MyMinistriesResponse>("/my-ministries"),
      ]);

      if (devotionalsResult.status === "rejected") throw devotionalsResult.reason;
      if (requestSequence !== requestSequenceRef.current) return;

      const nextDevotionals = Array.isArray(devotionalsResult.value.devotionals)
        ? devotionalsResult.value.devotionals.slice(0, DEVOTIONALS_PAGE_SIZE)
        : [];
      const nextPagination = normalizeDevotionalsPagination(
        devotionalsResult.value.pagination,
        requestedPage,
        nextDevotionals.length,
      );

      const nextSnapshot = {
        devotionals: nextDevotionals,
        ministries: ministriesResult.status === "fulfilled"
          ? Array.isArray(ministriesResult.value.ministries) ? ministriesResult.value.ministries : []
          : snapshot?.data.ministries || [],
        canManage: Boolean(devotionalsResult.value.permissions?.canManage),
        pagination: nextPagination,
      };
      applyDevotionalsData(nextSnapshot);
      if (nextPagination.page === 1) writeSessionSnapshot(snapshotKey, nextSnapshot);

      if (nextPagination.page !== requestedPage) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("page", String(nextPagination.page));
          return next;
        }, { replace: true });
      }
    } catch (error) {
      if (requestSequence !== requestSequenceRef.current) return;
      const message = error instanceof Error ? error.message : "No se pudieron cargar los devocionales";
      setLoadError(message);
      toast({
        title: message,
        variant: "destructive",
      });
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [applyDevotionalsData, fetchApi, setSearchParams, snapshotKey, toast]);

  useEffect(() => {
    if (searchParams.get("page") !== String(page)) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("page", String(page));
        return next;
      }, { replace: true });
      return;
    }

    void loadDevotionals(page);
    if (paginationNavigationRef.current) {
      paginationNavigationRef.current = false;
      window.requestAnimationFrame(() => listStartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [loadDevotionals, page, searchParams, setSearchParams]);

  const goToPage = useCallback((nextPage: number) => {
    const safePage = Math.max(1, nextPage);
    if (safePage === page) return;
    paginationNavigationRef.current = true;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", String(safePage));
      return next;
    });
  }, [page, setSearchParams]);

  function resetForm() {
    setForm({ ...emptyForm, publishDate: new Date().toISOString().slice(0, 10) });
    setEditingId(null);
    setShowForm(false);
  }

  function openNewForm() {
    if (showForm && !editingId) {
      resetForm();
      return;
    }
    setForm({ ...emptyForm, publishDate: new Date().toISOString().slice(0, 10) });
    setEditingId(null);
    setShowForm(true);
  }

  function editDevotional(devotional: Devotional) {
    setForm({
      title: devotional.title,
      scriptureRef: devotional.scriptureRef || "",
      bibleText: devotional.bibleText || "",
      body: devotional.body,
      ministryId: devotional.ministryId || "",
      videoUrl: devotional.videoUrl || "",
      videoTitle: devotional.videoTitle || "",
      publishDate: devotional.publishDate.slice(0, 10),
      status: devotional.status,
    });
    setEditingId(devotional.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveDevotional(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Título y reflexión son obligatorios", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      await fetchApi(editingId ? `/devotionals/${editingId}` : "/devotionals", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      resetForm();
      toast({ title: editingId ? "Devocional actualizado" : "Devocional guardado" });
      if (page === 1) await loadDevotionals(1);
      else goToPage(1);
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
      setDevotionals((current) => {
        const nextDevotionals = current.map((devotional) =>
          devotional.id === id ? { ...devotional, readAt: data.readAt || new Date().toISOString() } : devotional
        );
        if (page === 1) {
          writeSessionSnapshot(snapshotKey, {
            devotionals: nextDevotionals,
            ministries,
            canManage,
            pagination,
          });
        }
        return nextDevotionals;
      });
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
      toast({ title: "Devocional eliminado" });
      const targetPage = devotionalPageAfterDeletion(pagination);
      if (targetPage !== page) goToPage(targetPage);
      else await loadDevotionals(page);
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
            {devotional.ministryName && (
              <Badge variant="outline" className="rounded-full">
                {devotional.ministryName}
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
              <>
                <Button variant="ghost" size="sm" onClick={() => editDevotional(devotional)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteDevotional(devotional.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="mobile-page flex items-center justify-center py-20">
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
          <Button size="sm" className="shrink-0 rounded-2xl" onClick={() => showForm ? resetForm() : openNewForm()}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {canManage && showForm && (
        <Card className="app-card">
          <CardContent className="p-4">
            <form onSubmit={saveDevotional} className="space-y-3">
              <p className="text-sm font-bold text-zinc-950">
                {editingId ? "Editar devocional" : "Nuevo devocional"}
              </p>
              <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Título del devocional" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={form.scriptureRef} onChange={(event) => setForm((current) => ({ ...current, scriptureRef: event.target.value }))} placeholder="Juan 14:27" />
                <Input type="date" value={form.publishDate} onChange={(event) => setForm((current) => ({ ...current, publishDate: event.target.value }))} />
              </div>
              <label className="block space-y-1.5 text-sm font-semibold text-zinc-700">
                <span>Asignar a ministerio</span>
                <select
                  value={form.ministryId}
                  onChange={(event) => setForm((current) => ({ ...current, ministryId: event.target.value }))}
                  className="h-12 w-full rounded-2xl border border-input bg-background px-3 text-sm text-zinc-950"
                >
                  <option value="">General / sin ministerio</option>
                  {ministries.map((ministry) => (
                    <option key={ministry.id} value={ministry.id}>{ministry.name}</option>
                  ))}
                  {ministries.length === 0 && (
                    <option value="__no_ministries" disabled>No hay ministerios disponibles</option>
                  )}
                </select>
              </label>
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
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? "Actualizar devocional" : "Guardar devocional"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div ref={listStartRef} className="scroll-mt-4" />

      {loadError && devotionals.length === 0 ? (
        <Card className="app-card">
          <CardContent className="p-8 text-center">
            <p className="font-bold">No se pudieron cargar los devocionales</p>
            <p className="mt-1 text-sm text-muted-foreground">Revisa tu conexión e intenta nuevamente.</p>
            <Button className="mt-4 min-h-11" variant="outline" onClick={() => void loadDevotionals(page)}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : devotionals.length === 0 ? (
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
              <p className="text-sm font-bold text-muted-foreground">{page === 1 ? "Anteriores" : "Historial"}</p>
              {pastDevotionals.map((devotional) => renderDevotional(devotional))}
            </div>
          )}
        </div>
      )}

      {!loadError && pagination.totalPages > 1 && (
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-2" aria-label="Paginación de devocionales / Devotionals pagination">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 justify-self-start rounded-xl px-3"
            disabled={!pagination.hasPrevious || loading}
            onClick={() => goToPage(page - 1)}
            aria-label="Página anterior / Previous page"
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Anterior
          </Button>
          <p className="text-center text-sm font-semibold text-muted-foreground" aria-live="polite">
            Página {pagination.page} de {pagination.totalPages}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 justify-self-end rounded-xl px-3"
            disabled={!pagination.hasNext || loading}
            onClick={() => goToPage(page + 1)}
            aria-label="Página siguiente / Next page"
          >
            Siguiente
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
