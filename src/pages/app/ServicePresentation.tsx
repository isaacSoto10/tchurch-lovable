import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Clock3, Eye, EyeOff, ListMusic, Loader2, Minus, MonitorPlay, Music, Pause, Pencil, Play, Plus, RotateCcw, Settings2, Sparkles, Square, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApiError, apiFetch } from "@/lib/api";
import { PresentationWorkspaceEditor } from "@/components/presentation/PresentationWorkspaceEditor";
import { PresentationAudienceOutput } from "@/components/presentation/PresentationAudienceOutput";
import { PresentationOutputManager } from "@/components/presentation/PresentationOutputManager";
import {
  LiveConnectionBadge,
  PresentationLiveNotice,
  PresentationOwnershipControls,
  PresentationRemoteSurface,
  PresentationStageMessages,
  PresentationTimingPanel,
} from "@/components/presentation/PresentationLiveControls";
import { usePresentationLive } from "@/hooks/usePresentationLive";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useChurch } from "@/providers/ChurchProvider";
import {
  buildServicePresentationSlides,
  buildAudiencePreviewSlide,
  buildPresentationRunSteps,
  canUseServicePresentation,
  getDefaultPresentationSongMode,
  type PresentationLayout,
  type PresentationService,
  type PresentationSlide,
  type PresentationSongMode,
} from "@/lib/servicePresentation";
import {
  DEFAULT_PRESENTATION_STAGE_LAYOUTS,
  presentationStageRoleForViewer,
  projectPresentationPlaybackPosition,
  resolvePresentationAnnouncementSlideId,
  type PresentationOutputConfig,
  type PresentationMediaPlayback,
  type PresentationStageMode,
} from "@/lib/presentationOutput";
import { fetchPresentationOutputConfig } from "@/lib/presentationOutputApi";
import { formatServiceDate } from "@/lib/serviceDates";
import {
  fetchPresentationWorkspace,
  fetchPresentationWorkspaceForPreferredView,
  canEnterPresentationWorkspace,
  getWorkspaceItem,
  isPresentationAnnotationVisible,
  normalizePresentationWorkspace,
  savePresentationWorkspaceItem,
  type PresentationAnnotation,
  type PresentationTargetRole,
  type PresentationWorkspace,
  type PresentationWorkspaceItem,
} from "@/lib/presentationWorkspace";
import {
  presentationPackageMatchesLiveViewer,
  presentationWorkspaceMatchesLiveViewer,
  resolvePresentationCursorIndex,
  type PresentationPrivateLiveView,
} from "@/lib/presentationLive";

type UserMe = {
  id: string;
  email?: string | null;
};

type WakeLockHandle = {
  release: () => Promise<void>;
};

const TABLET_PRESENTATION_MIN_SIDE = 768;
const MIN_SONG_ZOOM_LEVEL = -1;
const MAX_SONG_ZOOM_LEVEL = 4;
const SONG_ZOOM_STEP = 0.14;

function getViewportSize() {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return {
    width: window.visualViewport?.width || window.innerWidth,
    height: window.visualViewport?.height || window.innerHeight,
  };
}

function isTabletPresentationViewport(width: number, height: number) {
  return Math.min(width || 0, height || 0) >= TABLET_PRESENTATION_MIN_SIDE;
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

function useTabletPresentationLayout() {
  const [isTablet, setIsTablet] = useState(() => {
    const { width, height } = getViewportSize();
    return isTabletPresentationViewport(width, height);
  });

  useEffect(() => {
    function updateLayout() {
      const { width, height } = getViewportSize();
      setIsTablet(isTabletPresentationViewport(width, height));
    }

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);
    window.visualViewport?.addEventListener("resize", updateLayout);

    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
      window.visualViewport?.removeEventListener("resize", updateLayout);
    };
  }, []);

  return isTablet;
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

function firstContentColumn(value: string) {
  const index = value.search(/\S/);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function trimSharedChartIndent(chords: string, lyrics: string) {
  const sharedColumns = Math.min(firstContentColumn(chords), firstContentColumn(lyrics));

  if (!Number.isFinite(sharedColumns)) {
    return { chords: chords.trimStart(), lyrics: lyrics.trimStart() };
  }

  if (sharedColumns <= 0) return { chords, lyrics };
  return { chords: chords.slice(sharedColumns), lyrics: lyrics.slice(sharedColumns) };
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

function formatLiveDuration(value: number | null | undefined) {
  const total = Math.max(0, Math.round(value || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function getChordTokenLeft(column: number, columns: number) {
  if (columns <= 1) return 0;
  return Math.min(92, Math.max(0, (column / columns) * 100));
}

function getSongZoomScale(level: number) {
  return 1 + level * SONG_ZOOM_STEP;
}

function scaledClamp(minRem: number, preferredVw: number, maxRem: number, scale: number) {
  return `clamp(${(minRem * scale).toFixed(2)}rem, ${(preferredVw * scale).toFixed(2)}vw, ${(maxRem * scale).toFixed(2)}rem)`;
}

function SongSlide({
  slide,
  showChords,
  layout,
  songMode,
  zoomScale,
  activeSequenceId,
  stageMode,
}: {
  slide: Extract<PresentationSlide, { kind: "song" }>;
  showChords: boolean;
  layout: PresentationLayout;
  songMode: PresentationSongMode;
  zoomScale: number;
  activeSequenceId?: string | null;
  stageMode: PresentationStageMode;
}) {
  const isTabletLayout = layout === "tablet";
  const allowsVerticalScroll = songMode === "scroll" || zoomScale > 1 || !isTabletLayout;
  const [chartBodyRef, chartSize] = useMeasuredElement<HTMLDivElement>();
  const displayLines = useMemo(() => {
    if (stageMode !== "confidence" || !activeSequenceId) return slide.lines;
    const confidenceLines = slide.lines.filter((line) => line.sectionSequenceId === activeSequenceId);
    return confidenceLines.length ? confidenceLines : slide.lines;
  }, [activeSequenceId, slide.lines, stageMode]);
  useEffect(() => {
    if (!activeSequenceId || songMode !== "scroll") return;
    const root = chartBodyRef.current;
    const target = Array.from(root?.querySelectorAll<HTMLElement>("[data-presentation-sequence]") || [])
      .find((element) => element.dataset.presentationSequence === activeSequenceId);
    if (!target) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeSequenceId, chartBodyRef, songMode]);
  const chartMetrics = useMemo(() => {
    return displayLines.reduce(
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
      { maxColumns: Math.max(18, slide.maxColumns), rows: 0 }
    );
  }, [displayLines, showChords, slide.maxColumns]);
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
  const lyricFontSize = isTabletLayout ? scaledClamp(1, 2.35, 1.75, zoomScale) : `${Math.round(lyricFontSizePx * zoomScale)}px`;
  const chordFontSize = isTabletLayout ? scaledClamp(0.86, 1.85, 1.35, zoomScale) : `${Math.round(chordFontSizePx * zoomScale)}px`;

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-0 sm:max-w-6xl sm:px-8 sm:pb-4 sm:pt-1">
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

      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/[0.15] bg-black/25 p-4 shadow-2xl shadow-black/[0.35] sm:rounded-[1.75rem] sm:p-7">
        <div
          ref={chartBodyRef}
          className={`h-full w-full min-w-0 ${allowsVerticalScroll ? "touch-pan-y overflow-y-auto overscroll-contain pb-4 pr-1" : "overflow-hidden"}`}
          style={allowsVerticalScroll ? { WebkitOverflowScrolling: "touch" } : undefined}
          onClick={songMode === "scroll" ? (event) => event.stopPropagation() : undefined}
        >
          {displayLines.map((line, index) => {
            if (line.kind === "blank") return <div key={index} className="h-2" />;
            if (line.kind === "section" || line.kind === "meta") {
              const label = formatPresentationSectionLabel(line.label);
              const SectionIcon = normalizeSectionLabel(label).includes("coro") ? Sparkles : ListMusic;

              return (
                <div
                  key={index}
                  data-presentation-sequence={line.sectionSequenceId}
                  className={`${index > 0 ? "mt-3 border-t border-white/10 pt-3" : ""} scroll-mt-2 pb-1`}
                >
                  <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] shadow-lg sm:px-4 sm:text-xs sm:tracking-[0.24em] ${line.sectionSequenceId === activeSequenceId ? "border-amber-300/60 bg-amber-400/20 text-amber-100 shadow-amber-950/20" : "border-violet-300/20 bg-violet-500/[0.18] text-violet-200 shadow-violet-950/20"}`}>
                    <SectionIcon className="h-3.5 w-3.5" />
                    {label}
                  </span>
                </div>
              );
            }

            if (!showChords && !line.lyrics.trim()) return null;

            if (isTabletLayout) {
              const chartLine = trimSharedChartIndent(line.chords, line.lyrics);

              return (
                <div
                  key={index}
                  className="min-w-0 overflow-x-auto pb-3 leading-none last:pb-0"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {showChords && chartLine.chords.trim().length > 0 && (
                    <pre
                      className="w-max min-w-full whitespace-pre font-mono font-black leading-none text-violet-300"
                      style={{ fontSize: chordFontSize, textShadow: "0 0 18px rgba(196,181,253,0.24)" }}
                    >
                      {chartLine.chords}
                    </pre>
                  )}
                  {chartLine.lyrics.trim().length > 0 && (
                    <pre
                      className="w-max min-w-full whitespace-pre font-mono font-black leading-[1.12] text-white"
                      style={{ fontSize: lyricFontSize, textShadow: "0 2px 18px rgba(0,0,0,0.34)" }}
                    >
                      {chartLine.lyrics}
                    </pre>
                  )}
                </div>
              );
            }

            const chordTokens = getChordTokens(line.chords);
            const lineColumns = Math.max(18, slide.maxColumns, line.chords.length, line.lyrics.length);
            const hasLyrics = line.lyrics.trim().length > 0;

            return (
              <div
                key={index}
                className="min-w-0 overflow-hidden pb-2 leading-none last:pb-0"
                style={{ fontVariantLigatures: "none" }}
              >
                {showChords && chordTokens.length > 0 && (
                  <div className="relative h-[1.12em] min-w-0 overflow-visible" style={{ fontSize: chordFontSize }}>
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
                      fontSize: lyricFontSize,
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

function CueSlide({ slide, fontScale, mode, showNotes }: { slide: Extract<PresentationSlide, { kind: "cue" }>; fontScale: number; mode: PresentationStageMode; showNotes: boolean }) {
  const titleSize = mode === "confidence" ? "text-[clamp(3rem,14vw,7rem)]" : mode === "production" ? "text-[clamp(2rem,8vw,4rem)]" : "text-[clamp(2.5rem,12vw,5.75rem)]";
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center px-5 py-3 sm:px-10" data-stage-layout-mode={mode}>
      <div className={`rounded-[2rem] border border-white/10 bg-white/[0.05] p-6 shadow-2xl shadow-black/40 sm:p-12 ${mode === "speaker" ? "border-l-4 border-l-amber-300/70" : ""}`} style={fontScale === 1 ? undefined : { transform: `scale(${fontScale})` }}>
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-black uppercase tracking-[0.28em] text-violet-200">
            {slide.itemIndex}. {slide.subtitle}
          </span>
          {slide.duration && <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">{slide.duration} min</Badge>}
        </div>

        <h1 className={`${titleSize} font-black leading-none tracking-tight text-white`}>{slide.title}</h1>

        {showNotes && slide.notes.length > 0 && (
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

const ANNOTATION_LABELS: Record<PresentationAnnotation["category"], string> = {
  note: "Nota",
  direction: "Dirección",
  musical: "Musical",
  technical: "Técnica",
  transition: "Transición",
  safety: "Seguridad",
};

function usePresentationClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(now);
}

function useProjectionClock(active: boolean) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);

  return nowMs;
}

function AnnotationList({ annotations, emptyLabel }: { annotations: PresentationAnnotation[]; emptyLabel: string }) {
  if (!annotations.length) {
    return <p className="rounded-2xl border border-dashed border-white/15 px-4 py-5 text-center text-sm text-slate-400">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {annotations.map((annotation) => (
        <div key={annotation.id} className={`rounded-2xl border px-4 py-3 ${annotation.category === "safety" ? "border-amber-300/35 bg-amber-300/10" : "border-white/10 bg-white/[0.07]"}`}>
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`text-[10px] font-black uppercase tracking-[0.15em] ${annotation.category === "safety" ? "text-amber-200" : "text-violet-200"}`}>{ANNOTATION_LABELS[annotation.category]}</span>
            {annotation.roles.slice(0, 3).map((role) => <span key={role} className="rounded-md bg-black/25 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300">{role.replace("_", " ")}</span>)}
          </div>
          <p className="text-sm font-semibold leading-5 text-white">{annotation.body}</p>
        </div>
      ))}
    </div>
  );
}

function PresentationMediaControls({
  slide,
  playback,
  serverNow,
  receivedAtMs,
  pending,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onRestart,
  onStop,
}: {
  slide: Extract<PresentationSlide, { kind: "content" }>;
  playback: PresentationMediaPlayback | null;
  serverNow: string;
  receivedAtMs: number;
  pending: boolean;
  canControl: boolean;
  onPlay: (positionMs: number) => void;
  onPause: () => void;
  onSeek: (positionMs: number) => void;
  onRestart: () => void;
  onStop: () => void;
}) {
  const audience = slide.audienceSlide;
  const mediaKind = audience.kind === "video" || audience.kind === "audio" || audience.kind === "announcement" ? audience.kind : null;
  const matches = Boolean(mediaKind && playback?.itemId === slide.itemId && playback.slideId === audience.id && playback.kind === mediaKind);
  const projected = matches ? projectPresentationPlaybackPosition(playback, serverNow, receivedAtMs, Date.now()) : 0;
  const maximumMs = audience.kind === "video" || audience.kind === "audio"
    ? audience.durationMs || 3_600_000
    : audience.kind === "announcement"
      ? audience.durationSeconds * 1_000
      : 0;
  const [seekMs, setSeekMs] = useState(projected);

  useEffect(() => {
    setSeekMs(matches ? projectPresentationPlaybackPosition(playback, serverNow, receivedAtMs, Date.now()) : 0);
  }, [matches, playback, receivedAtMs, serverNow]);
  if (!mediaKind) return null;
  const disabled = pending || !canControl;
  const playing = matches && playback?.status === "playing";

  return (
    <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-3">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">Reproducción</p><p className="mt-1 text-xs text-slate-400">{mediaKind === "announcement" ? "Intervalo del anuncio" : mediaKind === "video" ? "Video de audiencia" : "Audio de audiencia"}</p></div><span className="text-xs font-black tabular-nums">{formatLiveDuration(seekMs / 1_000)}</span></div>
      <input type="range" min={0} max={Math.max(1_000, maximumMs)} step={1_000} value={Math.min(seekMs, Math.max(1_000, maximumMs))} onChange={(event) => setSeekMs(Number(event.target.value))} className="mt-3 h-8 w-full accent-amber-300" aria-label="Posición del contenido" disabled={disabled || !matches} />
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        <Button type="button" variant="ghost" size="icon" className="h-11 w-full rounded-xl bg-white/[0.07] text-white hover:bg-white/10 hover:text-white" disabled={disabled} onClick={() => onPlay(matches ? projected : 0)} aria-label="Reproducir"><Play className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-11 w-full rounded-xl bg-white/[0.07] text-white hover:bg-white/10 hover:text-white" disabled={disabled || !playing} onClick={onPause} aria-label="Pausar"><Pause className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-11 w-full rounded-xl bg-white/[0.07] text-white hover:bg-white/10 hover:text-white" disabled={disabled || !matches} onClick={() => onSeek(seekMs)} aria-label="Buscar posición"><Clock3 className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-11 w-full rounded-xl bg-white/[0.07] text-white hover:bg-white/10 hover:text-white" disabled={disabled || !matches} onClick={onRestart} aria-label="Reiniciar"><RotateCcw className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-11 w-full rounded-xl bg-white/[0.07] text-white hover:bg-white/10 hover:text-white" disabled={disabled || !matches} onClick={onStop} aria-label="Detener"><Square className="h-4 w-4" /></Button>
      </div>
      {!canControl ? <p className="mt-2 text-[10px] text-slate-500">Toma el control y conéctate para manejar medios.</p> : null}
    </div>
  );
}

function RundownList({
  steps,
  activeIndex,
  onSelect,
}: {
  steps: ReturnType<typeof buildPresentationRunSteps>;
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      {steps.map((step, index) => (
        <button
          key={step.id}
          type="button"
          aria-current={index === activeIndex ? "step" : undefined}
          className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${index === activeIndex ? "bg-violet-500 text-white shadow-lg shadow-violet-950/30" : "bg-white/[0.05] text-slate-300 hover:bg-white/10"}`}
          onClick={() => onSelect(index)}
        >
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-black ${index === activeIndex ? "bg-white/15 text-white" : "bg-black/25 text-slate-400"}`}>{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-black">{step.title}</span>
            <span className={`block truncate text-[10px] font-semibold uppercase tracking-[0.12em] ${index === activeIndex ? "text-violet-100" : "text-slate-500"}`}>{step.sectionLabel || "Cue"}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function ServicePresentation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { userId: authenticatedUserId } = useAppAuth();
  const isTabletPresentation = useTabletPresentationLayout();
  const clock = usePresentationClock();
  const [service, setService] = useState<PresentationService | null>(null);
  const [workspace, setWorkspace] = useState<PresentationWorkspace | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [showChords, setShowChords] = useState(true);
  const [songModeOverride, setSongModeOverride] = useState<PresentationSongMode | null>(null);
  const [songZoomLevel, setSongZoomLevel] = useState(0);
  const [surface, setSurface] = useState<"operator" | "stage" | "remote">("stage");
  const [blackout, setBlackout] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [showRundown, setShowRundown] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showOutputManager, setShowOutputManager] = useState(false);
  const [outputConfig, setOutputConfig] = useState<PresentationOutputConfig | null>(null);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const historyRef = useRef<string[]>([]);
  const keyboardActionsRef = useRef({
    goNext: () => undefined,
    goPrevious: () => undefined,
    undo: () => undefined,
    toggleBlackout: () => undefined,
    exit: () => undefined,
  });
  const surfaceInitializedRef = useRef(false);
  const touchStartXRef = useRef<number | null>(null);
  const swipeHandledRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const presentationLoadGenerationRef = useRef(0);
  const presentationLoadIdentity = [
    id || "no-service",
    authenticatedUserId || "signed-out",
    selectedChurch?.id || "no-church",
    selectedChurch?.role || "no-role",
  ].join("::");

  useWakeLock();

  useLayoutEffect(() => {
    presentationLoadGenerationRef.current += 1;
    surfaceInitializedRef.current = false;
    historyRef.current = [];
    setService(null);
    setWorkspace(null);
    setCurrentUserId(null);
    setCurrentUserEmail(null);
    setLoading(Boolean(id));
    setLoadError(null);
    setWorkspaceNotice(null);
    setActiveStepIndex(0);
    setHistoryCount(0);
    setShowEditor(false);
    setShowOutputManager(false);
    setOutputConfig(null);
    setSavingWorkspace(false);
  }, [presentationLoadIdentity, id]);

  useEffect(() => {
    if (!id) return undefined;
    const generation = presentationLoadGenerationRef.current;
    let active = true;
    const isCurrentLoad = () => active && generation === presentationLoadGenerationRef.current;

    async function loadPresentation() {
      setLoading(true);
      setLoadError(null);
      setWorkspaceNotice(null);

      try {
        const [serviceData, userData] = await Promise.all([
          apiFetch<PresentationService>(`/services/${id}`, { cache: "no-store" }),
          apiFetch<UserMe>("/users/me").catch(() => null),
        ]);
        if (!isCurrentLoad()) return;

        const normalizedService = {
          ...serviceData,
          items: [...(serviceData.items || [])].sort((a, b) => a.position - b.position),
        };
        setService(normalizedService);
        setCurrentUserId(userData?.id || null);
        setCurrentUserEmail(userData?.email?.trim().toLowerCase() || null);

        const preferredView = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER" ? "editor" : "operator";
        try {
          const loadedWorkspace = await fetchPresentationWorkspaceForPreferredView(normalizedService, preferredView, selectedChurch?.role);
          if (isCurrentLoad()) setWorkspace(loadedWorkspace);
        } catch (workspaceError) {
          if (!isCurrentLoad()) return;
          if (workspaceError instanceof ApiError && (workspaceError.status === 401 || workspaceError.status === 403)) {
            throw workspaceError;
          }
          console.warn("Tchurch Live usará el arreglo derivado:", workspaceError);
          if (isCurrentLoad()) {
            setWorkspace(normalizePresentationWorkspace(null, normalizedService, "stage", null));
            setWorkspaceNotice("Las notas guardadas no están disponibles ahora. La presentación sigue con el arreglo de la canción.");
          }
        }
      } catch (error) {
        console.error("No se pudo cargar la presentación:", error);
        if (isCurrentLoad()) setLoadError(error instanceof Error ? error.message : "No se pudo cargar la presentación");
      } finally {
        if (isCurrentLoad()) setLoading(false);
      }
    }

    void loadPresentation();
    return () => { active = false; };
  }, [authenticatedUserId, id, selectedChurch?.id, selectedChurch?.role]);

  useEffect(() => {
    if (!id || !workspace?.viewer.canEdit) {
      setOutputConfig(null);
      return;
    }
    let active = true;
    void fetchPresentationOutputConfig(id)
      .then((next) => { if (active) setOutputConfig(next); })
      .catch(() => { if (active) setOutputConfig(null); });
    return () => { active = false; };
  }, [id, workspace?.viewer.canEdit]);

  const presentationLayout: PresentationLayout = isTabletPresentation ? "tablet" : "phone";
  const defaultSongMode = getDefaultPresentationSongMode(presentationLayout);
  const songMode = songModeOverride || defaultSongMode;
  const songZoomScale = getSongZoomScale(songZoomLevel);
  const slides = useMemo(
    () => service ? buildServicePresentationSlides(service, { layout: presentationLayout, songMode, workspace }) : [],
    [presentationLayout, service, songMode, workspace],
  );
  const runSteps = useMemo(() => buildPresentationRunSteps(slides, songMode), [slides, songMode]);
  const liveRunSteps = useMemo(() => {
    const partCounts = new Map<string, number>();
    return runSteps.map((step) => {
      const stepId = step.sectionSequenceId;
      const key = `${step.itemId}::${stepId || "cue"}`;
      const partIndex = partCounts.get(key) || 0;
      partCounts.set(key, partIndex + 1);
      return { itemId: step.itemId, stepId, partIndex, sectionAnchorId: step.sectionAnchorId };
    });
  }, [runSteps]);
  const preferredLiveView: PresentationPrivateLiveView = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER" ? "operator" : "remote";
  const offlineContext = useMemo(() => {
    const itemSecondsById = Object.fromEntries((service?.items || []).map((item) => [item.id, Math.max(0, Number(item.duration || 0) * 60)]));
    return {
      steps: liveRunSteps,
      plannedTiming: {
        serviceSeconds: Object.values(itemSecondsById).reduce((sum, seconds) => sum + seconds, 0),
        itemSecondsById,
      },
    };
  }, [liveRunSteps, service?.items]);
  const live = usePresentationLive({
    serviceId: id,
    preferredView: preferredLiveView,
    churchId: selectedChurch?.id,
    accountId: authenticatedUserId,
    offlineContext,
    enabled: Boolean(id && selectedChurch?.id && authenticatedUserId),
  });
  const authoritativePrivateViewer = live.snapshot?.viewer.view !== "audience" ? live.snapshot?.viewer : null;
  const workspaceScopeMismatch = Boolean(
    workspace
    && authoritativePrivateViewer
    && !presentationWorkspaceMatchesLiveViewer(workspace, authoritativePrivateViewer),
  );
  const verifiedReplacementPackage = Boolean(
    live.presentationPackage
    && authoritativePrivateViewer
    && id
    && selectedChurch?.id
    && authenticatedUserId
    && presentationPackageMatchesLiveViewer(live.presentationPackage, authoritativePrivateViewer, {
      accountId: authenticatedUserId,
      churchId: selectedChurch.id,
      serviceId: id,
    }),
  );
  const packageMatchesCurrentIdentity = Boolean(
    live.presentationPackage
    && id
    && selectedChurch?.id
    && authenticatedUserId
    && live.presentationPackage.scope.accountId === authenticatedUserId
    && live.presentationPackage.scope.churchId === selectedChurch.id
    && live.presentationPackage.service.id === id
  );
  const localCanPresent = canUseServicePresentation(service, selectedChurch?.role, currentUserId, currentUserEmail);
  const canPresent = Boolean(live.snapshot || live.presentationPackage) || canEnterPresentationWorkspace(workspace, localCanPresent);
  const safeStepIndex = runSteps.length ? Math.min(activeStepIndex, runSteps.length - 1) : 0;
  const currentStep = runSteps[safeStepIndex];
  const nextStep = runSteps[safeStepIndex + 1] || null;
  const currentSlide = currentStep ? slides[currentStep.slideIndex] : null;
  const contentAudienceSlides = useMemo(() => slides.flatMap((slide) => slide.kind === "content" ? [slide.audienceSlide] : []), [slides]);
  const audiencePlayback = live.snapshot?.session?.playback || null;
  const announcementNowMs = useProjectionClock(audiencePlayback?.kind === "announcement" && audiencePlayback.status === "playing");
  const rotatedAnnouncementSlideId = resolvePresentationAnnouncementSlideId(
    contentAudienceSlides,
    audiencePlayback,
    live.snapshot?.serverNow || new Date().toISOString(),
    live.snapshot?.receivedAtMs || Date.now(),
    announcementNowMs,
    currentSlide?.itemId,
  );
  const stageCurrentSlide = currentSlide?.kind === "content" && currentSlide.audienceSlide.kind === "announcement" && rotatedAnnouncementSlideId
    ? slides.find((slide) => slide.kind === "content" && slide.id === rotatedAnnouncementSlideId) || currentSlide
    : currentSlide;
  const currentWorkspaceItem = currentStep ? getWorkspaceItem(workspace, currentStep.itemId) : null;
  const viewerRoles = useMemo(
    () => authoritativePrivateViewer?.roles || workspace?.viewer.roles || [],
    [authoritativePrivateViewer?.roles, workspace?.viewer.roles],
  );
  const viewerCanEdit = authoritativePrivateViewer?.canEdit ?? workspace?.viewer.canEdit ?? false;
  const stageRole = presentationStageRoleForViewer(viewerRoles, viewerCanEdit);
  const scopedViewerLayout = live.snapshot?.viewerLayout?.targetRole === stageRole ? live.snapshot.viewerLayout : null;
  const stageLayout = outputConfig?.resolvedRoleLayouts[stageRole] || scopedViewerLayout || DEFAULT_PRESENTATION_STAGE_LAYOUTS[stageRole];
  const effectiveShowChords = stageLayout.show.chords && showChords;
  const audiencePreviewSlide = useMemo(() => buildAudiencePreviewSlide(stageCurrentSlide), [stageCurrentSlide]);
  const stageCountdownDuration = stageCurrentSlide?.kind === "content" && stageCurrentSlide.audienceSlide.kind === "countdown"
    ? stageCurrentSlide.audienceSlide.durationSeconds
    : 0;
  const localContentClock = useMemo(() => {
    const receivedAtMs = Date.now();
    return {
      slideId: stageCurrentSlide?.id || "",
      receivedAtMs,
      serverNow: new Date(receivedAtMs).toISOString(),
      targetAt: stageCountdownDuration ? new Date(receivedAtMs + stageCountdownDuration * 1_000).toISOString() : "",
    };
  }, [stageCountdownDuration, stageCurrentSlide?.id]);
  const stageCountdown = useMemo(() => {
    if (!stageCountdownDuration) return null;
    if (live.snapshot?.session) {
      const authoritativeCountdown = live.timing?.countdown || live.snapshot.session.timing.countdown;
      return authoritativeCountdown ? {
        durationSeconds: authoritativeCountdown.durationSeconds,
        targetAt: authoritativeCountdown.targetAt,
      } : null;
    }
    return {
      durationSeconds: stageCountdownDuration,
      targetAt: localContentClock.targetAt,
    };
  }, [live.snapshot?.session, live.timing?.countdown, localContentClock.targetAt, stageCountdownDuration]);
  const stageAnnotations = useMemo(() => {
    if (!currentWorkspaceItem) return [];
    return currentWorkspaceItem.annotations.filter((annotation) =>
      !currentWorkspaceItem.reconciliation.unresolvedAnnotationIds.includes(annotation.id) &&
      (annotation.sectionAnchorId === null || annotation.sectionAnchorId === currentStep?.sectionAnchorId) &&
      isPresentationAnnotationVisible(annotation, "stage", viewerRoles, viewerCanEdit)
    );
  }, [currentStep?.sectionAnchorId, currentWorkspaceItem, viewerCanEdit, viewerRoles]);
  const operatorAnnotations = useMemo(() => {
    if (!currentWorkspaceItem) return [];
    return currentWorkspaceItem.annotations.filter((annotation) =>
      !currentWorkspaceItem.reconciliation.unresolvedAnnotationIds.includes(annotation.id) &&
      (annotation.sectionAnchorId === null || annotation.sectionAnchorId === currentStep?.sectionAnchorId) &&
      isPresentationAnnotationVisible(annotation, "operator", viewerRoles, viewerCanEdit)
    );
  }, [currentStep?.sectionAnchorId, currentWorkspaceItem, viewerCanEdit, viewerRoles]);
  const currentLegacyNotes = useMemo(
    () => [...new Set([...(workspace?.legacyNotes || []), ...(currentWorkspaceItem?.legacyNotes || [])])],
    [currentWorkspaceItem?.legacyNotes, workspace?.legacyNotes],
  );
  const effectiveSurface = surface === "remote" ? "remote" : isTabletPresentation ? (stageLayout.mode === "production" ? "operator" : surface) : "stage";
  const liveControllerOwned = Boolean(live.snapshot?.session?.controller?.ownedByViewer && live.controllerLeaseActive);
  const liveCanMutate = liveControllerOwned && !live.commandPending && live.networkState !== "diverged";

  useEffect(() => {
    if (!workspaceScopeMismatch || !verifiedReplacementPackage || !live.presentationPackage) return;
    setService(live.presentationPackage.service);
    setWorkspace(live.presentationPackage.presentation);
    setLoadError(null);
    setLoading(false);
  }, [live.presentationPackage, verifiedReplacementPackage, workspaceScopeMismatch]);

  useEffect(() => {
    const cached = live.presentationPackage;
    if (!cached || !packageMatchesCurrentIdentity || (service && live.networkState === "online")) return;
    setService(cached.service);
    setWorkspace(cached.presentation);
    setLoadError(null);
    setLoading(false);
  }, [live.networkState, live.presentationPackage, packageMatchesCurrentIdentity, service]);

  useEffect(() => {
    const liveSession = live.snapshot?.session;
    if (!liveSession) return;
    setActiveStepIndex(resolvePresentationCursorIndex(liveSession.cursor, liveRunSteps));
    setBlackout(liveSession.display.blackout);
    setShowChords(liveSession.display.chordsVisible);
  }, [live.snapshot?.session, liveRunSteps]);

  useEffect(() => {
    if (surfaceInitializedRef.current || live.loading) return;
    if (live.snapshot) {
      surfaceInitializedRef.current = true;
      if (!isTabletPresentation && live.snapshot.viewer.canControl) setSurface("remote");
      else if (isTabletPresentation && live.activeView === "operator") setSurface("operator");
      else setSurface("stage");
      return;
    }
    if (workspace) {
      surfaceInitializedRef.current = true;
      const canOperate = workspace.viewer.canEdit || workspace.viewer.roles.includes("operator");
      setSurface(isTabletPresentation && canOperate ? "operator" : "stage");
    }
  }, [isTabletPresentation, live.activeView, live.loading, live.snapshot, workspace]);

  useEffect(() => {
    if (!runSteps.length) {
      setActiveStepIndex(0);
      return;
    }
    if (activeStepIndex > runSteps.length - 1) setActiveStepIndex(runSteps.length - 1);
  }, [activeStepIndex, runSteps.length]);

  function goToStep(index: number, recordHistory = true) {
    const nextIndex = Math.max(0, Math.min(index, Math.max(runSteps.length - 1, 0)));
    if (nextIndex === safeStepIndex) return;
    if (live.snapshot?.session) {
      if (!liveCanMutate) return;
      const target = runSteps[nextIndex];
      const liveTarget = liveRunSteps[nextIndex];
      if (target && liveTarget) void live.sendCommand("jump", { itemId: target.itemId, stepId: liveTarget.stepId, partIndex: liveTarget.partIndex }).catch(() => undefined);
      return;
    }
    if (recordHistory && currentStep) {
      historyRef.current = [...historyRef.current.slice(-29), currentStep.id];
      setHistoryCount(historyRef.current.length);
    }
    setActiveStepIndex(nextIndex);
  }

  function goNext() {
    if (live.snapshot?.session) {
      if (liveCanMutate && safeStepIndex < runSteps.length - 1) {
        const targetLiveStep = liveRunSteps[safeStepIndex + 1];
        if (targetLiveStep) {
          void live.sendCommand("jump", { itemId: targetLiveStep.itemId, stepId: targetLiveStep.stepId, partIndex: targetLiveStep.partIndex }).catch(() => undefined);
        } else {
          void live.sendCommand("next", {}).catch(() => undefined);
        }
      }
      return;
    }
    goToStep(safeStepIndex + 1);
  }

  function goPrevious() {
    if (live.snapshot?.session) {
      if (liveCanMutate && safeStepIndex > 0) {
        const targetLiveStep = liveRunSteps[safeStepIndex - 1];
        if (targetLiveStep) {
          void live.sendCommand("jump", { itemId: targetLiveStep.itemId, stepId: targetLiveStep.stepId, partIndex: targetLiveStep.partIndex }).catch(() => undefined);
        } else {
          void live.sendCommand("previous", {}).catch(() => undefined);
        }
      }
      return;
    }
    goToStep(safeStepIndex - 1);
  }

  function undoNavigation() {
    if (live.snapshot?.session) {
      goPrevious();
      return;
    }
    while (historyRef.current.length) {
      const previousId = historyRef.current.pop();
      const previousIndex = runSteps.findIndex((step) => step.id === previousId);
      if (previousIndex >= 0) {
        setActiveStepIndex(previousIndex);
        break;
      }
    }
    setHistoryCount(historyRef.current.length);
  }

  function toggleBlackout() {
    if (live.snapshot?.session) {
      if (liveCanMutate) void live.sendCommand("set_blackout", { blackout: !blackout }).catch(() => undefined);
      return;
    }
    setBlackout((current) => !current);
  }

  function toggleChords() {
    if (live.snapshot?.session) {
      if (liveCanMutate) void live.sendCommand("set_chords", { chordsVisible: !showChords }).catch(() => undefined);
      return;
    }
    setShowChords((current) => !current);
  }

  keyboardActionsRef.current = {
    goNext,
    goPrevious,
    undo: undoNavigation,
    toggleBlackout,
    exit: () => navigate(`/app/services/${id}`),
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("input, textarea, select, [role=dialog]") || target.isContentEditable)) return;
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        keyboardActionsRef.current.goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        keyboardActionsRef.current.goPrevious();
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        keyboardActionsRef.current.toggleBlackout();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        keyboardActionsRef.current.undo();
      } else if (event.key === "Escape") {
        keyboardActionsRef.current.exit();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function changeSongMode(nextMode: PresentationSongMode) {
    setSongModeOverride(nextMode);
    if (!service || !currentStep) {
      setActiveStepIndex(0);
      return;
    }
    const nextSlides = buildServicePresentationSlides(service, { layout: presentationLayout, songMode: nextMode, workspace });
    const nextSteps = buildPresentationRunSteps(nextSlides, nextMode);
    const nextIndex = nextSteps.findIndex((step) =>
      step.itemId === currentStep.itemId &&
      (step.sectionAnchorId === currentStep.sectionAnchorId || !currentStep.sectionAnchorId)
    );
    setActiveStepIndex(nextIndex >= 0 ? nextIndex : 0);
    historyRef.current = [];
    setHistoryCount(0);
  }

  function changeSongZoom(delta: number) {
    setSongZoomLevel((current) => Math.max(MIN_SONG_ZOOM_LEVEL, Math.min(MAX_SONG_ZOOM_LEVEL, current + delta)));
  }

  function handlePhoneStageClick(event: MouseEvent<HTMLDivElement>) {
    if (swipeHandledRef.current) {
      swipeHandledRef.current = false;
      return;
    }
    if (event.clientX >= window.innerWidth / 2) goNext();
    else goPrevious();
  }

  function suppressNextTabletClick() {
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 350);
  }

  function handleTabletPointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  }

  function handleTabletPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) suppressNextTabletClick();
  }

  function handleStageClick(event: MouseEvent<HTMLDivElement>) {
    if (isTabletPresentation) {
      if (suppressClickRef.current) suppressClickRef.current = false;
      else goNext();
      return;
    }
    handlePhoneStageClick(event);
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (!isTabletPresentation) touchStartXRef.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (isTabletPresentation) return;
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    touchStartXRef.current = null;
    if (startX === null || endX === null || Math.abs(endX - startX) < 48) return;
    swipeHandledRef.current = true;
    if (endX < startX) goNext();
    else goPrevious();
  }

  async function saveWorkspaceItem(item: PresentationWorkspaceItem) {
    if (!service) return;
    setSavingWorkspace(true);
    setWorkspaceNotice(null);
    try {
      await savePresentationWorkspaceItem(service.id, item);
      const refreshed = await fetchPresentationWorkspace(service, "editor", selectedChurch?.role);
      setWorkspace(refreshed);
      setWorkspaceNotice("Arreglo y notas guardados.");
      setShowEditor(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await fetchPresentationWorkspace(service, "editor", selectedChurch?.role).catch(() => null);
        if (refreshed) setWorkspace(refreshed);
        setWorkspaceNotice("Otra persona actualizó esta canción. Recargamos la versión más reciente para que revises tus cambios.");
        setShowEditor(false);
      } else {
        setWorkspaceNotice(error instanceof Error ? error.message : "No se pudieron guardar las notas.");
      }
    } finally {
      setSavingWorkspace(false);
    }
  }

  function stopStageEvent(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  const exitToService = () => navigate(`/app/services/${id}`);

  if (live.error || loadError) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-svh items-center justify-center bg-[#050508] p-6 text-white">
        <div className="max-w-md rounded-[2rem] border border-white/10 bg-white/[0.05] p-8 text-center"><X className="mx-auto mb-4 h-9 w-9 text-red-300" /><h1 className="text-2xl font-black">No se pudo abrir la presentación</h1><p className="mt-2 text-slate-300">{live.error || loadError}</p><Button className="mt-6 min-h-11 rounded-2xl" onClick={() => navigate("/app/services")}>Volver a servicios</Button></div>
      </div>
    );
  }

  if (loading || live.loading || workspaceScopeMismatch) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-svh items-center justify-center bg-[#050508] text-white">
        <div className="flex flex-col items-center gap-4"><Loader2 className="h-9 w-9 animate-spin text-violet-300" /><p className="text-sm font-bold uppercase tracking-[0.24em] text-slate-400">Preparando Tchurch Live</p></div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-svh items-center justify-center bg-[#050508] p-6 text-white">
        <div className="max-w-md rounded-[2rem] border border-white/10 bg-white/[0.05] p-8 text-center"><X className="mx-auto mb-4 h-9 w-9 text-red-300" /><h1 className="text-2xl font-black">No se pudo abrir la presentación</h1><p className="mt-2 text-slate-300">Servicio no encontrado.</p><Button className="mt-6 min-h-11 rounded-2xl" onClick={() => navigate("/app/services")}>Volver a servicios</Button></div>
      </div>
    );
  }

  if (!canPresent) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-svh items-center justify-center bg-[#050508] p-6 text-white">
        <div className="max-w-lg rounded-[2rem] border border-white/10 bg-white/[0.05] p-8 text-center"><EyeOff className="mx-auto mb-4 h-10 w-10 text-violet-200" /><h1 className="text-3xl font-black">Presentación no disponible</h1><p className="mt-3 text-slate-300">Solo administradores, planificadores o músicos asignados pueden abrir este modo para el servicio.</p><Button className="mt-6 min-h-11 rounded-2xl" onClick={exitToService}>Volver al servicio</Button></div>
      </div>
    );
  }

  const stageOutput = (
    <div
      className="relative h-full min-h-0 overflow-hidden"
      onClick={handleStageClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onPointerDown={isTabletPresentation ? handleTabletPointerDown : undefined}
      onPointerUp={isTabletPresentation ? handleTabletPointerUp : undefined}
      onPointerCancel={isTabletPresentation ? suppressNextTabletClick : undefined}
    >
      {stageLayout.show.messages ? <PresentationStageMessages messages={live.messages} canDismiss={liveCanMutate} onCommand={live.sendCommand} /> : null}
      {runSteps.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center"><div><Music className="mx-auto mb-4 h-12 w-12 text-violet-200" /><h1 className="text-3xl font-black">Este servicio todavía no tiene elementos.</h1><p className="mt-2 text-slate-300">Agrega canciones o cues antes de abrirlo en modo presentación.</p></div></div>
      ) : !stageLayout.show.current ? (
        <div className="flex h-full items-center justify-center px-6 text-center"><div><EyeOff className="mx-auto mb-4 h-10 w-10 text-slate-600" /><p className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Contenido actual oculto en esta vista</p></div></div>
      ) : stageCurrentSlide?.kind === "song" ? (
        <SongSlide slide={stageCurrentSlide} showChords={effectiveShowChords} layout={presentationLayout} songMode={songMode} zoomScale={songZoomScale * stageLayout.fontScale} activeSequenceId={currentStep?.sectionSequenceId} stageMode={stageLayout.mode} />
      ) : stageCurrentSlide?.kind === "content" ? (
        <PresentationAudienceOutput
          slide={stageCurrentSlide.audienceSlide}
          theme={outputConfig?.resolvedTheme}
          blackout={false}
          playback={live.snapshot?.session?.playback || null}
          countdown={stageCurrentSlide.audienceSlide.kind === "countdown" ? stageCountdown : null}
          serverNow={live.snapshot?.serverNow || localContentClock.serverNow}
          receivedAtMs={live.snapshot?.receivedAtMs || localContentClock.receivedAtMs}
          authoritativePlayback={Boolean(live.snapshot?.session)}
          showPlaybackRecovery
          embedded
          fontScale={stageLayout.fontScale}
        />
      ) : stageCurrentSlide?.kind === "cue" ? (
        <CueSlide slide={stageCurrentSlide} fontScale={stageLayout.fontScale} mode={stageLayout.mode} showNotes={stageLayout.show.notes} />
      ) : null}
      {blackout && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black" onClick={stopStageEvent}>
          <div className="text-center"><EyeOff className="mx-auto h-9 w-9 text-slate-600" /><p className="mt-3 text-xs font-black uppercase tracking-[0.22em] text-slate-600">Salida en negro</p></div>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex min-h-svh flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,#2f1e6a_0%,#090912_34%,#020204_100%)] text-white" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_35%,rgba(124,58,237,0.12))]" />

      <header className="relative z-40 flex min-h-16 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3 py-2 sm:px-5" onClick={stopStageEvent}>
        <Button variant="ghost" className="h-11 shrink-0 rounded-xl border border-white/10 bg-white/[0.08] px-3 font-bold text-white hover:bg-white/[0.15] hover:text-white" onClick={exitToService}><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Salir</span></Button>
        <div className="hidden min-w-0 flex-1 sm:block"><p className="truncate text-sm font-black">{service.title}</p><p className="truncate text-[10px] text-slate-400">{formatServiceDate(service.date)}</p></div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {workspace?.viewer.canEdit && <Button variant="ghost" aria-label="Configurar salida congregacional" className="h-11 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 text-amber-100 hover:bg-amber-300/15 hover:text-amber-50" onClick={() => setShowOutputManager(true)}><MonitorPlay className="h-4 w-4" /><span className="hidden lg:inline">Salida</span></Button>}
          {workspace?.viewer.canEdit && <Button variant="ghost" aria-label="Preparar presentación" className="hidden h-11 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-white hover:bg-white/[0.15] hover:text-white md:flex" onClick={() => setShowEditor(true)}><Settings2 className="h-4 w-4" /><span className="hidden lg:inline">Preparar</span></Button>}
          <Button
            variant="ghost"
            aria-label={blackout ? "Restaurar salida de presentación" : "Poner salida de presentación en negro"}
            aria-pressed={blackout}
            className={`h-11 rounded-xl border px-2 text-[11px] font-black text-white hover:text-white sm:px-3 sm:text-xs ${blackout ? "border-red-400/60 bg-red-500/30 hover:bg-red-500/40" : "border-white/10 bg-black/70 hover:bg-black"}`}
            disabled={Boolean(live.snapshot?.session) && !liveCanMutate}
            onClick={toggleBlackout}
          >{blackout ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}<span>{blackout ? "Restaurar" : "Salida en negro"}</span></Button>
          <Button variant="ghost" className="hidden h-11 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-white hover:bg-white/[0.15] hover:text-white sm:flex" disabled={live.snapshot?.session ? !liveCanMutate || safeStepIndex === 0 : !historyCount} onClick={undoNavigation}><Undo2 className="h-4 w-4" /><span className="hidden xl:inline">Atrás</span></Button>
          {currentSlide?.kind === "song" && stageLayout.show.chords && <Button
            variant="ghost"
            aria-label={showChords ? "Ocultar acordes" : "Mostrar acordes"}
            aria-pressed={showChords}
            className={`h-11 min-w-[5.5rem] rounded-xl border px-2 text-xs font-black text-white hover:text-white sm:px-3 ${showChords ? "border-emerald-300/25 bg-emerald-300/10 hover:bg-emerald-300/15" : "border-white/10 bg-white/[0.05] hover:bg-white/10"}`}
            disabled={Boolean(live.snapshot?.session) && !liveCanMutate}
            onClick={toggleChords}
          >{showChords ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}<span>Acordes</span><span className="text-[9px] opacity-70">{showChords ? "sí" : "no"}</span></Button>}
          {stageLayout.show.clock ? <div className="flex h-11 min-w-14 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.08] px-2 text-xs font-black tabular-nums sm:px-3"><Clock3 className="hidden h-4 w-4 text-violet-200 sm:block" /><span><span className="block leading-none">{clock}</span><span className="mt-1 block text-center text-[8px] leading-none text-slate-400 sm:hidden">{runSteps.length ? safeStepIndex + 1 : 0}/{runSteps.length}</span></span></div> : null}
          <div className="hidden h-11 items-center rounded-xl border border-white/10 bg-white/[0.08] px-3 text-xs font-black tabular-nums sm:flex">{runSteps.length ? safeStepIndex + 1 : 0}/{runSteps.length}</div>
        </div>
      </header>

      <div className="relative z-40 flex min-h-12 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-black/20 px-3 py-1.5 sm:px-5" onClick={stopStageEvent}>
        <LiveConnectionBadge networkState={live.networkState} queueCount={live.offlineQueueCount} />
        <div className="hidden min-w-0 flex-1 lg:block"><PresentationOwnershipControls snapshot={live.snapshot} controllerLeaseActive={live.controllerLeaseActive} pending={live.commandPending} onCommand={live.sendCommand} compact /></div>
        <div className="ml-auto flex h-11 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06]">
          {isTabletPresentation && <button type="button" aria-pressed={effectiveSurface === "operator"} className={`min-w-20 px-3 text-xs font-black ${effectiveSurface === "operator" ? "bg-violet-500 text-white" : "text-slate-300"}`} onClick={() => setSurface("operator")}>Operador</button>}
          <button type="button" aria-pressed={effectiveSurface === "stage"} className={`min-w-20 border-l border-white/10 px-3 text-xs font-black ${effectiveSurface === "stage" ? "bg-violet-500 text-white" : "text-slate-300"}`} onClick={() => setSurface("stage")}>Escenario</button>
          {live.snapshot?.viewer.canControl && <button type="button" aria-pressed={effectiveSurface === "remote"} className={`min-w-20 border-l border-white/10 px-3 text-xs font-black ${effectiveSurface === "remote" ? "bg-violet-500 text-white" : "text-slate-300"}`} onClick={() => setSurface("remote")}>Control</button>}
        </div>
      </div>

      {workspaceNotice && (
        <div className="relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-100" onClick={stopStageEvent}>
          <span className="truncate">{workspaceNotice}</span><button type="button" className="min-h-11 shrink-0 rounded-xl px-3 font-black" onClick={() => setWorkspaceNotice(null)}>Cerrar</button>
        </div>
      )}

      <PresentationLiveNotice
        notice={live.notice}
        networkState={live.networkState}
        queueCount={live.offlineQueueCount}
        onClose={live.clearNotice}
        onReconcile={live.reconcileOffline}
        onDiscard={live.discardOfflineChanges}
      />

      {currentSlide?.kind === "song" && (
        <div className="relative z-30 flex shrink-0 items-center justify-center gap-2 border-b border-white/[0.05] px-3 py-2" onClick={stopStageEvent}>
          <div className="flex h-11 overflow-hidden rounded-xl border border-white/10 bg-white/[0.08]">
            <Button type="button" variant="ghost" aria-pressed={songMode === "scroll"} className={`h-11 rounded-none px-3 text-xs font-black text-white hover:text-white ${songMode === "scroll" ? "bg-violet-500 hover:bg-violet-500" : "hover:bg-white/10"}`} onClick={() => changeSongMode("scroll")}>Hoja</Button>
            <Button type="button" variant="ghost" aria-pressed={songMode === "paged"} className={`h-11 rounded-none border-l border-white/10 px-3 text-xs font-black text-white hover:text-white ${songMode === "paged" ? "bg-violet-500 hover:bg-violet-500" : "hover:bg-white/10"}`} onClick={() => changeSongMode("paged")}>Slides</Button>
          </div>
          <div className="flex h-11 items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.08]">
            <Button type="button" variant="ghost" aria-label="Reducir letra" className="h-11 w-11 rounded-none text-white hover:bg-white/10 hover:text-white" disabled={songZoomLevel <= MIN_SONG_ZOOM_LEVEL} onClick={() => changeSongZoom(-1)}><Minus className="h-4 w-4" /></Button>
            <span className="min-w-12 text-center text-xs font-black tabular-nums">{Math.round(songZoomScale * 100)}%</span>
            <Button type="button" variant="ghost" aria-label="Aumentar letra" className="h-11 w-11 rounded-none text-white hover:bg-white/10 hover:text-white" disabled={songZoomLevel >= MAX_SONG_ZOOM_LEVEL} onClick={() => changeSongZoom(1)}><Plus className="h-4 w-4" /></Button>
          </div>
          <Button type="button" variant="ghost" className="h-11 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-white hover:bg-white/[0.15] hover:text-white sm:hidden" onClick={() => setShowRundown(true)}><ListMusic className="h-4 w-4" /><span className="sr-only">Abrir orden</span></Button>
        </div>
      )}

      {effectiveSurface === "stage" && live.timing && (stageLayout.show.serviceTimer || stageLayout.show.itemTimer) && (
        <div className="relative z-30 grid shrink-0 border-b border-white/[0.06] bg-black/25" style={{ gridTemplateColumns: `repeat(${Number(stageLayout.show.serviceTimer) + (stageLayout.show.itemTimer ? 2 : 0)}, minmax(0, 1fr))` }} role="timer" aria-label="Tiempos del servicio">
          {stageLayout.show.serviceTimer ? <div className="px-3 py-2 text-center"><span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Servicio</span><span className={`mt-0.5 block text-sm font-black tabular-nums ${live.timing.service.overrunSeconds ? "text-red-300" : "text-white"}`}>{live.timing.service.overrunSeconds ? `+${formatLiveDuration(live.timing.service.overrunSeconds)}` : formatLiveDuration(live.timing.service.elapsedSeconds)}</span></div> : null}
          {stageLayout.show.itemTimer ? <div className="border-x border-white/[0.06] px-3 py-2 text-center"><span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Elemento</span><span className={`mt-0.5 block text-sm font-black tabular-nums ${live.timing.item.overrunSeconds ? "text-red-300" : "text-white"}`}>{live.timing.item.overrunSeconds ? `+${formatLiveDuration(live.timing.item.overrunSeconds)}` : formatLiveDuration(live.timing.item.elapsedSeconds)}</span></div> : null}
          {stageLayout.show.itemTimer ? <div className="px-3 py-2 text-center"><span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Cuenta</span><span className={`mt-0.5 block text-sm font-black tabular-nums ${live.timing.countdown && live.timing.countdown.remainingSeconds <= 10 ? "text-amber-200" : "text-white"}`}>{live.timing.countdown ? formatLiveDuration(live.timing.countdown.remainingSeconds) : "—"}</span></div> : null}
        </div>
      )}

      {effectiveSurface === "remote" ? (
        <PresentationRemoteSurface
          snapshot={live.snapshot}
          activeView={live.activeView}
          controllerLeaseActive={live.controllerLeaseActive}
          timing={live.timing}
          steps={runSteps}
          liveSteps={liveRunSteps}
          activeIndex={safeStepIndex}
          nextLabel={nextStep?.sectionLabel || nextStep?.title || "Fin del servicio"}
          blackout={blackout}
          chordsVisible={showChords}
          pending={live.commandPending || live.networkState === "diverged"}
          onCommand={live.sendCommand}
        />
      ) : effectiveSurface === "operator" ? (
        <main className="relative z-10 grid min-h-0 flex-1 grid-cols-[12rem_minmax(20rem,1fr)_15rem] overflow-hidden xl:grid-cols-[16rem_minmax(0,1fr)_19rem]">
          <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-black/20 p-3" onClick={stopStageEvent}>
            <div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Orden</p><p className="text-sm font-black">Servicio</p></div><Badge className="rounded-lg bg-white/10 text-white hover:bg-white/10">{runSteps.length}</Badge></div>
            <RundownList steps={runSteps} activeIndex={safeStepIndex} onSelect={goToStep} />
          </aside>
          <section className="min-h-0 overflow-hidden border-r border-white/10 bg-black/15">{stageOutput}</section>
          <aside className="min-h-0 overflow-y-auto bg-black/20 p-4" onClick={stopStageEvent}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Ahora</p><h2 className="mt-1 truncate text-lg font-black">{currentStep?.sectionLabel || currentStep?.title || "Sin contenido"}</h2><p className="truncate text-xs text-slate-400">{currentStep?.title}</p></div>{stageLayout.show.clock ? <span className="text-lg font-black tabular-nums text-white">{clock}</span> : null}</div>
            <div className="mt-3"><PresentationOwnershipControls snapshot={live.snapshot} controllerLeaseActive={live.controllerLeaseActive} pending={live.commandPending} onCommand={live.sendCommand} /></div>
            {currentSlide?.kind === "content" && (currentSlide.audienceSlide.kind === "video" || currentSlide.audienceSlide.kind === "audio" || currentSlide.audienceSlide.kind === "announcement") ? (
              <PresentationMediaControls
                slide={currentSlide}
                playback={live.snapshot?.session?.playback || null}
                serverNow={live.snapshot?.serverNow || new Date().toISOString()}
                receivedAtMs={live.snapshot?.receivedAtMs || Date.now()}
                pending={live.commandPending}
                canControl={liveCanMutate && live.networkState === "online"}
                onPlay={(positionMs) => { const media = currentSlide.audienceSlide; if (media.kind === "video" || media.kind === "audio" || media.kind === "announcement") void live.sendCommand("media_play", { itemId: currentSlide.itemId, slideId: media.id, kind: media.kind, positionMs: Math.round(positionMs), loop: media.loop }).catch(() => undefined); }}
                onPause={() => { void live.sendCommand("media_pause", {}).catch(() => undefined); }}
                onSeek={(positionMs) => { void live.sendCommand("media_seek", { positionMs: Math.round(positionMs) }).catch(() => undefined); }}
                onRestart={() => { void live.sendCommand("media_restart", {}).catch(() => undefined); }}
                onStop={() => { void live.sendCommand("media_stop", {}).catch(() => undefined); }}
              />
            ) : null}
            {stageLayout.show.next ? <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.05] p-3"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Siguiente</p><p className="mt-1 truncate text-sm font-black">{nextStep?.sectionLabel || nextStep?.title || "Fin del servicio"}</p><p className="truncate text-xs text-slate-400">{nextStep?.title}</p></div> : null}
            {(stageLayout.show.serviceTimer || stageLayout.show.itemTimer) ? <div className="mt-4"><PresentationTimingPanel timing={live.timing} canControl={liveCanMutate} pending={live.commandPending} onCommand={live.sendCommand} compact /></div> : null}
            {stageLayout.show.notes ? <div className="mt-4"><p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Notas del equipo</p><AnnotationList annotations={operatorAnnotations} emptyLabel="Sin indicaciones en este momento." /></div> : null}
            {stageLayout.show.notes && currentLegacyNotes.length ? <div className="mt-4 space-y-2"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Notas anteriores</p>{currentLegacyNotes.map((note, index) => <p key={`${note}-${index}`} className="rounded-xl bg-white/[0.05] p-3 text-xs leading-5 text-slate-300">{note}</p>)}</div> : null}
            <div className="sticky bottom-0 mt-5 grid grid-cols-[3rem_minmax(0,1fr)_3rem] gap-2 bg-[#08070d]/95 py-3">
              <Button variant="ghost" className="h-12 rounded-xl bg-white/10 text-white hover:bg-white/15 hover:text-white" disabled={safeStepIndex === 0 || Boolean(live.snapshot?.session) && !liveCanMutate} onClick={goPrevious}><ChevronLeft className="h-5 w-5" /></Button>
              <Button className="h-12 rounded-xl bg-violet-500 font-black hover:bg-violet-400" disabled={safeStepIndex >= runSteps.length - 1 || Boolean(live.snapshot?.session) && !liveCanMutate} onClick={goNext}>Siguiente</Button>
              <Button variant="ghost" aria-label="Abrir control remoto" className="h-12 rounded-xl bg-white/10 text-white hover:bg-white/15 hover:text-white" onClick={() => setSurface("remote")}><Settings2 className="h-5 w-5" /></Button>
            </div>
          </aside>
        </main>
      ) : (
        <main className={`relative z-10 grid min-h-0 flex-1 overflow-hidden ${isTabletPresentation ? "grid-cols-[minmax(0,1fr)_15rem] xl:grid-cols-[minmax(0,1fr)_18rem]" : "grid-cols-1"}`}>
          <section className="min-h-0 overflow-hidden">{stageOutput}</section>
          {isTabletPresentation && (
            <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-black/25 p-4" onClick={stopStageEvent}>
              <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">Ahora</p><h2 className="mt-1 text-xl font-black">{currentStep?.sectionLabel || currentStep?.title}</h2></div>{stageLayout.show.clock ? <span className="text-lg font-black tabular-nums">{clock}</span> : null}</div>
              {stageLayout.show.next ? <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.05] p-3"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Siguiente</p><p className="mt-1 text-sm font-black">{nextStep?.sectionLabel || nextStep?.title || "Fin del servicio"}</p></div> : null}
              {stageLayout.show.notes ? <div className="mt-4"><p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Para ti</p><AnnotationList annotations={stageAnnotations} emptyLabel="Sin notas en esta sección." /></div> : null}
              {stageLayout.show.notes && currentLegacyNotes.length ? <div className="mt-4 space-y-2"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Notas anteriores</p>{currentLegacyNotes.map((note, index) => <p key={`${note}-${index}`} className="rounded-xl bg-white/[0.05] p-3 text-xs leading-5 text-slate-300">{note}</p>)}</div> : null}
              <Button variant="outline" className="mt-4 h-11 w-full rounded-xl border-white/10 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white" onClick={() => setShowRundown(true)}><ListMusic className="h-4 w-4" /> Salto rápido</Button>
            </aside>
          )}
        </main>
      )}

      {effectiveSurface === "stage" && (
        <footer className="relative z-30 flex shrink-0 items-center gap-2 border-t border-white/[0.07] px-3 py-2 sm:px-5" onClick={stopStageEvent}>
          <Button variant="ghost" className="h-12 w-12 shrink-0 rounded-xl bg-white/10 text-white hover:bg-white/15 hover:text-white" disabled={safeStepIndex === 0 || Boolean(live.snapshot?.session) && !liveCanMutate} onClick={goPrevious}><ChevronLeft className="h-5 w-5" /></Button>
          <button type="button" aria-label="Abrir salto rápido" className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-center" onClick={() => setShowRundown(true)}>
            {stageLayout.show.next ? <><span className="block truncate text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Siguiente</span><span className="block truncate text-sm font-black text-white">{nextStep?.sectionLabel || nextStep?.title || "Fin del servicio"}</span></> : null}
            {!isTabletPresentation && stageLayout.show.notes && (stageAnnotations[0]?.body || currentLegacyNotes[0]) ? <span className="mt-0.5 block truncate text-[10px] font-semibold text-amber-200">{stageAnnotations[0]?.body || currentLegacyNotes[0]}</span> : null}
            {!stageLayout.show.next && (!stageLayout.show.notes || !(stageAnnotations[0]?.body || currentLegacyNotes[0])) ? <ListMusic aria-hidden="true" className="mx-auto h-4 w-4 text-slate-500" /> : null}
          </button>
          <Button variant="ghost" className="h-12 w-12 shrink-0 rounded-xl bg-white/10 text-white hover:bg-white/15 hover:text-white" disabled={safeStepIndex >= runSteps.length - 1 || Boolean(live.snapshot?.session) && !liveCanMutate} onClick={goNext}><ChevronRight className="h-5 w-5" /></Button>
        </footer>
      )}

      {showRundown && (
        <div role="dialog" aria-modal="true" aria-label="Salto rápido" className="fixed inset-0 z-[70] flex justify-end bg-black/70" onClick={() => setShowRundown(false)}>
          <aside className="h-full w-full max-w-sm overflow-y-auto border-l border-white/10 bg-[#0b0a11] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]" onClick={stopStageEvent}>
            <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Salto rápido</p><h2 className="text-xl font-black">Orden del servicio</h2></div><Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-white hover:bg-white/10 hover:text-white" onClick={() => setShowRundown(false)}><X className="h-5 w-5" /></Button></div>
            <RundownList steps={runSteps} activeIndex={safeStepIndex} onSelect={(index) => { goToStep(index); setShowRundown(false); }} />
          </aside>
        </div>
      )}

      {workspace && (
        <PresentationWorkspaceEditor open={showEditor} onOpenChange={setShowEditor} service={service} workspace={workspace} saving={savingWorkspace} onSave={saveWorkspaceItem} />
      )}
      {workspace?.viewer.canEdit ? (
        <PresentationOutputManager
          open={showOutputManager}
          onOpenChange={setShowOutputManager}
          serviceId={service.id}
          serviceTitle={service.title}
          previewSlide={audiencePreviewSlide}
          blackout={blackout}
          onConfigChange={setOutputConfig}
        />
      ) : null}
    </div>
  );
}
