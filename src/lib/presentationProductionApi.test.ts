import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));

import {
  dispatchPresentationAutomation,
  fetchProPresenterExport,
  revokePresentationBroadcastLink,
} from "./presentationProduction";

describe("presentation production API requests", () => {
  beforeEach(() => mocks.apiFetch.mockReset());

  it("sends the final automation event contract with client UUID and exact threshold fields", async () => {
    mocks.apiFetch.mockResolvedValue({ schemaVersion: 4, serviceId: "service-1", mode: "live", idempotent: false, simulated: false, actions: [] });
    await dispatchPresentationAutomation("service-1", {
      mode: "live",
      clientId: "11111111-1111-4111-8111-111111111111",
      event: { id: "22222222-2222-4222-8222-222222222222", type: "item_elapsed", occurredAt: "2026-07-12T13:00:00.000Z", sessionId: "session-0001", revision: 7, thresholdSeconds: 30, elapsedSeconds: 31 },
    });
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({
      schemaVersion: 4,
      mode: "live",
      clientId: "11111111-1111-4111-8111-111111111111",
      event: { id: "22222222-2222-4222-8222-222222222222", type: "item_elapsed", occurredAt: "2026-07-12T13:00:00.000Z", sessionId: "session-0001", revision: 7, thresholdSeconds: 30, elapsedSeconds: 31 },
    });
  });

  it("accepts a valid one-slide ProPresenter export", async () => {
    mocks.apiFetch.mockResolvedValueOnce("Único slide sin separador");
    await expect(fetchProPresenterExport("service-1")).resolves.toBe("Único slide sin separador");
  });

  it("requires the canonical updated-list response after revoking a broadcast link", async () => {
    mocks.apiFetch.mockResolvedValue({ schemaVersion: 4, links: [] });
    await expect(revokePresentationBroadcastLink("service-1", "link-00000001")).resolves.toEqual({ schemaVersion: 4, links: [] });
    mocks.apiFetch.mockResolvedValueOnce({ schemaVersion: 4, revoked: true, linkId: "link-00000001" });
    await expect(revokePresentationBroadcastLink("service-1", "link-00000001")).rejects.toThrow(/incompatibles/i);
  });
});
