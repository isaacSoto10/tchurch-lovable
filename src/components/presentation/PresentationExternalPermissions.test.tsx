import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchBroadcastLinks: vi.fn(),
  requestProPresenter: vi.fn(),
  obsConnect: vi.fn(),
  obsRequest: vi.fn(),
  obsClientDisconnect: vi.fn(),
  disconnectObs: vi.fn(),
}));

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
    fetchPresentationBroadcastLinks: mocks.fetchBroadcastLinks,
    fetchProPresenterExport: vi.fn(),
    createPresentationBroadcastLink: vi.fn(),
    revokePresentationBroadcastLink: vi.fn(),
  };
});

import { PresentationBroadcastPanel } from "./PresentationBroadcastPanel";
import { PresentationIntegrationsPanel } from "./PresentationIntegrationsPanel";

describe("presentation external-system permissions", () => {
  beforeEach(() => {
    mocks.fetchBroadcastLinks.mockReset();
    mocks.requestProPresenter.mockReset();
    mocks.obsConnect.mockReset();
    mocks.obsRequest.mockReset();
    mocks.obsClientDisconnect.mockReset();
    mocks.disconnectObs.mockReset();
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
    const view = render(<PresentationIntegrationsPanel serviceId="service-1" serviceTitle="Domingo" mode="live" churchId="church-1" externalAuthorityScope="account-1::church-1::service-1::online::observer" canOperateExternal={false} canExportPublic={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Probar conexión/i }));
    await screen.findByText(/ProPresenter 20.1 conectado/i);
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Exportar texto/i })).toBeDisabled();
    expect(mocks.requestProPresenter).toHaveBeenCalledTimes(1);
    expect(mocks.requestProPresenter).toHaveBeenCalledWith("http://localhost:50001", "status", { mode: "live" });
    view.unmount();
  });

  it("permits an operator to export public ProPresenter text without requiring the controller lease", async () => {
    render(<PresentationIntegrationsPanel serviceId="service-1" serviceTitle="Domingo" mode="live" churchId="church-1" externalAuthorityScope="account-1::church-1::service-1::online::observer" canOperateExternal={false} canExportPublic />);
    expect(screen.getByRole("button", { name: /Exportar texto/i })).toBeEnabled();
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

  it("drops an in-flight OBS connection and blocks manual controls when the live runtime goes offline", async () => {
    let resolveConnect!: (value: { version: string; rpcVersion: number }) => void;
    mocks.obsConnect.mockReturnValue(new Promise((resolve) => { resolveConnect = resolve; }));
    const view = render(<PresentationBroadcastPanel serviceId="service-1" mode="live" churchId="church-1" privacyScope="operator::online" canEdit canOperateExternal />);
    fireEvent.click(await screen.findByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(mocks.obsConnect).toHaveBeenCalledOnce());

    view.rerender(<PresentationBroadcastPanel serviceId="service-1" mode="live" churchId="church-1" privacyScope="operator::offline" canEdit canOperateExternal={false} />);
    await act(async () => resolveConnect({ version: "5.5.0", rpcVersion: 1 }));

    await waitFor(() => expect(mocks.obsClientDisconnect).toHaveBeenCalled());
    expect(screen.queryByText("Conectado · 5.5.0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeDisabled();
    expect(document.querySelector('input[type="password"]')).toBeDisabled();
  });

});
