import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, FileClock, Loader2, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useChurch } from "@/providers/ChurchProvider";
import {
  buildSongLyricsProposalSubmission,
  canonicalizeChordPro,
  listSongLyricsProposals,
  SONG_LYRICS_PROPOSAL_MAX_BYTES,
  songLyricsProposalFailure,
  type SongLyricsProposalSummaryV1,
  type SongLyricsProposalTargetInput,
} from "@/lib/songLyricsProposals";
import {
  listSongLyricsProposalOutbox,
  removeSongLyricsProposalOutboxRecord,
  songLyricsProposalOutboxScope,
  submitSongLyricsProposalDurably,
  type SongLyricsProposalOutboxRecord,
} from "@/lib/songLyricsProposalOutbox";

export type SongLyricsEditorTarget = SongLyricsProposalTargetInput & {
  label: string;
  lyrics: string;
};

type Draft = { baseLyrics: string; value: string; rebasedAt: string | null };

type Props = {
  targets: SongLyricsEditorTarget[];
  onCanManageChange: (canManage: boolean | null) => void;
  onDirectSave: (target: SongLyricsEditorTarget, lyrics: string) => Promise<void>;
  onRefreshTarget: (target: SongLyricsEditorTarget) => Promise<string>;
};

function targetKey(target: SongLyricsEditorTarget) {
  return `${target.type}:${target.arrangementId || target.songId}`;
}

function statusLabel(status: SongLyricsProposalSummaryV1["status"]) {
  if (status === "PENDING") return "Pendiente";
  if (status === "ACCEPTED") return "Aceptada";
  if (status === "REJECTED") return "Rechazada";
  return "Reemplazada";
}

function statusClass(status: SongLyricsProposalSummaryV1["status"]) {
  if (status === "ACCEPTED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "REJECTED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "SUPERSEDED") return "border-zinc-200 bg-zinc-100 text-zinc-600";
  return "border-primary/20 bg-primary/10 text-primary";
}

export function SongLyricsProposalEditor({ targets, onCanManageChange, onDirectSave, onRefreshTarget }: Props) {
  const { selectedChurch } = useChurch();
  const { getToken, userId } = useAppAuth();
  const { toast } = useToast();
  const [selectedKey, setSelectedKey] = useState(() => targetKey(targets[0]));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => ({
    [targetKey(targets[0])]: { baseLyrics: targets[0].lyrics, value: targets[0].lyrics, rebasedAt: null },
  }));
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<SongLyricsProposalSummaryV1[]>([]);
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(0);
  const [localRecords, setLocalRecords] = useState<SongLyricsProposalOutboxRecord[]>([]);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<Record<string, { baseLyrics: string; lyrics: string; requestChecksum: string }>>({});

  const selectedTarget = targets.find((target) => targetKey(target) === selectedKey) || targets[0];
  const selectedDraft = drafts[selectedKey] || { baseLyrics: selectedTarget.lyrics, value: selectedTarget.lyrics, rebasedAt: null };
  const byteCount = useMemo(() => new TextEncoder().encode(selectedDraft.value).byteLength, [selectedDraft.value]);
  const changed = useMemo(() => {
    try {
      return canonicalizeChordPro(selectedDraft.value) !== canonicalizeChordPro(selectedDraft.baseLyrics);
    } catch {
      return selectedDraft.value !== selectedDraft.baseLyrics;
    }
  }, [selectedDraft.baseLyrics, selectedDraft.value]);
  const alreadySubmitted = useMemo(() => {
    const submitted = lastSubmitted[selectedKey];
    if (!submitted) return false;
    try {
      return submitted.baseLyrics === canonicalizeChordPro(selectedDraft.baseLyrics)
        && submitted.lyrics === canonicalizeChordPro(selectedDraft.value);
    } catch {
      return false;
    }
  }, [lastSubmitted, selectedDraft.baseLyrics, selectedDraft.value, selectedKey]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      let didChange = false;
      targets.forEach((target) => {
        const key = targetKey(target);
        if (!next[key]) {
          next[key] = { baseLyrics: target.lyrics, value: target.lyrics, rebasedAt: null };
          didChange = true;
        } else if (next[key].value === next[key].baseLyrics && next[key].baseLyrics !== target.lyrics) {
          next[key] = { baseLyrics: target.lyrics, value: target.lyrics, rebasedAt: null };
          didChange = true;
        }
      });
      return didChange ? next : current;
    });
  }, [targets]);

  const refreshQueueCount = useCallback(async () => {
    if (!selectedChurch?.id || !userId) return;
    try {
      const scope = await songLyricsProposalOutboxScope(selectedChurch.id, userId);
      const records = await listSongLyricsProposalOutbox(scope);
      const submissions = records.filter((record) => record.kind === "submission" && record.body.target.songId === selectedTarget.songId);
      setLocalRecords(submissions);
      setQueued(submissions.filter((record) => record.state === "pending").length);
    } catch {
      setQueued(0);
      setLocalRecords([]);
    }
  }, [selectedChurch?.id, selectedTarget.songId, userId]);

  const loadProposals = useCallback(async () => {
    if (!selectedTarget?.songId) return;
    setLoadingPermissions(true);
    setLoadError(null);
    try {
      const token = await getToken();
      const response = await listSongLyricsProposals({ songId: selectedTarget.songId, limit: 12 }, token);
      setCanManage(response.permissions.canManageLyrics);
      onCanManageChange(response.permissions.canManageLyrics);
      setRecent(response.proposals);
    } catch (error) {
      setCanManage(null);
      onCanManageChange(null);
      setLoadError(songLyricsProposalFailure(error).message);
    } finally {
      setLoadingPermissions(false);
    }
  }, [getToken, onCanManageChange, selectedTarget?.songId]);

  useEffect(() => {
    void loadProposals();
    void refreshQueueCount();
  }, [loadProposals, refreshQueueCount]);

  function updateDraft(value: string) {
    setDrafts((current) => ({ ...current, [selectedKey]: { ...selectedDraft, value } }));
    setStaleMessage(null);
  }

  async function submitProposal() {
    if (!selectedChurch?.id || !userId || !changed) return;
    setSaving(true);
    setStaleMessage(null);
    try {
      const [body, scope, token] = await Promise.all([
        buildSongLyricsProposalSubmission({
          target: { type: selectedTarget.type, songId: selectedTarget.songId, arrangementId: selectedTarget.arrangementId },
          lyrics: selectedDraft.value,
          baseLyrics: selectedDraft.baseLyrics,
          sourceType: "IOS",
          sourceRef: null,
        }),
        songLyricsProposalOutboxScope(selectedChurch.id, userId),
        getToken(),
      ]);
      const result = await submitSongLyricsProposalDurably(scope, body, token);
      if (result.queued) {
        toast({ title: "Propuesta guardada en este iPhone", description: "Se enviará cuando vuelva la conexión." });
      } else {
        toast({ title: "Propuesta enviada", description: "Tu cambio quedó listo para revisión." });
      }
      setLastSubmitted((current) => ({
        ...current,
        [selectedKey]: {
          baseLyrics: canonicalizeChordPro(selectedDraft.baseLyrics),
          lyrics: body.lyrics,
          requestChecksum: body.requestChecksum,
        },
      }));
      await Promise.all([loadProposals(), refreshQueueCount()]);
    } catch (error) {
      const failure = songLyricsProposalFailure(error);
      if (failure.code === "LYRICS_BASE_STALE") {
        setStaleMessage("La letra original cambió desde que abriste esta pantalla. Tu borrador sigue intacto.");
      } else if (failure.code === "LYRICS_UNCHANGED") {
        toast({ title: "No hay cambios para enviar" });
      } else {
        toast({ title: "No se pudo enviar la propuesta", description: failure.message, variant: "destructive" });
      }
      await refreshQueueCount();
    } finally {
      setSaving(false);
    }
  }

  async function saveDirectly() {
    setSaving(true);
    try {
      const canonical = canonicalizeChordPro(selectedDraft.value);
      await onDirectSave(selectedTarget, canonical);
      setDrafts((current) => ({
        ...current,
        [selectedKey]: { baseLyrics: canonical, value: canonical, rebasedAt: null },
      }));
      toast({ title: "Letras actualizadas" });
      await loadProposals();
    } catch (error) {
      toast({ title: "No se pudieron guardar las letras", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function rebaseDraft() {
    setSaving(true);
    try {
      const currentLyrics = await onRefreshTarget(selectedTarget);
      setDrafts((current) => ({
        ...current,
        [selectedKey]: { ...selectedDraft, baseLyrics: currentLyrics, rebasedAt: new Date().toISOString() },
      }));
      setLastSubmitted((current) => {
        const next = { ...current };
        delete next[selectedKey];
        return next;
      });
      setStaleMessage(null);
      toast({ title: "Versión actual cargada", description: "Revisa tu borrador y vuelve a enviarlo." });
      await refreshQueueCount();
    } catch (error) {
      toast({ title: "No se pudo cargar la versión actual", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function restoreLocalDraft(record: SongLyricsProposalOutboxRecord) {
    if (record.kind !== "submission") return;
    const target = targets.find((candidate) => candidate.type === record.body.target.type
      && candidate.songId === record.body.target.songId
      && candidate.arrangementId === record.body.target.arrangementId);
    if (!target) {
      toast({ title: "La versión original ya no está disponible", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const currentLyrics = await onRefreshTarget(target);
      const key = targetKey(target);
      setSelectedKey(key);
      setDrafts((current) => ({
        ...current,
        [key]: { baseLyrics: currentLyrics, value: record.body.lyrics, rebasedAt: new Date().toISOString() },
      }));
      setLastSubmitted((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await removeSongLyricsProposalOutboxRecord(record.id);
      await refreshQueueCount();
      toast({ title: "Borrador restaurado", description: "Se cargó la versión actual como base. Revísalo antes de enviar." });
    } catch (error) {
      toast({ title: "No se pudo restaurar el borrador", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function discardLocalDraft(record: SongLyricsProposalOutboxRecord) {
    if (record.state === "pending") return;
    await removeSongLyricsProposalOutboxRecord(record.id);
    await refreshQueueCount();
    toast({ title: "Borrador local descartado" });
  }

  return (
    <div className="space-y-4">
      <Card className="app-card overflow-hidden border-primary/15">
        <div className="bg-primary/[0.06] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Letras y acordes</p>
              <p className="mt-1 text-sm text-zinc-600">Edita la versión principal o un arreglo sin perder el original.</p>
            </div>
            {queued > 0 && <Badge className="shrink-0 gap-1 bg-zinc-900 text-white"><CloudOff className="h-3 w-3" /> {queued}</Badge>}
          </div>
        </div>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="lyrics-target">Versión</Label>
            <Select value={selectedKey} onValueChange={(value) => { setSelectedKey(value); setStaleMessage(null); }}>
              <SelectTrigger id="lyrics-target" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {targets.map((target) => <SelectItem key={targetKey(target)} value={targetKey(target)}>{target.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loadingPermissions ? (
            <div className="flex min-h-11 items-center gap-2 rounded-xl bg-zinc-50 px-3 text-sm text-zinc-500" role="status">
              <Loader2 className="h-4 w-4 animate-spin" /> Comprobando permisos…
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>No pudimos abrir las propuestas. {loadError}</span></div>
              <Button variant="ghost" size="sm" onClick={() => void loadProposals()} className="mt-2 h-11 text-amber-950"><RefreshCw className="mr-2 h-4 w-4" />Reintentar</Button>
            </div>
          ) : (
            <div className="flex min-h-11 items-center gap-2 rounded-xl bg-zinc-50 px-3 text-sm text-zinc-600">
              {canManage ? <ShieldCheck className="h-4 w-4 text-primary" /> : <FileClock className="h-4 w-4 text-primary" />}
              {canManage ? "Puedes guardar directamente y revisar propuestas." : "Tus cambios se enviarán para aprobación."}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <Label htmlFor="lyrics-draft">ChordPro</Label>
              <span className={`text-xs tabular-nums ${byteCount > SONG_LYRICS_PROPOSAL_MAX_BYTES ? "font-bold text-destructive" : "text-zinc-400"}`}>
                {Math.ceil(byteCount / 1024)} / 64 KiB
              </span>
            </div>
            <Textarea
              id="lyrics-draft"
              value={selectedDraft.value}
              onChange={(event) => updateDraft(event.target.value)}
              className="min-h-[22rem] resize-y rounded-2xl font-mono text-sm leading-6"
              placeholder={'{verse}\n[C]Letra aquí…\n\n{chorus}\n[F]Coro aquí…'}
              spellCheck={false}
            />
            <p className="text-xs leading-5 text-zinc-500">También puedes pegar acordes encima de la letra; Tchurch los convierte a ChordPro al guardar.</p>
          </div>

          {staleMessage && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3" role="alert">
              <div className="flex gap-2 text-sm leading-5 text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{staleMessage}</span></div>
              <Button variant="outline" onClick={() => void rebaseDraft()} disabled={saving} className="mt-3 h-11 border-amber-300 bg-white text-amber-950">
                <RefreshCw className="mr-2 h-4 w-4" />Cargar versión actual
              </Button>
            </div>
          )}

          {alreadySubmitted && !staleMessage && (
            <div className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 px-3 text-sm text-emerald-800" role="status">
              <CheckCircle2 className="h-4 w-4 shrink-0" />Esta versión ya fue enviada. Tu base original se conserva hasta que alguien la apruebe.
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() => void (canManage ? saveDirectly() : submitProposal())}
              disabled={saving || canManage === null || !changed || alreadySubmitted || byteCount > SONG_LYRICS_PROPOSAL_MAX_BYTES}
              className="h-12 rounded-xl px-5 active:scale-[0.98]"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : canManage ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
              {canManage ? "Guardar directamente" : "Enviar propuesta"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {localRecords.length > 0 && (
        <Card className="app-card">
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="font-bold text-zinc-950">Guardado en este dispositivo</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Los borradores no se comparten con otra iglesia ni con otra sesión.</p>
            </div>
            {localRecords.map((record) => (
              <div key={record.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900">
                      {record.state === "pending" ? "Pendiente de envío" : record.state === "needs_review" ? "Necesita una base nueva" : "No se pudo enviar"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">{record.kind === "submission" && record.body.target.type === "ARRANGEMENT" ? "Arreglo" : "Canción principal"} · {new Date(record.createdAt).toLocaleDateString("es-US")}</p>
                  </div>
                  <Badge variant="outline" className={record.state === "pending" ? "border-primary/20 text-primary" : "border-amber-200 bg-amber-50 text-amber-900"}>
                    {record.state === "pending" ? "Sincronizando" : "Atención"}
                  </Badge>
                </div>
                {record.state !== "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void restoreLocalDraft(record)} disabled={saving} className="h-11 rounded-xl bg-white">
                      <RotateCcw className="mr-2 h-4 w-4" />Restaurar borrador
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void discardLocalDraft(record)} disabled={saving} className="h-11 rounded-xl text-zinc-600">
                      <Trash2 className="mr-2 h-4 w-4" />Descartar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {recent.length > 0 && (
        <Card className="app-card">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-bold text-zinc-950">Actividad reciente</p>
              <Button variant="ghost" size="sm" onClick={() => void loadProposals()} className="h-11"><RefreshCw className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-2">
              {recent.slice(0, 4).map((proposal) => (
                <div key={proposal.id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{proposal.target.arrangement?.name || "Canción principal"}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{proposal.submittedBy.displayName} · {new Date(proposal.submittedAt).toLocaleDateString("es-US")}</p>
                  </div>
                  <Badge variant="outline" className={statusClass(proposal.status)}>{statusLabel(proposal.status)}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
