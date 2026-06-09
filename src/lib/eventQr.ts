import QRCode from "qrcode";
import type { EventQrResponse } from "@/types/events";

export function isSignedEventQrValue(value: string) {
  return /^evqr_[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

export function extractSignedEventQrValue(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isSignedEventQrValue(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const candidates = [
      url.searchParams.get("qr"),
      url.searchParams.get("qrCode"),
      url.searchParams.get("token"),
      url.searchParams.get("code"),
      url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
      url.pathname.split("/").filter(Boolean).at(-1),
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && isSignedEventQrValue(candidate)) {
        return candidate.trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function getEventQrValue(qr: EventQrResponse | null | undefined) {
  if (!qr) return null;

  const value = extractSignedEventQrValue(
    qr.qrPayload ||
    qr.payload ||
    qr.qrValue ||
    qr.value ||
    qr.token ||
    qr.qrToken ||
    qr.code ||
    qr.qrUrl ||
    qr.url ||
    null
  );

  return value;
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

export async function createEventQrDataUrl(qr: EventQrResponse | null | undefined) {
  if (!qr) return null;

  const value = getEventQrValue(qr);
  if (value) {
    return QRCode.toDataURL(value, {
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
