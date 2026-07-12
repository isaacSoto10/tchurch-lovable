import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));

import {
  completePlanningCenterHandoff,
  dispatchPresentationAutomation,
  fetchPlanningCenterCatalog,
  fetchProPresenterExport,
  importPlanningCenterPlan,
  revokePresentationBroadcastLink,
} from "./presentationProduction";

describe("presentation production API requests", () => {
  beforeEach(() => mocks.apiFetch.mockReset());

  it("posts the mobile OAuth handoff once with an exact body and parses only the integration summary", async () => {
    const handoff = "h".repeat(43);
    mocks.apiFetch.mockResolvedValue({ schemaVersion: 4, integrations: [] });
    await expect(completePlanningCenterHandoff(handoff)).resolves.toEqual({ schemaVersion: 4, integrations: [] });
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe("/presentation-integrations/planning-center/complete");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ schemaVersion: 4, handoff });
    await expect(completePlanningCenterHandoff("short")).rejects.toThrow(/inválido/i);
  });

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

  it("marks Planning Center import as live and accepts a valid one-slide ProPresenter export", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ schemaVersion: 4, provider: "planning_center", operation: "preview", source: { serviceTypeId: "type-1", planId: "plan-1", title: "Domingo", dates: "12 jul" }, changes: { create: 1, update: 0, unchanged: 0, reorderedLocal: 0 }, applied: false, syncedAt: null })
      .mockResolvedValueOnce("Único slide sin separador");
    await importPlanningCenterPlan("service-1", { serviceTypeId: "type-1", planId: "plan-1", operation: "preview" });
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({ schemaVersion: 4, mode: "live", serviceTypeId: "type-1", planId: "plan-1", operation: "preview" });
    await expect(fetchProPresenterExport("service-1")).resolves.toBe("Único slide sin separador");
  });

  it("infers the required Planning Center resource and preserves bounded pagination offsets", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ schemaVersion: 4, provider: "planning_center", resource: "service_types", items: [], nextOffset: 25 })
      .mockResolvedValueOnce({ schemaVersion: 4, provider: "planning_center", resource: "plans", serviceTypeId: "type-1", items: [], nextOffset: 75 })
      .mockResolvedValueOnce({ schemaVersion: 4, provider: "planning_center", resource: "plan", serviceTypeId: "type-1", plan: { id: "plan-1", title: "Domingo", dates: "", sortDate: null }, items: [] });

    await fetchPlanningCenterCatalog({ offset: 25 });
    await fetchPlanningCenterCatalog({ serviceTypeId: "type-1", offset: 50 });
    await fetchPlanningCenterCatalog({ serviceTypeId: "type-1", planId: "plan-1" });

    expect(mocks.apiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/presentation-integrations/planning-center/catalog?resource=service_types&offset=25",
      "/presentation-integrations/planning-center/catalog?resource=plans&serviceTypeId=type-1&offset=50",
      "/presentation-integrations/planning-center/catalog?resource=plan&serviceTypeId=type-1&planId=plan-1",
    ]);
    expect(mocks.apiFetch.mock.calls.every(([, options]) => options.cache === "no-store")).toBe(true);
    await expect(fetchPlanningCenterCatalog({ planId: "plan-1" })).rejects.toThrow(/tipo de servicio es obligatorio/i);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
  });

  it("requires the canonical updated-list response after revoking a broadcast link", async () => {
    mocks.apiFetch.mockResolvedValue({ schemaVersion: 4, links: [] });
    await expect(revokePresentationBroadcastLink("service-1", "link-00000001")).resolves.toEqual({ schemaVersion: 4, links: [] });
    mocks.apiFetch.mockResolvedValueOnce({ schemaVersion: 4, revoked: true, linkId: "link-00000001" });
    await expect(revokePresentationBroadcastLink("service-1", "link-00000001")).rejects.toThrow(/incompatibles/i);
  });
});
