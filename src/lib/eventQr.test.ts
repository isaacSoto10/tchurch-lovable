import QRCode from "qrcode";
import { describe, expect, it, vi } from "vitest";
import {
  buildEventRegistrationPath,
  buildEventRegistrationUrl,
  buildEventQrScanPayload,
  createEventQrDataUrl,
  extractSignedEventQrValue,
  getEventQrScanPayload,
  getEventQrValue,
  isSignedEventQrValue,
} from "@/lib/eventQr";

const SIGNED_QR = "evqr_abcdefghijklmnopqrstuvwx.abcdefghijklmnop";

describe("event QR helpers", () => {
  it("accepts only signed opaque event QR values", () => {
    expect(isSignedEventQrValue(SIGNED_QR)).toBe(true);
    expect(isSignedEventQrValue("plain-code")).toBe(false);
    expect(isSignedEventQrValue("https://tchurchapp.com/app/events/event-1/qr")).toBe(false);
  });

  it("extracts signed values from wrapped URLs without accepting the URL itself", () => {
    expect(extractSignedEventQrValue(`https://tchurchapp.com/events/check-in?qr=${SIGNED_QR}`)).toBe(SIGNED_QR);
    expect(extractSignedEventQrValue(`tchurchapp://event-qr/${SIGNED_QR}`)).toBe(SIGNED_QR);
    expect(extractSignedEventQrValue(`https://tchurchapp.com/app/events/event-1/check-in?qr=${SIGNED_QR}`)).toBe(SIGNED_QR);
    expect(extractSignedEventQrValue(`/app/events/event-1/check-in?token=${SIGNED_QR}`)).toBe(SIGNED_QR);
    expect(extractSignedEventQrValue(`/app/events/event-1/qr?qr=${SIGNED_QR}`)).toBe(SIGNED_QR);
    expect(extractSignedEventQrValue(`/events/check-in?code=${SIGNED_QR}`)).toBe(SIGNED_QR);
    expect(extractSignedEventQrValue(`token=${SIGNED_QR}`)).toBe(SIGNED_QR);
    expect(extractSignedEventQrValue("https://tchurchapp.com/events/check-in?qr=plain-code")).toBeNull();
  });

  it("normalizes supported backend QR response shapes", () => {
    expect(getEventQrValue({ qrPayload: SIGNED_QR })).toBe(SIGNED_QR);
    expect(getEventQrValue({ qrUrl: `https://tchurchapp.com/events/check-in?token=${SIGNED_QR}` })).toBe(SIGNED_QR);
    expect(getEventQrValue({ payload: "/app/events/event-1/qr", token: SIGNED_QR })).toBe(SIGNED_QR);
    expect(getEventQrValue({ qrValue: "legacy-plain-code" })).toBeNull();
  });

  it("wraps signed tokens in explicit scan URLs", () => {
    expect(buildEventQrScanPayload(SIGNED_QR, { eventId: "event 1" })).toBe(
      `https://tchurchapp.com/event-check-in?token=${SIGNED_QR}&event=event+1`
    );
    expect(getEventQrScanPayload({ qrPayload: SIGNED_QR }, { eventId: "event-1" })).toBe(
      `https://tchurchapp.com/event-check-in?token=${SIGNED_QR}&event=event-1`
    );
    expect(getEventQrScanPayload({ qrUrl: `tchurchapp://app/events/event-1/check-in?qr=${SIGNED_QR}` })).toBe(
      `https://tchurchapp.com/event-check-in?token=${SIGNED_QR}&event=event-1`
    );
    expect(getEventQrScanPayload({ payload: `/app/events/event-2/qr?code=${SIGNED_QR}` })).toBe(
      `https://tchurchapp.com/event-check-in?token=${SIGNED_QR}&event=event-2`
    );
    expect(getEventQrScanPayload({ payload: `/events/check-in?code=${SIGNED_QR}` }, { eventId: "event-3" })).toBe(
      `https://tchurchapp.com/event-check-in?token=${SIGNED_QR}&event=event-3`
    );
  });

  it("builds shared event QR URLs for registration instead of check-in", () => {
    expect(buildEventRegistrationPath({
      id: "event-public",
      visibility: "public",
      publicUrl: "/iglesia/grace/eventos/dia-de-parque",
    })).toBe("/iglesia/grace/eventos/dia-de-parque");

    expect(buildEventRegistrationUrl({
      id: "event-private",
      visibility: "private",
      publicUrl: "/iglesia/grace/eventos/private-slug",
    })).toBe("https://tchurchapp.com/events/event-private?tab=registration");
  });

  it("uses rendered QR image fields from the backend when provided", async () => {
    const svgDataUrl = await createEventQrDataUrl({
      qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" /></svg>',
    });
    expect(svgDataUrl).toContain("data:image/svg+xml;charset=utf-8,");
    expect(svgDataUrl).toContain("%3Csvg");

    await expect(createEventQrDataUrl({ dataUrl: "not-an-image", qrPng: "iVBORw0KGgo=" })).resolves.toBe(
      "data:image/png;base64,iVBORw0KGgo="
    );
  });

  it("prefers locally rendered signed QR values over remote image URLs", async () => {
    const dataUrl = await createEventQrDataUrl({
      token: SIGNED_QR,
      imageUrl: "https://api.qrserver.com/v1/create-qr-code/?data=stale",
    });

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(dataUrl).not.toBe("https://api.qrserver.com/v1/create-qr-code/?data=stale");
  });

  it("renders explicit scan payloads instead of raw signed tokens", async () => {
    const toDataURL = vi.spyOn(QRCode, "toDataURL").mockResolvedValueOnce("data:image/png;base64,mock");

    await expect(createEventQrDataUrl({ token: SIGNED_QR }, { eventId: "event-1" })).resolves.toBe(
      "data:image/png;base64,mock"
    );
    expect(toDataURL).toHaveBeenCalledWith(
      `https://tchurchapp.com/event-check-in?token=${SIGNED_QR}&event=event-1`,
      expect.any(Object)
    );

    toDataURL.mockRestore();
  });
});
