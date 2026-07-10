import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronRight, Loader2, PlayCircle, Radio, RefreshCw, Search, Settings2, Video } from "lucide-react";
import { LiveDestinationSetup } from "@/components/LiveDestinationSetup";
import { MediaProviderBadge } from "@/components/MediaEmbed";
import { SectionNav } from "@/components/SectionNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/useApi";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";
import {
  flattenServiceMedia,
  formatMediaDate,
  groupMediaBySeries,
  isMediaEndpointUnavailableError,
  mediaSearchText,
  mediaSnapshotKey,
  normalizeSeriesKey,
  readMediaSnapshot,
  writeMediaSnapshot,
  type MediaSeriesGroup,
  type ServiceMediaEntry,
  type ServiceMediaResponse,
} from "@/lib/media";
import { useChurch } from "@/providers/ChurchProvider";

const MEDIA_LIST_PATH = "/service-media?limit=140";
type MediaView = "recent" | "series" | "live";

function roleCanManage(role?: string | null) {
  const normalized = String(role || "").toUpperCase();
  return normalized === "ADMIN" || normalized === "PLANNER";
}

function emptyResponse(): ServiceMediaResponse {
  return { live: [], scheduled: [], previous: [], destinations: [], generatedAt: new Date().toISOString() };
}

function MediaSkeleton() {
  return (
    <div className="mobile-page space-y-4" role="status" aria-label="Cargando sermones">
      <div className="h-11 animate-pulse rounded-xl border border-border bg-card" />
      <div className="h-20 animate-pulse rounded-xl border border-border bg-card" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse rounded-xl border border-border bg-card" />)}
      </div>
    </div>
  );
}

function SermonArtwork({ item }: { item: ServiceMediaEntry }) {
  return (
    <div className="relative aspect-video overflow-hidden bg-secondary">
      {item.thumbnailUrl ? (
        <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-primary"><Video className="h-10 w-10" /></div>
      )}
      <div className="absolute left-3 top-3 flex flex-wrap gap-2">
        {item.isLive && <Badge className="bg-red-600 text-white hover:bg-red-600">En vivo</Badge>}
        {item.isScheduled && <Badge className="bg-amber-500 text-white hover:bg-amber-500">Próximo</Badge>}
      </div>
      <span className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white">
        <PlayCircle className="h-5 w-5" />
      </span>
    </div>
  );
}

function SermonCard({ item }: { item: ServiceMediaEntry }) {
  const href = `/app/media/${item.id}`;
  return (
    <Link
      to={href}
      onFocus={() => preloadAppRoute(href)}
      onPointerEnter={() => preloadAppRoute(href)}
      onTouchStart={() => preloadAppRoute(href)}
      className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SermonArtwork item={item} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-lg font-semibold leading-tight text-foreground group-hover:text-primary">{item.title || item.serviceTitle}</h3>
            {item.serviceTitle && item.serviceTitle !== item.title && <p className="mt-1 truncate text-sm text-muted-foreground">{item.serviceTitle}</p>}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />{formatMediaDate(item.date)}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MediaProviderBadge item={item} />
          {item.series && <Badge variant="secondary">{item.series.trim()}</Badge>}
        </div>
        {(item.speaker || item.scripture) && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{[item.speaker, item.scripture].filter(Boolean).join(" · ")}</p>}
      </div>
    </Link>
  );
}

function MediaGrid({ items, emptyTitle, emptyDescription }: { items: ServiceMediaEntry[]; emptyTitle: string; emptyDescription: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
        <Radio className="mx-auto h-9 w-9 text-primary" />
        <p className="mt-3 font-semibold text-foreground">{emptyTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
      </div>
    );
  }
  return <div className="grid gap-3 sm:grid-cols-2">{items.map((item) => <SermonCard key={item.id} item={item} />)}</div>;
}

function SeriesCard({ series, onSelect }: { series: MediaSeriesGroup; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-[16/9] bg-secondary">
        {series.coverUrl ? <img src={series.coverUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-primary"><Video className="h-10 w-10" /></div>}
      </div>
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold text-foreground group-hover:text-primary">{series.label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{series.items.length} sermón{series.items.length === 1 ? "" : "es"}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
}

export default function Media() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedChurchId = selectedChurch?.id ?? null;
  const canManage = roleCanManage(selectedChurch?.role);
  const [response, setResponse] = useState<ServiceMediaResponse>(() => emptyResponse());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<MediaView>(() => searchParams.get("series") ? "series" : "recent");
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

  const query = search.trim().toLocaleLowerCase("es");
  const filterItems = useCallback((items: ServiceMediaEntry[]) => query ? items.filter((item) => mediaSearchText(item).includes(query)) : items, [query]);
  const recentItems = useMemo(() => filterItems([...response.previous].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())), [filterItems, response.previous]);
  const liveItems = useMemo(() => filterItems([...response.live, ...response.scheduled]), [filterItems, response.live, response.scheduled]);
  const seriesGroups = useMemo(() => groupMediaBySeries(filterItems(response.previous)), [filterItems, response.previous]);
  const selectedSeriesKey = normalizeSeriesKey(searchParams.get("series"));
  const selectedSeries = seriesGroups.find((series) => series.key === selectedSeriesKey) || null;
  const allItems = useMemo(() => flattenServiceMedia(response), [response]);

  useEffect(() => {
    if (selectedSeriesKey) setView("series");
  }, [selectedSeriesKey]);

  function selectSeries(series: MediaSeriesGroup | null) {
    const currentSeriesKey = normalizeSeriesKey(searchParams.get("series"));
    if ((series && currentSeriesKey === series.key) || (!series && !currentSeriesKey)) return;
    const next = new URLSearchParams(searchParams);
    if (series) next.set("series", series.key);
    else next.delete("series");
    setSearchParams(next);
  }

  if (loading && allItems.length === 0) return <MediaSkeleton />;

  return (
    <div className="mobile-page mx-auto max-w-6xl space-y-5">
      <SectionNav section="community" label="Comunidad" />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mobile-section-title">Comunidad</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Sermones</h1>
          <p className="mt-1 text-sm text-muted-foreground">Mensajes, series y transmisiones de {selectedChurch?.name || "tu iglesia"}.</p>
        </div>
        <Button variant="outline" onClick={() => loadPage({ silent: true, preferSnapshot: false })} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar
        </Button>
      </header>

      <label className="relative block">
        <span className="sr-only">Buscar sermones</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por serie, predicador o pasaje..." className="h-11 rounded-xl bg-card pl-10 text-base sm:text-sm" />
      </label>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p className="font-semibold">No pudimos cargar los sermones.</p><p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-3 border-red-200 bg-white text-red-700" onClick={() => loadPage({ preferSnapshot: false })}>Reintentar</Button>
        </div>
      )}

      <Tabs value={view} onValueChange={(value) => { setView(value as MediaView); if (value !== "series") selectSeries(null); }}>
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-border bg-card p-1">
          <TabsTrigger value="recent">Recientes</TabsTrigger>
          <TabsTrigger value="series">Series</TabsTrigger>
          <TabsTrigger value="live">En vivo</TabsTrigger>
        </TabsList>

        <TabsContent value="recent" className="mt-4">
          <MediaGrid items={recentItems} emptyTitle="Aún no hay sermones" emptyDescription="Los mensajes anteriores aparecerán aquí cuando tengan audio o video." />
        </TabsContent>

        <TabsContent value="series" className="mt-4 space-y-4">
          {selectedSeries ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div><p className="mobile-section-title">Serie</p><h2 className="mt-1 text-2xl font-semibold text-foreground">{selectedSeries.label}</h2></div>
                <Button variant="outline" onClick={() => selectSeries(null)}>Todas las series</Button>
              </div>
              <MediaGrid items={selectedSeries.items} emptyTitle="Esta serie está vacía" emptyDescription="Prueba otra serie." />
            </>
          ) : seriesGroups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center"><Video className="mx-auto h-9 w-9 text-primary" /><p className="mt-3 font-semibold text-foreground">Aún no hay series</p><p className="mt-1 text-sm text-muted-foreground">Asigna una serie a los sermones para organizarlos aquí.</p></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{seriesGroups.map((series) => <SeriesCard key={series.key} series={series} onSelect={() => selectSeries(series)} />)}</div>
          )}
        </TabsContent>

        <TabsContent value="live" className="mt-4">
          <MediaGrid items={liveItems} emptyTitle="No hay transmisión ahora" emptyDescription="Las transmisiones en vivo y programadas aparecerán aquí." />
        </TabsContent>
      </Tabs>

      {canManage && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Settings2 className="h-4 w-4 text-primary" /> Configuración de transmisión
          </summary>
          <div className="border-t border-border p-4"><LiveDestinationSetup /></div>
        </details>
      )}
    </div>
  );
}
