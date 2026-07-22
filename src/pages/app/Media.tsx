import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, Loader2, Play, Radio, RefreshCw, Search, Settings2, X } from "lucide-react";
import { LiveDestinationSetup } from "@/components/LiveDestinationSetup";
import { SectionNav } from "@/components/SectionNav";
import { SermonArtwork, SermonCard, SermonSeriesCard } from "@/components/SermonCards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useApi } from "@/hooks/useApi";
import {
  flattenServiceMedia,
  formatMediaDate,
  groupMediaBySeries,
  isMediaEndpointUnavailableError,
  mediaSnapshotKey,
  normalizeSeriesKey,
  readMediaSnapshot,
  searchServiceMedia,
  selectFeaturedMedia,
  sortMediaByDate,
  writeMediaSnapshot,
  type MediaSeriesGroup,
  type ServiceMediaEntry,
  type ServiceMediaResponse,
} from "@/lib/media";
import { useChurch } from "@/providers/ChurchProvider";

const MEDIA_LIST_PATH = "/service-media?limit=140";
const SERMON_CANVAS_CLASS = "sermons-canvas mobile-page -mx-3 -mb-4 -mt-4 w-[calc(100%+1.5rem)] max-w-none px-3 pb-10 pt-4 sm:-mx-4 sm:w-[calc(100%+2rem)] sm:px-4 md:-mx-5 md:w-[calc(100%+2.5rem)] md:px-5 lg:-mx-6 lg:w-[calc(100%+3rem)] lg:px-6 xl:-mx-8 xl:w-[calc(100%+4rem)] xl:px-8";

function roleCanManage(role?: string | null) {
  const normalized = String(role || "").toUpperCase();
  return normalized === "ADMIN" || normalized === "PLANNER";
}

function emptyResponse(): ServiceMediaResponse {
  return { live: [], scheduled: [], previous: [], destinations: [], generatedAt: new Date().toISOString() };
}

function MediaSkeleton() {
  return (
    <div className={SERMON_CANVAS_CLASS} role="status" aria-label="Cargando sermones">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="h-12 animate-pulse rounded-xl border border-zinc-200 bg-[#F8F7FF]" />
        <div className="flex gap-3">
          <div className="h-11 flex-1 animate-pulse rounded-xl bg-[#F8F7FF]" />
          <div className="h-11 w-11 animate-pulse rounded-xl bg-[#F8F7FF]" />
        </div>
        <div className="grid overflow-hidden rounded-3xl border border-zinc-200 bg-white md:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
          <div className="aspect-video animate-pulse bg-[#F8F7FF]" />
          <div className="min-h-64 animate-pulse bg-white" />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((item) => <div key={item} className="aspect-[4/3] w-[72vw] max-w-[20rem] shrink-0 animate-pulse rounded-2xl border border-zinc-200 bg-white" />)}
        </div>
      </div>
    </div>
  );
}

function FeaturedSermon({ item }: { item: ServiceMediaEntry }) {
  const title = item.title || item.serviceTitle;
  const status = item.isLive ? "En vivo" : item.isScheduled ? "Próximo" : "Destacado";

  return (
    <section
      aria-label="Sermón destacado"
      className="grid overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-[0_20px_55px_rgba(24,24,27,0.08)] md:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]"
    >
      <SermonArtwork item={item} title={title} eyebrow={item.series} priority className="md:aspect-auto md:min-h-[21rem]" />
      <div className="flex min-w-0 flex-col justify-center p-5 sm:p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className={item.isLive
            ? "rounded-full bg-red-600 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-white"
            : "rounded-full border border-[#5B4FD8]/35 bg-[#F8F7FF] px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[#5B4FD8]"}
          >
            {status}
          </span>
          {item.series ? <span className="truncate text-xs font-semibold text-zinc-600">{item.series}</span> : null}
        </div>
        <h2 className="mt-4 break-words text-2xl font-semibold leading-tight tracking-[-0.025em] text-zinc-950 sm:text-3xl">
          {title}
        </h2>
        {item.serviceTitle && item.serviceTitle !== title ? (
          <p className="mt-2 line-clamp-1 text-sm text-zinc-600">{item.serviceTitle}</p>
        ) : null}
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-700">
          <CalendarDays className="h-4 w-4 text-[#5B4FD8]" />
          <span>{formatMediaDate(item.date)}</span>
          {item.speaker ? <><span aria-hidden="true">·</span><span>{item.speaker}</span></> : null}
          {item.scripture ? <><span aria-hidden="true">·</span><span>{item.scripture}</span></> : null}
        </p>
        {item.description ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-600">{item.description}</p> : null}
        <Button asChild className="mt-6 min-h-11 w-full rounded-xl bg-[#5B4FD8] text-white hover:bg-[#685DE0] sm:w-fit">
          <Link to={`/app/media/${item.id}`}>
            <Play className="h-4 w-4 fill-current" />
            {item.isScheduled ? "Ver detalles" : "Ver ahora"}
          </Link>
        </Button>
      </div>
    </section>
  );
}

function RailHeader({ title, description, id }: { title: string; description?: string; id: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 id={id} className="text-xl font-semibold tracking-[-0.02em] text-zinc-950">{title}</h2>
        {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
      </div>
    </div>
  );
}

function SermonRail({ id, title, description, items }: {
  id: string;
  title: string;
  description?: string;
  items: ServiceMediaEntry[];
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <RailHeader id={id} title={title} description={description} />
      <div className="sermon-rail -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4 md:-mx-1 md:px-1">
        {items.map((item) => (
          <SermonCard key={item.id} item={item} className="w-[76vw] max-w-[20rem] flex-none snap-start sm:w-[19rem] md:w-[20rem]" />
        ))}
      </div>
    </section>
  );
}

function SearchResults({ query, items }: { query: string; items: ServiceMediaEntry[] }) {
  return (
    <section aria-labelledby="sermon-search-results" className="space-y-4">
      <div>
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[#5B4FD8]">Búsqueda</p>
        <h2 id="sermon-search-results" className="mt-1 text-2xl font-semibold text-zinc-950">Resultados para “{query.trim()}”</h2>
        <p className="mt-1 text-sm text-zinc-600">{items.length} resultado{items.length === 1 ? "" : "s"}</p>
      </div>
      {items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => <SermonCard key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-12 text-center">
          <Search className="mx-auto h-8 w-8 text-[#5B4FD8]" />
          <p className="mt-3 font-semibold text-zinc-950">No encontramos coincidencias</p>
          <p className="mt-1 text-sm text-zinc-600">Prueba con otro título, serie, predicador o pasaje.</p>
        </div>
      )}
    </section>
  );
}

function SeriesView({ series, onBack }: { series: MediaSeriesGroup | null; onBack: () => void }) {
  return (
    <section className="space-y-4" aria-labelledby="selected-series-title">
      <Button variant="ghost" onClick={onBack} className="min-h-11 w-fit px-0 text-[#5B4FD8] hover:bg-transparent hover:text-[#493EC0]">
        <ArrowLeft className="h-4 w-4" />
        Todas las series
      </Button>
      {series ? (
        <>
          <div>
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[#5B4FD8]">Serie</p>
            <h2 id="selected-series-title" className="mt-1 text-3xl font-semibold tracking-[-0.025em] text-zinc-950">{series.label}</h2>
            <p className="mt-1 text-sm text-zinc-600">{series.items.length} mensaje{series.items.length === 1 ? "" : "s"}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {series.items.map((item) => <SermonCard key={item.id} item={item} />)}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-12 text-center">
          <Radio className="mx-auto h-9 w-9 text-[#5B4FD8]" />
          <p id="selected-series-title" className="mt-3 font-semibold text-zinc-950">No encontramos esta serie</p>
          <p className="mt-1 text-sm text-zinc-600">Vuelve a la biblioteca para elegir otra.</p>
        </div>
      )}
    </section>
  );
}

export default function Media() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") || "";
  const selectedChurchId = selectedChurch?.id ?? null;
  const canManage = roleCanManage(selectedChurch?.role);
  const [response, setResponse] = useState<ServiceMediaResponse>(() => emptyResponse());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedPageRef = useRef(false);
  const snapshotKey = mediaSnapshotKey(selectedChurchId);

  const applyResponse = useCallback((nextResponse: ServiceMediaResponse) => {
    setResponse({ ...emptyResponse(), ...nextResponse });
    hasLoadedPageRef.current = true;
  }, []);

  const loadPage = useCallback(async (options?: { silent?: boolean; preferSnapshot?: boolean }) => {
    const snapshot = options?.preferSnapshot !== false ? readMediaSnapshot(snapshotKey) : null;
    if (!options?.silent) {
      if (snapshot) {
        applyResponse(snapshot.response);
        setLoading(false);
      } else if (!hasLoadedPageRef.current) {
        setLoading(true);
      }
    }
    setError(null);
    try {
      if (options?.silent) setRefreshing(true);
      const data = await fetchApi<ServiceMediaResponse>(MEDIA_LIST_PATH, options?.preferSnapshot === false ? { cache: "no-store" } : undefined);
      applyResponse(data);
      writeMediaSnapshot(snapshotKey, { response: data });
    } catch (loadError) {
      if (!snapshot && !isMediaEndpointUnavailableError(loadError)) {
        setError(loadError instanceof Error ? loadError.message : "No pudimos cargar los sermones.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyResponse, fetchApi, snapshotKey]);

  useEffect(() => {
    hasLoadedPageRef.current = false;
    setResponse(emptyResponse());
  }, [selectedChurchId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const allItems = useMemo(() => flattenServiceMedia(response), [response]);
  const featured = useMemo(() => selectFeaturedMedia(response), [response]);
  const recentItems = useMemo(() => sortMediaByDate(response.previous), [response.previous]);
  const liveItems = useMemo(() => [
    ...response.live,
    ...sortMediaByDate(response.scheduled, "ascending"),
  ], [response.live, response.scheduled]);
  const seriesGroups = useMemo(() => groupMediaBySeries(response.previous), [response.previous]);
  const searchResults = useMemo(() => searchServiceMedia(response, search), [response, search]);
  const selectedSeriesKey = normalizeSeriesKey(searchParams.get("series"));
  const selectedSeries = seriesGroups.find((series) => series.key === selectedSeriesKey) || null;
  const hasSearch = search.trim().length > 0;

  function selectSeries(series: MediaSeriesGroup | null) {
    const next = new URLSearchParams(searchParams);
    if (series) next.set("series", series.key);
    else next.delete("series");
    setSearchParams(next);
  }

  function updateSearch(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) {
      next.set("q", value);
      next.delete("series");
    } else {
      next.delete("q");
    }
    setSearchParams(next, { replace: true });
  }

  if (loading && allItems.length === 0) return <MediaSkeleton />;

  return (
    <div className={SERMON_CANVAS_CLASS}>
      <div className="mx-auto max-w-6xl space-y-6">
        <SectionNav section="community" label="Comunidad" />

        <header className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-[#5B4FD8]">{selectedChurch?.name || "Tu iglesia"}</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-zinc-950">Sermones</h1>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Actualizar sermones"
                onClick={() => loadPage({ silent: true, preferSnapshot: false })}
                disabled={refreshing}
                className="h-11 w-11 rounded-xl border-zinc-200 bg-white text-[#5B4FD8] hover:bg-[#F8F7FF] hover:text-[#493EC0]"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              {canManage ? (
                <Sheet>
                  <SheetTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Configuración de transmisión"
                      className="h-11 w-11 rounded-xl border-zinc-200 bg-white text-[#5B4FD8] hover:bg-[#F8F7FF] hover:text-[#493EC0]"
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-[min(94vw,38rem)] max-w-[38rem] overflow-y-auto border-zinc-200 bg-[#F8F7FF] px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[max(env(safe-area-inset-top),1.5rem)] text-zinc-950 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center sm:px-6">
                    <SheetHeader className="mb-5 pr-8 text-left">
                      <SheetTitle className="text-xl font-semibold text-zinc-950">Configuración de transmisión</SheetTitle>
                      <SheetDescription>Administra los destinos que alimentan la biblioteca de Sermones.</SheetDescription>
                    </SheetHeader>
                    <LiveDestinationSetup compact />
                  </SheetContent>
                </Sheet>
              ) : null}
            </div>
          </div>

          <label className="relative block">
            <span className="sr-only">Buscar sermones</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B4FD8]" />
            <Input
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="Buscar serie, predicador o pasaje"
              className="h-11 rounded-xl border-zinc-200 bg-white pl-10 pr-11 text-base text-zinc-950 placeholder:text-zinc-500 focus-visible:ring-[#5B4FD8] sm:text-sm"
            />
            {hasSearch ? (
              <button
                type="button"
                onClick={() => updateSearch("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4FD8]"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
        </header>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950" role="alert">
            <p className="font-semibold">No pudimos cargar los sermones.</p>
            <p className="mt-1 text-red-800">{error}</p>
            <Button size="sm" variant="outline" className="mt-3 min-h-11 border-red-300 bg-white text-red-800 hover:bg-red-100 hover:text-red-900" onClick={() => loadPage({ preferSnapshot: false })}>
              Reintentar
            </Button>
          </div>
        ) : null}

        {hasSearch ? (
          <SearchResults query={search} items={searchResults} />
        ) : selectedSeriesKey ? (
          <SeriesView series={selectedSeries} onBack={() => selectSeries(null)} />
        ) : allItems.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-zinc-300 bg-white px-5 py-14 text-center">
            <Radio className="mx-auto h-10 w-10 text-[#5B4FD8]" />
            <p className="mt-4 text-lg font-semibold text-zinc-950">Aún no hay sermones</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">Los mensajes, series y transmisiones aparecerán aquí cuando estén disponibles.</p>
          </div>
        ) : (
          <>
            {featured ? <FeaturedSermon item={featured} /> : null}
            <SermonRail id="live-sermons" title="En vivo y próximamente" description="Acompaña a tu iglesia desde donde estés." items={liveItems} />
            <SermonRail id="recent-sermons" title="Mensajes recientes" items={recentItems} />
            {seriesGroups.length > 0 ? (
              <section aria-labelledby="sermon-series">
                <RailHeader id="sermon-series" title="Series" description="Explora conversaciones completas, mensaje a mensaje." />
                <div className="sermon-rail -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4 md:-mx-1 md:px-1">
                  {seriesGroups.map((series) => (
                    <SermonSeriesCard
                      key={series.key}
                      series={series}
                      onSelect={() => selectSeries(series)}
                      className="w-[76vw] max-w-[20rem] flex-none snap-start sm:w-[19rem] md:w-[20rem]"
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
