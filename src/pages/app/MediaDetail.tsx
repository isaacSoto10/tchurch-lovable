import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, Radio, Tag, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { MediaEmbed, MediaExternalLink, MediaProviderBadge } from "@/components/MediaEmbed";
import {
  flattenServiceMedia,
  formatMediaDate,
  getServiceMediaEntryFromDetail,
  mediaSnapshotKey,
  readMediaSnapshot,
  writeMediaSnapshot,
  type ServiceMediaEntry,
  type ServiceMediaResponse,
} from "@/lib/media";
import { getChurchId } from "@/lib/api";

const MEDIA_LIST_PATH = "/service-media?limit=160";

function mediaDetailPath(id: string) {
  return `/service-media/${encodeURIComponent(id)}`;
}

function DetailSkeleton() {
  return (
    <div className="mobile-page animate-pulse space-y-4">
      <div className="h-10 w-32 rounded-lg bg-muted" />
      <div className="h-8 w-64 rounded-full bg-muted" />
      <div className="aspect-video rounded-lg bg-muted" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-20 rounded-lg bg-muted/80" />
        <div className="h-20 rounded-lg bg-muted/70" />
        <div className="h-20 rounded-lg bg-muted/60" />
      </div>
    </div>
  );
}

export default function MediaDetail() {
  const { id } = useParams();
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [item, setItem] = useState<ServiceMediaEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const snapshotKey = mediaSnapshotKey(getChurchId());

  const loadDetail = useCallback(async () => {
    if (!id) {
      setItem(null);
      setLoading(false);
      return;
    }

    const snapshot = readMediaSnapshot(snapshotKey, { allowStale: true });
    const cached = flattenServiceMedia(snapshot?.response).find((mediaItem) => mediaItem.id === id) || null;

    if (cached) {
      setItem(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const detail = getServiceMediaEntryFromDetail(await fetchApi<unknown>(mediaDetailPath(id)));
      if (detail) {
        setItem(detail);
        return;
      }
      throw new Error("No se encontró este servicio");
    } catch (error) {
      try {
        const data = await fetchApi<ServiceMediaResponse>(MEDIA_LIST_PATH);
        const nextItem = flattenServiceMedia(data).find((mediaItem) => mediaItem.id === id) || cached;
        setItem(nextItem || null);
        writeMediaSnapshot(snapshotKey, { response: data });
      } catch (fallbackError) {
        if (!cached) {
          const message = fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : "No se pudo cargar media";

          toast({
            title: message,
            variant: "destructive",
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [fetchApi, id, snapshotKey, toast]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const relatedFacts = useMemo(() => {
    if (!item) return [];
    return [
      { label: "Fecha", value: formatMediaDate(item.date), icon: CalendarDays },
      { label: "Predicador", value: item.speaker || "No asignado", icon: UserRound },
      { label: "Serie", value: item.series || "Sin serie", icon: Tag },
    ];
  }, [item]);

  if (loading && !item) return <DetailSkeleton />;

  if (!item) {
    return (
      <div className="mobile-page space-y-5">
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link to="/app/media">
            <ArrowLeft className="h-4 w-4" />
            Media
          </Link>
        </Button>
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-12 text-center">
          <Radio className="mx-auto h-10 w-10 text-zinc-300" />
          <p className="mt-3 text-sm font-black text-zinc-800">No se encontró este servicio</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link to="/app/media">
              <ArrowLeft className="h-4 w-4" />
              Media
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-black text-zinc-950 sm:text-3xl">{item.title}</h1>
            <p className="mt-1 text-sm font-semibold text-zinc-500">{item.serviceTitle}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {item.isLive && <Badge className="bg-red-600 text-white">En vivo</Badge>}
              {item.isScheduled && <Badge className="bg-amber-500 text-white">Programado</Badge>}
              <MediaProviderBadge item={item} />
              {item.scripture && <Badge variant="outline" className="bg-white">{item.scripture}</Badge>}
            </div>
          </div>
        </div>
        <MediaExternalLink item={item} />
      </div>

      <MediaEmbed item={item} />

      <section className="grid gap-3 sm:grid-cols-3">
        {relatedFacts.map((fact) => {
          const Icon = fact.icon;
          return (
            <div key={fact.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="flex items-center gap-2 text-xs font-black uppercase text-zinc-500">
                <Icon className="h-4 w-4" />
                {fact.label}
              </p>
              <p className="mt-2 text-sm font-bold text-zinc-900">{fact.value}</p>
            </div>
          );
        })}
      </section>

      {(item.description || item.scripture) && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-black uppercase text-zinc-500">Notas</h2>
          {item.description && <p className="mt-3 text-sm leading-6 text-zinc-700">{item.description}</p>}
          {item.scripture && <p className="mt-3 text-sm font-bold text-primary">{item.scripture}</p>}
        </section>
      )}
    </div>
  );
}
