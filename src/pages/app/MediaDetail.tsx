import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CalendarDays, Radio, Tag, UserRound } from "lucide-react";
import { MediaEmbed, MediaExternalLink, MediaProviderBadge } from "@/components/MediaEmbed";
import { SectionNav } from "@/components/SectionNav";
import { SermonCard } from "@/components/SermonCards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import {
  flattenServiceMedia,
  formatMediaDate,
  getRelatedMedia,
  getServiceMediaEntryFromDetail,
  isMediaEndpointUnavailableError,
  mediaSnapshotKey,
  normalizeSeriesKey,
  readMediaSnapshot,
  writeMediaSnapshot,
  type ServiceMediaEntry,
  type ServiceMediaResponse,
} from "@/lib/media";
import { useChurch } from "@/providers/ChurchProvider";

const MEDIA_LIST_PATH = "/service-media?limit=160";
const SERMON_CANVAS_CLASS = "sermons-canvas mobile-page -mx-3 -mb-4 -mt-4 w-[calc(100%+1.5rem)] max-w-none px-3 pb-10 pt-4 sm:-mx-4 sm:w-[calc(100%+2rem)] sm:px-4 md:-mx-5 md:w-[calc(100%+2.5rem)] md:px-5 lg:-mx-6 lg:w-[calc(100%+3rem)] lg:px-6 xl:-mx-8 xl:w-[calc(100%+4rem)] xl:px-8";

function mediaDetailPath(id: string) {
  return `/service-media/${encodeURIComponent(id)}`;
}

function DetailSkeleton() {
  return (
    <div className={SERMON_CANVAS_CLASS} role="status" aria-label="Cargando sermón">
      <div className="mx-auto max-w-6xl animate-pulse space-y-5">
        <div className="h-12 rounded-xl border border-white/10 bg-[#15121D]" />
        <div className="h-11 w-36 rounded-xl bg-[#1C1826]" />
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.85fr)]">
          <div className="aspect-video rounded-2xl bg-[#15121D]" />
          <div className="min-h-72 rounded-2xl bg-[#15121D]" />
        </div>
      </div>
    </div>
  );
}

function DetailFact({ label, value, icon: Icon, href }: {
  label: string;
  value: string;
  icon: typeof CalendarDays;
  href?: string | null;
}) {
  const content = href ? (
    <Link to={href} className="inline-flex min-h-11 items-center text-sm font-semibold text-[#C5C9FF] hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#818CF8]">
      {value}
    </Link>
  ) : (
    <p className="mt-1 text-sm font-semibold text-[#F8F7FF]">{value}</p>
  );

  return (
    <div className="border-t border-white/10 py-3 first:border-t-0 first:pt-0">
      <p className="flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[#8F899B]">
        <Icon className="h-3.5 w-3.5 text-[#818CF8]" />
        {label}
      </p>
      {content}
    </div>
  );
}

export default function MediaDetail() {
  const { id } = useParams();
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const { selectedChurch } = useChurch();
  const location = useLocation();
  const navigate = useNavigate();
  const [item, setItem] = useState<ServiceMediaEntry | null>(null);
  const [library, setLibrary] = useState<ServiceMediaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const requestGenerationRef = useRef(0);
  const snapshotKey = mediaSnapshotKey(selectedChurch?.id ?? null);

  const loadDetail = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    const isCurrentRequest = () => requestGenerationRef.current === requestGeneration;

    if (!id) {
      setItem(null);
      setLibrary(null);
      setLoading(false);
      return;
    }

    const snapshot = readMediaSnapshot(snapshotKey, { allowStale: true });
    const cachedLibrary = snapshot?.response || null;
    const cached = flattenServiceMedia(cachedLibrary).find((mediaItem) => mediaItem.id === id) || null;
    setLibrary(cachedLibrary);
    setItem(cached);
    setLoading(!cached);

    let detailItem: ServiceMediaEntry | null = null;
    let listedItem: ServiceMediaEntry | null = null;

    const detailRequest = fetchApi<unknown>(mediaDetailPath(id)).then((value) => {
      detailItem = getServiceMediaEntryFromDetail(value);
      if (detailItem && isCurrentRequest()) {
        setItem(detailItem);
        setLoading(false);
      }
      return detailItem;
    });

    const listRequest = fetchApi<ServiceMediaResponse>(MEDIA_LIST_PATH).then((value) => {
      listedItem = flattenServiceMedia(value).find((mediaItem) => mediaItem.id === id) || null;
      if (isCurrentRequest()) {
        setLibrary(value);
        writeMediaSnapshot(snapshotKey, { response: value });
        if (!detailItem && listedItem) {
          setItem(listedItem);
          setLoading(false);
        }
      }
      return listedItem;
    });

    const [detailResult, listResult] = await Promise.allSettled([detailRequest, listRequest]);
    if (!isCurrentRequest()) return;

    const nextItem = detailItem || listedItem || cached;
    setItem(nextItem || null);

    if (!nextItem) {
      const detailError = detailResult.status === "rejected" ? detailResult.reason : null;
      const listError = listResult.status === "rejected" ? listResult.reason : null;
      const rolloutUnavailable = isMediaEndpointUnavailableError(detailError) || isMediaEndpointUnavailableError(listError);
      if (!rolloutUnavailable && (detailError || listError)) {
        const error = listError || detailError;
        toast({
          title: error instanceof Error ? error.message : "No se pudo cargar el sermón",
          variant: "destructive",
        });
      }
    }

    setLoading(false);
  }, [fetchApi, id, snapshotKey, toast]);

  useEffect(() => {
    void loadDetail();
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadDetail]);

  const returnToLibrary = useCallback(() => {
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    navigate("/app/media", { replace: true });
  }, [location.key, navigate]);

  const relatedItems = useMemo(() => item ? getRelatedMedia(item, library, 6) : [], [item, library]);
  const seriesHref = item?.series
    ? `/app/media?series=${encodeURIComponent(normalizeSeriesKey(item.series))}`
    : null;

  if (loading && !item) return <DetailSkeleton />;

  if (!item) {
    return (
      <div className={SERMON_CANVAS_CLASS}>
        <div className="mx-auto max-w-6xl space-y-5">
          <SectionNav section="community" label="Comunidad" />
          <Button type="button" onClick={returnToLibrary} variant="ghost" size="sm" className="min-h-11 w-fit px-0 text-[#C5C9FF] hover:bg-transparent hover:text-white">
            <ArrowLeft className="h-4 w-4" />Sermones
          </Button>
          <div className="rounded-3xl border border-dashed border-white/15 bg-[#15121D] px-4 py-14 text-center">
            <Radio className="mx-auto h-10 w-10 text-[#818CF8]" />
            <p className="mt-4 text-lg font-semibold text-[#F8F7FF]">No se encontró este sermón</p>
            <p className="mt-1 text-sm text-[#A9A4B7]">Puede que ya no esté disponible o que el enlace haya cambiado.</p>
            <Button onClick={loadDetail} variant="outline" className="mt-5 min-h-11 border-white/10 bg-[#1C1826] text-[#F8F7FF] hover:bg-[#272132]">Intentar de nuevo</Button>
          </div>
        </div>
      </div>
    );
  }

  const title = item.title || item.serviceTitle;

  return (
    <div className={SERMON_CANVAS_CLASS}>
      <div className="mx-auto max-w-6xl space-y-6">
        <SectionNav section="community" label="Comunidad" />

        <div className="flex min-h-11 items-center justify-between gap-3">
          <Button type="button" onClick={returnToLibrary} variant="ghost" size="sm" className="min-h-11 w-fit px-0 text-[#C5C9FF] hover:bg-transparent hover:text-white">
            <ArrowLeft className="h-4 w-4" />Sermones
          </Button>
          <MediaExternalLink item={item} label="Abrir fuente" touchTarget />
        </div>

        <main className="grid items-start gap-5 md:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.85fr)] md:gap-6">
          <div className="min-w-0">
            <MediaEmbed item={item} appearance="sermons" />
          </div>

          <aside className="min-w-0 rounded-3xl border border-white/10 bg-[#15121D] p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              {item.isLive ? <Badge className="bg-red-600 text-white hover:bg-red-600">En vivo</Badge> : null}
              {item.isScheduled ? <Badge className="border border-[#818CF8]/50 bg-[#1C1826] text-[#C5C9FF] hover:bg-[#1C1826]">Próximo</Badge> : null}
              <MediaProviderBadge item={item} appearance="sermons" />
            </div>
            <h1 className="mt-4 break-words text-2xl font-semibold leading-tight tracking-[-0.025em] text-[#F8F7FF] sm:text-3xl">{title}</h1>
            {item.serviceTitle && item.serviceTitle !== title ? <p className="mt-2 text-sm text-[#A9A4B7]">{item.serviceTitle}</p> : null}

            <div className="mt-6">
              <DetailFact label="Fecha" value={formatMediaDate(item.date)} icon={CalendarDays} />
              <DetailFact label="Predicador" value={item.speaker || "No asignado"} icon={UserRound} />
              <DetailFact label="Serie" value={item.series || "Sin serie"} icon={Tag} href={seriesHref} />
              {item.scripture ? <DetailFact label="Pasaje" value={item.scripture} icon={BookOpen} /> : null}
            </div>

            {item.description ? (
              <section className="mt-3 border-t border-white/10 pt-5" aria-labelledby="sermon-notes-title">
                <h2 id="sermon-notes-title" className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[#818CF8]">Notas</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#C2BECC]">{item.description}</p>
              </section>
            ) : null}
          </aside>
        </main>

        {relatedItems.length > 0 ? (
          <section aria-labelledby="related-sermons">
            <div className="mb-3">
              <h2 id="related-sermons" className="text-xl font-semibold tracking-[-0.02em] text-[#F8F7FF]">
                {item.series && relatedItems.some((related) => normalizeSeriesKey(related.series) === normalizeSeriesKey(item.series))
                  ? `Más de ${item.series}`
                  : "Mensajes recientes"}
              </h2>
              <p className="mt-1 text-sm text-[#A9A4B7]">Continúa explorando la biblioteca de tu iglesia.</p>
            </div>
            <div className="sermon-rail -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4 md:-mx-1 md:px-1">
              {relatedItems.map((related) => (
                <SermonCard key={related.id} item={related} className="w-[76vw] max-w-[20rem] flex-none snap-start sm:w-[19rem] md:w-[20rem]" />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
