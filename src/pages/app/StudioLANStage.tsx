import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import { ArrowLeft, Eye, LoaderCircle, MonitorUp, Music2, Radio, RefreshCw, ScanLine, ShieldCheck, Unplug, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStudioLANClient } from "@/hooks/useStudioLANClient";
import { scannerErrorNotice } from "@/lib/barcodeScannerErrors";
import { normalizeStudioLANPairingQR, type StudioLANChannel, type StudioLANChordLine, type StudioLANTimer } from "@/lib/studioLANClient";

function formatClock(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function projectedTimer(timer: StudioLANTimer, now: number) {
  const elapsed = timer.anchorValueMs + (timer.isRunning ? Math.max(0, now - timer.anchorAtMs) : 0);
  if (timer.mode === "countDown" && timer.durationMs != null) return Math.max(0, timer.durationMs - Math.min(elapsed, timer.durationMs));
  return Math.max(0, elapsed);
}

function goBack(navigate: ReturnType<typeof useNavigate>) {
  if (window.history.length > 1) navigate(-1);
  else navigate("/app/services", { replace: true });
}

function chordSegments(line: StudioLANChordLine) {
  const grouped = new Map<number, string[]>();
  for (const chord of line.chords) grouped.set(chord.offsetUtf16, [...(grouped.get(chord.offsetUtf16) ?? []), chord.value]);
  const offsets = [...grouped.keys()].sort((left, right) => left - right);
  if (offsets.length === 0) return [{ offset: 0, text: line.text, chords: [] as string[] }];
  const segments: Array<{ offset: number; text: string; chords: string[] }> = [];
  let cursor = 0;
  offsets.forEach((offset, index) => {
    if (offset > cursor) segments.push({ offset: cursor, text: line.text.slice(cursor, offset), chords: [] });
    const nextOffset = offsets[index + 1] ?? line.text.length;
    segments.push({ offset, text: line.text.slice(offset, nextOffset), chords: grouped.get(offset) ?? [] });
    cursor = nextOffset;
  });
  if (cursor < line.text.length) segments.push({ offset: cursor, text: line.text.slice(cursor), chords: [] });
  return segments;
}

function ChordLyricLine({ line }: { line: StudioLANChordLine }) {
  const segments = chordSegments(line);
  const accessibleChords = line.chords.map((chord) => `${chord.value} en ${chord.offsetUtf16}`).join(", ");
  return (
    <div className="max-w-full overflow-x-auto pb-1" aria-label={`${line.text}. ${accessibleChords}`}>
      <div className="inline-grid min-w-full items-end justify-start text-left font-mono" style={{ gridTemplateColumns: `repeat(${segments.length}, max-content)`, gridTemplateRows: "auto auto" }}>
        {segments.map((segment, index) => <span key={`chord-${segment.offset}-${index}`} className="min-h-6 whitespace-nowrap pr-2 text-sm font-black text-emerald-300 sm:text-lg" style={{ gridColumn: index + 1, gridRow: 1 }} data-chord-offset-utf16={segment.offset}>{segment.chords.join(" / ")}</span>)}
        {segments.map((segment, index) => <span key={`lyric-${segment.offset}-${index}`} className="whitespace-pre text-[clamp(1.7rem,7vw,4.75rem)] font-black leading-[1.08] tracking-tight" style={{ gridColumn: index + 1, gridRow: 2 }}>{segment.text || "\u00a0"}</span>)}
      </div>
    </div>
  );
}

export default function StudioLANStage() {
  const navigate = useNavigate();
  const { status, update, connect, disconnect, forget, refresh } = useStudioLANClient();
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [channel, setChannel] = useState<StudioLANChannel>("stage");
  const [pairingCode, setPairingCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status.selectedServiceId) setSelectedServiceId(status.selectedServiceId);
    else if (!selectedServiceId && status.services[0]) setSelectedServiceId(status.services[0].id);
  }, [selectedServiceId, status.selectedServiceId, status.services]);

  useEffect(() => {
    if (status.phase === "connected") setShowSetup(false);
    if (status.phase === "failed") setShowSetup(true);
  }, [status.phase]);

  useEffect(() => {
    if (!update?.stage?.timers.some((timer) => timer.isRunning) && !update?.audience.countdown) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [update]);

  const selectedService = useMemo(
    () => status.services.find((service) => service.id === selectedServiceId) ?? null,
    [selectedServiceId, status.services],
  );
  const connected = status.phase === "connected";
  const reconnecting = status.phase === "reconnecting" || status.phase === "suspended";
  const currentCue = update?.audience.cue ?? null;
  const currentChordSlide = channel === "stage" && update?.payloadVersion === 2 ? update.stage?.currentChordSlide ?? null : null;
  const countdown = update?.audience.countdown;
  const countdownRemaining = countdown ? Math.max(0, countdown.targetAtMs - now) : null;

  async function submitConnection() {
    if (!selectedServiceId || submitting) return;
    setScanNotice(null);
    setSubmitting(true);
    try {
      await connect(selectedServiceId, channel, pairingCode);
      setPairingCode("");
    } finally {
      setSubmitting(false);
    }
  }

  async function scanPairingQR() {
    if (!selectedServiceId || scanning || submitting) return;
    setScanNotice(null);
    setScanning(true);
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "Escanea el QR mostrado en Tchurch Studio.",
        scanButton: true,
        scanText: "Escanear",
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      });
      const scannedCode = normalizeStudioLANPairingQR(result.ScanResult);
      if (!scannedCode) {
        setScanNotice("Ese QR no pertenece a Tchurch Studio.");
        return;
      }
      await connect(selectedServiceId, channel, scannedCode);
      setPairingCode("");
    } catch (error) {
      const notice = scannerErrorNotice(error);
      if (notice) setScanNotice(`${notice.title}. ${notice.description}`);
    } finally {
      setScanning(false);
    }
  }

  async function openSetup() {
    await disconnect();
    setShowSetup(true);
  }

  return (
    <main className="flex min-h-svh flex-col overflow-hidden bg-[#050507] text-white" data-testid="studio-lan-stage">
      <header className="z-20 flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-black/80 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] backdrop-blur sm:px-5">
        <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 rounded-xl text-white hover:bg-white/10 hover:text-white" aria-label="Volver a servicios" onClick={() => goBack(navigate)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-violet-300" aria-hidden="true" />
            <h1 className="truncate text-sm font-black">Tchurch Studio LAN</h1>
          </div>
          <p className="truncate text-[10px] font-semibold text-slate-400">Directo · solo lectura · sin cloud</p>
        </div>
        {!showSetup && (
          <Button type="button" variant="ghost" className="h-11 rounded-xl px-3 text-xs font-black text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => void openSetup()}>
            <Unplug className="h-4 w-4" /> Desconectar
          </Button>
        )}
      </header>

      {showSetup || !update ? (
        <section className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-6 sm:px-6" aria-label="Conectar con Tchurch Studio">
          <div className="mx-auto w-full max-w-2xl space-y-5">
            <div className="rounded-3xl border border-violet-300/20 bg-violet-300/[0.07] p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-300/10 text-violet-200"><ShieldCheck className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-lg font-black">Pantalla de músicos y escenario</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-300">Recibe la diapositiva actual por la red local aun cuando internet esté caído. Esta pantalla no puede avanzar slides ni controlar producción.</p>
                </div>
              </div>
            </div>

            {!status.supported ? (
              <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5" role="status">
                <p className="font-black text-amber-100">Abre esta ruta en la app de iPhone o iPad.</p>
                <p className="mt-2 text-sm leading-6 text-amber-100/80">El navegador no recibe conexiones locales de Studio.</p>
              </div>
            ) : (
              <>
                {status.message && (
                  <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${status.phase === "failed" ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`} role="status">
                    {status.message}
                  </div>
                )}

                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">1 · Studio disponible</p>
                      <p className="mt-1 text-xs text-slate-400">El iPhone/iPad y la Mac deben estar en la misma red.</p>
                    </div>
                    {(status.phase === "discovering" || status.phase === "connecting" || status.phase === "authenticating") && <LoaderCircle className="h-5 w-5 animate-spin text-violet-300" aria-label="Buscando Studio" />}
                  </div>
                  <div className="mt-4 grid gap-2">
                    {status.services.map((service) => (
                      <button key={service.id} type="button" className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-left transition-colors ${selectedServiceId === service.id ? "border-violet-300/50 bg-violet-300/10" : "border-white/10 bg-black/20 hover:bg-white/[0.06]"}`} aria-pressed={selectedServiceId === service.id} onClick={() => setSelectedServiceId(service.id)}>
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06]"><MonitorUp className="h-4 w-4 text-violet-200" /></span>
                        <span className="min-w-0 flex-1 truncate text-sm font-black">{service.name}</span>
                        {selectedServiceId === service.id && <ShieldCheck className="h-4 w-4 text-emerald-300" />}
                      </button>
                    ))}
                    {status.services.length === 0 && (
                      <div className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 px-4 py-4 text-center text-sm text-slate-400">
                        <Wifi className="mb-2 h-5 w-5" />
                        <span>{status.phase === "discovering" ? "Buscando Tchurch Studio en la red local…" : "No hay ningún Tchurch Studio visible en esta red."}</span>
                        {status.phase !== "discovering" && (
                          <Button type="button" variant="ghost" size="sm" className="mt-2 h-10 rounded-xl text-violet-200 hover:bg-violet-300/10 hover:text-violet-100" onClick={() => void refresh()}>
                            <RefreshCw className="h-4 w-4" />Buscar de nuevo
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">2 · Salida</p>
                  <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Tipo de salida LAN">
                    <button type="button" className={`min-h-14 rounded-2xl border px-3 text-sm font-black ${channel === "stage" ? "border-violet-300/50 bg-violet-300/10" : "border-white/10 bg-black/20"}`} aria-pressed={channel === "stage"} onClick={() => setChannel("stage")}><Music2 className="mx-auto mb-1 h-4 w-4" />Escenario</button>
                    <button type="button" className={`min-h-14 rounded-2xl border px-3 text-sm font-black ${channel === "audience" ? "border-violet-300/50 bg-violet-300/10" : "border-white/10 bg-black/20"}`} aria-pressed={channel === "audience"} onClick={() => setChannel("audience")}><Eye className="mx-auto mb-1 h-4 w-4" />Audiencia</button>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <label htmlFor="studio-pairing-code" className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">3 · Código de emparejamiento</label>
                  <p className="mt-2 text-xs leading-5 text-slate-400">Escanea el QR visible en Studio. El secreto se guarda cifrado en Keychain y puede cambiar cuando inicia una autoridad nueva.</p>
                  {scanNotice && <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100" role="alert">{scanNotice}</p>}
                  <Button type="button" className="mt-4 h-12 w-full rounded-2xl font-black" disabled={!selectedService || scanning || submitting} onClick={() => void scanPairingQR()}>{scanning ? <><LoaderCircle className="h-4 w-4 animate-spin" />Abriendo cámara…</> : <><ScanLine className="h-4 w-4" />Escanear QR de Studio</>}</Button>
                  <div className="my-4 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600"><span className="h-px flex-1 bg-white/10" />o pegar manualmente<span className="h-px flex-1 bg-white/10" /></div>
                  <Input id="studio-pairing-code" type="password" autoComplete="off" spellCheck={false} value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="tchurch-studio:…" className="h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-slate-600" />
                  <Button type="button" variant="outline" className="mt-3 h-12 w-full rounded-2xl border-white/15 bg-transparent font-black text-white hover:bg-white/10 hover:text-white" disabled={!selectedService || submitting || scanning} onClick={() => void submitConnection()}>
                    {submitting || status.phase === "connecting" || status.phase === "authenticating" ? <><LoaderCircle className="h-4 w-4 animate-spin" />Verificando…</> : <><ShieldCheck className="h-4 w-4" />Conectar de forma segura</>}
                  </Button>
                  {selectedServiceId && status.paired && (
                    <Button type="button" variant="ghost" className="mt-2 h-11 w-full rounded-xl text-xs text-slate-400 hover:bg-white/5 hover:text-white" onClick={() => void forget(selectedServiceId)}>Olvidar emparejamiento guardado</Button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {reconnecting && (
            <div className="z-10 flex min-h-11 shrink-0 items-center justify-center gap-2 border-b border-amber-300/20 bg-amber-300/10 px-4 text-center text-xs font-black text-amber-100" role="status">
              <RefreshCw className="h-4 w-4 animate-spin" />{status.message || "Reconectando con Studio…"}
            </div>
          )}
          {connected && (
            <div className="z-10 flex min-h-10 shrink-0 items-center justify-center gap-2 border-b border-emerald-300/15 bg-emerald-300/[0.07] px-4 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200" role="status">
              <ShieldCheck className="h-3.5 w-3.5" />LAN verificada · revisión {update.revision}
            </div>
          )}

          {update.audience.isBlackout ? (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black" aria-label="Salida en negro">
              {channel === "stage" && <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-700">Salida en negro</p>}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-8" data-testid="studio-lan-scroll">
              <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
                {channel === "stage" && update.stage?.message && (
                  <div className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-center text-sm font-black text-amber-100" role="note">{update.stage.message}</div>
                )}

                {(countdownRemaining != null || update.stage?.timers.length) ? (
                  <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Tiempos del servicio">
                    {countdownRemaining != null && <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-center"><span className="block text-[9px] font-black uppercase tracking-wider text-slate-500">{countdown?.label}</span><span className="mt-1 block text-lg font-black tabular-nums">{formatClock(countdownRemaining)}</span></div>}
                    {update.stage?.timers.map((timer) => <div key={timer.id} className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-center"><span className="block truncate text-[9px] font-black uppercase tracking-wider text-slate-500">{timer.label}</span><span className="mt-1 block text-lg font-black tabular-nums">{formatClock(projectedTimer(timer, now))}</span></div>)}
                  </div>
                ) : null}

                <div className="flex min-h-[55vh] flex-1 flex-col justify-center rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 text-center shadow-2xl shadow-black/40 sm:p-10">
                  {currentCue?.title && <p className="mb-5 text-xs font-black uppercase tracking-[0.2em] text-violet-200">{currentCue.title}</p>}
                  {currentChordSlide ? (
                    <div className="mb-4 space-y-3" aria-label="Acordes y letra actuales">
                      {currentChordSlide.key && <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Tono · {currentChordSlide.key}</p>}
                      {currentChordSlide.lines.map((line, index) => <ChordLyricLine key={`${index}-${line.text}`} line={line} />)}
                    </div>
                  ) : channel === "stage" && update.payloadVersion === 1 && update.stage?.chordLines.length ? (
                    <div className="mb-4 space-y-1 font-mono text-base font-black leading-relaxed text-emerald-300 sm:text-xl" aria-label="Acordes actuales">
                      {update.stage.chordLines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
                    </div>
                  ) : null}
                  {!currentChordSlide && currentCue?.lines.length ? (
                    <div className="space-y-3 text-[clamp(2rem,9vw,5.75rem)] font-black leading-[1.08] tracking-tight" aria-label="Diapositiva actual">
                      {currentCue.lines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
                    </div>
                  ) : (
                    <p className="text-xl font-black text-slate-500">Esperando la primera diapositiva…</p>
                  )}
                </div>

                {channel === "stage" && update.stage?.nextCue && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Siguiente</p>
                    <p className="mt-1 truncate text-sm font-black">{update.stage.nextCue.title || update.stage.nextCue.lines[0] || "Fin del servicio"}</p>
                    {update.stage.nextCue.lines[1] && <p className="mt-1 truncate text-xs text-slate-400">{update.stage.nextCue.lines[1]}</p>}
                  </div>
                )}
                <p className="mt-5 text-center text-[10px] font-semibold text-slate-600">{update.audience.currentCueIndex == null ? "—" : update.audience.currentCueIndex + 1} / {update.audience.cueCount} · Autoridad LAN {update.authority.runId.slice(0, 8)}</p>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
