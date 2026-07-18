import { describe, expect, it } from "vitest";
import {
  MEDIA_SNAPSHOT_TTL_MS,
  getMediaEmbed,
  getMediaProvider,
  getRelatedMedia,
  groupMediaBySeries,
  getServiceMediaEntryFromDetail,
  getUrlMediaEmbed,
  isMediaEndpointUnavailableError,
  isLiveDestinationSelectable,
  readMediaSnapshot,
  normalizeMediaUrl,
  normalizeSeriesKey,
  searchServiceMedia,
  selectFeaturedMedia,
  type LiveDestination,
  type ServiceMediaEntry,
  type ServiceMediaPlayback,
  type ServiceMediaResponse,
} from "./media";

function entry(overrides: Partial<ServiceMediaEntry>): ServiceMediaEntry {
  return {
    id: "item",
    serviceId: "service",
    serviceItemId: "item",
    destinationId: null,
    title: "Servicio",
    serviceTitle: "Domingo",
    date: "2026-06-29T12:00:00.000Z",
    type: "livestream",
    provider: "custom",
    providerLabel: "Custom",
    streamStatus: null,
    playbackUrl: null,
    livestreamUrl: null,
    videoUrl: null,
    audioUrl: null,
    externalUrl: null,
    embedUrl: null,
    hlsUrl: null,
    thumbnailUrl: null,
    speaker: null,
    scripture: null,
    series: null,
    description: null,
    isLive: false,
    isScheduled: false,
    ...overrides,
  };
}

function playback(overrides: Partial<ServiceMediaPlayback>): ServiceMediaPlayback {
  return {
    kind: "external",
    provider: "external",
    sourceUrl: null,
    embedUrl: null,
    hlsUrl: null,
    externalUrl: null,
    thumbnailUrl: null,
    canInlineIos: false,
    requiresExternalBrowser: true,
    ...overrides,
  };
}

function response(mediaEntry: ServiceMediaEntry): ServiceMediaResponse {
  return {
    live: [mediaEntry],
    scheduled: [],
    previous: [],
    destinations: [],
    generatedAt: "2026-06-29T12:00:00.000Z",
  };
}

function destination(overrides: Partial<LiveDestination>): LiveDestination {
  return {
    id: "dest_1",
    provider: "cloudflare",
    name: "Tchurch OBS",
    description: null,
    status: "active",
    streamStatus: "offline",
    playbackUrl: "https://iframe.videodelivery.net/0123456789abcdefghijklmnop",
    embedUrl: "https://iframe.videodelivery.net/0123456789abcdefghijklmnop",
    hlsUrl: "https://videodelivery.net/0123456789abcdefghijklmnop/manifest/video.m3u8",
    rtmpServerUrl: null,
    srtUrl: null,
    cloudflareLiveInputId: "0123456789abcdefghijklmnop",
    cloudflareUid: "0123456789abcdefghijklmnop",
    metadata: {},
    hasCredentials: false,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("service media helpers", () => {
  it("normalizes bare URLs and detects livestream providers", () => {
    expect(normalizeMediaUrl("facebook.com/church/videos/12345")).toBe("https://facebook.com/church/videos/12345");
    expect(getMediaProvider("https://embed.resi.io/webplayer/video.html?id=abc")).toBe("resi");
    expect(getMediaProvider("https://iframe.videodelivery.net/0123456789abcdefghijklmnop")).toBe("cloudflare");
    expect(getMediaProvider("https://cdn.example.com/live/index.m3u8")).toBe("hls");
  });

  it("recognizes route-missing media endpoints as rollout-unavailable", () => {
    expect(isMediaEndpointUnavailableError({ status: 404 })).toBe(true);
    expect(isMediaEndpointUnavailableError({ status: 405 })).toBe(true);
    expect(isMediaEndpointUnavailableError({ status: 503, body: { code: "live_destinations_unavailable" } })).toBe(true);
    expect(isMediaEndpointUnavailableError({ status: 501 })).toBe(true);
    expect(isMediaEndpointUnavailableError({ status: 401 })).toBe(false);
    expect(isMediaEndpointUnavailableError({ status: 503 })).toBe(false);
    expect(isMediaEndpointUnavailableError(new Error("network"))).toBe(false);
  });

  it("builds safe iframe embeds and Resi fallbacks", () => {
    expect(getUrlMediaEmbed("https://www.facebook.com/church/videos/12345").embedUrl).toContain("facebook.com/plugins/video.php");
    expect(getUrlMediaEmbed("https://embed.resi.io/webplayer/video.html?id=abc").kind).toBe("iframe");
    expect(getUrlMediaEmbed("https://control.resi.io/events/abc").kind).toBe("link");
    expect(getUrlMediaEmbed("https://cdn.example.com/live/index.m3u8").kind).toBe("hls");
    expect(getUrlMediaEmbed("https://videodelivery.net/0123456789abcdefghijklmnop/manifest/video.m3u8").kind).toBe("hls");
    expect(getUrlMediaEmbed("https://watch.videodelivery.net/0123456789abcdefghijklmnop").embedUrl)
      .toBe("https://iframe.videodelivery.net/0123456789abcdefghijklmnop");
  });

  it("prefers API-provided HLS and embed URLs", () => {
    expect(getMediaEmbed(entry({ provider: "hls", hlsUrl: "https://cdn.example.com/live/index.m3u8" })).kind).toBe("hls");
    expect(getMediaEmbed(entry({ provider: "facebook", embedUrl: "https://www.facebook.com/plugins/video.php?href=x" })).kind).toBe("iframe");
    expect(getMediaEmbed(entry({ audioUrl: "https://cdn.example.com/message.mp3" })).kind).toBe("audio");
  });

  it("prefers backend playback HLS over Cloudflare or custom iframe embeds", () => {
    const cloudflare = getMediaEmbed(entry({
      provider: "cloudflare",
      embedUrl: "https://iframe.videodelivery.net/0123456789abcdefghijklmnop",
      playback: playback({
        kind: "hls",
        provider: "cloudflare",
        sourceUrl: "https://watch.videodelivery.net/0123456789abcdefghijklmnop",
        embedUrl: "https://iframe.videodelivery.net/0123456789abcdefghijklmnop",
        hlsUrl: "https://customer.videodelivery.net/0123456789abcdefghijklmnop/manifest/video.m3u8",
      }),
    }));

    expect(cloudflare.kind).toBe("hls");
    expect(cloudflare.provider).toBe("cloudflare");
    expect(cloudflare.embedUrl).toBe("https://customer.videodelivery.net/0123456789abcdefghijklmnop/manifest/video.m3u8");

    const custom = getMediaEmbed(entry({
      provider: "custom",
      embedUrl: "https://player.example.com/embed/service",
      playback: playback({
        kind: "hls",
        provider: "custom",
        sourceUrl: "https://cdn.example.com/service/master.m3u8",
        embedUrl: "https://player.example.com/embed/service",
      }),
    }));

    expect(custom.kind).toBe("hls");
    expect(custom.embedUrl).toBe("https://cdn.example.com/service/master.m3u8");

    const hlsWithoutSecureUrl = getMediaEmbed(entry({
      provider: "cloudflare",
      playback: playback({
        kind: "hls",
        provider: "cloudflare",
        sourceUrl: "http://cdn.example.com/service/master.m3u8",
        embedUrl: "https://iframe.videodelivery.net/0123456789abcdefghijklmnop",
      }),
    }));

    expect(hlsWithoutSecureUrl.kind).toBe("iframe");
    expect(hlsWithoutSecureUrl.embedUrl).toBe("https://iframe.videodelivery.net/0123456789abcdefghijklmnop");
  });

  it("honors backend playback kinds for iframe, video, audio, and external links", () => {
    expect(getMediaEmbed(entry({
      playback: playback({
        kind: "iframe",
        provider: "youtube",
        sourceUrl: "https://youtube.com/watch?v=abc123",
        embedUrl: "https://www.youtube.com/embed/abc123",
      }),
    }))).toMatchObject({ kind: "iframe", embedUrl: "https://www.youtube.com/embed/abc123" });

    expect(getMediaEmbed(entry({
      playback: playback({
        kind: "video",
        provider: "external",
        sourceUrl: "https://cdn.example.com/message.mp4",
      }),
    }))).toMatchObject({ kind: "video", embedUrl: "https://cdn.example.com/message.mp4" });

    expect(getMediaEmbed(entry({
      playback: playback({
        kind: "audio",
        provider: "external",
        sourceUrl: "https://cdn.example.com/message.mp3",
      }),
    }))).toMatchObject({ kind: "audio", embedUrl: "https://cdn.example.com/message.mp3" });

    expect(getMediaEmbed(entry({
      playback: playback({
        kind: "external",
        provider: "external",
        externalUrl: "https://example.com/service",
      }),
    }))).toMatchObject({ kind: "link", sourceUrl: "https://example.com/service" });
  });

  it("keeps trusted Facebook iframe playback inline even when old iOS flags are conservative", () => {
    const facebook = entry({
      provider: "facebook",
      embedUrl: "https://www.facebook.com/plugins/video.php?href=x",
      playback: playback({
        kind: "iframe",
        provider: "facebook",
        sourceUrl: "https://www.facebook.com/church/videos/12345",
        embedUrl: "https://www.facebook.com/plugins/video.php?href=x",
        externalUrl: "https://www.facebook.com/church/videos/12345",
        canInlineIos: false,
        requiresExternalBrowser: false,
      }),
    });

    expect(getMediaEmbed(facebook).kind).toBe("iframe");
    expect(getMediaEmbed(facebook, { respectIosPlaybackFlags: true })).toMatchObject({
      kind: "iframe",
      provider: "facebook",
      sourceUrl: "https://www.facebook.com/church/videos/12345",
      embedUrl: "https://www.facebook.com/plugins/video.php?href=x",
    });

    const externalOnly = entry({
      playback: playback({
        kind: "video",
        provider: "external",
        sourceUrl: "https://player.example.com/watch/service",
        requiresExternalBrowser: true,
      }),
    });

    expect(getMediaEmbed(externalOnly, { respectIosPlaybackFlags: true })).toMatchObject({
      kind: "link",
      sourceUrl: "https://player.example.com/watch/service",
    });
  });

  it("keeps allowed Facebook iframe embeds inline with an external fallback", () => {
    const facebook = entry({
      provider: "facebook",
      embedUrl: "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fchurch%2Fvideos%2F12345",
      playback: playback({
        kind: "external",
        provider: "facebook",
        sourceUrl: "https://www.facebook.com/church/videos/12345",
        embedUrl: "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fchurch%2Fvideos%2F12345",
        externalUrl: "https://www.facebook.com/church/videos/12345",
        canInlineIos: true,
        requiresExternalBrowser: false,
      }),
    });

    expect(getMediaEmbed(facebook, { respectIosPlaybackFlags: true })).toMatchObject({
      kind: "iframe",
      provider: "facebook",
      sourceUrl: "https://www.facebook.com/church/videos/12345",
      embedUrl: "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fchurch%2Fvideos%2F12345",
    });
  });

  it("only treats configured active live destinations as selectable", () => {
    expect(isLiveDestinationSelectable(destination({}))).toBe(true);
    expect(isLiveDestinationSelectable(destination({ status: "setup_required" }))).toBe(false);
    expect(isLiveDestinationSelectable(destination({ status: "inactive" }))).toBe(false);
    expect(isLiveDestinationSelectable(destination({
      provider: "cloudflare",
      playbackUrl: null,
      embedUrl: null,
      hlsUrl: null,
      cloudflareUid: null,
      cloudflareLiveInputId: null,
    }))).toBe(false);
    expect(isLiveDestinationSelectable(destination({
      provider: "hls",
      playbackUrl: "http://cdn.example.com/live/index.m3u8",
      embedUrl: null,
      hlsUrl: null,
      cloudflareUid: null,
      cloudflareLiveInputId: null,
    }))).toBe(false);
    expect(isLiveDestinationSelectable(destination({
      provider: "facebook",
      playbackUrl: "https://facebook.com/church/videos/12345",
      embedUrl: null,
      hlsUrl: null,
      cloudflareUid: null,
      cloudflareLiveInputId: null,
    }))).toBe(true);
  });

  it("falls back for cleartext HLS and keeps normal video playable", () => {
    expect(getUrlMediaEmbed("http://cdn.example.com/live/index.m3u8").kind).toBe("link");
    const mp4 = getMediaEmbed(entry({ provider: "external", videoUrl: "https://cdn.example.com/message.mp4" }));
    expect(mp4.kind).toBe("video");
    expect(mp4.embedUrl).toBe("https://cdn.example.com/message.mp4");
  });

  it("parses detail responses and can opt into stale snapshots", () => {
    const mediaEntry = entry({ id: "cached-service" });
    expect(getServiceMediaEntryFromDetail({ entry: mediaEntry })?.id).toBe("cached-service");
    expect(getServiceMediaEntryFromDetail(mediaEntry)?.id).toBe("cached-service");

    const key = "media-test:snapshot";
    window.sessionStorage.setItem(key, JSON.stringify({
      savedAt: Date.now() - MEDIA_SNAPSHOT_TTL_MS - 1000,
      value: { response: response(mediaEntry) },
    }));

    expect(readMediaSnapshot(key)).toBeNull();
    expect(readMediaSnapshot(key, { allowStale: true })?.response.live[0]?.id).toBe("cached-service");
    window.sessionStorage.removeItem(key);
  });

  it("groups series without splitting case, accents, or whitespace variants", () => {
    const grouped = groupMediaBySeries([
      entry({ id: "one", series: "Fe y Vida", date: "2026-06-01T12:00:00.000Z", thumbnailUrl: "https://example.com/old.jpg" }),
      entry({ id: "two", series: "  FÉ   Y VIDA ", date: "2026-06-08T12:00:00.000Z", thumbnailUrl: "https://example.com/latest.jpg" }),
      entry({ id: "three", series: null }),
    ]);

    expect(normalizeSeriesKey("  FÉ   Y VIDA ")).toBe("fe y vida");
    expect(grouped).toHaveLength(1);
    expect(grouped[0].items.map((item) => item.id)).toEqual(["two", "one"]);
    expect(grouped[0].coverUrl).toBe("https://example.com/latest.jpg");
  });

  it("selects the hero in live, recent, then upcoming priority order", () => {
    const live = entry({ id: "live", isLive: true, date: "2026-06-10T12:00:00.000Z" });
    const recent = entry({ id: "recent", date: "2026-06-09T12:00:00.000Z" });
    const older = entry({ id: "older", date: "2026-06-01T12:00:00.000Z" });
    const soon = entry({ id: "soon", isScheduled: true, date: "2026-06-12T12:00:00.000Z" });
    const later = entry({ id: "later", isScheduled: true, date: "2026-06-20T12:00:00.000Z" });

    expect(selectFeaturedMedia({ ...response(live), previous: [recent, older], scheduled: [later, soon] })?.id).toBe("live");
    expect(selectFeaturedMedia({ ...response(live), live: [], previous: [older, recent], scheduled: [later, soon] })?.id).toBe("recent");
    expect(selectFeaturedMedia({ ...response(live), live: [], previous: [], scheduled: [later, soon] })?.id).toBe("soon");
  });

  it("searches all media without accents and keeps live results first", () => {
    const live = entry({ id: "live", title: "Oración", isLive: true });
    const previous = entry({ id: "previous", title: "Una vida de oración", speaker: "José" });
    const unrelated = entry({ id: "unrelated", title: "Generosidad" });
    const mediaResponse: ServiceMediaResponse = {
      live: [live],
      scheduled: [],
      previous: [unrelated, previous],
      destinations: [],
      generatedAt: "2026-06-29T12:00:00.000Z",
    };

    expect(searchServiceMedia(mediaResponse, "oracion").map((item) => item.id)).toEqual(["live", "previous"]);
    expect(searchServiceMedia(mediaResponse, "jose").map((item) => item.id)).toEqual(["previous"]);
    expect(searchServiceMedia(mediaResponse, "vida jose").map((item) => item.id)).toEqual(["previous"]);
  });

  it("prefers related messages from the same series and otherwise falls back to recent", () => {
    const current = entry({ id: "current", series: "Fe y Vida", date: "2026-06-15T12:00:00.000Z" });
    const sameSeries = entry({ id: "same-series", series: "FÉ Y VIDA", date: "2026-06-08T12:00:00.000Z" });
    const recent = entry({ id: "recent", series: "Otra", date: "2026-06-12T12:00:00.000Z" });
    const mediaResponse: ServiceMediaResponse = {
      live: [],
      scheduled: [],
      previous: [current, recent, sameSeries],
      destinations: [],
      generatedAt: "2026-06-29T12:00:00.000Z",
    };

    expect(getRelatedMedia(current, mediaResponse).map((item) => item.id)).toEqual(["same-series"]);
    expect(getRelatedMedia(entry({ id: "standalone", series: null }), mediaResponse, 2).map((item) => item.id)).toEqual(["current", "recent"]);
  });
});
