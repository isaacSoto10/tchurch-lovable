import { useState } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { ExternalLink, Play } from "lucide-react";
import { getYoutubeThumbnailUrl, getYoutubeWatchUrl } from "@/lib/youtube";
import { cn } from "@/lib/utils";

type YoutubePlayerProps = {
  sourceUrl: string;
  embedUrl: string;
  title: string;
  className?: string;
};

export function usesNativeYoutubeFallback() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

async function openYoutube(url: string) {
  if (usesNativeYoutubeFallback()) {
    try {
      await Browser.open({ url });
      return;
    } catch {
      // Fall through when the native browser plugin is unavailable.
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function YoutubePlayer({ sourceUrl, embedUrl, title, className }: YoutubePlayerProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const watchUrl = getYoutubeWatchUrl(sourceUrl) || getYoutubeWatchUrl(embedUrl) || sourceUrl;
  const thumbnailUrl = getYoutubeThumbnailUrl(sourceUrl) || getYoutubeThumbnailUrl(embedUrl);

  if (!usesNativeYoutubeFallback()) {
    return (
      <iframe
        src={embedUrl}
        title={title}
        className={cn("h-full w-full border-0", className)}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "group relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-900 text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        className,
      )}
      onClick={() => void openYoutube(watchUrl)}
      aria-label={`Ver ${title} en YouTube`}
    >
      {thumbnailUrl && !thumbnailFailed && (
        <img
          src={thumbnailUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={() => setThumbnailFailed(true)}
        />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" aria-hidden="true" />
      <span className="relative flex min-h-11 items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-sm font-bold shadow-lg transition-transform group-active:scale-95">
        <Play className="h-5 w-5 fill-current" aria-hidden="true" />
        Ver en YouTube
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  );
}
