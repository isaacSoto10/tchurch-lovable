import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Loader2, Radio, RefreshCw, Search, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { LiveDestinationSetup } from "@/components/LiveDestinationSetup";
import { MediaEmbed, MediaExternalLink, MediaProviderBadge } from "@/components/MediaEmbed";
import {
  flattenServiceMedia,
  formatMediaDate,
  isMediaEndpointUnavailableError,
  mediaSearchText,
  mediaSnapshotKey,
  readMediaSnapshot,
  writeMediaSnapshot,
  type ServiceMediaEntry,
  type ServiceMediaResponse,
} from "@/lib/media";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";

const MEDIA_LIST_PATH = "/service-media?limit=140";

function roleCanManage(role?: string | null) {
  const normalized = String(role || "").toUpperCase();
  return normalized === "ADMIN" || normalized === "PLANNER";
}

function emptyResponse(): ServiceMediaResponse {
  return {
    live: [],
    scheduled: [],
    previous: [],
    destinations: [],
    generatedAt: new Date().toISOString(),
  };
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 shadow-sm">
      <p className="text-[0.68rem] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-zinc-950">{value}</p>
    </div>
  );
}

function MediaSkeleton() {
  return (
    <div className="mobile-page animate-pulse space-y-4">
      <div className="h-8 w-36 rounded-full bg-muted" />
      <div className="aspect-video rounded-lg bg-muted" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-20 rounded-lg bg-muted/80" />
        <div className="h-20 rounded-lg bg-muted/70" />
        <div className="h-20 rounded-lg bg-muted/60" />
      </div>
      <div className="space-y-3">
        <div className="h-24 rounded-lg bg-muted/70" />
        <div className="h-24 rounded-lg bg-muted/60" />
      </div>
    </div>
  );
}

function MediaCard({ item }: { item: ServiceMediaEntry }) {
  return (
    <Link
      to={`/app/media/${item.id}`}
      onPointerEnter={() => preloadAppRoute(`/app/media/${item.id}`)}
      onFocus={() => preloadAppRoute(`/app/media/${item.id}`)}
      onTouchStart={() => preloadAppRoute(`/app/media/${item.id}`)}
      className="group block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-black text-zinc-950 group-hover:text-primary">{item.title}</h3>
          <p className="mt-1 truncate text-sm font-medium text-zinc-500">{item.serviceTitle}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MediaProviderBadge item={item} />
            {item.series && <Badge variant="outline" className="bg-white">{item.series}</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs font-bold text-zinc-500">
          <CalendarDays className="h-3.5 w-3.5" />
          {formatMediaDate(item.date)}
        </div>
      </div>
      {(item.speaker || item.scripture || item.description) && (
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-600">
          {[item.speaker, item.scripture, item.description].filter(Boolean).join(" · ")}
        </p>
      )}
    </Link>
  );
}

function MediaGrid({ items, emptyLabel }: { items: ServiceMediaEntry[]; emptyLabel: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-12 text-center">
        <Radio className="mx-auto h-9 w-9 text-zinc-300" />
        <p className="mt-3 text-sm font-black text-zinc-800">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => <MediaCard key={item.id} item={item} />)}
    </div>
  );
}

export default function Media() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();
  const selectedChurchId = selectedChurch?.id ?? null;
  const canManage = roleCanManage(selectedChurch?.role);
  const hasLoadedPageRef = useRef(false);
  const [response, setResponse] = useState<ServiceMediaResponse>(() => emptyResponse());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const snapshotKey = mediaSnapshotKey(selectedChurchId);

  const applyResponse = useCallback((nextResponse: ServiceMediaResponse) => {
    setResponse(nextResponse);
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

    try {
      if (options?.silent) setRefreshing(true);
      const requestOptions = options?.preferSnapshot === false ? { cache: "no-store" as RequestCache } : undefined;
      const data = await fetchApi<ServiceMediaResponse>(MEDIA_LIST_PATH, requestOptions);
      applyResponse(data);
      writeMediaSnapshot(snapshotKey, { response: data });
    } catch (error) {
      if (isMediaEndpointUnavailableError(error)) {
        if (!snapshot) applyResponse(emptyResponse());
        return;
      }
      if (!snapshot) {
        toast({
          title: error instanceof Error ? error.message : "No se pudo cargar media",
          variant: "destructive",
        });
      }
    } finally {
      if (!options?.silent) setLoading(false);
      setRefreshing(false);
    }
  }, [applyResponse, fetchApi, snapshotKey, toast]);

  useEffect(() => {
    hasLoadedPageRef.current = false;
    setResponse(emptyResponse());
  }, [selectedChurchId]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const allItems = useMemo(() => flattenServiceMedia(response), [response]);
  const featured = response.live[0] || response.scheduled[0] || response.previous[0] || null;
  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return response;
    const filterItems = (items: ServiceMediaEntry[]) => items.filter((item) => mediaSearchText(item).includes(query));
    return {
      ...response,
      live: filterItems(response.live),
      scheduled: filterItems(response.scheduled),
      previous: filterItems(response.previous),
    };
  }, [query, response]);

  if (loading && allItems.length === 0) return <MediaSkeleton />;

  return (
    <div className="mobile-page space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">
            <Radio className="h-3.5 w-3.5" />
            Media
          </div>
          <h1 className="text-2xl font-black text-zinc-950 sm:text-3xl">Media</h1>
          <p className="mt-1 text-sm font-medium text-zinc-500">Servicios anteriores y transmisiones de {selectedChurch?.name || "tu iglesia"}.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadPage({ silent: true, preferSnapshot: false })} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </Button>
      </div>

      {featured && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-black uppercase text-zinc-500">{featured.isLive ? "En vivo ahora" : "Destacado"}</h2>
            <MediaExternalLink item={featured} />
          </div>
          <MediaEmbed item={featured} compact />
          <div className="flex flex-wrap items-center gap-2">
            {featured.isLive && <Badge className="bg-red-600 text-white">En vivo</Badge>}
            {featured.isScheduled && <Badge className="bg-amber-500 text-white">Programado</Badge>}
            <MediaProviderBadge item={featured} />
            {featured.speaker && <Badge variant="outline" className="bg-white">{featured.speaker}</Badge>}
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="En vivo" value={response.live.length} />
        <StatTile label="Próximos" value={response.scheduled.length} />
        <StatTile label="Anteriores" value={response.previous.length} />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-zinc-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por serie, predicador, escritura..."
            className="h-10 border-0 bg-zinc-50 focus-visible:ring-1"
          />
        </div>
      </section>

      <Tabs defaultValue="previous" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-lg bg-muted p-1">
          <TabsTrigger value="live" className="rounded-md">En vivo</TabsTrigger>
          <TabsTrigger value="scheduled" className="rounded-md">Próximos</TabsTrigger>
          <TabsTrigger value="previous" className="rounded-md">Anteriores</TabsTrigger>
        </TabsList>
        <TabsContent value="live" className="mt-4">
          <MediaGrid items={filtered.live} emptyLabel="No hay transmisión en vivo ahora" />
        </TabsContent>
        <TabsContent value="scheduled" className="mt-4">
          <MediaGrid items={filtered.scheduled} emptyLabel="No hay transmisiones programadas" />
        </TabsContent>
        <TabsContent value="previous" className="mt-4">
          <MediaGrid items={filtered.previous} emptyLabel="Aún no hay servicios anteriores con media" />
        </TabsContent>
      </Tabs>

      {canManage && <LiveDestinationSetup />}

      {allItems.length === 0 && canManage && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-bold text-zinc-800">
            <Video className="h-4 w-4 text-primary" />
            Agrega campos de media en un elemento del servicio para que aparezca aquí.
          </p>
        </div>
      )}
    </div>
  );
}
