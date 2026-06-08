import { describe, expect, it } from "vitest";
import { createEventQrDataUrl, extractSignedEventQrValue, getEventQrValue, isSignedEventQrValue } from "@/lib/eventQr";

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
    expect(extractSignedEventQrValue("https://tchurchapp.com/events/check-in?qr=plain-code")).toBeNull();
  });

  it("normalizes supported backend QR response shapes", () => {
    expect(getEventQrValue({ qrPayload: SIGNED_QR })).toBe(SIGNED_QR);
    expect(getEventQrValue({ qrUrl: `https://tchurchapp.com/events/check-in?token=${SIGNED_QR}` })).toBe(SIGNED_QR);
    expect(getEventQrValue({ qrValue: "legacy-plain-code" })).toBeNull();
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
});
