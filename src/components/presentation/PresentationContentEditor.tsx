import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Loader2, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { paginateResolvedScripture, normalizePresentationResolvedScripture } from "@/lib/presentationOutput";
import { resolvePresentationScripture } from "@/lib/presentationOutputApi";

type PresentationContentEditorProps = {
  initialValue: unknown;
  onChange: (value: Record<string, unknown> | null) => void;
};

const KINDS = ["scripture", "image", "video", "audio", "countdown", "sermon", "announcement", "blank"] as const;
type ContentKind = (typeof KINDS)[number];

const KIND_LABELS: Record<ContentKind, string> = {
  scripture: "Escritura",
  image: "Imagen",
  video: "Video",
  audio: "Audio",
  countdown: "Cuenta regresiva",
  sermon: "Diapositivas de sermón",
  announcement: "Anuncio en bucle",
  blank: "Diapositiva vacía",
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function defaults(kind: ContentKind): Record<string, unknown> {
  if (kind === "scripture") return { kind, reference: "", passageUsfm: null, bibleId: null, language: "es", manualText: null, versionName: null, versionAbbreviation: null, copyright: null, promotionalContent: null, resolvedPassage: null };
  if (kind === "image") return { kind, src: "", alt: "", fit: "cover" };
  if (kind === "video") return { kind, src: "", posterSrc: null, mimeType: null, muted: true, autoplay: true, loop: false, durationMs: null };
  if (kind === "audio") return { kind, src: "", artist: null, mimeType: null, autoplay: true, loop: false, durationMs: null };
  if (kind === "countdown") return { kind, label: "Comenzamos en", durationSeconds: 300 };
  if (kind === "sermon") return { kind, subtitle: null, speaker: null, body: "", mediaSrc: null, mediaMimeType: null };
  if (kind === "announcement") return { kind, body: "", mediaSrc: null, mediaMimeType: null, durationSeconds: 10, loop: true };
  return { kind: "blank", tone: "black" };
}

export function PresentationContentEditor({ initialValue, onChange }: PresentationContentEditorProps) {
  const initial = objectValue(initialValue);
  const initialKind = KINDS.includes(initial?.kind as ContentKind) ? initial?.kind as ContentKind : null;
  const [draft, setDraft] = useState<Record<string, unknown> | null>(() => initialKind ? { ...defaults(initialKind), ...initial } : null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const kind = draft?.kind as ContentKind | undefined;
  const resolvedPassage = normalizePresentationResolvedScripture(draft?.resolvedPassage);
  const scripturePages = useMemo(() => resolvedPassage ? paginateResolvedScripture(resolvedPassage).length : 0, [resolvedPassage]);

  function commit(next: Record<string, unknown> | null) {
    setDraft(next);
    onChange(next);
  }

  function setField(field: string, value: unknown, invalidateScripture = false) {
    setDraft((current) => {
      if (!current) return current;
      const next: Record<string, unknown> = { ...current, [field]: value, ...(invalidateScripture ? { resolvedPassage: null } : {}) };
      if (field === "src" && !next.mimeType && (next.kind === "video" || next.kind === "audio")) {
        next.mimeType = inferAssetMime(textValue(value), next.kind);
      }
      onChange(next);
      return next;
    });
    if (invalidateScripture) setResolveError(null);
  }

  function setPresentationImageUrl(value: string) {
    setDraft((current) => {
      if (!current) return current;
      const mediaSrc = value || null;
      const previousInferredMime = inferAssetMime(textValue(current.mediaSrc), "image");
      const nextInferredMime = inferAssetMime(value, "image");
      const hasExplicitMime = Boolean(current.mediaMimeType && current.mediaMimeType !== previousInferredMime);
      const mediaMimeType = mediaSrc ? (hasExplicitMime ? current.mediaMimeType : nextInferredMime) : null;
      const next = { ...current, mediaSrc, mediaMimeType };
      onChange(next);
      return next;
    });
  }

  function changeKind(value: string) {
    if (value === "none") {
      commit(null);
      return;
    }
    commit(defaults(value as ContentKind));
    setResolveError(null);
  }

  async function resolveScripture() {
    if (kind !== "scripture" || !textValue(draft?.reference).trim()) {
      setResolveError("Escribe una referencia como Juan 3:16–18.");
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      const passage = await resolvePresentationScripture({
        reference: textValue(draft.reference).trim(),
        passageUsfm: textValue(draft.passageUsfm).trim() || null,
        bibleId: textValue(draft.bibleId).trim() || null,
        language: textValue(draft.language).trim() || "es",
        manualText: textValue(draft.manualText).trim() || null,
        versionName: textValue(draft.versionName).trim() || null,
        versionAbbreviation: textValue(draft.versionAbbreviation).trim() || null,
        copyright: textValue(draft.copyright).trim() || null,
        promotionalContent: textValue(draft.promotionalContent).trim() || null,
      });
      commit({ ...draft, resolvedPassage: passage, passageUsfm: passage.passageUsfm, language: passage.version.language, versionName: passage.version.name, versionAbbreviation: passage.version.abbreviation, copyright: passage.copyright, promotionalContent: passage.promotionalContent });
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "No se pudo resolver el pasaje.");
    } finally {
      setResolving(false);
    }
  }

  const mediaMetadataFields = kind === "video" || kind === "audio" ? (
    <div className="mt-4 grid gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-3 sm:grid-cols-2">
      <div><Label className="text-xs font-bold text-zinc-600">Formato real</Label><Select value={textValue(draft?.mimeType) || "none"} onValueChange={(value) => setField("mimeType", value === "none" ? null : value)}><SelectTrigger className="mt-1.5 h-11 rounded-2xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Seleccionar o inferir de URL</SelectItem>{kind === "video" ? <><SelectItem value="video/mp4">MP4</SelectItem><SelectItem value="video/webm">WebM</SelectItem></> : <><SelectItem value="audio/mpeg">MP3</SelectItem><SelectItem value="audio/mp4">M4A / MP4</SelectItem><SelectItem value="audio/wav">WAV</SelectItem><SelectItem value="audio/ogg">OGG</SelectItem></>}</SelectContent></Select></div>
      <div><Label className="text-xs font-bold text-zinc-600">Duración opcional (ms)</Label><Input type="number" min={1} max={86_400_000} value={draft?.durationMs === null || draft?.durationMs === undefined ? "" : String(draft.durationMs)} onChange={(event) => setField("durationMs", event.target.value ? Number(event.target.value) : null)} placeholder="180000" className="mt-1.5 h-11 rounded-2xl bg-white" /></div>
    </div>
  ) : null;

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3">
      {mediaMetadataFields}
      <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white"><MonitorPlay className="h-4 w-4" /></span><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-900">Contenido de presentación</p><p className="mt-1 text-xs leading-5 text-violet-700">Esto sí llega a la audiencia; las notas del equipo permanecen privadas.</p></div></div>
      <div className="mt-3">
        <Label className="text-xs font-bold text-zinc-600">Tipo de diapositiva</Label>
        <Select value={kind || "none"} onValueChange={changeKind}><SelectTrigger className="mt-2 h-11 rounded-2xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin contenido público especial</SelectItem>{KINDS.map((value) => <SelectItem key={value} value={value}>{KIND_LABELS[value]}</SelectItem>)}</SelectContent></Select>
      </div>

      {kind === "scripture" ? <div className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]"><div><Label className="text-xs font-bold text-zinc-600">Referencia</Label><Input value={textValue(draft.reference)} onChange={(event) => setField("reference", event.target.value, true)} placeholder="Juan 3:16–18" className="mt-1.5 h-11 rounded-2xl bg-white" /></div><div><Label className="text-xs font-bold text-zinc-600">Idioma</Label><Input value={textValue(draft.language)} onChange={(event) => setField("language", event.target.value, true)} maxLength={20} className="mt-1.5 h-11 rounded-2xl bg-white" /></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label className="text-xs font-bold text-zinc-600">Bible ID de YouVersion</Label><Input value={textValue(draft.bibleId)} onChange={(event) => setField("bibleId", event.target.value, true)} placeholder="Usa el configurado si se deja vacío" className="mt-1.5 h-11 rounded-2xl bg-white" /></div><div><Label className="text-xs font-bold text-zinc-600">Abreviación de versión</Label><Input value={textValue(draft.versionAbbreviation)} onChange={(event) => setField("versionAbbreviation", event.target.value, true)} placeholder="RVR1960" className="mt-1.5 h-11 rounded-2xl bg-white" /></div></div>
        <div><Label className="text-xs font-bold text-zinc-600">Texto manual opcional</Label><Textarea value={textValue(draft.manualText)} onChange={(event) => setField("manualText", event.target.value, true)} rows={5} maxLength={20_000} placeholder="Pégalo si el proveedor no está configurado. El servidor lo resolverá y paginará." className="mt-1.5 rounded-2xl bg-white" /></div>
        <div className="flex flex-wrap items-center gap-2"><Button type="button" className="h-11 rounded-2xl" onClick={() => void resolveScripture()} disabled={resolving}>{resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}Resolver texto</Button>{resolvedPassage ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{resolvedPassage.version.abbreviation} · {scripturePages} slide{scripturePages === 1 ? "" : "s"}</span> : null}</div>
        {resolveError ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">{resolveError}</p> : null}
      </div> : null}

      {kind === "image" ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Label className="text-xs font-bold text-zinc-600">URL HTTPS de imagen</Label><Input value={textValue(draft.src)} onChange={(event) => setField("src", event.target.value)} inputMode="url" placeholder="https://…" className="mt-1.5 h-11 rounded-2xl bg-white" /></div><div><Label className="text-xs font-bold text-zinc-600">Descripción accesible</Label><Input value={textValue(draft.alt)} onChange={(event) => setField("alt", event.target.value)} maxLength={240} className="mt-1.5 h-11 rounded-2xl bg-white" /></div><div><Label className="text-xs font-bold text-zinc-600">Ajuste</Label><Select value={textValue(draft.fit) || "cover"} onValueChange={(value) => setField("fit", value)}><SelectTrigger className="mt-1.5 h-11 rounded-2xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cover">Llenar</SelectItem><SelectItem value="contain">Mostrar completa</SelectItem></SelectContent></Select></div></div> : null}

      {kind === "video" || kind === "audio" ? <div className="mt-4 grid gap-3"><div><Label className="text-xs font-bold text-zinc-600">URL HTTPS de {kind === "video" ? "video" : "audio"}</Label><Input value={textValue(draft.src)} onChange={(event) => setField("src", event.target.value)} inputMode="url" placeholder="https://…" className="mt-1.5 h-11 rounded-2xl bg-white" /></div>{kind === "video" ? <div><Label className="text-xs font-bold text-zinc-600">Poster HTTPS opcional</Label><Input value={textValue(draft.posterSrc)} onChange={(event) => setField("posterSrc", event.target.value || null)} inputMode="url" className="mt-1.5 h-11 rounded-2xl bg-white" /></div> : <div><Label className="text-xs font-bold text-zinc-600">Artista</Label><Input value={textValue(draft.artist)} onChange={(event) => setField("artist", event.target.value || null)} className="mt-1.5 h-11 rounded-2xl bg-white" /></div>}<div className="grid gap-2 sm:grid-cols-3">{kind === "video" ? <Toggle label="Silenciar" checked={boolValue(draft.muted, true)} onChange={(value) => setField("muted", value)} /> : null}<Toggle label="Autoplay" checked={boolValue(draft.autoplay, true)} onChange={(value) => setField("autoplay", value)} /><Toggle label="Repetir" checked={boolValue(draft.loop, false)} onChange={(value) => setField("loop", value)} /></div></div> : null}

      {kind === "countdown" ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><div><Label className="text-xs font-bold text-zinc-600">Etiqueta</Label><Input value={textValue(draft.label)} onChange={(event) => setField("label", event.target.value)} maxLength={120} className="mt-1.5 h-11 rounded-2xl bg-white" /></div><div><Label className="text-xs font-bold text-zinc-600">Segundos (5–86400)</Label><Input type="number" min={5} max={86_400} value={Number(draft.durationSeconds || 300)} onChange={(event) => setField("durationSeconds", Number(event.target.value))} className="mt-1.5 h-11 rounded-2xl bg-white" /></div></div> : null}

      {kind === "sermon" || kind === "announcement" ? <div className="mt-4 grid gap-3"><div className="grid gap-3 sm:grid-cols-2">{kind === "sermon" ? <><div><Label className="text-xs font-bold text-zinc-600">Subtítulo</Label><Input value={textValue(draft.subtitle)} onChange={(event) => setField("subtitle", event.target.value || null)} className="mt-1.5 h-11 rounded-2xl bg-white" /></div><div><Label className="text-xs font-bold text-zinc-600">Orador</Label><Input value={textValue(draft.speaker)} onChange={(event) => setField("speaker", event.target.value || null)} className="mt-1.5 h-11 rounded-2xl bg-white" /></div></> : <><div><Label className="text-xs font-bold text-zinc-600">Segundos por slide (3–3600)</Label><Input type="number" min={3} max={3_600} value={Number(draft.durationSeconds || 10)} onChange={(event) => setField("durationSeconds", Number(event.target.value))} className="mt-1.5 h-11 rounded-2xl bg-white" /></div><Toggle label="Repetir páginas" checked={boolValue(draft.loop, true)} onChange={(value) => setField("loop", value)} /></>}</div><div><Label className="text-xs font-bold text-zinc-600">Texto</Label><Textarea value={Array.isArray(draft.body) ? draft.body.map(String).join("\n") : textValue(draft.body)} onChange={(event) => setField("body", event.target.value)} rows={6} maxLength={12_000} placeholder="El servidor dividirá el texto en slides legibles." className="mt-1.5 rounded-2xl bg-white" /></div><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]"><div><Label className="text-xs font-bold text-zinc-600">Imagen HTTPS opcional</Label><Input value={textValue(draft.mediaSrc)} onChange={(event) => setPresentationImageUrl(event.target.value)} inputMode="url" className="mt-1.5 h-11 rounded-2xl bg-white" /></div><div><Label className="text-xs font-bold text-zinc-600">Formato</Label><Select value={textValue(draft.mediaMimeType) || "none"} onValueChange={(value) => setField("mediaMimeType", value === "none" ? null : value)}><SelectTrigger className="mt-1.5 h-11 rounded-2xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin imagen</SelectItem><SelectItem value="image/jpeg">JPEG</SelectItem><SelectItem value="image/png">PNG</SelectItem><SelectItem value="image/webp">WebP</SelectItem><SelectItem value="image/gif">GIF</SelectItem></SelectContent></Select></div></div></div> : null}

      {kind === "blank" ? <div className="mt-4"><Label className="text-xs font-bold text-zinc-600">Fondo</Label><Select value={textValue(draft.tone) || "black"} onValueChange={(value) => setField("tone", value)}><SelectTrigger className="mt-1.5 h-11 rounded-2xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="black">Negro</SelectItem><SelectItem value="transparent">Transparente</SelectItem></SelectContent></Select></div> : null}
    </div>
  );
}

function inferAssetMime(value: string, kind: "image" | "video" | "audio") {
  let extension = "";
  try { extension = new URL(value).pathname.split(".").pop()?.toLowerCase() || ""; } catch { return null; }
  const images: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  const videos: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };
  const audio: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg" };
  return (kind === "image" ? images : kind === "video" ? videos : audio)[extension] || null;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-3"><span className="text-xs font-bold text-zinc-600">{label}</span><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>;
}
