import QRCode from "qrcode";
import type { EventQrResponse } from "@/types/events";

export function getEventQrValue(qr: EventQrResponse | null | undefined, fallbackEventId?: string) {
  if (!qr) return null;

  const value =
    qr.qrPayload ||
    qr.payload ||
    qr.value ||
    qr.token ||
    qr.qrToken ||
    qr.code ||
    qr.url ||
    qr.qrUrl ||
    null;

  if (typeof value === "string" && value.trim()) return value.trim();

  if (fallbackEventId && (qr.id || qr.eventId || qr.userId)) {
    return JSON.stringify({
      eventId: qr.eventId || fallbackEventId,
      qrId: qr.id,
      userId: qr.userId,
    });
  }

  return null;
}

export async function createEventQrDataUrl(qr: EventQrResponse | null | undefined, fallbackEventId?: string) {
  if (!qr) return null;
  if (typeof qr.dataUrl === "string" && qr.dataUrl.startsWith("data:image/")) return qr.dataUrl;
  if (typeof qr.imageUrl === "string" && qr.imageUrl.trim()) return qr.imageUrl;

  const value = getEventQrValue(qr, fallbackEventId);
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
