import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchIntegrations: vi.fn(),
  fetchBroadcastLinks: vi.fn(),
  requestProPresenter: vi.fn(),
  obsConnect: vi.fn(),
  disconnectObs: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }));
vi.mock("@capacitor/browser", () => ({ Browser: { addListener: vi.fn(async () => ({ remove: vi.fn() })), open: vi.fn() } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" }, Filesystem: { writeFile: vi.fn(), deleteFile: vi.fn() } }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));

vi.mock("@/lib/presentationLocalConnectors", () => ({
  ObsWebSocketClient: class { connect = mocks.obsConnect; disconnect = vi.fn(); request = vi.fn(); },
  disconnectActivePresentationObsConnection: mocks.disconnectObs,
  getActivePresentationObsConnection: vi.fn(() => null),
  normalizePresentationConnectorEndpoint: (value: string) => value,
  readPresentationLocalConnectorSettings: vi.fn(() => ({ schemaVersion: 1, propresenterEndpoint: "http://localhost:50001", obsEndpoint: "ws://localhost:4455", studioBridgeEndpoint: "http://localhost:4317" })),
  requestProPresenter: mocks.requestProPresenter,
  setActivePresentationObsConnection: vi.fn(),
  writePresentationLocalConnectorSettings: vi.fn((_churchId, value) => value),
}));

vi.mock("@/lib/presentationProduction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentationProduction")>();
  return {
    ...actual,
    fetchPresentationIntegrations: mocks.fetchIntegrations,
    fetchPresentationBroadcastLinks: mocks.fetchBroadcastLinks,
    connectPlanningCenter: vi.fn(),
    disconnectPlanningCenter: vi.fn(),
    fetchPlanningCenterCatalog: vi.fn(),
    fetchProPresenterExport: vi.fn(),
    importPlanningCenterPlan: vi.fn(),
    createPresentationBroadcastLink: vi.fn(),
    revokePresentationBroadcastLink: vi.fn(),
  };
});

import { PresentationBroadcastPanel } from "./PresentationBroadcastPanel";
import { PresentationIntegrationsPanel } from "./PresentationIntegrationsPanel";
import { PRESENTATION_PLANNING_CENTER_RELAY_EVENT } from "@/lib/presentationProduction";

const integrationSummary = {
  schemaVersion: 4 as const,
  integrations: [
    { provider: "planning_center" as const, status: "not_connected" as const, externalOrganization: null, scopes: ["services" as const], connectedAt: null, lastSyncAt: null },
    { provider: "propresenter" as const, status: "local_only" as const, capabilities: ["text_export" as const, "local_api" as const] },
    { provider: "obs" as const, status: "local_only" as const, capabilities: ["browser_source" as const, "obs_websocket_5" as const] },
    { provider: "ndi_bridge" as const, status: "requires_tchurch_studio" as const, capabilities: ["frame_feed" as const] },
  ],
};

describe("presentation external-system permissions", () => {
  beforeEach(() => {
    mocks.fetchIntegrations.mockReset();
    mocks.fetchBroadcastLinks.mockReset();
    mocks.requestProPresenter.mockReset();
    mocks.obsConnect.mockReset();
    mocks.disconnectObs.mockReset();
    mocks.fetchIntegrations.mockResolvedValue(integrationSummary);
    mocks.requestProPresenter.mockResolvedValue({ connected: true, host: "localhost:50001", version: "20.1", platform: "macOS", name: "ProPresenter" });
  });

  it("does not let a band/member without controller authority mutate OBS or manage browser links", async () => {
    render(<PresentationBroadcastPanel serviceId="service-1" mode="live" churchId="church-1" privacyScope="member::band" canEdit={false} canOperateExternal={false} />);
    expect(screen.getByText("Browser Source").closest(".hidden")).not.toBeNull();
    expect(mocks.fetchBroadcastLinks).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("ws://localhost:4455")).toBeDisabled();
    expect(document.querySelector('input[type="password"]')).toBeDisabled();
    const connect = screen.getByRole("button", { name: "Conectar" });
    expect(connect).toBeDisabled();
    fireEvent.click(connect);
    expect(mocks.obsConnect).not.toHaveBeenCalled();
  });

  it("allows a local ProPresenter status check but blocks movement/export for a band member without production permission", async () => {
    const view = render(<PresentationIntegrationsPanel serviceId="service-1" serviceTitle="Domingo" mode="live" churchId="church-1" canEdit={false} canOperateExternal={false} canExportPublic={false} hasActivePresentationSession={false} />);
    await waitFor(() => expect(mocks.fetchIntegrations).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /Probar conexión/i }));
    await screen.findByText(/ProPresenter 20.1 conectado/i);
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Exportar texto/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Conectar con OAuth/i })).toBeDisabled();
    expect(mocks.requestProPresenter).toHaveBeenCalledTimes(1);
    expect(mocks.requestProPresenter).toHaveBeenCalledWith("http://localhost:50001", "status", { mode: "live" });
    view.unmount();
  });

  it("permits an operator to export public ProPresenter text without requiring the controller lease", async () => {
    render(<PresentationIntegrationsPanel serviceId="service-1" serviceTitle="Domingo" mode="live" churchId="church-1" canEdit={false} canOperateExternal={false} canExportPublic hasActivePresentationSession={false} />);
    await waitFor(() => expect(mocks.fetchIntegrations).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: /Exportar texto/i })).toBeEnabled();
  });

  it("shows fixed safe copy for a generic Planning Center callback failure", async () => {
    const view = render(<PresentationIntegrationsPanel serviceId="service-1" serviceTitle="Domingo" mode="live" churchId="church-1" canEdit canOperateExternal canExportPublic hasActivePresentationSession={false} />);
    await waitFor(() => expect(mocks.fetchIntegrations).toHaveBeenCalledOnce());

    act(() => {
      window.dispatchEvent(new CustomEvent(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, {
        detail: { serviceId: "service-1", outcome: "error", code: "OAUTH_CALLBACK_ERROR" },
      }));
    });

    expect(await screen.findByText("No se pudo completar la conexión con Planning Center. Intenta conectar otra vez.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("OAUTH_CALLBACK_ERROR");
    view.unmount();
  });
});
