import { useEffect, useRef, type MouseEvent } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { ExternalLink, FileText, PlayCircle, Radio, Volume2 } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMediaEmbed, type MediaEmbed as MediaEmbedConfig, type ServiceMediaEntry } from "@/lib/media";
import { cn } from "@/lib/utils";

function getNativeAwareMediaEmbed(item: ServiceMediaEntry) {
  return getMediaEmbed(item, {
    respectIosPlaybackFlags: Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios",
  });
}

function ProviderIcon({ embed }: { embed: MediaEmbedConfig }) {
  if (embed.kind === "audio") return <Volume2 className="h-4 w-4" />;
  if (embed.kind === "link") return <FileText className="h-4 w-4" />;
  if (embed.kind === "hls") return <Radio className="h-4 w-4" />;
  if (embed.provider === "hls" || embed.provider === "resi" || embed.provider === "cloudflare") return <Radio className="h-4 w-4" />;
  return <PlayCircle className="h-4 w-4" />;
}

function HlsVideo({ src, title, compact }: { src: string; title: string; compact?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return undefined;
    }

    let disposed = false;
    let hlsInstance: { destroy: () => void } | null = null;

    void import("hls.js").then(({ default: Hls }) => {
      if (disposed || !video) return;
      if (!Hls.isSupported()) {
        video.src = src;
        return;
      }
      const hls = new Hls({ maxBufferLength: compact ? 18 : 30, lowLatencyMode: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hlsInstance = hls;
    }).catch(() => {
      if (video) video.src = src;
    });

    return () => {
      disposed = true;
      hlsInstance?.destroy();
    };
  }, [compact, src]);

  return (
    <video
      ref={videoRef}
      className="h-full w-full bg-zinc-950"
      controls
      playsInline
      preload={compact ? "metadata" : "auto"}
      title={title}
    />
  );
}

function NativeVideo({ src, title, compact }: { src: string; title: string; compact?: boolean }) {
  return (
    <video
      className="h-full w-full bg-zinc-950"
      controls
      playsInline
      preload={compact ? "metadata" : "auto"}
      src={src}
      title={title}
    />
  );
}

function isHlsSource(src: string) {
  const lower = src.toLowerCase();
  return lower.includes(".m3u8") || lower.includes("format=m3u8");
}

async function openExternalMediaLink(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!Capacitor.isNativePlatform()) return;

  event.preventDefault();
  try {
    await Browser.open({ url: href });
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

function OpenLink({ href, label = "Abrir" }: { href: string | null; label?: string }) {
  if (!href) return null;

  return (
    <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-lg">
      <a href={href} target="_blank" rel="noreferrer" onClick={(event) => void openExternalMediaLink(event, href)}>
        <ExternalLink className="h-4 w-4" />
        {label}
      </a>
    </Button>
  );
}

export function MediaProviderBadge({ item }: { item: ServiceMediaEntry }) {
  const embed = getNativeAwareMediaEmbed(item);

  return (
    <Badge variant="outline" className="gap-1.5 bg-white/85 text-zinc-700">
      <ProviderIcon embed={embed} />
      {embed.providerLabel}
    </Badge>
  );
}

export function MediaEmbed({ item, compact = false }: { item: ServiceMediaEntry; compact?: boolean }) {
  const embed = getNativeAwareMediaEmbed(item);

  if (embed.kind === "iframe" && embed.embedUrl) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 shadow-sm">
        <AspectRatio ratio={16 / 9}>
          <iframe
            title={item.title}
            src={embed.embedUrl}
            className="h-full w-full border-0"
            allow={embed.allow}
            allowFullScreen
            loading={compact ? "lazy" : "eager"}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </AspectRatio>
      </div>
    );
  }

  if ((embed.kind === "hls" || embed.kind === "video") && embed.embedUrl) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 shadow-sm">
        <AspectRatio ratio={16 / 9}>
          {embed.kind === "hls" || isHlsSource(embed.embedUrl)
            ? <HlsVideo src={embed.embedUrl} title={item.title} compact={compact} />
            : <NativeVideo src={embed.embedUrl} title={item.title} compact={compact} />}
        </AspectRatio>
      </div>
    );
  }

  if (embed.kind === "audio" && embed.embedUrl) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <Volume2 className="h-4 w-4 text-primary" />
          {item.title}
        </div>
        <audio className="w-full" controls preload={compact ? "none" : "metadata"} src={embed.embedUrl} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white p-4 shadow-sm",
        compact ? "min-h-32" : "min-h-48",
      )}
    >
      <div className="flex h-full min-h-28 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
            <ProviderIcon embed={embed} />
          </div>
          <p className="truncate text-sm font-black text-zinc-950">{item.title}</p>
          <p className="mt-1 truncate text-xs font-semibold text-zinc-500">{embed.providerLabel}</p>
        </div>
        <OpenLink href={embed.sourceUrl} />
      </div>
    </div>
  );
}

export function MediaExternalLink({ item, label = "Abrir" }: { item: ServiceMediaEntry; label?: string }) {
  const embed = getNativeAwareMediaEmbed(item);
  return <OpenLink href={embed.sourceUrl} label={label} />;
}
