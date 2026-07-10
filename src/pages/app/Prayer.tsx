import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Heart, Lock, Loader2, Plus, RotateCw, UserRound, VenetianMask } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SectionNav } from "@/components/SectionNav";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import {
  getPrayerAuthorLabel,
  normalizePrayerRequest,
  normalizePrayerRequests,
  type PrayerPrivacy,
  type PrayerRequest,
} from "@/lib/prayer";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import { useChurch } from "@/providers/ChurchProvider";

type PrayerFilter = "all" | "mine" | "answered";
type PrayerSnapshot = { requests: PrayerRequest[] };

const PRAYER_SNAPSHOT_PREFIX = "tchurch_ios_prayer_snapshot_v2";

const PRIVACY_OPTIONS: Array<{
  value: PrayerPrivacy;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  { value: "name", label: "Con mi nombre", description: "Visible para la iglesia", icon: UserRound },
  { value: "anonymous", label: "Anónima", description: "Oculta tu nombre", icon: VenetianMask },
  { value: "private", label: "Solo yo", description: "Petición privada", icon: Lock },
];

function isPrayerSnapshot(value: unknown): value is PrayerSnapshot {
  return Boolean(value && typeof value === "object" && Array.isArray((value as PrayerSnapshot).requests));
}

function formatPrayerDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return date.toLocaleDateString("es-US", { month: "short", day: "numeric" });
}

function requestPath(filter: PrayerFilter) {
  if (filter === "answered") return "/prayer-requests?status=answered&mine=false";
  if (filter === "mine") return "/prayer-requests?status=active&mine=true";
  return "/prayer-requests?status=active&mine=false";
}

interface PrayerComposerProps {
  content: string;
  privacy: PrayerPrivacy;
  submitting: boolean;
  onContentChange: (content: string) => void;
  onPrivacyChange: (privacy: PrayerPrivacy) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel?: () => void;
}

function PrayerComposer({
  content,
  privacy,
  submitting,
  onContentChange,
  onPrivacyChange,
  onSubmit,
  onCancel,
}: PrayerComposerProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="prayer-content" className="text-sm font-semibold text-foreground">Tu petición</label>
        <Textarea
          id="prayer-content"
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          placeholder="¿Cómo podemos orar contigo?"
          rows={5}
          maxLength={1200}
          className="mt-2 min-h-32 resize-none rounded-xl bg-card text-base"
          autoFocus={Boolean(onCancel)}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">{content.length}/1200</p>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Privacidad</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {PRIVACY_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = privacy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onPrivacyChange(option.value)}
                className={[
                  "flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary bg-secondary text-primary" : "border-border bg-card text-foreground",
                ].join(" ")}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" disabled={submitting || !content.trim()}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
          {submitting ? "Compartiendo..." : "Compartir petición"}
        </Button>
      </div>
    </form>
  );
}

export default function Prayer() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PrayerRequest[]>([]);
  const [filter, setFilter] = useState<PrayerFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [content, setContent] = useState("");
  const [privacy, setPrivacy] = useState<PrayerPrivacy>("name");
  const [submitting, setSubmitting] = useState(false);
  const [prayingIds, setPrayingIds] = useState<Set<string>>(() => new Set());
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const isAdmin = selectedChurch?.role === "ADMIN";
  const snapshotKey = sessionSnapshotKey(
    PRAYER_SNAPSHOT_PREFIX,
    `${selectedChurch?.id || getChurchId() || "default"}:${filter}`,
  );

  const visibleRequests = useMemo(
    () => filter === "mine" ? requests.filter((request) => request.isMine) : requests,
    [filter, requests],
  );

  const loadRequests = useCallback(async (preferSnapshot = true) => {
    const snapshot = preferSnapshot
      ? readSessionSnapshot<PrayerSnapshot>(snapshotKey, { validate: isPrayerSnapshot })
      : null;
    if (snapshot) {
      setRequests(snapshot.data.requests);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await fetchApi<unknown>(requestPath(filter));
      const normalized = normalizePrayerRequests(data);
      setRequests(normalized);
      writeSessionSnapshot(snapshotKey, { requests: normalized });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "No pudimos cargar las peticiones.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchApi, filter, snapshotKey]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const nextContent = content.trim();
    if (!nextContent || submitting) return;

    setSubmitting(true);
    try {
      const created = normalizePrayerRequest(await fetchApi<unknown>("/prayer-requests", {
        method: "POST",
        body: JSON.stringify({ content: nextContent, privacy }),
      }));
      setContent("");
      setPrivacy("name");
      setComposerOpen(false);
      if (created && filter !== "answered") setRequests((current) => [created, ...current]);
      else await loadRequests(false);
      toast({ title: "Petición compartida", description: privacy === "private" ? "Solo tú podrás verla." : "La iglesia ya puede acompañarte en oración." });
    } catch (createError) {
      toast({
        title: "No se pudo compartir",
        description: createError instanceof Error ? createError.message : "Intenta nuevamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePray(request: PrayerRequest) {
    if (request.hasPrayed || prayingIds.has(request.id)) return;
    setPrayingIds((current) => new Set(current).add(request.id));
    setRequests((current) => current.map((item) => item.id === request.id
      ? { ...item, prayedCount: item.prayedCount + 1, hasPrayed: true }
      : item));

    try {
      const result = await fetchApi<{ prayedCount?: number }>(`/prayer-requests/${request.id}/pray`, { method: "POST" });
      if (typeof result?.prayedCount === "number") {
        setRequests((current) => current.map((item) => item.id === request.id ? { ...item, prayedCount: result.prayedCount! } : item));
      }
    } catch (prayError) {
      setRequests((current) => current.map((item) => item.id === request.id
        ? { ...item, prayedCount: request.prayedCount, hasPrayed: request.hasPrayed }
        : item));
      toast({ title: "No se pudo registrar tu oración", variant: "destructive" });
    } finally {
      setPrayingIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }
  }

  async function handleAnswer(request: PrayerRequest) {
    setAnsweringId(request.id);
    try {
      await fetchApi(`/prayer-requests/${request.id}/answer`, { method: "PUT" });
      setRequests((current) => current.filter((item) => item.id !== request.id));
      toast({ title: "Petición marcada como respondida" });
    } catch (answerError) {
      toast({ title: "No se pudo actualizar la petición", variant: "destructive" });
    } finally {
      setAnsweringId(null);
    }
  }

  const composer = (
    <PrayerComposer
      content={content}
      privacy={privacy}
      submitting={submitting}
      onContentChange={setContent}
      onPrivacyChange={setPrivacy}
      onSubmit={handleCreate}
      onCancel={() => setComposerOpen(false)}
    />
  );

  return (
    <div className="mobile-page mx-auto max-w-6xl space-y-5">
      <SectionNav section="community" label="Comunidad" />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mobile-section-title">Comunidad</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Muro de oración</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Comparte una necesidad y acompaña a otras personas de tu iglesia.</p>
        </div>
        <Button onClick={() => setComposerOpen(true)} className="lg:hidden">
          <Plus className="h-4 w-4" /> Nueva petición
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <main className="min-w-0 space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Filtrar peticiones">
            {([
              ["all", "Todas"],
              ["mine", "Mías"],
              ["answered", "Respondidas"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={[
                  "min-h-11 rounded-[10px] px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              <p className="font-semibold">No pudimos cargar el muro.</p>
              <p className="mt-1">{error}</p>
              <Button variant="outline" size="sm" className="mt-3 border-red-200 bg-white text-red-700" onClick={() => loadRequests(false)}>
                <RotateCw className="h-4 w-4" /> Reintentar
              </Button>
            </div>
          )}

          {loading && requests.length === 0 ? (
            <div className="space-y-3" aria-label="Cargando peticiones" role="status">
              {[0, 1, 2].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl border border-border bg-card" />)}
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
              <Heart className="mx-auto h-9 w-9 text-primary" />
              <p className="mt-3 font-semibold text-foreground">
                {filter === "mine" ? "Aún no has compartido peticiones" : filter === "answered" ? "Aún no hay peticiones respondidas" : "Aún no hay peticiones"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Cuando alguien comparta una petición aparecerá aquí.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleRequests.map((request) => (
                <Card key={request.id} className="app-card">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                        {request.isPrivate ? <Lock className="h-5 w-5" /> : request.isAnonymous ? <VenetianMask className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{getPrayerAuthorLabel(request)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatPrayerDate(request.createdAt)}</span>
                          {request.isMine && <span className="rounded-full bg-secondary px-2 py-1 font-semibold text-primary">Tu petición</span>}
                        </div>
                        <p className="mt-3 whitespace-pre-wrap break-words text-[0.95rem] leading-7 text-foreground">{request.content}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                          <Button
                            size="sm"
                            variant={request.hasPrayed ? "secondary" : "outline"}
                            disabled={request.hasPrayed || prayingIds.has(request.id)}
                            onClick={() => handlePray(request)}
                          >
                            {prayingIds.has(request.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                            {request.hasPrayed ? "Oraste" : "Estoy orando"}
                            {request.prayedCount > 0 && <span>{request.prayedCount}</span>}
                          </Button>
                          {isAdmin && !request.answeredAt && (
                            <Button size="sm" variant="ghost" disabled={answeringId === request.id} onClick={() => handleAnswer(request)}>
                              {answeringId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              Respondida
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </main>

        <aside className="app-card hidden p-4 lg:sticky lg:top-4 lg:block">
          <p className="text-lg font-semibold text-foreground">Nueva petición</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">Tú decides quién puede verla.</p>
          <div className="mt-4">
            <PrayerComposer
              content={content}
              privacy={privacy}
              submitting={submitting}
              onContentChange={setContent}
              onPrivacyChange={setPrivacy}
              onSubmit={handleCreate}
            />
          </div>
        </aside>
      </div>

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="top-auto bottom-0 max-w-none translate-y-0 rounded-t-2xl p-5 sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-xl">
          <DialogHeader className="text-left">
            <DialogTitle>Nueva petición</DialogTitle>
            <DialogDescription>Comparte solo lo que te haga sentir cómodo.</DialogDescription>
          </DialogHeader>
          {composer}
        </DialogContent>
      </Dialog>
    </div>
  );
}
