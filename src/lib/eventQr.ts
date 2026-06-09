import QRCode from "qrcode";
import type { EventQrResponse } from "@/types/events";

const DEFAULT_EVENT_QR_ORIGIN = "https://tchurchapp.com";
const EVENT_QR_TOKEN_PARAMS = ["token", "qr", "code", "qrCode"];
const EVENT_QR_ROUTE_PREFIX = /^(app|events?|event-check-in)([/?#]|$)/i;

type EventRegistrationQrSource = {
  id: string;
  visibility?: string | null;
  publicUrl?: string | null;
};

export type EventQrScanPayloadOptions = {
  eventId?: string | null;
  origin?: string;
};

export function buildEventRegistrationPath(event: EventRegistrationQrSource) {
  const publicUrl = typeof event.publicUrl === "string" ? event.publicUrl.trim() : "";

  if (event.visibility === "public" && publicUrl) {
    return publicUrl;
  }

  return `/app/events/${encodeURIComponent(event.id)}/rsvp`;
}

export function buildEventRegistrationUrl(event: EventRegistrationQrSource, origin = DEFAULT_EVENT_QR_ORIGIN) {
  const path = buildEventRegistrationPath(event);
  if (/^https?:\/\//i.test(path)) return path;

  const root = origin.replace(/\/$/, "") || DEFAULT_EVENT_QR_ORIGIN;
  return new URL(path, root).toString();
}

export async function createEventRegistrationQrDataUrl(event: EventRegistrationQrSource, origin = DEFAULT_EVENT_QR_ORIGIN) {
  return QRCode.toDataURL(buildEventRegistrationUrl(event, origin), {
    margin: 1,
    width: 720,
    color: {
      dark: "#111827",
      light: "#ffffff",
    },
  });
}

export function isSignedEventQrValue(value: string) {
  return /^evqr_[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

function signedValueFromSearchParams(params: URLSearchParams) {
  for (const key of EVENT_QR_TOKEN_PARAMS) {
    const value = params.get(key);
    if (typeof value === "string" && isSignedEventQrValue(value)) return value.trim();
  }

  return null;
}

function signedValueFromSearchString(value: string) {
  const trimmed = value.trim().replace(/^[?#]/, "");
  if (!trimmed || !/(^|&)(token|qr|code|qrCode)=/.test(trimmed)) return null;
  return signedValueFromSearchParams(new URLSearchParams(trimmed));
}

function eventQrUrlFromString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed);
  } catch {
    if (trimmed.startsWith("/") || trimmed.startsWith("?") || EVENT_QR_ROUTE_PREFIX.test(trimmed)) {
      const relativePath = trimmed.startsWith("/") || trimmed.startsWith("?") ? trimmed : `/${trimmed}`;
      return new URL(relativePath, DEFAULT_EVENT_QR_ORIGIN);
    }
  }

  return null;
}

function eventRoutePath(url: URL) {
  if (url.protocol !== "tchurchapp:" || !url.hostname) return url.pathname;
  if (url.hostname === "tchurchapp.com" || url.hostname === "www.tchurchapp.com") return url.pathname;
  return `/${url.hostname}${url.pathname}`;
}

function eventIdFromQrUrl(value: unknown) {
  if (typeof value !== "string") return null;

  const url = eventQrUrlFromString(value);
  if (!url) return null;

  const eventParam = url.searchParams.get("event") || url.searchParams.get("eventId") || url.searchParams.get("event_id");
  if (eventParam?.trim()) return eventParam.trim();

  const segments = eventRoutePath(url).split("/").filter(Boolean);
  const appEventIndex = segments[0] === "app" && segments[1] === "events" ? 2 : -1;
  const webEventIndex = segments[0] === "events" && segments[1] !== "check-in" ? 1 : -1;
  const eventIndex = appEventIndex >= 0 ? appEventIndex : webEventIndex;
  if (eventIndex < 0) return null;

  const eventId = segments[eventIndex];
  const suffix = segments[eventIndex + 1];
  if (eventId && (!suffix || suffix === "check-in" || suffix === "qr" || suffix === "my-qr")) {
    return decodeURIComponent(eventId);
  }

  return null;
}

export function extractSignedEventQrValue(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isSignedEventQrValue(trimmed)) return trimmed;

  const directSearchValue = signedValueFromSearchString(trimmed);
  if (directSearchValue) return directSearchValue;

  const url = eventQrUrlFromString(trimmed);
  if (!url) return null;

  const searchValue = signedValueFromSearchParams(url.searchParams);
  if (searchValue) return searchValue;

  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hash) {
    if (isSignedEventQrValue(hash)) return hash.trim();
    const hashSearchValue = signedValueFromSearchString(hash);
    if (hashSearchValue) return hashSearchValue;
  }

  const pathValue = eventRoutePath(url).split("/").filter(Boolean).at(-1);
  if (typeof pathValue === "string" && isSignedEventQrValue(pathValue)) {
    return pathValue.trim();
  }

  return null;
}

export function getEventQrValue(qr: EventQrResponse | null | undefined) {
  if (!qr) return null;

  const candidates = [qr.qrPayload, qr.payload, qr.qrValue, qr.value, qr.token, qr.qrToken, qr.code, qr.qrUrl, qr.url];
  for (const candidate of candidates) {
    const value = extractSignedEventQrValue(candidate);
    if (value) return value;
  }

  return null;
}

export function buildEventQrScanPayload(signedValue: string, options: EventQrScanPayloadOptions = {}) {
  const token = signedValue.trim();
  const eventId = typeof options.eventId === "string" && options.eventId.trim() ? options.eventId.trim() : null;
  const url = new URL("/event-check-in", options.origin || DEFAULT_EVENT_QR_ORIGIN);
  url.searchParams.set("token", token);
  if (eventId) url.searchParams.set("event", eventId);
  return url.toString();
}

export function getEventQrScanPayload(qr: EventQrResponse | null | undefined, options: EventQrScanPayloadOptions = {}) {
  if (!qr) return null;

  const signedValue = getEventQrValue(qr);
  if (!signedValue) return null;

  const eventId =
    options.eventId ||
    qr.eventId ||
    [qr.qrPayload, qr.payload, qr.qrValue, qr.value, qr.qrUrl, qr.url].map(eventIdFromQrUrl).find(Boolean);

  return buildEventQrScanPayload(signedValue, {
    eventId,
    origin: options.origin,
  });
}

function getEventQrImageSource(qr: EventQrResponse) {
  const candidates = [
    { value: qr.dataUrl, type: null },
    { value: qr.imageUrl, type: null },
    { value: qr.qrPng, type: "png" },
    { value: qr.qrSvg, type: "svg+xml" },
  ];

  for (const candidate of candidates) {
    if (typeof candidate.value !== "string") continue;

    const trimmed = candidate.value.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("data:image/") || /^https?:\/\//i.test(trimmed)) return trimmed;

    if (candidate.type === "svg+xml" && (trimmed.startsWith("<svg") || trimmed.includes("<svg"))) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
    }

    if (candidate.type && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
      return `data:image/${candidate.type};base64,${trimmed}`;
    }
  }

  return null;
}

export async function createEventQrDataUrl(qr: EventQrResponse | null | undefined, options: EventQrScanPayloadOptions = {}) {
  if (!qr) return null;

  const payload = getEventQrScanPayload(qr, options);
  if (payload) {
    return QRCode.toDataURL(payload, {
      margin: 1,
      width: 720,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    });
  }

  return getEventQrImageSource(qr);
}
