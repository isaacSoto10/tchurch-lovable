import { useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, EyeOff, ListMusic, Loader2, Music, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";
import {
  buildServicePresentationSlides,
  canUseServicePresentation,
  type PresentationService,
  type PresentationSlide,
} from "@/lib/servicePresentation";

type UserMe = {
  id: string;
  email?: string | null;
};

type WakeLockHandle = {
  release: () => Promise<void>;
};

function formatServiceDate(value: string) {
  return new Date(value).toLocaleDateString("es-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function useWakeLock() {
  const wakeLockRef = useRef<WakeLockHandle | null>(null);

  useEffect(() => {
    async function requestWakeLock() {
      const navigatorWithWakeLock = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> };
      };

      if (!navigatorWithWakeLock.wakeLock || wakeLockRef.current) return;

      try {
        wakeLockRef.current = await navigatorWithWakeLock.wakeLock.request("screen");
      } catch {
        wakeLockRef.current = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        wakeLockRef.current = null;
        void requestWakeLock();
      }
    }

    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, []);
}

function useMeasuredElement<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    function updateSize() {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    }

    updateSize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateSize);
    observer?.observe(element);
    window.addEventListener("resize", updateSize);
    window.visualViewport?.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
      window.visualViewport?.removeEventListener("resize", updateSize);
    };
  }, []);

  return [ref, size] as const;
}

function getChordTokens(chords: string) {
  return [...chords.matchAll(/\S+/g)].map((match) => ({
    chord: match[0],
    column: match.index ?? 0,
  }));
}

function normalizeSectionLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function formatPresentationSectionLabel(label: string) {
  const normalized = normalizeSectionLabel(label);
  const number = label.match(/\d+$/)?.[0];
  const suffix = number ? ` ${number}` : "";

  if (normalized.includes("pre") && (normalized.includes("chorus") || normalized.includes("coro"))) return `Pre-Coro${suffix}`;
  if (normalized.startsWith("verse") || normalized.startsWith("verso") || normalized.startsWith("estrofa")) return `Verso${suffix}`;
  if (normalized.startsWith("chorus") || normalized.startsWith("coro")) return `Coro${suffix}`;
  if (normalized.startsWith("bridge") || normalized.startsWith("puente")) return `Puente${suffix}`;
  if (normalized.startsWith("interlude") || normalized.startsWith("interludio")) return `Interludio${suffix}`;
  if (normalized.startsWith("outro") || normalized.startsWith("final") || normalized.startsWith("ending")) return `Final${suffix}`;

  return label;
}

function getChordTokenLeft(column: number, columns: number) {
  if (columns <= 1) return 0;
  return Math.min(92, Math.max(0, (column / columns) * 100));
}

function SongSlide({ slide, showChords }: { slide: Extract<PresentationSlide, { kind: "song" }>; showChords: boolean }) {
  const [chartBodyRef, chartSize] = useMeasuredElement<HTMLDivElement>();
  const chartMetrics = useMemo(() => {
    return slide.lines.reduce(
      (metrics, line) => {
        if (line.kind === "blank") {
          return { ...metrics, rows: metrics.rows + 0.28 };
        }

        if (line.kind === "section" || line.kind === "meta") {
          return { ...metrics, rows: metrics.rows + 1.25 };
        }

        const hasChords = showChords && line.chords.trim().length > 0;
        const hasLyrics = line.lyrics.trim().length > 0;
        const maxColumns = Math.max(metrics.maxColumns, showChords ? line.chords.length : 0, line.lyrics.length);
        const rows = hasChords && hasLyrics ? 2.2 : hasChords ? 1.05 : hasLyrics ? 1.28 : 0.35;
        return { maxColumns, rows: metrics.rows + rows };
      },
      { maxColumns: 18, rows: 0 }
    );
  }, [showChords, slide.lines]);
  const fallbackWidth = typeof window === "undefined" ? 360 : Math.max(window.innerWidth - 40, 320);
  const fallbackHeight = typeof window === "undefined" ? 620 : Math.max(window.innerHeight - 118, 420);
  const chartWidth = chartSize.width || fallbackWidth;
  const chartHeight = chartSize.height || fallbackHeight;
  const isCompactStage = chartWidth < 640;
  const widthLimitedFont = (chartWidth / Math.max(chartMetrics.maxColumns, 1)) * (isCompactStage ? 2.05 : 1.8);
  const heightLimitedFont = (chartHeight / Math.max(chartMetrics.rows, 1)) * (isCompactStage ? 0.94 : 0.9);
  const minLyricFontSize = isCompactStage ? 20 : 24;
  const maxLyricFontSize = isCompactStage ? 24 : 38;
  const lyricFontSizePx = Math.round(
    Math.max(minLyricFontSize, Math.min(widthLimitedFont, heightLimitedFont, maxLyricFontSize))
  );
  const chordFontSizePx = Math.round(
    Math.max(isCompactStage ? 18 : 22, Math.min(lyricFontSizePx - 1, isCompactStage ? 22 : 34))
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col px-3 pb-3 pt-0 sm:max-w-6xl sm:px-8 sm:pb-4 sm:pt-1">
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-2 sm:mb-3 sm:gap-2.5">
        <span className="rounded-full bg-violet-500/70 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white shadow-lg shadow-violet-950/20 sm:px-4 sm:py-1.5 sm:text-xs sm:tracking-[0.2em]">
          {slide.itemIndex}. Canción
        </span>
        {slide.key && <Badge className="rounded-full border border-white/10 bg-white/[0.12] px-3 py-1 text-[11px] font-bold text-violet-50 hover:bg-white/[0.12] sm:px-3.5 sm:py-1.5 sm:text-xs">Tono {slide.key}</Badge>}
        {slide.bpm && <Badge className="hidden rounded-full border border-white/10 bg-white/[0.12] text-xs text-white hover:bg-white/[0.12] sm:inline-flex">{slide.bpm} BPM</Badge>}
        {slide.meter && <Badge className="hidden rounded-full border border-white/10 bg-white/[0.12] text-xs text-white hover:bg-white/[0.12] sm:inline-flex">{slide.meter}</Badge>}
        {slide.totalParts > 1 && (
          <span className="rounded-full border border-white/10 bg-white/[0.12] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-violet-50 sm:px-3.5 sm:py-1.5 sm:text-xs">
            {slide.part}/{slide.totalParts}
          </span>
        )}
      </div>

      <div className="hidden sm:mb-2 sm:block">
        <h1 className="line-clamp-1 text-[clamp(1rem,4.8vw,2.25rem)] font-black leading-none tracking-tight text-white">{slide.title}</h1>
        {slide.artist && <p className="mt-0.5 hidden truncate text-[clamp(0.8rem,3.4vw,1.25rem)] font-medium text-slate-300 sm:block">{slide.artist}</p>}
        {slide.totalParts > 1 && (
          <p className="mt-0.5 hidden text-[11px] font-bold uppercase tracking-[0.24em] text-violet-200/80 sm:block">
            Parte {slide.part} de {slide.totalParts}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/[0.15] bg-black/25 p-5 shadow-2xl shadow-black/[0.35] sm:rounded-[1.75rem] sm:p-7">
        <div ref={chartBodyRef} className="h-full w-full min-w-0 overflow-hidden">
          {slide.lines.map((line, index) => {
            if (line.kind === "blank") return <div key={index} className="h-2" />;
            if (line.kind === "section" || line.kind === "meta") {
              const label = formatPresentationSectionLabel(line.label);
              const SectionIcon = normalizeSectionLabel(label).includes("coro") ? Sparkles : ListMusic;

              return (
                <div key={index} className={`${index > 0 ? "mt-3 border-t border-white/10 pt-3" : ""} pb-1`}>
                  <span className="inline-flex items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-500/[0.18] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-violet-200 shadow-lg shadow-violet-950/20 sm:px-4 sm:text-xs sm:tracking-[0.24em]">
                    <SectionIcon className="h-3.5 w-3.5" />
                    {label}
                  </span>
                </div>
              );
            }

            if (!showChords && !line.lyrics.trim()) return null;

            const chordTokens = getChordTokens(line.chords);
            const lineColumns = Math.max(18, chartMetrics.maxColumns, line.chords.length, line.lyrics.length);
            const hasLyrics = line.lyrics.trim().length > 0;

            return (
              <div
                key={index}
                className="min-w-0 overflow-hidden pb-2 leading-none last:pb-0"
                style={{ fontVariantLigatures: "none" }}
              >
                {showChords && chordTokens.length > 0 && (
                  <div className="relative h-[1.12em] min-w-0 overflow-visible" style={{ fontSize: `${chordFontSizePx}px` }}>
                    {chordTokens.map((token, tokenIndex) => (
                      <span
                        key={`${token.chord}-${token.column}-${tokenIndex}`}
                        className="absolute top-0 whitespace-nowrap font-black leading-none text-violet-300"
                        style={{
                          left: `${getChordTokenLeft(token.column, lineColumns)}%`,
                          textShadow: "0 0 18px rgba(196,181,253,0.24)",
                        }}
                      >
                        {token.chord}
                      </span>
                    ))}
                  </div>
                )}
                {hasLyrics && (
                  <p
                    className="min-w-0 whitespace-pre-wrap break-words font-sans font-black leading-[1.12] text-white"
                    style={{
                      fontSize: `${lyricFontSizePx}px`,
                      textShadow: "0 2px 18px rgba(0,0,0,0.34)",
                    }}
                  >
                    {line.lyrics.trimStart()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CueSlide({ slide }: { slide: Extract<PresentationSlide, { kind: "cue" }> }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center px-5 py-3 sm:px-10">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-6 shadow-2xl shadow-black/40 sm:p-12">
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-black uppercase tracking-[0.28em] text-violet-200">
            {slide.itemIndex}. {slide.subtitle}
          </span>
          {slide.duration && <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">{slide.duration} min</Badge>}
        </div>

        <h1 className="text-[clamp(2.5rem,12vw,5.75rem)] font-black leading-none tracking-tight text-white">{slide.title}</h1>

        {slide.notes.length > 0 && (
          <div className="mt-9 grid gap-3">
            {slide.notes.map((note, index) => (
              <div key={`${note}-${index}`} className="rounded-3xl border border-white/10 bg-black/25 px-5 py-4 text-xl font-semibold leading-snug text-slate-100 sm:text-2xl">
                {note}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ServicePresentation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const [service, setService] = useState<PresentationService | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [showChords, setShowChords] = useState(true);
  const touchStartXRef = useRef<number | null>(null);
  const swipeHandledRef = useRef(false);

  useWakeLock();

  useEffect(() => {
    if (!id) return;
    let active = true;

    async function loadPresentation() {
      setLoading(true);
      setLoadError(null);

      try {
        const [serviceData, userData] = await Promise.all([
          apiFetch<PresentationService>(`/services/${id}`),
          apiFetch<UserMe>("/users/me").catch(() => null),
        ]);

        if (!active) return;
        setService({
          ...serviceData,
          items: [...(serviceData.items || [])].sort((a, b) => a.position - b.position),
        });
        setCurrentUserId(userData?.id || null);
        setCurrentUserEmail(userData?.email?.trim().toLowerCase() || null);
      } catch (error) {
        console.error("No se pudo cargar la presentación:", error);
        if (active) setLoadError(error instanceof Error ? error.message : "No se pudo cargar la presentación");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadPresentation();

    return () => {
      active = false;
    };
  }, [id]);

  const slides = useMemo(() => service ? buildServicePresentationSlides(service) : [], [service]);
  const canPresent = canUseServicePresentation(service, selectedChurch?.role, currentUserId, currentUserEmail);
  const currentSlide = slides[slideIndex];

  useEffect(() => {
    if (slides.length === 0) {
      setSlideIndex(0);
      return;
    }
    if (slideIndex > slides.length - 1) setSlideIndex(slides.length - 1);
  }, [slideIndex, slides.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        setSlideIndex((current) => Math.min(current + 1, Math.max(slides.length - 1, 0)));
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSlideIndex((current) => Math.max(current - 1, 0));
      }
      if (event.key === "Escape") {
        navigate(`/app/services/${id}`);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [id, navigate, slides.length]);

  function goNext() {
    setSlideIndex((current) => Math.min(current + 1, Math.max(slides.length - 1, 0)));
  }

  function goPrevious() {
    setSlideIndex((current) => Math.max(current - 1, 0));
  }

  function handleStageClick(event: MouseEvent<HTMLDivElement>) {
    if (swipeHandledRef.current) {
      swipeHandledRef.current = false;
      return;
    }

    const midpoint = window.innerWidth / 2;
    if (event.clientX >= midpoint) goNext();
    else goPrevious();
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    touchStartXRef.current = null;
    if (startX === null || endX === null) return;

    const delta = endX - startX;
    if (Math.abs(delta) < 48) return;

    swipeHandledRef.current = true;
    if (delta < 0) goNext();
    else goPrevious();
  }

  function stopStageEvent(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  const exitToService = () => navigate(`/app/services/${id}`);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-svh items-center justify-center bg-[#050508] text-white">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-9 w-9 animate-spin text-violet-300" />
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-slate-400">Preparando presentación</p>
        </div>
      </div>
    );
  }

  if (loadError || !service) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-svh items-center justify-center bg-[#050508] p-6 text-white">
        <div className="max-w-md rounded-[2rem] border border-white/10 bg-white/[0.05] p-8 text-center">
          <X className="mx-auto mb-4 h-9 w-9 text-red-300" />
          <h1 className="text-2xl font-black">No se pudo abrir la presentación</h1>
          <p className="mt-2 text-slate-300">{loadError || "Servicio no encontrado."}</p>
          <Button className="mt-6 rounded-2xl" onClick={() => navigate("/app/services")}>Volver a servicios</Button>
        </div>
      </div>
    );
  }

  if (!canPresent) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-svh items-center justify-center bg-[#050508] p-6 text-white">
        <div className="max-w-lg rounded-[2rem] border border-white/10 bg-white/[0.05] p-8 text-center">
          <EyeOff className="mx-auto mb-4 h-10 w-10 text-violet-200" />
          <h1 className="text-3xl font-black">Presentación no disponible</h1>
          <p className="mt-3 text-slate-300">
            Solo administradores, planificadores o músicos asignados pueden abrir este modo para el servicio.
          </p>
          <Button className="mt-6 rounded-2xl" onClick={exitToService}>Volver al servicio</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 min-h-svh overflow-hidden bg-[radial-gradient(circle_at_top_left,#2f1e6a_0%,#090912_34%,#020204_100%)] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      onClick={handleStageClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_35%,rgba(124,58,237,0.12))]" />

      <header className="relative z-10 flex h-16 items-center justify-between gap-2 px-4 py-2 sm:h-auto sm:px-6 sm:py-2.5" onClick={stopStageEvent}>
        <Button variant="ghost" className="h-10 shrink-0 rounded-2xl border border-white/10 bg-white/10 px-3 text-sm font-bold text-white shadow-lg shadow-black/20 hover:bg-white/[0.15] hover:text-white sm:h-10 sm:px-4" onClick={exitToService}>
          <ArrowLeft className="h-4 w-4" />
          Salir
        </Button>
        <div className="hidden min-w-0 flex-1 sm:block">
          <p className="truncate text-xs font-black text-white sm:text-sm">{service.title}</p>
          <p className="truncate text-[10px] text-slate-400 sm:text-xs">{formatServiceDate(service.date)}</p>
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 min-w-0 max-w-[38vw] -translate-x-1/2 -translate-y-1/2 text-center sm:hidden">
          <p className="truncate text-xl font-black leading-none tracking-tight text-white">
            {currentSlide?.title || service.title}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {currentSlide?.kind === "song" && (
            <Button
              variant="ghost"
              className="h-10 rounded-2xl border border-white/10 bg-white/10 px-3 text-sm font-bold text-white shadow-lg shadow-black/20 hover:bg-white/[0.15] hover:text-white sm:h-10 sm:px-4"
              onClick={() => setShowChords((current) => !current)}
            >
              {showChords ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              Acordes
            </Button>
          )}
          <div className="flex h-10 items-center rounded-2xl border border-white/10 bg-white/10 px-3 text-sm font-black text-white shadow-lg shadow-black/20 sm:px-4">
            {slides.length ? slideIndex + 1 : 0} / {slides.length}
          </div>
        </div>
      </header>

      <main className="relative z-10 h-[calc(100svh-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-0 sm:h-[calc(100svh-7.5rem)]">
        {slides.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div>
              <Music className="mx-auto mb-4 h-12 w-12 text-violet-200" />
              <h1 className="text-3xl font-black">Este servicio todavía no tiene elementos.</h1>
              <p className="mt-2 text-slate-300">Agrega canciones o cues antes de abrirlo en modo presentación.</p>
            </div>
          </div>
        ) : currentSlide?.kind === "song" ? (
          <SongSlide slide={currentSlide} showChords={showChords} />
        ) : currentSlide ? (
          <CueSlide slide={currentSlide} />
        ) : null}
      </main>

      <footer className="relative z-10 hidden items-center gap-3 px-4 py-2 sm:flex sm:px-6" onClick={stopStageEvent}>
        <Button
          variant="ghost"
          className="h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/15 hover:text-white"
          onClick={goPrevious}
          disabled={slideIndex === 0}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center">
          <p className="truncate text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Siguiente</p>
          <p className="truncate text-sm font-black text-white">{currentSlide?.nextTitle || "Fin del servicio"}</p>
        </div>
        <Button
          variant="ghost"
          className="h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/15 hover:text-white"
          onClick={goNext}
          disabled={slideIndex >= slides.length - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </footer>
    </div>
  );
}
