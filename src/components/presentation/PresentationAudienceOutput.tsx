import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AudioLines, BookOpen, Radio, TriangleAlert } from "lucide-react";
import {
  DEFAULT_PRESENTATION_THEME,
  formatAudienceCountdown,
  projectPresentationCountdownSeconds,
  projectPresentationPlaybackPosition,
  type PresentationAudienceSlide,
  type PresentationCountdownState,
  type PresentationMediaPlayback,
  type PresentationResolvedTheme,
} from "@/lib/presentationOutput";

export type PresentationAudienceOutputStatus = "loading" | "ready" | "reconnecting" | "ended" | "error";

type PresentationAudienceOutputProps = {
  slide: PresentationAudienceSlide | null;
  theme?: PresentationResolvedTheme | null;
  blackout: boolean;
  playback?: PresentationMediaPlayback | null;
  countdown?: PresentationCountdownState | null;
  serverNow?: string | null;
  receivedAtMs?: number;
  nowMs?: number;
  status?: PresentationAudienceOutputStatus;
  authoritativePlayback?: boolean;
  showPlaybackRecovery?: boolean;
  embedded?: boolean;
  fontScale?: number;
  onMediaError?: (slideId: string) => void;
};

const FONT_STACKS: Record<PresentationResolvedTheme["fontFamily"], string> = {
  sans: '"Avenir Next", "SF Pro Display", ui-sans-serif, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, ui-serif, serif',
  condensed: '"Avenir Next Condensed", "Arial Narrow", ui-sans-serif, sans-serif',
  rounded: '"SF Pro Rounded", "Avenir Next", ui-rounded, sans-serif',
};

const LOGO_POSITION_CLASSES: Record<PresentationResolvedTheme["logo"]["position"], string> = {
  none: "hidden",
  top_left: "left-[max(2rem,4vw)] top-[max(2rem,4vw)]",
  top_right: "right-[max(2rem,4vw)] top-[max(2rem,4vw)]",
  bottom_left: "bottom-[max(2.75rem,5vw)] left-[max(2rem,4vw)]",
  bottom_right: "bottom-[max(2.75rem,5vw)] right-[max(2rem,4vw)]",
};

const COPYRIGHT_POSITION_CLASSES: Record<PresentationResolvedTheme["copyright"]["position"], string> = {
  bottom_left: "left-[max(2rem,4vw)] text-left",
  bottom_center: "left-1/2 -translate-x-1/2 text-center",
  bottom_right: "right-[max(2rem,4vw)] text-right",
};

function colorWithOpacity(color: string, opacity: number) {
  const normalized = color.replace("#", "").slice(0, 6);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function CopyrightLine({ slide, theme }: { slide: PresentationAudienceSlide; theme: PresentationResolvedTheme }) {
  if (!theme.copyright.visible) return null;
  const requiredPieces = slide.kind === "lyrics"
    ? [slide.copyright?.text, slide.copyright?.ccliNumber ? `CCLI ${slide.copyright.ccliNumber}` : null]
    : slide.kind === "scripture"
      ? [slide.passage.copyright]
      : [];
  const content = requiredPieces.filter(Boolean).join(" · ");
  const promotionalContent = slide.kind === "scripture" ? slide.passage.promotionalContent : null;
  if (!content && !promotionalContent) return null;
  return (
    <div className={`absolute bottom-[max(0.75rem,2vw)] z-20 max-w-[88vw] break-words text-[clamp(0.5rem,0.9vw,0.82rem)] font-semibold leading-[1.22] tracking-wide opacity-75 ${COPYRIGHT_POSITION_CLASSES[theme.copyright.position]}`}>
      {content ? <p data-testid="audience-copyright">{content}</p> : null}
      {promotionalContent ? <p className="mt-1 max-w-[68vw] text-[0.82em] leading-tight opacity-70" data-testid="audience-promotion">{promotionalContent}</p> : null}
    </div>
  );
}

function LowerThird({ children, theme }: { children: ReactNode; theme: PresentationResolvedTheme }) {
  if (theme.placement !== "lower_third") return <>{children}</>;
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-[max(2rem,6vw)] pb-[max(4.5rem,9vh)] pt-[max(6rem,18vh)]">
      {children}
    </div>
  );
}

function TitleBlock({ slide }: { slide: PresentationAudienceSlide }) {
  if (!slide.title && !("subtitle" in slide && slide.subtitle)) return null;
  const subtitle = "subtitle" in slide ? slide.subtitle : slide.kind === "lyrics" ? slide.sectionLabel : null;
  return (
    <div className="mb-[clamp(1rem,3vh,2.5rem)]">
      {subtitle ? <p className="mb-2 text-[clamp(0.75rem,1.55vw,1.4rem)] font-black uppercase tracking-[0.24em] opacity-75">{subtitle}</p> : null}
      {slide.title ? <h1 className="text-[clamp(1.7rem,4.6vw,5.25rem)] font-black leading-[0.98] tracking-[-0.035em]">{slide.title}</h1> : null}
    </div>
  );
}

function LyricsSlide({ slide }: { slide: Extract<PresentationAudienceSlide, { kind: "lyrics" }> }) {
  return (
    <div className="mx-auto w-full max-w-[92vw] text-center">
      {slide.sectionLabel ? <p className="mb-[clamp(0.8rem,2.5vh,2rem)] text-[clamp(0.72rem,1.35vw,1.2rem)] font-black uppercase tracking-[0.28em] opacity-70">{slide.sectionLabel}</p> : null}
      <div className="space-y-[clamp(0.25rem,1vh,0.9rem)] text-[clamp(2rem,6.1vw,7.4rem)] font-[inherit] leading-[1.03] tracking-[-0.035em] [text-wrap:balance]">
        {slide.lines.map((line, index) => <p key={`${slide.id}-${index}`}>{line}</p>)}
      </div>
    </div>
  );
}

function ScriptureSlide({ slide }: { slide: Extract<PresentationAudienceSlide, { kind: "scripture" }> }) {
  return (
    <div className="mx-auto grid w-full max-w-[90vw] gap-[clamp(1.2rem,3vw,3.5rem)] lg:grid-cols-[minmax(12rem,0.35fr)_minmax(0,1fr)] lg:text-left">
      <header>
        <BookOpen className="mb-4 h-[clamp(2rem,4vw,4rem)] w-[clamp(2rem,4vw,4rem)] opacity-70" aria-hidden="true" />
        <h1 className="text-[clamp(1.8rem,4vw,4.75rem)] font-black leading-none tracking-[-0.035em]">{slide.passage.reference}</h1>
        <p className="mt-3 text-[clamp(0.72rem,1.3vw,1.15rem)] font-black uppercase tracking-[0.2em] opacity-65">{slide.passage.version.abbreviation}</p>
      </header>
      <div className="space-y-[clamp(0.65rem,1.4vh,1.25rem)] text-[clamp(1.55rem,3.25vw,4rem)] leading-[1.2] tracking-[-0.02em]">
        {slide.passage.verses.map((verse) => (
          <p key={`${slide.id}-${verse.number}`}><sup className="mr-2 text-[0.45em] font-black opacity-65">{verse.number}</sup>{verse.text}</p>
        ))}
      </div>
    </div>
  );
}

function MessageSlide({ slide }: { slide: Extract<PresentationAudienceSlide, { kind: "sermon" | "announcement" }> }) {
  const body = slide.body;
  const eyebrow = slide.kind === "sermon" ? slide.speaker || slide.subtitle : "Anuncio";
  return (
    <div className="mx-auto grid w-full max-w-[75vw] items-center gap-[clamp(1.5rem,5vw,5rem)]">
      <div className="text-left">
        {eyebrow ? <p className="mb-4 text-[clamp(0.75rem,1.35vw,1.25rem)] font-black uppercase tracking-[0.24em] opacity-70">{eyebrow}</p> : null}
        {slide.title ? <h1 className="text-[clamp(2.2rem,min(6vw,8vh),7rem)] font-black leading-[0.94] tracking-[-0.045em] [text-wrap:balance]">{slide.title}</h1> : null}
        {body.length ? <div className="mt-[clamp(1rem,min(3vh,2vw),2.5rem)] space-y-2 text-[clamp(1.15rem,min(2.25vw,3vh),2.4rem)] leading-[1.25] opacity-90">{body.map((line, index) => <p key={`${slide.id}-body-${index}`}>{line}</p>)}</div> : null}
      </div>
    </div>
  );
}

function MediaFailure({ title }: { title: string | null }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center text-center" role="status">
      <TriangleAlert className="h-12 w-12 opacity-55" aria-hidden="true" />
      <p className="mt-5 text-[clamp(1.3rem,2.8vw,2.6rem)] font-black">{title || "Contenido no disponible"}</p>
      <p className="mt-2 text-[clamp(0.8rem,1.2vw,1rem)] font-bold uppercase tracking-[0.18em] opacity-55">La presentación continuará</p>
    </div>
  );
}

export function PresentationAudienceOutput({
  slide,
  theme: requestedTheme,
  blackout,
  playback = null,
  countdown = null,
  serverNow = null,
  nowMs,
  receivedAtMs,
  status = "ready",
  authoritativePlayback = false,
  showPlaybackRecovery = false,
  embedded = false,
  fontScale = 1,
  onMediaError,
}: PresentationAudienceOutputProps) {
  const theme = requestedTheme || DEFAULT_PRESENTATION_THEME;
  const [localNowMs, setLocalNowMs] = useState(() => Date.now());
  const effectiveNowMs = nowMs ?? localNowMs;
  const effectiveReceivedAtMs = receivedAtMs ?? effectiveNowMs;
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [mediaFailedSlideId, setMediaFailedSlideId] = useState<string | null>(null);
  const [playbackBlockedSlideId, setPlaybackBlockedSlideId] = useState<string | null>(null);

  useEffect(() => {
    if (nowMs !== undefined || slide?.kind !== "countdown") return undefined;
    const timer = window.setInterval(() => setLocalNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [nowMs, slide?.kind]);

  useEffect(() => {
    setMediaFailedSlideId(null);
    setPlaybackBlockedSlideId(null);
  }, [slide?.id]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !slide || (slide.kind !== "video" && slide.kind !== "audio")) return;
    let active = true;
    const matches = playback?.slideId === slide.id && playback.itemId === slide.itemId;
    const attemptPlay = () => {
      void media.play()
        .then(() => { if (active) setPlaybackBlockedSlideId(null); })
        .catch(() => { if (active) setPlaybackBlockedSlideId(slide.id); });
    };
    if (!matches || !playback || !serverNow) {
      if (authoritativePlayback) {
        media.pause();
        media.currentTime = 0;
        media.loop = false;
        setPlaybackBlockedSlideId(null);
      } else if (slide.autoplay) {
        attemptPlay();
      }
      return () => { active = false; };
    }
    const synchronize = () => {
      const projectedSeconds = projectPresentationPlaybackPosition(playback, serverNow, effectiveReceivedAtMs, Date.now()) / 1_000;
      const hasDuration = Number.isFinite(media.duration) && media.duration > 0;
      const targetSeconds = hasDuration
        ? playback.loop
          ? projectedSeconds % media.duration
          : Math.min(Math.max(0, projectedSeconds), media.duration)
        : Math.max(0, projectedSeconds);
      if (Math.abs(media.currentTime - targetSeconds) > 0.75) media.currentTime = targetSeconds;
      media.loop = playback.loop;
      if (playback.status === "playing") {
        if (hasDuration && !playback.loop && projectedSeconds >= media.duration) {
          media.pause();
          setPlaybackBlockedSlideId(null);
        } else {
          attemptPlay();
        }
      } else {
        media.pause();
      }
    };
    synchronize();
    media.addEventListener("loadedmetadata", synchronize);
    return () => {
      active = false;
      media.removeEventListener("loadedmetadata", synchronize);
    };
  }, [authoritativePlayback, effectiveReceivedAtMs, playback, serverNow, slide]);

  const slideMediaBackground = slide && (slide.kind === "sermon" || slide.kind === "announcement") && slide.mediaType === "image" ? slide.mediaSrc : null;
  const effectiveBackgroundImage = slideMediaBackground || (theme.background.type === "image" ? theme.background.imageUrl : null);
  const effectiveOverlayOpacity = slideMediaBackground ? Math.max(0.66, theme.background.overlayOpacity) : theme.background.overlayOpacity;
  const backgroundStyle = useMemo<CSSProperties>(() => {
    return {
      backgroundColor: slide?.kind === "blank" && slide.tone === "transparent" ? "transparent" : theme.background.color,
      color: theme.textColor,
      fontFamily: FONT_STACKS[theme.fontFamily],
      fontWeight: theme.fontWeight,
      ...(effectiveBackgroundImage ? {
        backgroundImage: `url("${effectiveBackgroundImage.replace(/["\\]/g, "")}")`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      } : {}),
    };
  }, [effectiveBackgroundImage, slide, theme]);

  function failMedia() {
    if (!slide) return;
    setMediaFailedSlideId(slide.id);
    onMediaError?.(slide.id);
  }

  function retryPlayback() {
    const media = mediaRef.current;
    if (!media || !slide) return;
    void media.play()
      .then(() => setPlaybackBlockedSlideId(null))
      .catch(() => setPlaybackBlockedSlideId(slide.id));
  }

  let content: ReactNode = null;
  if (status === "loading" || status === "reconnecting") {
    content = <div className="flex flex-col items-center text-center" role="status"><Radio className="h-10 w-10 animate-pulse opacity-55" aria-hidden="true" /><p className="mt-5 text-sm font-black uppercase tracking-[0.24em] opacity-60">{status === "loading" ? "Conectando salida" : "Reconectando"}</p></div>;
  } else if (status === "error") {
    content = <MediaFailure title="Salida temporalmente no disponible" />;
  } else if (status === "ended") {
    content = <div className="text-center"><p className="text-[clamp(2rem,5vw,5rem)] font-black tracking-[-0.04em]">Servicio finalizado</p></div>;
  } else if (!slide) {
    content = <div aria-hidden="true" />;
  } else if (mediaFailedSlideId === slide.id) {
    content = <MediaFailure title={slide.title} />;
  } else if (slide.kind === "lyrics") {
    content = <LyricsSlide slide={slide} />;
  } else if (slide.kind === "scripture") {
    content = <ScriptureSlide slide={slide} />;
  } else if (slide.kind === "image") {
    content = <img src={slide.src} alt={slide.alt} onError={failMedia} className="h-full w-full" style={{ objectFit: slide.fit }} />;
  } else if (slide.kind === "video") {
    content = <video ref={(node) => { mediaRef.current = node; }} src={slide.src} poster={slide.posterSrc || undefined} muted={slide.muted} autoPlay={slide.autoplay && !authoritativePlayback} loop={slide.loop && !authoritativePlayback} playsInline controls={false} onError={failMedia} aria-label={slide.title || "Video de presentación"} className="h-full w-full object-contain" />;
  } else if (slide.kind === "audio") {
    content = <div className="mx-auto flex max-w-3xl flex-col items-center text-center"><AudioLines className="h-[clamp(3rem,8vw,8rem)] w-[clamp(3rem,8vw,8rem)] opacity-70" aria-hidden="true" /><TitleBlock slide={slide} />{slide.artist ? <p className="text-[clamp(1rem,2vw,2rem)] opacity-70">{slide.artist}</p> : null}<audio ref={(node) => { mediaRef.current = node; }} src={slide.src} autoPlay={slide.autoplay && !authoritativePlayback} loop={slide.loop && !authoritativePlayback} controls={false} onError={failMedia} /></div>;
  } else if (slide.kind === "countdown") {
    const remaining = countdown && serverNow
      ? projectPresentationCountdownSeconds(countdown, serverNow, effectiveReceivedAtMs, effectiveNowMs)
      : 0;
    content = <div className="text-center"><p className="text-[clamp(0.8rem,1.6vw,1.4rem)] font-black uppercase tracking-[0.28em] opacity-65">{slide.label}</p><p className="mt-4 text-[clamp(5rem,18vw,18rem)] font-black tabular-nums leading-none tracking-[-0.07em]">{formatAudienceCountdown(remaining)}</p></div>;
  } else if (slide.kind === "sermon" || slide.kind === "announcement") {
    content = <MessageSlide slide={slide} />;
  } else if (slide.tone === "black") {
    content = <div className="absolute inset-0 bg-black" />;
  }

  const placeContent = slide && (slide.kind === "lyrics" || slide.kind === "scripture" || slide.kind === "sermon" || slide.kind === "announcement" || slide.kind === "audio")
    ? <LowerThird theme={theme}>{content}</LowerThird>
    : content;
  const visualFontScale = slide && (slide.kind === "image" || slide.kind === "video" || slide.kind === "blank") ? 1 : fontScale;

  return (
    <main className={`relative isolate flex h-full w-full items-center justify-center overflow-hidden ${embedded ? "min-h-full" : "min-h-[100dvh]"}`} style={backgroundStyle} data-audience-kind={slide?.kind || "none"}>
      {effectiveBackgroundImage ? <div data-testid="audience-media-overlay" className="absolute inset-0 z-0" style={{ backgroundColor: colorWithOpacity(theme.background.overlayColor, effectiveOverlayOpacity) }} aria-hidden="true" /> : null}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.055),transparent_55%)]" aria-hidden="true" />
      <section className={`relative z-10 flex h-full w-full items-center justify-center px-[max(2rem,5vw)] [text-shadow:0_2px_20px_rgba(0,0,0,0.45)] ${embedded ? "min-h-full py-[max(1rem,3vh)]" : "min-h-[100dvh] py-[max(3.5rem,8vh)]"}`}>
        <div className="relative flex h-full w-full items-center justify-center" style={visualFontScale === 1 ? undefined : { width: `${100 / visualFontScale}%`, height: `${100 / visualFontScale}%`, transform: `scale(${visualFontScale})`, transformOrigin: theme.placement === "lower_third" ? "bottom center" : "center" }}>
          {placeContent}
        </div>
      </section>
      {slide ? <CopyrightLine slide={slide} theme={theme} /> : null}
      {theme.logo.url && theme.logo.position !== "none" ? <img src={theme.logo.url} alt="" className={`absolute z-20 max-h-[clamp(2rem,6vh,5rem)] max-w-[clamp(5rem,14vw,12rem)] object-contain ${LOGO_POSITION_CLASSES[theme.logo.position]}`} /> : null}
      {showPlaybackRecovery && slide && playbackBlockedSlideId === slide.id ? (
        <div className="absolute inset-x-0 bottom-[max(2.75rem,6vh)] z-40 flex justify-center px-6">
          <button type="button" onClick={retryPlayback} className="rounded-full border border-white/25 bg-black/80 px-5 py-3 text-sm font-black tracking-wide text-white shadow-2xl backdrop-blur" aria-label="Activar audio de la presentación">
            Activar audio
          </button>
        </div>
      ) : null}
      <div data-testid="audience-blackout" aria-hidden="true" className={`absolute inset-0 z-[100] bg-black transition-none ${blackout ? "visible" : "invisible"}`} />
    </main>
  );
}
