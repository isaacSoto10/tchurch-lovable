import { describe, expect, it } from "vitest";
import { getQueuedEventCheckInDedupeKey } from "./eventCheckInQueue";

describe("event check-in queue dedupe keys", () => {
  it("prioritizes offlineClientId for queued scan and manual items", () => {
    expect(getQueuedEventCheckInDedupeKey("scan", {
      qrCode: "evqr_scan_token",
      offlineClientId: " offline-1 ",
    })).toBe("scan:offline:offline-1");

    expect(getQueuedEventCheckInDedupeKey("manual", {
      name: "Ada Lovelace",
      offlineClientId: " offline-1 ",
    })).toBe("manual:offline:offline-1");
  });

  it("falls back to QR value for repeated offline scans", () => {
    expect(getQueuedEventCheckInDedupeKey("scan", {
      qrValue: " EVQR_TOKEN ",
      scannedAt: "2026-06-09T00:00:00.000Z",
      source: "camera",
    })).toBe("scan:evqr_token");

    expect(getQueuedEventCheckInDedupeKey("scan", {
      token: " EVQR_TOKEN ",
      qrCode: "different-wrapper",
    })).toBe("scan:evqr_token");
  });

  it("falls back to member identity for manual check-ins", () => {
    expect(getQueuedEventCheckInDedupeKey("manual", { registrationId: " REG-1 " })).toBe("manual:reg-1");
    expect(getQueuedEventCheckInDedupeKey("manual", { userId: " USER-1 " })).toBe("manual:user-1");
    expect(getQueuedEventCheckInDedupeKey("manual", { email: " Leader@Church.com " })).toBe("manual:leader@church.com");
    expect(getQueuedEventCheckInDedupeKey("manual", { name: "  Maria   Lopez " })).toBe("manual:maria lopez");
  });
});
