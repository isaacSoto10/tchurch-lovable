import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronRight, Clock3, FileDiff, Inbox, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/hooks/useAppAuth";
import { apiFetch } from "@/lib/api";
import {
  buildSongLyricsProposalDecision,
  getSongLyricsProposal,
  listSongLyricsProposals,
  songLyricsProposalFailure,
  type SongLyricsProposalDetailEnvelopeV1,
  type SongLyricsProposalStatus,
  type SongLyricsProposalSummaryV1,
} from "@/lib/songLyricsProposals";
import {
  decideSongLyricsProposalDurably,
  songLyricsProposalOutboxScope,
} from "@/lib/songLyricsProposalOutbox";
import { useChurch } from "@/providers/ChurchProvider";

type StatusFilter = SongLyricsProposalStatus | "ALL";

function statusLabel(status: SongLyricsProposalStatus) {
  if (status === "PENDING") return "Pendiente";
  if (status === "ACCEPTED") return "Aceptada";
  if (status === "REJECTED") return "Rechazada";
  return "Reemplazada";
}

function statusClass(status: SongLyricsProposalStatus) {
  if (status === "ACCEPTED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "REJECTED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "SUPERSEDED") return "border-zinc-200 bg-zinc-100 text-zinc-600";
  return "border-primary/20 bg-primary/10 text-primary";
}

function proposalTitle(proposal: SongLyricsProposalSummaryV1) {
  return proposal.target.arrangement
    ? `${proposal.target.song.title} · ${proposal.target.arrangement.name}`
    : proposal.target.song.title;
}

function sourceLabel(source: SongLyricsProposalSummaryV1["source"]["type"]) {
  if (source === "MAC_STUDIO") return "Studio Mac";
  if (source === "IOS") return "iPhone/iPad";
  if (source === "ANDROID") return "Android";
  if (source === "IMPORT") return "Importación";
  return "Web";
}

export default function SongLyricsProposals() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { getToken, userId } = useAppAuth();
  const { toast } = useToast();
  const [filter, setFilter] = useState<StatusFilter>("PENDING");
  const [proposals, setProposals] = useState<SongLyricsProposalSummaryV1[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SongLyricsProposalDetailEnvelopeV1 | null>(null);
  const [currentLyrics, setCurrentLyrics] = useState("");
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [deciding, setDeciding] = useState<"ACCEPTED" | "REJECTED" | null>(null);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [queuedDecision, setQueuedDecision] = useState<{ proposalId: string; status: "ACCEPTED" | "REJECTED" } | null>(null);

  const load = useCallback(async (cursor?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const response = await listSongLyricsProposals({
        status: filter === "ALL" ? undefined : filter,
        cursor: cursor || null,
        limit: 30,
      }, token);
      setCanManage(response.permissions.canManageLyrics);
      setProposals((current) => cursor ? [...current, ...response.proposals] : response.proposals);
      setNextCursor(response.pagination.nextCursor);
      if (!cursor && response.proposals.length > 0) setSelectedId((current) => current || response.proposals[0].id);
    } catch (loadError) {
      setError(songLyricsProposalFailure(loadError).message);
    } finally {
      setLoading(false);
    }
  }, [filter, getToken]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    void load(null);
  }, [filter, load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDecisionReason("");
    void (async () => {
      try {
        const token = await getToken();
        const response = await getSongLyricsProposal(selectedId, token);
        if (cancelled) return;
        setDetail(response);
        setCanManage(response.permissions.canManageLyrics);
        const song = await apiFetch<{ lyrics?: string | null }>(`/songs/${encodeURIComponent(response.proposal.target.song.id)}`, { cache: "no-store" }, token);
        if (cancelled) return;
        if (response.proposal.target.type === "ARRANGEMENT" && response.proposal.target.arrangement) {
          const arrangements = await apiFetch<Array<{ id: string; lyrics?: string | null }>>(
            `/songs/${encodeURIComponent(response.proposal.target.song.id)}/arrangements`, { cache: "no-store" }, token,
          );
          setCurrentLyrics(arrangements.find((item) => item.id === response.proposal.target.arrangement?.id)?.lyrics || "");
        } else {
          setCurrentLyrics(song.lyrics || "");
        }
      } catch (detailError) {
        if (!cancelled) {
          setDetail(null);
          toast({ title: "No se pudo abrir la propuesta", description: songLyricsProposalFailure(detailError).message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, selectedId, toast]);

  async function decide(status: "ACCEPTED" | "REJECTED") {
    if (!detail || !selectedChurch?.id || !userId || !detail.permissions.canManageLyrics) return;
    if (status === "REJECTED" && !decisionReason.trim()) {
      toast({ title: "Escribe el motivo del rechazo", description: "Así la persona sabrá qué necesita corregir.", variant: "destructive" });
      return;
    }
    setDeciding(status);
    try {
      const [body, scope, token] = await Promise.all([
        buildSongLyricsProposalDecision({ status, decisionReason }),
        songLyricsProposalOutboxScope(selectedChurch.id, userId),
        getToken(),
      ]);
      const result = await decideSongLyricsProposalDurably(scope, detail.proposal.id, body, token);
      if (result.queued) {
        setQueuedDecision({ proposalId: detail.proposal.id, status });
        toast({ title: "Decisión pendiente de sincronización", description: "La propuesta todavía no se ha aplicado. Se enviará cuando vuelva la conexión." });
        return;
      } else {
        toast({ title: status === "ACCEPTED" ? "Propuesta aceptada" : "Propuesta rechazada" });
      }
      setQueuedDecision(null);
      setDetail(result.envelope);
      setSelectedId(null);
      await load(null);
    } catch (decisionError) {
      const failure = songLyricsProposalFailure(decisionError);
      toast({
        title: failure.code === "LYRICS_BASE_STALE" ? "La letra cambió antes de aceptar" : "No se pudo guardar la decisión",
        description: failure.code === "LYRICS_BASE_STALE" ? "Se conservó la propuesta, pero Tchurch no reemplazó la versión nueva." : failure.message,
        variant: "destructive",
      });
      await load(null);
    } finally {
      setDeciding(null);
    }
  }

  const pendingCount = useMemo(() => proposals.filter((proposal) => proposal.status === "PENDING").length, [proposals]);

  return (
    <div className="mobile-page space-y-4">
      <div className="app-card-soft overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/app/songs")} className="h-11 w-11 shrink-0 rounded-2xl bg-white shadow-sm" aria-label="Volver a canciones">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="mobile-section-title">Biblioteca</p>
            <h1 className="truncate text-2xl font-black tracking-tight text-zinc-950">Propuestas de letras</h1>
            <p className="mt-1 text-sm text-zinc-500">{canManage ? "Revisa cambios antes de publicarlos." : "Sigue el estado de tus cambios."}</p>
          </div>
          {pendingCount > 0 && <Badge className="bg-primary text-primary-foreground">{pendingCount}</Badge>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
          <SelectTrigger className="h-11 max-w-56 rounded-xl bg-white" aria-label="Filtrar propuestas"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Pendientes</SelectItem>
            <SelectItem value="ACCEPTED">Aceptadas</SelectItem>
            <SelectItem value="REJECTED">Rechazadas</SelectItem>
            <SelectItem value="SUPERSEDED">Reemplazadas</SelectItem>
            <SelectItem value="ALL">Todas</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => void load(null)} disabled={loading} className="h-11 w-11 rounded-xl" aria-label="Actualizar propuestas">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error ? (
        <Card className="app-card border-rose-200"><CardContent className="p-6 text-center">
          <p className="text-sm font-semibold text-rose-900">No pudimos cargar las propuestas.</p>
          <p className="mt-1 text-sm text-rose-700">{error}</p>
          <Button variant="outline" onClick={() => void load(null)} className="mt-4 h-11">Reintentar</Button>
        </CardContent></Card>
      ) : loading && proposals.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.4fr)]" role="status" aria-label="Cargando propuestas">
          <div className="h-72 animate-pulse rounded-3xl bg-zinc-100" />
          <div className="h-[32rem] animate-pulse rounded-3xl bg-zinc-100" />
        </div>
      ) : proposals.length === 0 ? (
        <Card className="app-card"><CardContent className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Inbox className="h-6 w-6" /></div>
          <p className="mt-4 font-bold text-zinc-950">No hay propuestas {filter === "PENDING" ? "pendientes" : "en esta vista"}</p>
          <p className="mt-1 text-sm text-zinc-500">Los cambios de letras aparecerán aquí sin modificar una canción hasta ser aprobados.</p>
        </CardContent></Card>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.4fr)]">
          <div className="space-y-2">
            {proposals.map((proposal) => (
              <button
                key={proposal.id}
                type="button"
                onClick={() => setSelectedId(proposal.id)}
                className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition active:scale-[0.99] ${selectedId === proposal.id ? "border-primary ring-2 ring-primary/15" : "border-zinc-200"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileDiff className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-zinc-950">{proposalTitle(proposal)}</p>
                    <p className="mt-1 truncate text-xs text-zinc-500">{proposal.submittedBy.displayName} · {sourceLabel(proposal.source.type)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline" className={statusClass(proposal.status)}>{statusLabel(proposal.status)}</Badge>
                      <span className="text-xs text-zinc-400">{new Date(proposal.submittedAt).toLocaleDateString("es-US")}</span>
                    </div>
                  </div>
                  <ChevronRight className="mt-2 h-4 w-4 text-zinc-300" />
                </div>
              </button>
            ))}
            {nextCursor && <Button variant="outline" onClick={() => void load(nextCursor)} disabled={loading} className="h-11 w-full rounded-xl">Cargar más</Button>}
          </div>

          <Card className="app-card min-w-0 overflow-hidden md:sticky md:top-4">
            {loadingDetail ? (
              <CardContent className="flex min-h-80 items-center justify-center" role="status"><Loader2 className="h-7 w-7 animate-spin text-primary" /></CardContent>
            ) : detail ? (
              <CardContent className="space-y-5 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><span className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Revisión segura</span></div>
                    <h2 className="mt-2 text-xl font-black tracking-tight text-zinc-950">{proposalTitle(detail.proposal)}</h2>
                    <p className="mt-1 text-sm text-zinc-500">Enviada por {detail.proposal.submittedBy.displayName}</p>
                  </div>
                  <Badge variant="outline" className={statusClass(detail.proposal.status)}>{statusLabel(detail.proposal.status)}</Badge>
                </div>

                <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                  <div className="min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500"><Clock3 className="h-3.5 w-3.5" />Versión actual</div>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-700">{currentLyrics || "Sin letras"}</pre>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-primary"><FileDiff className="h-3.5 w-3.5" />Cambio propuesto</div>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-900">{detail.proposal.lyrics || "Sin letras"}</pre>
                  </div>
                </div>

                {detail.proposal.decisionReason && (
                  <div className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700"><span className="font-semibold">Nota de revisión:</span> {detail.proposal.decisionReason}</div>
                )}

                {detail.permissions.canManageLyrics && detail.proposal.status === "PENDING" && (
                  <div className="space-y-3 border-t border-zinc-100 pt-4">
                    {queuedDecision?.proposalId === detail.proposal.id && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">
                        {queuedDecision.status === "ACCEPTED" ? "La aceptación" : "El rechazo"} está guardado en este dispositivo, pero aún no se aplicó.
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="decision-reason">Nota de revisión (opcional)</Label>
                      <Textarea id="decision-reason" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value.slice(0, 500))} className="min-h-24 rounded-xl" placeholder="Qué se revisó o qué falta corregir…" />
                      <p className="text-right text-xs text-zinc-400">{decisionReason.length}/500</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button variant="outline" onClick={() => void decide("REJECTED")} disabled={Boolean(deciding) || Boolean(queuedDecision) || !decisionReason.trim()} className="h-12 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50">
                        {deciding === "REJECTED" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}Rechazar
                      </Button>
                      <Button onClick={() => setConfirmAccept(true)} disabled={Boolean(deciding) || Boolean(queuedDecision)} className="h-12 rounded-xl active:scale-[0.98]">
                        {deciding === "ACCEPTED" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Aceptar y publicar
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            ) : (
              <CardContent className="flex min-h-80 flex-col items-center justify-center p-8 text-center text-sm text-zinc-500">
                <FileDiff className="mb-3 h-7 w-7 text-zinc-300" />Selecciona una propuesta para comparar las versiones.
              </CardContent>
            )}
          </Card>
        </div>
      )}

      <AlertDialog open={confirmAccept} onOpenChange={setConfirmAccept}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aceptar y publicar estas letras?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción reemplaza la letra actual y puede verse de inmediato en hojas, servicios y pantallas en vivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void decide("ACCEPTED")}>Aceptar y publicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
