import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchIntegrations: vi.fn(),
  fetchBroadcastLinks: vi.fn(),
  requestProPresenter: vi.fn(),
  obsConnect: vi.fn(),
  obsRequest: vi.fn(),
  obsClientDisconnect: vi.fn(),
  disconnectObs: vi.fn(),
  fetchCatalog: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }));
vi.mock("@capacitor/browser", () => ({ Browser: { addListener: vi.fn(async () => ({ remove: vi.fn() })), open: vi.fn() } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" }, Filesystem: { writeFile: vi.fn(), deleteFile: vi.fn() } }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));

vi.mock("@/lib/presentationLocalConnectors", () => ({
  ObsWebSocketClient: class { connect = mocks.obsConnect; disconnect = mocks.obsClientDisconnect; request = mocks.obsRequest; },
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
    fetchPlanningCenterCatalog: mocks.fetchCatalog,
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
    mocks.obsRequest.mockReset();
    mocks.obsClientDisconnect.mockReset();
    mocks.disconnectObs.mockReset();
    mocks.fetchCatalog.mockReset();
    mocks.fetchIntegrations.mockResolvedValue(integrationSummary);
    mocks.fetchBroadcastLinks.mockResolvedValue({ schemaVersion: 4, links: [] });
    mocks.requestProPresenter.mockResolvedValue({ connected: true, host: "localhost:50001", version: "20.1", platform: "macOS", name: "ProPresenter" });
    mocks.obsConnect.mockResolvedValue({ version: "5.5.0", rpcVersion: 1 });
    mocks.obsRequest.mockResolvedValue({ scenes: [{ sceneName: "Wide" }, { sceneName: "Cámara" }], currentProgramSceneName: "Wide" });
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

  it("disconnects OBS immediately when dynamic production authority is lost and also offers manual disconnect", async () => {
    const view = render(<PresentationBroadcastPanel serviceId="service-1" mode="live" churchId="church-1" privacyScope="operator-authority" canEdit canOperateExternal />);
    fireEvent.click(await screen.findByRole("button", { name: "Conectar" }));
    expect(await screen.findByText("Conectado · 5.5.0")).toBeInTheDocument();
    expect(mocks.obsRequest).toHaveBeenCalledWith("GetSceneList", {}, { mode: "live" });

    mocks.disconnectObs.mockClear();
    view.rerender(<PresentationBroadcastPanel serviceId="service-1" mode="live" churchId="church-1" privacyScope="band-authority" canEdit={false} canOperateExternal={false} />);
    await waitFor(() => expect(mocks.disconnectObs).toHaveBeenCalled());
    expect(screen.queryByText("Conectado · 5.5.0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeDisabled();

    view.rerender(<PresentationBroadcastPanel serviceId="service-1" mode="live" churchId="church-1" privacyScope="operator-authority-2" canEdit canOperateExternal />);
    fireEvent.click(await screen.findByRole("button", { name: "Conectar" }));
    await screen.findByText("Conectado · 5.5.0");
    mocks.disconnectObs.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(mocks.disconnectObs).toHaveBeenCalled();
    expect(await screen.findByText("OBS fue desconectado de este dispositivo.")).toBeInTheDocument();
  });

  it("loads Planning Center catalog pages one at a time and stops a stalled offset", async () => {
    mocks.fetchIntegrations.mockResolvedValue({
      ...integrationSummary,
      integrations: integrationSummary.integrations.map((item) => item.provider === "planning_center" ? {
        provider: "planning_center" as const,
        status: "connected" as const,
        externalOrganization: { id: "org-1", name: "Tchurch" },
        scopes: ["services" as const],
        connectedAt: "2026-07-12T13:00:00.000Z",
        lastSyncAt: null,
      } : item),
    });
    mocks.fetchCatalog
      .mockResolvedValueOnce({ schemaVersion: 4, provider: "planning_center", resource: "service_types", items: [{ id: "type-1", name: "Domingo" }], nextOffset: 25 })
      .mockResolvedValueOnce({ schemaVersion: 4, provider: "planning_center", resource: "service_types", items: [{ id: "type-1", name: "Domingo" }, { id: "type-2", name: "Miércoles" }], nextOffset: 25 });

    render(<PresentationIntegrationsPanel serviceId="service-1" serviceTitle="Domingo" mode="live" churchId="church-1" canEdit canOperateExternal canExportPublic hasActivePresentationSession={false} />);
    const loadMore = await screen.findByRole("button", { name: /Cargar más tipos/i });
    fireEvent.click(loadMore);
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenLastCalledWith({ offset: 25 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Cargar más tipos/i })).not.toBeInTheDocument());
  });
});
