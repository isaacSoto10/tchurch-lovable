import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_STAGE_LAYOUTS, DEFAULT_PRESENTATION_THEME } from "@/lib/presentationOutput";

const api = vi.hoisted(() => ({
  fetchPresentationOutputConfig: vi.fn(),
  fetchPresentationOutputLinks: vi.fn(),
}));

vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }));
vi.mock("@/lib/presentationOutputApi", () => ({
  ...api,
  createPresentationLayout: vi.fn(),
  createPresentationOutputLink: vi.fn(),
  createPresentationTheme: vi.fn(),
  deletePresentationLayout: vi.fn(),
  deletePresentationTheme: vi.fn(),
  revokePresentationOutputLink: vi.fn(),
  updatePresentationLayout: vi.fn(),
  updatePresentationOutputConfig: vi.fn(),
  updatePresentationTheme: vi.fn(),
}));

import { PresentationOutputManager } from "./PresentationOutputManager";

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

const timestamp = "2026-07-12T12:00:00.000Z";

function layout(role: keyof typeof DEFAULT_PRESENTATION_STAGE_LAYOUTS) {
  return { ...DEFAULT_PRESENTATION_STAGE_LAYOUTS[role], churchId: "church-1", createdAt: timestamp, updatedAt: timestamp };
}

describe("PresentationOutputManager", () => {
  it("keeps the active preset name separate from Save as new", async () => {
    const theme = { ...DEFAULT_PRESENTATION_THEME, id: "theme-real", churchId: "church-1", name: "Tema real del santuario", version: 4, isDefault: false, createdAt: timestamp, updatedAt: timestamp };
    api.fetchPresentationOutputConfig.mockResolvedValue({
      schemaVersion: 3,
      serviceId: "service-1",
      version: 2,
      activeThemeId: theme.id,
      themeOverrides: null,
      roleLayoutIds: { worship_leader: null, musicians: null, preacher: null, production: null },
      themes: [theme],
      roleLayouts: [layout("worship_leader"), layout("musicians"), layout("preacher"), layout("production")],
      resolvedTheme: theme,
      resolvedRoleLayouts: { worship_leader: layout("worship_leader"), musicians: layout("musicians"), preacher: layout("preacher"), production: layout("production") },
    });
    api.fetchPresentationOutputLinks.mockResolvedValue({ schemaVersion: 3, links: [] });
    render(<PresentationOutputManager open onOpenChange={vi.fn()} serviceId="service-1" serviceTitle="Domingo" previewSlide={null} blackout={false} initialTab="themes" />);
    expect(await screen.findByDisplayValue("Tema real del santuario")).toHaveAttribute("aria-label", "Nombre del tema activo");
    expect(screen.getByLabelText("Nombre del tema nuevo")).toHaveValue("Tema nuevo");
  });
});
