import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch }));

import {
  createPresentationOutputLink,
  fetchPresentationOutputConfig,
  revokePresentationOutputLink,
  updatePresentationTheme,
  updatePresentationOutputConfig,
} from "./presentationOutputApi";
import { DEFAULT_PRESENTATION_STAGE_LAYOUTS, DEFAULT_PRESENTATION_THEME } from "./presentationOutput";

function link(revokedAt: string | null = null) {
  return { id: "link-1", serviceId: "service-1", label: "Santuario", createdAt: "2026-07-12T12:00:00.000Z", expiresAt: "2026-07-13T12:00:00.000Z", revokedAt, lastUsedAt: null };
}

function resolvedLayouts() {
  return Object.fromEntries(Object.entries(DEFAULT_PRESENTATION_STAGE_LAYOUTS).map(([role, layout]) => [role, {
    ...layout,
    churchId: "church-1",
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
  }]));
}

function config() {
  return {
    schemaVersion: 3,
    serviceId: "service-1",
    version: 2,
    activeThemeId: null,
    themeOverrides: null,
    roleLayoutIds: { worship_leader: null, musicians: null, preacher: null, production: null },
    themes: [],
    roleLayouts: [],
    resolvedTheme: DEFAULT_PRESENTATION_THEME,
    resolvedRoleLayouts: resolvedLayouts(),
  };
}

describe("presentation output authenticated API", () => {
  beforeEach(() => apiFetch.mockReset());

  it("uses the frozen no-store config path and optimistic update body", async () => {
    apiFetch.mockResolvedValue(config());
    await fetchPresentationOutputConfig("service/1");
    expect(apiFetch).toHaveBeenCalledWith("/services/service%2F1/presentation-output-config", { cache: "no-store" });

    await updatePresentationOutputConfig("service-1", { expectedVersion: 2, activeThemeId: null, themeOverrides: {}, roleLayoutIds: { preacher: "layout-1" } });
    const [, request] = apiFetch.mock.calls[1];
    expect(request.method).toBe("PUT");
    expect(JSON.parse(request.body)).toEqual({ schemaVersion: 3, expectedVersion: 2, activeThemeId: null, themeOverrides: {}, roleLayoutIds: { preacher: "layout-1" } });
  });

  it("keeps the one-time share fragment only in the create response and never in list payloads", async () => {
    const token = "A".repeat(48);
    apiFetch.mockResolvedValue({ schemaVersion: 3, link: link(), shareUrl: `https://www.tchurchapp.com/present#${token}` });
    const created = await createPresentationOutputLink("service-1", { label: "Santuario", ttlHours: 24 });
    expect(created.shareUrl).toContain(`#${token}`);
    expect(apiFetch.mock.calls[0][0]).not.toContain(token);
    expect(apiFetch.mock.calls[0][1].body).not.toContain(token);
  });

  it("accepts the exact first-party Vercel origin without trusting preview deployments", async () => {
    const token = "B".repeat(48);
    apiFetch.mockResolvedValueOnce({ schemaVersion: 3, link: link(), shareUrl: `https://tchurch.vercel.app/present#${token}` });
    await expect(createPresentationOutputLink("service-1", { label: "Santuario", ttlHours: 24 })).resolves.toMatchObject({ shareUrl: `https://tchurch.vercel.app/present#${token}` });
    apiFetch.mockResolvedValueOnce({ schemaVersion: 3, link: link(), shareUrl: `https://tchurch-preview.vercel.app/present#${token}` });
    await expect(createPresentationOutputLink("service-1", { label: "Santuario", ttlHours: 24 })).rejects.toThrow(/inválido/i);
  });

  it("revokes by idempotent DELETE without sending a share token", async () => {
    apiFetch.mockResolvedValue({ schemaVersion: 3, link: link("2026-07-12T13:00:00.000Z") });
    const revoked = await revokePresentationOutputLink("service-1", "link-1");
    expect(revoked.revokedAt).toBe("2026-07-12T13:00:00.000Z");
    const [, request] = apiFetch.mock.calls[0];
    expect(request.method).toBe("DELETE");
    expect(JSON.parse(request.body)).toEqual({ schemaVersion: 3, linkId: "link-1" });
  });

  it("propagates exact 409 current-state conflicts for config and preset updates", async () => {
    const configConflict = Object.assign(new Error("Version conflict"), {
      status: 409,
      body: { error: "VERSION_CONFLICT", message: "Newer config exists", current: config() },
    });
    apiFetch.mockRejectedValueOnce(configConflict);
    await expect(updatePresentationOutputConfig("service-1", { expectedVersion: 1, activeThemeId: null, themeOverrides: {}, roleLayoutIds: {} })).rejects.toBe(configConflict);
    expect(configConflict.body.current.version).toBe(2);

    const themeConflict = Object.assign(new Error("Version conflict"), {
      status: 409,
      body: { error: "VERSION_CONFLICT", message: "Newer theme exists", current: { id: "theme-1", version: 3 } },
    });
    apiFetch.mockRejectedValueOnce(themeConflict);
    await expect(updatePresentationTheme("theme-1", { expectedVersion: 2, name: "Domingo", isDefault: false, theme: DEFAULT_PRESENTATION_THEME })).rejects.toBe(themeConflict);
    expect(themeConflict.body.current.version).toBe(3);
  });
});
