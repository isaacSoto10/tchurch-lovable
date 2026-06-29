export type MediaProvider = "youtube" | "vimeo" | "facebook" | "resi" | "cloudflare" | "hls" | "custom" | "external";
export type MediaEmbedKind = "iframe" | "hls" | "video" | "audio" | "link";
export type ServiceMediaPlaybackKind = "iframe" | "hls" | "video" | "audio" | "external";

export type ServiceMediaPlayback = {
  kind: ServiceMediaPlaybackKind;
  provider: MediaProvider;
  sourceUrl: string | null;
  embedUrl: string | null;
  hlsUrl: string | null;
  externalUrl: string | null;
  thumbnailUrl: string | null;
  canInlineIos: boolean;
  requiresExternalBrowser: boolean;
};

export type ServiceMediaEntry = {
  id: string;
  serviceId: string;
  serviceItemId: string | null;
  destinationId: string | null;
  title: string;
  serviceTitle: string;
  date: string;
  type: string;
  provider: MediaProvider;
  providerLabel: string;
  streamStatus: string | null;
  playbackUrl: string | null;
  livestreamUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  externalUrl: string | null;
  embedUrl: string | null;
  hlsUrl: string | null;
  thumbnailUrl: string | null;
  speaker: string | null;
  scripture: string | null;
  series: string | null;
  description: string | null;
  playback?: ServiceMediaPlayback | null;
  isLive: boolean;
  isScheduled: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type LiveDestination = {
  id: string;
  provider: string;
  name: string;
  description?: string | null;
  status: string;
  streamStatus: string;
  playbackUrl: string | null;
  embedUrl: string | null;
  hlsUrl: string | null;
  rtmpServerUrl?: string | null;
  srtUrl?: string | null;
  cloudflareLiveInputId?: string | null;
  cloudflareUid?: string | null;
  metadata?: Record<string, unknown>;
  hasCredentials?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ServiceMediaResponse = {
  live: ServiceMediaEntry[];
  scheduled: ServiceMediaEntry[];
  previous: ServiceMediaEntry[];
  destinations: LiveDestination[];
  generatedAt: string;
  refreshAfterSeconds?: number;
};

export type ServiceMediaDetailResponse = {
  entry: ServiceMediaEntry;
  generatedAt: string;
  refreshAfterSeconds?: number;
};

export type MediaSnapshot = {
  response: ServiceMediaResponse;
};

export type MediaEmbed = {
  kind: MediaEmbedKind;
  provider: MediaProvider;
  providerLabel: string;
  sourceUrl: string | null;
  embedUrl: string | null;
  allow?: string;
};

type SnapshotEnvelope<T> = {
  savedAt: number;
  value: T;
};

type ReadMediaSnapshotOptions = {
  allowStale?: boolean;
};

export const MEDIA_SNAPSHOT_TTL_MS = 2 * 60 * 1000;
export const MEDIA_SNAPSHOT_PREFIX = "tchurch_service_media_snapshot_v1";

const PROVIDER_LABELS: Record<MediaProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  facebook: "Facebook Live",
  resi: "Resi",
  cloudflare: "Tchurch / OBS",
  hls: "HLS",
  custom: "Personalizado",
  external: "Enlace",
};

const IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";

function trimmedUrl(value: string | null | undefined) {
  return value?.trim() || "";
}

export function normalizeMediaUrl(value: string | null | undefined): string | null {
  const raw = trimmedUrl(value);
  if (!raw) return null;

  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).toString();
    if (/^\/\//.test(raw)) return new URL(`https:${raw}`).toString();
    if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw)) return new URL(`https://${raw}`).toString();
  } catch {
    return raw;
  }

  return raw;
}

function parseMediaUrl(value: string | null | undefined): URL | null {
  const normalized = normalizeMediaUrl(value);
  if (!normalized) return null;

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function hostWithoutWww(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function isHost(url: URL, host: string) {
  const current = hostWithoutWww(url);
  return current === host || current.endsWith(`.${host}`);
}

function youtubeEmbedUrl(url: URL) {
  const id = isHost(url, "youtu.be")
    ? url.pathname.split("/").filter(Boolean)[0]
    : url.pathname.startsWith("/embed/")
      ? url.pathname.split("/").filter(Boolean)[1]
      : url.searchParams.get("v");
  return id ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1` : null;
}

function vimeoEmbedUrl(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const id = url.hostname.includes("player.vimeo.com")
    ? segments[segments.indexOf("video") + 1]
    : segments.find((segment) => /^\d{5,}$/.test(segment));

  return id ? `https://player.vimeo.com/video/${id}` : null;
}

function facebookEmbedUrl(sourceUrl: string) {
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(sourceUrl)}&show_text=false&autoplay=false`;
}

function isTrustedResiEmbed(url: URL) {
  const host = hostWithoutWww(url);
  const trusted =
    isHost(url, "resi.io") ||
    isHost(url, "resi.media") ||
    isHost(url, "resilive.com") ||
    isHost(url, "resionline.com") ||
    isHost(url, "pushpay.com") ||
    isHost(url, "pushpayevents.com");
  const path = url.pathname.toLowerCase();
  return trusted && (host.startsWith("embed.") || path.includes("embed") || path.includes("player") || path.includes("webplayer"));
}

function cloudflareStreamId(url: URL) {
  const host = hostWithoutWww(url);
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "iframe.videodelivery.net" || host === "watch.videodelivery.net") return segments[0] || null;
  if (host.endsWith("cloudflarestream.com") || host.endsWith("videodelivery.net")) {
    return segments.find((segment) => /^[\w-]{20,}$/.test(segment)) || segments[0] || null;
  }
  return null;
}

function cloudflareEmbedUrl(url: URL) {
  if (hostWithoutWww(url) === "iframe.videodelivery.net") return url.toString();
  const streamId = cloudflareStreamId(url);
  return streamId ? `https://iframe.videodelivery.net/${streamId}` : null;
}

function isHlsUrl(url: URL) {
  const value = `${url.pathname}${url.search}`.toLowerCase();
  return value.includes(".m3u8") || value.includes("format=m3u8");
}

function isSecureHlsUrl(url: URL) {
  return url.protocol === "https:" && isHlsUrl(url);
}

function firstNormalizedMediaUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeMediaUrl(value);
    if (normalized) return normalized;
  }
  return null;
}

function firstSecureHlsUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeMediaUrl(value);
    const url = parseMediaUrl(normalized);
    if (normalized && url && isSecureHlsUrl(url)) return normalized;
  }
  return null;
}

export function getMediaProvider(value: string | null | undefined, explicit?: string | null): MediaProvider {
  const normalizedExplicit = explicit?.trim().toLowerCase();
  if (normalizedExplicit) {
    if (["facebook", "facebooklive", "fb"].includes(normalizedExplicit)) return "facebook";
    if (["resi", "pushpay"].includes(normalizedExplicit)) return "resi";
    if (["cloudflare", "cloudflarestream", "obs", "tchurch"].includes(normalizedExplicit)) return "cloudflare";
    if (["hls", "m3u8"].includes(normalizedExplicit)) return "hls";
    if (["youtube", "vimeo", "custom", "external"].includes(normalizedExplicit)) return normalizedExplicit as MediaProvider;
  }

  const url = parseMediaUrl(value);
  if (!url) return "custom";

  if (isHost(url, "youtube.com") || isHost(url, "youtu.be") || isHost(url, "youtube-nocookie.com")) return "youtube";
  if (isHost(url, "vimeo.com")) return "vimeo";
  if (isHost(url, "facebook.com") || isHost(url, "fb.watch")) return "facebook";
  if (isHost(url, "resi.io") || isHost(url, "resi.media") || isHost(url, "resilive.com") || isHost(url, "resionline.com") || isHost(url, "pushpay.com")) return "resi";
  if (isHost(url, "videodelivery.net") || isHost(url, "cloudflarestream.com")) return "cloudflare";
  if (isHlsUrl(url)) return "hls";

  return "external";
}

function embed(kind: MediaEmbedKind, provider: MediaProvider, sourceUrl: string | null, embedUrl: string | null): MediaEmbed {
  return {
    kind,
    provider,
    providerLabel: PROVIDER_LABELS[provider],
    sourceUrl,
    embedUrl,
    allow: kind === "iframe" ? IFRAME_ALLOW : undefined,
  };
}

function playbackKindToEmbedKind(kind: ServiceMediaPlaybackKind): MediaEmbedKind {
  return kind === "external" ? "link" : kind;
}

export function getUrlMediaEmbed(value: string | null | undefined, explicitProvider?: string | null): MediaEmbed {
  const normalized = normalizeMediaUrl(value);
  const url = parseMediaUrl(normalized);
  const provider = getMediaProvider(normalized, explicitProvider);

  if (!normalized || !url) return embed("link", "custom", normalized, null);
  if (isHlsUrl(url)) return embed(isSecureHlsUrl(url) ? "hls" : "link", provider, normalized, isSecureHlsUrl(url) ? normalized : null);
  if (provider === "youtube") return embed("iframe", "youtube", normalized, youtubeEmbedUrl(url));
  if (provider === "vimeo") return embed("iframe", "vimeo", normalized, vimeoEmbedUrl(url));
  if (provider === "facebook") return embed("iframe", "facebook", normalized, facebookEmbedUrl(normalized));
  if (provider === "resi") return embed(isTrustedResiEmbed(url) ? "iframe" : "link", "resi", normalized, isTrustedResiEmbed(url) ? normalized : null);
  if (provider === "cloudflare") return embed("iframe", "cloudflare", normalized, cloudflareEmbedUrl(url));

  return embed("link", provider, normalized, null);
}

export function getMediaEmbed(item: ServiceMediaEntry | null | undefined): MediaEmbed {
  if (!item) return embed("link", "custom", null, null);
  const playback = item.playback || null;
  const sourceUrl = firstNormalizedMediaUrl(
    playback?.externalUrl,
    item.externalUrl,
    playback?.sourceUrl,
    item.playbackUrl,
    item.livestreamUrl,
    item.videoUrl,
    item.hlsUrl,
    item.audioUrl,
  );
  const provider = getMediaProvider(
    sourceUrl || playback?.hlsUrl || item.hlsUrl || playback?.embedUrl || item.embedUrl,
    playback?.provider || item.provider,
  );

  if (playback?.kind) {
    const kind = playbackKindToEmbedKind(playback.kind);
    const hlsUrl = firstSecureHlsUrl(playback.hlsUrl, playback.sourceUrl, item.hlsUrl, item.videoUrl, item.playbackUrl, item.livestreamUrl);
    if (kind === "hls") {
      if (hlsUrl) return embed("hls", provider, sourceUrl || hlsUrl, hlsUrl);
      if (playback.embedUrl) return embed("iframe", provider, sourceUrl || playback.embedUrl, playback.embedUrl);
      return embed("link", provider, sourceUrl || firstNormalizedMediaUrl(playback.sourceUrl, playback.externalUrl), null);
    }
    if (kind === "iframe" && playback.embedUrl) {
      return embed("iframe", provider, sourceUrl || playback.sourceUrl, playback.embedUrl);
    }
    if (kind === "audio") {
      const audioUrl = firstNormalizedMediaUrl(playback.sourceUrl, item.audioUrl, item.playbackUrl);
      if (audioUrl) return embed("audio", provider, sourceUrl || audioUrl, audioUrl);
    }
    if (kind === "video") {
      const videoUrl = firstNormalizedMediaUrl(playback.sourceUrl, item.videoUrl, item.playbackUrl, item.livestreamUrl);
      if (videoUrl) return embed("video", provider, sourceUrl || videoUrl, videoUrl);
    }
    if (kind === "link") {
      return embed("link", provider, sourceUrl || firstNormalizedMediaUrl(playback.sourceUrl, playback.externalUrl), null);
    }
  }

  if (item.hlsUrl) {
    const hlsUrl = firstSecureHlsUrl(item.hlsUrl);
    if (hlsUrl) {
      return embed("hls", provider === "cloudflare" ? "cloudflare" : "hls", sourceUrl || hlsUrl, hlsUrl);
    }
  }
  if (item.embedUrl) return embed("iframe", provider, sourceUrl, item.embedUrl);
  if (item.audioUrl && !item.videoUrl && !item.playbackUrl) return embed("audio", provider, sourceUrl, item.audioUrl);

  const fallback = getUrlMediaEmbed(sourceUrl, provider);
  if (fallback.embedUrl) return fallback;
  if (item.videoUrl) return embed("video", provider, sourceUrl, item.videoUrl);
  return fallback;
}

export function getServiceMediaEntryFromDetail(value: unknown): ServiceMediaEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ServiceMediaEntry> & { entry?: ServiceMediaEntry | null };
  if (record.entry?.id) return record.entry;
  return typeof record.id === "string" ? record as ServiceMediaEntry : null;
}

export function flattenServiceMedia(response: ServiceMediaResponse | null | undefined) {
  if (!response) return [];
  return [...response.live, ...response.scheduled, ...response.previous];
}

export function isMediaEndpointUnavailableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return [404, 405, 501].includes(Number((error as { status?: unknown }).status));
}

export function mediaSnapshotKey(churchId: string | null | undefined) {
  return `${MEDIA_SNAPSHOT_PREFIX}:${churchId || "no-church"}`;
}

export function isServiceMediaResponse(value: unknown): value is ServiceMediaResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<ServiceMediaResponse>;
  return Array.isArray(response.live) && Array.isArray(response.scheduled) && Array.isArray(response.previous);
}

export function isMediaSnapshot(value: unknown): value is MediaSnapshot {
  if (!value || typeof value !== "object") return false;
  return isServiceMediaResponse((value as Partial<MediaSnapshot>).response);
}

export function readMediaSnapshot(key: string, options?: ReadMediaSnapshotOptions): MediaSnapshot | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as SnapshotEnvelope<unknown>;
    if (!envelope?.savedAt) return null;
    if (!options?.allowStale && Date.now() - envelope.savedAt > MEDIA_SNAPSHOT_TTL_MS) return null;
    return isMediaSnapshot(envelope.value) ? envelope.value : null;
  } catch {
    return null;
  }
}

export function writeMediaSnapshot(key: string, value: MediaSnapshot) {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value } satisfies SnapshotEnvelope<MediaSnapshot>));
  } catch {
    // Best-effort cache for smoother native navigation.
  }
}

export function clearMediaSnapshots(churchId?: string | null) {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    if (churchId) {
      window.sessionStorage.removeItem(mediaSnapshotKey(churchId));
      return;
    }

    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(`${MEDIA_SNAPSHOT_PREFIX}:`)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cache cleanup after media mutations.
  }
}

export function formatMediaDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleDateString("es-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function mediaSearchText(item: ServiceMediaEntry) {
  return [
    item.title,
    item.serviceTitle,
    item.providerLabel,
    item.speaker,
    item.scripture,
    item.series,
    item.description,
    item.type,
  ].filter(Boolean).join(" ").toLowerCase();
}
