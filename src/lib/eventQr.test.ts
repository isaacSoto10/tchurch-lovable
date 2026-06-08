import { describe, expect, it } from "vitest";
import { extractSignedEventQrValue, getEventQrValue, isSignedEventQrValue } from "@/lib/eventQr";

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
});
