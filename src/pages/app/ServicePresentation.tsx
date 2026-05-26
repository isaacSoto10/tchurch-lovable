import { useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, Music, X } from "lucide-react";
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

function SongSlide({ slide, showChords }: { slide: Extract<PresentationSlide, { kind: "song" }>; showChords: boolean }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center px-6 py-5 sm:px-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-black uppercase tracking-[0.28em] text-violet-200">
          {slide.itemIndex}. Canción
        </span>
        {slide.key && <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">Tono {slide.key}</Badge>}
        {slide.bpm && <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">{slide.bpm} BPM</Badge>}
        {slide.meter && <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">{slide.meter}</Badge>}
      </div>

      <div className="mb-7">
        <h1 className="text-4xl font-black leading-none tracking-tight text-white sm:text-6xl">{slide.title}</h1>
        {slide.artist && <p className="mt-3 text-xl font-medium text-slate-300 sm:text-2xl">{slide.artist}</p>}
        {slide.totalParts > 1 && (
          <p className="mt-3 text-sm font-bold uppercase tracking-[0.24em] text-violet-200/80">
            Parte {slide.part} de {slide.totalParts}
          </p>
        )}
      </div>

      <div className="max-h-[62svh] overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 sm:p-8">
        <div className="space-y-3 font-mono">
          {slide.lines.map((line, index) => {
            if (line.kind === "blank") return <div key={index} className="h-3" />;
            if (line.kind === "section" || line.kind === "meta") {
              return (
                <div key={index} className="pt-2">
                  <span className="rounded-full bg-violet-400/15 px-3 py-1 text-sm font-black uppercase tracking-[0.28em] text-violet-200">
                    {line.label}
                  </span>
                </div>
              );
            }

            if (!showChords && !line.lyrics.trim()) return null;

            return (
              <div key={index} className="leading-tight">
                {showChords && line.chords && (
                  <pre className="overflow-hidden whitespace-pre-wrap text-2xl font-black leading-tight text-violet-300 sm:text-4xl">
                    {line.chords}
                  </pre>
                )}
                {line.lyrics && (
                  <pre className="overflow-hidden whitespace-pre-wrap text-3xl font-semibold leading-tight text-white sm:text-5xl">
                    {line.lyrics}
                  </pre>
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
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center px-6 py-5 sm:px-10">
      <div className="rounded-[2.5rem] border border-white/10 bg-white/[0.05] p-8 shadow-2xl shadow-black/40 sm:p-12">
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-black uppercase tracking-[0.28em] text-violet-200">
            {slide.itemIndex}. {slide.subtitle}
          </span>
          {slide.duration && <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">{slide.duration} min</Badge>}
        </div>

        <h1 className="text-5xl font-black leading-none tracking-tight text-white sm:text-7xl">{slide.title}</h1>

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

      <header className="relative z-10 flex items-center gap-3 px-4 py-3 sm:px-6" onClick={stopStageEvent}>
        <Button variant="ghost" className="h-10 rounded-full bg-white/10 px-3 text-white hover:bg-white/15 hover:text-white" onClick={exitToService}>
          <ArrowLeft className="h-4 w-4" />
          Salir
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-white">{service.title}</p>
          <p className="truncate text-xs text-slate-400">{formatServiceDate(service.date)}</p>
        </div>
        {currentSlide?.kind === "song" && (
          <Button
            variant="ghost"
            className="h-10 rounded-full bg-white/10 px-3 text-white hover:bg-white/15 hover:text-white"
            onClick={() => setShowChords((current) => !current)}
          >
            {showChords ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            Acordes
          </Button>
        )}
        <div className="rounded-full bg-white/10 px-3 py-2 text-sm font-black text-white">
          {slides.length ? slideIndex + 1 : 0} / {slides.length}
        </div>
      </header>

      <main className="relative z-10 h-[calc(100svh-9.5rem)] min-h-0">
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

      <footer className="relative z-10 flex items-center gap-3 px-4 py-3 sm:px-6" onClick={stopStageEvent}>
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
