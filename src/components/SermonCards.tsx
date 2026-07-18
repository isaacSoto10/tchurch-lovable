import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Play } from "lucide-react";
import { TchurchLogo } from "@/components/TchurchLogo";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";
import { formatMediaDate, type MediaSeriesGroup, type ServiceMediaEntry } from "@/lib/media";
import { cn } from "@/lib/utils";

type SermonArtworkProps = {
  item?: ServiceMediaEntry | null;
  imageUrl?: string | null;
  title: string;
  eyebrow?: string | null;
  className?: string;
  priority?: boolean;
};

export function SermonArtwork({ item, imageUrl, title, eyebrow, className, priority = false }: SermonArtworkProps) {
  const source = imageUrl ?? item?.thumbnailUrl ?? null;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [source]);

  return (
    <div className={cn("relative aspect-video overflow-hidden bg-[#1C1826]", className)}>
      {source && !imageFailed ? (
        <img
          src={source}
          alt={`Portada de ${title}`}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <TchurchLogo variant="mark" size="lg" className="rounded-2xl bg-[#F8F7FF] p-3" />
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.24em] text-[#818CF8]">Tchurch</p>
            <p className="mt-1 line-clamp-2 text-base font-semibold leading-tight text-[#F8F7FF]">
              {eyebrow || "Sermones"}
            </p>
          </div>
        </div>
      )}
      {item?.isLive ? (
        <span className="absolute left-3 top-3 rounded-full bg-red-600 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-white">
          En vivo
        </span>
      ) : item?.isScheduled ? (
        <span className="absolute left-3 top-3 rounded-full border border-[#818CF8]/60 bg-[#15121D] px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#C5C9FF]">
          Próximo
        </span>
      ) : null}
    </div>
  );
}

export function SermonCard({ item, className }: { item: ServiceMediaEntry; className?: string }) {
  const href = `/app/media/${item.id}`;
  const title = item.title || item.serviceTitle;

  return (
    <Link
      to={href}
      onFocus={() => preloadAppRoute(href)}
      onPointerEnter={() => preloadAppRoute(href)}
      onTouchStart={() => preloadAppRoute(href)}
      className={cn(
        "group block min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#15121D] text-left shadow-[0_16px_40px_rgba(0,0,0,0.2)] transition-colors hover:border-[#818CF8]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#818CF8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0A10]",
        className,
      )}
    >
      <SermonArtwork item={item} title={title} eyebrow={item.series} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {item.series ? (
              <p className="truncate text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#818CF8]">{item.series}</p>
            ) : null}
            <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-[#F8F7FF] group-hover:text-white">
              {title}
            </h3>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#5B4FD8] text-white" aria-hidden="true">
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </span>
        </div>
        <p className="mt-3 flex min-w-0 items-center gap-2 text-xs text-[#A9A4B7]">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{formatMediaDate(item.date)}{item.speaker ? ` · ${item.speaker}` : ""}</span>
        </p>
      </div>
    </Link>
  );
}

export function SermonSeriesCard({ series, onSelect, className }: {
  series: MediaSeriesGroup;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#15121D] text-left transition-colors hover:border-[#818CF8]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#818CF8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0A10]",
        className,
      )}
    >
      <SermonArtwork imageUrl={series.coverUrl} title={series.label} eyebrow={series.label} />
      <div className="flex min-h-20 items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-[#F8F7FF]">{series.label}</h3>
          <p className="mt-1 text-xs text-[#A9A4B7]">{series.items.length} mensaje{series.items.length === 1 ? "" : "s"}</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 text-[#C5C9FF]" aria-hidden="true">
          <ChevronRight className="h-5 w-5" />
        </span>
      </div>
    </button>
  );
}
