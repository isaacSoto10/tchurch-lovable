import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Clock3,
  Film,
  Loader2,
  PlayCircle,
  Radio,
  RefreshCw,
  Search,
  Video,
} from "lucide-react";
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
  getMediaEmbed,
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

function isLiveMediaItem(item: ServiceMediaEntry | null | undefined) {
  return Boolean(item?.isLive || item?.streamStatus?.toLowerCase() === "live");
}

function featureLabel(item: ServiceMediaEntry | null) {
  if (!item) return "Media";
  if (isLiveMediaItem(item)) return "En vivo ahora";
  if (item.isScheduled) return "Próxima transmisión";
  return "Servicio destacado";
}

function featureMeta(item: ServiceMediaEntry | null) {
  if (!item) return "Transmisiones y servicios anteriores";
  return [item.providerLabel, formatMediaDate(item.date), item.speaker].filter(Boolean).join(" · ");
}

function StatTile({ label, value, tone }: { label: string; value: number | string; tone: "live" | "soon" | "archive" }) {
  const toneClass = {
    live: "from-red-50 to-white text-red-700 border-red-100",
    soon: "from-amber-50 to-white text-amber-700 border-amber-100",
    archive: "from-emerald-50 to-white text-emerald-700 border-emerald-100",
  }[tone];

  return (
    <div className={`media-card-enter rounded-2xl border bg-gradient-to-br px-3 py-3 shadow-sm ${toneClass}`}>
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

function MediaHero({
  item,
  churchName,
  refreshing,
  onRefresh,
}: {
  item: ServiceMediaEntry | null;
  churchName: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const isLive = isLiveMediaItem(item);

  return (
    <section className="media-hero-enter overflow-hidden rounded-[1.6rem] border border-zinc-900 bg-zinc-950 text-white shadow-[0_24px_70px_rgba(24,24,27,0.22)]">
      <div className="media-broadcast-scan relative grid min-h-[25rem] gap-5 p-4 sm:min-h-0 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-center">
        <div className="relative z-10 min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.68rem] font-black uppercase ${isLive ? "bg-red-500 text-white" : "bg-white/10 text-white"}`}>
              <span className={isLive ? "media-live-dot" : ""} />
              <Radio className="h-3.5 w-3.5" />
              {featureLabel(item)}
            </span>
            {item?.providerLabel && (
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[0.68rem] font-black uppercase text-white/80">
                {item.providerLabel}
              </span>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-black uppercase text-emerald-200">{churchName}</p>
            <h1 className="line-clamp-3 text-3xl font-black leading-[0.98] text-white sm:text-4xl">
              {item?.title || "Media"}
            </h1>
            <p className="max-w-xl text-sm font-medium leading-6 text-white/72">
              {item?.description || "Servicios anteriores y transmisiones de tu iglesia en un solo lugar."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-white/70">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {featureMeta(item)}
            </span>
            {item?.series && (
              <span className="rounded-full bg-white/10 px-3 py-1.5">{item.series}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {item ? (
              <Button asChild className="h-11 rounded-2xl bg-white text-zinc-950 hover:bg-white/90">
                <Link to={`/app/media/${item.id}`}>
                  <PlayCircle className="h-4 w-4" />
                  Ver ahora
                </Link>
              </Button>
            ) : null}
            {item ? <MediaExternalLink item={item} /> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              className="h-11 rounded-2xl border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualizar
            </Button>
          </div>
        </div>

        <div className="relative z-10 min-w-0">
          {item ? (
            <div className="media-player-lift overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-900 shadow-2xl">
              <MediaEmbed item={item} compact />
            </div>
          ) : (
            <div className="media-player-lift flex aspect-video min-h-52 items-center justify-center rounded-[1.35rem] border border-white/10 bg-white/[0.06]">
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-emerald-200">
                  <Film className="h-7 w-7" />
                </div>
                <p className="mt-3 text-sm font-black text-white">No hay transmisión activa</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function shouldShowInlineMediaCard(item: ServiceMediaEntry) {
  const embed = getMediaEmbed(item);
  const isPlayableInline = Boolean(embed.embedUrl) && ["iframe", "hls", "video"].includes(embed.kind);
  if (!isPlayableInline) return false;
  if (item.isLive || item.isScheduled || item.streamStatus) return true;
  if (item.type.toLowerCase().includes("live")) return true;
  return embed.provider === "facebook" || embed.provider === "resi" || item.playback?.kind === "iframe";
}

function MediaCard({ item, index }: { item: ServiceMediaEntry; index: number }) {
  const showInline = shouldShowInlineMediaCard(item);
  const isLive = isLiveMediaItem(item);
  const animationDelay = `${Math.min(index, 8) * 55}ms`;

  if (showInline) {
    return (
      <article
        className="media-card-enter group overflow-hidden rounded-[1.35rem] border border-zinc-200/90 bg-white p-3 shadow-sm shadow-zinc-200/60 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg"
        style={{ animationDelay }}
      >
        <div className="mb-4">
          <MediaEmbed item={item} compact />
        </div>

        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/app/media/${item.id}`}
              onPointerEnter={() => preloadAppRoute(`/app/media/${item.id}`)}
              onFocus={() => preloadAppRoute(`/app/media/${item.id}`)}
              onTouchStart={() => preloadAppRoute(`/app/media/${item.id}`)}
              className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <h3 className="line-clamp-2 text-base font-black text-zinc-950 group-hover:text-emerald-700">{item.title}</h3>
              <p className="mt-1 truncate text-sm font-medium text-zinc-500">{item.serviceTitle}</p>
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isLive && <Badge className="bg-red-600 text-white">En vivo</Badge>}
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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-9 rounded-xl">
            <Link to={`/app/media/${item.id}`}>
              <Video className="h-4 w-4" />
              Ver detalle
            </Link>
          </Button>
          <MediaExternalLink item={item} />
        </div>
      </article>
    );
  }

  return (
    <Link
      to={`/app/media/${item.id}`}
      onPointerEnter={() => preloadAppRoute(`/app/media/${item.id}`)}
      onFocus={() => preloadAppRoute(`/app/media/${item.id}`)}
      onTouchStart={() => preloadAppRoute(`/app/media/${item.id}`)}
      className="media-card-enter group block rounded-[1.35rem] border border-zinc-200/90 bg-white p-4 shadow-sm shadow-zinc-200/60 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ animationDelay }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-black text-zinc-950 group-hover:text-emerald-700">{item.title}</h3>
          <p className="mt-1 truncate text-sm font-medium text-zinc-500">{item.serviceTitle}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isLive && <Badge className="bg-red-600 text-white">En vivo</Badge>}
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
      <div className="media-card-enter rounded-[1.35rem] border border-dashed border-zinc-300 bg-white px-4 py-12 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
          <Radio className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-black text-zinc-800">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item, index) => <MediaCard key={item.id} item={item} index={index} />)}
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
      <MediaHero
        item={featured}
        churchName={selectedChurch?.name || "Tu iglesia"}
        refreshing={refreshing}
        onRefresh={() => loadPage({ silent: true, preferSnapshot: false })}
      />

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="En vivo" value={response.live.length} tone="live" />
        <StatTile label="Próximos" value={response.scheduled.length} tone="soon" />
        <StatTile label="Anteriores" value={response.previous.length} tone="archive" />
      </div>

      <section className="media-card-enter rounded-[1.35rem] border border-zinc-200/90 bg-white p-3 shadow-sm shadow-zinc-200/60">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500">
            <Search className="h-4 w-4" />
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por serie, predicador, escritura..."
            className="h-11 border-0 bg-zinc-50 text-base focus-visible:ring-1"
          />
        </div>
      </section>

      <Tabs defaultValue={response.live.length > 0 ? "live" : "previous"} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl bg-zinc-100 p-1">
          <TabsTrigger value="live" className="h-10 rounded-xl font-black data-[state=active]:bg-white data-[state=active]:shadow-sm">En vivo</TabsTrigger>
          <TabsTrigger value="scheduled" className="h-10 rounded-xl font-black data-[state=active]:bg-white data-[state=active]:shadow-sm">Próximos</TabsTrigger>
          <TabsTrigger value="previous" className="h-10 rounded-xl font-black data-[state=active]:bg-white data-[state=active]:shadow-sm">Anteriores</TabsTrigger>
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
        <div className="media-card-enter rounded-[1.35rem] border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-bold text-zinc-800">
            <Video className="h-4 w-4 text-primary" />
            Agrega campos de media en un elemento del servicio para que aparezca aquí.
          </p>
        </div>
      )}
    </div>
  );
}
