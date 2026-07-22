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
    <div className={cn("relative aspect-video overflow-hidden bg-[#F8F7FF]", className)}>
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
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.24em] text-[#5B4FD8]">Tchurch</p>
            <p className="mt-1 line-clamp-2 text-base font-semibold leading-tight text-zinc-950">
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
        <span className="absolute left-3 top-3 rounded-full border border-[#5B4FD8]/35 bg-white px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#5B4FD8]">
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
        "group block min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white text-left shadow-[0_14px_36px_rgba(24,24,27,0.08)] transition-colors hover:border-[#5B4FD8]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4FD8] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        className,
      )}
    >
      <SermonArtwork item={item} title={title} eyebrow={item.series} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {item.series ? (
              <p className="truncate text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#5B4FD8]">{item.series}</p>
            ) : null}
            <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-zinc-950 group-hover:text-[#493EC0]">
              {title}
            </h3>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#5B4FD8] text-white" aria-hidden="true">
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </span>
        </div>
        <p className="mt-3 flex min-w-0 items-center gap-2 text-xs text-zinc-600">
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
        "group min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white text-left shadow-[0_14px_36px_rgba(24,24,27,0.06)] transition-colors hover:border-[#5B4FD8]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4FD8] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        className,
      )}
    >
      <SermonArtwork imageUrl={series.coverUrl} title={series.label} eyebrow={series.label} />
      <div className="flex min-h-20 items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-zinc-950">{series.label}</h3>
          <p className="mt-1 text-xs text-zinc-600">{series.items.length} mensaje{series.items.length === 1 ? "" : "s"}</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-[#5B4FD8]" aria-hidden="true">
          <ChevronRight className="h-5 w-5" />
        </span>
      </div>
    </button>
  );
}
