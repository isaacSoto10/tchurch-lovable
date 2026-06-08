import QRCode from "qrcode";
import type { EventQrResponse } from "@/types/events";

function isSignedEventQrValue(value: string) {
  return /^evqr_[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

export function getEventQrValue(qr: EventQrResponse | null | undefined) {
  if (!qr) return null;

  const value =
    qr.qrPayload ||
    qr.payload ||
    qr.qrValue ||
    qr.value ||
    qr.token ||
    qr.qrToken ||
    qr.code ||
    null;

  if (typeof value === "string" && isSignedEventQrValue(value)) {
    return value.trim();
  }

  return null;
}

export async function createEventQrDataUrl(qr: EventQrResponse | null | undefined) {
  if (!qr) return null;
  if (typeof qr.dataUrl === "string" && qr.dataUrl.startsWith("data:image/")) return qr.dataUrl;
  if (typeof qr.imageUrl === "string" && qr.imageUrl.trim()) return qr.imageUrl;

  const value = getEventQrValue(qr);
  if (!value) return null;

  return QRCode.toDataURL(value, {
    margin: 1,
    width: 720,
    color: {
      dark: "#111827",
      light: "#ffffff",
    },
  });
}
