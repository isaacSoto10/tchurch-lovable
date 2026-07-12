import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  PlanningCenterCatalogResponse,
  PlanningCenterImportResponse,
  PresentationIntegrationSummary,
} from "@/lib/presentationProduction";

const mocks = vi.hoisted(() => ({
  fetchIntegrations: vi.fn(),
  fetchCatalog: vi.fn(),
  importPlan: vi.fn(),
  connectPlanningCenter: vi.fn(),
  browserOpen: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }));
vi.mock("@capacitor/browser", () => ({ Browser: { addListener: vi.fn(async () => ({ remove: vi.fn() })), open: mocks.browserOpen } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" }, Filesystem: { writeFile: vi.fn(), deleteFile: vi.fn() } }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type SelectContextValue = { disabled: boolean; onValueChange: (value: string) => void };
  type SelectProps = { children?: ReactNode; disabled?: boolean; onValueChange: (value: string) => void; value?: string };
  type TriggerProps = { children?: ReactNode; "aria-label"?: string; className?: string };
  type ItemProps = { children?: ReactNode; value: string };
  const SelectContext = React.createContext<SelectContextValue | null>(null);
  return {
    Select: ({ children, disabled = false, onValueChange }: SelectProps) => React.createElement(SelectContext.Provider, { value: { disabled, onValueChange } }, React.createElement("div", null, children)),
    SelectTrigger: ({ children, "aria-label": ariaLabel, className }: TriggerProps) => {
      const context = React.useContext(SelectContext);
      return React.createElement("button", { type: "button", role: "combobox", "aria-label": ariaLabel, className, disabled: context?.disabled }, children);
    },
    SelectValue: ({ placeholder }: { placeholder?: string }) => React.createElement("span", null, placeholder || ""),
    SelectContent: ({ children }: { children?: ReactNode }) => React.createElement("div", null, children),
    SelectItem: ({ children, value }: ItemProps) => {
      const context = React.useContext(SelectContext);
      return React.createElement("button", { type: "button", role: "option", disabled: context?.disabled, onClick: () => context?.onValueChange(value) }, children);
    },
  };
});

vi.mock("@/lib/presentationLocalConnectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentationLocalConnectors")>();
  return {
    ...actual,
    readPresentationLocalConnectorSettings: vi.fn(() => ({ schemaVersion: 1, propresenterEndpoint: "http://localhost:50001", obsEndpoint: "ws://localhost:4455", studioBridgeEndpoint: "http://localhost:4317" })),
  };
});

vi.mock("@/lib/presentationProduction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentationProduction")>();
  return {
    ...actual,
    fetchPresentationIntegrations: mocks.fetchIntegrations,
    fetchPlanningCenterCatalog: mocks.fetchCatalog,
    importPlanningCenterPlan: mocks.importPlan,
    connectPlanningCenter: mocks.connectPlanningCenter,
    disconnectPlanningCenter: vi.fn(),
    fetchProPresenterExport: vi.fn(),
  };
});

import { PresentationIntegrationsPanel } from "./PresentationIntegrationsPanel";
import { PRESENTATION_PLANNING_CENTER_RELAY_EVENT } from "@/lib/presentationProduction";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function integrationSummary(status: "connected" | "not_connected", organization = "Tchurch"): PresentationIntegrationSummary {
  return {
    schemaVersion: 4,
    integrations: [
      {
        provider: "planning_center",
        status,
        externalOrganization: status === "connected" ? { id: `org-${organization}`, name: organization } : null,
        scopes: ["services"],
        connectedAt: status === "connected" ? "2026-07-12T13:00:00.000Z" : null,
        lastSyncAt: null,
      },
      { provider: "propresenter", status: "local_only", capabilities: ["text_export", "local_api"] },
      { provider: "obs", status: "local_only", capabilities: ["browser_source", "obs_websocket_5"] },
      { provider: "ndi_bridge", status: "requires_tchurch_studio", capabilities: ["frame_feed"] },
    ],
  };
}

function serviceTypes(items: Array<{ id: string; name: string }>, nextOffset: number | null = null): PlanningCenterCatalogResponse {
  return { schemaVersion: 4, provider: "planning_center", resource: "service_types", items, nextOffset };
}

function plans(serviceTypeId: string, items: Array<{ id: string; title: string }>): PlanningCenterCatalogResponse {
  return {
    schemaVersion: 4,
    provider: "planning_center",
    resource: "plans",
    serviceTypeId,
    items: items.map((item) => ({ ...item, dates: "12 jul", sortDate: "2026-07-12" })),
    nextOffset: null,
  };
}

function importResult(serviceTypeId: string, planId: string, title: string): PlanningCenterImportResponse {
  return {
    schemaVersion: 4,
    provider: "planning_center",
    operation: "preview",
    source: { serviceTypeId, planId, title, dates: "12 jul" },
    changes: { create: 1, update: 0, unchanged: 0, reorderedLocal: 0 },
    applied: false,
    syncedAt: null,
  };
}

function panelProps(overrides: Partial<Parameters<typeof PresentationIntegrationsPanel>[0]> = {}): Parameters<typeof PresentationIntegrationsPanel>[0] {
  return {
    serviceId: "service-1",
    serviceTitle: "Domingo",
    mode: "live",
    accountId: "account-1",
    churchId: "church-1",
    externalAuthorityScope: "account-1::church-1::service-1::online::controller",
    canEdit: true,
    canOperateExternal: true,
    canExportPublic: true,
    hasActivePresentationSession: false,
    ...overrides,
  };
}

describe("Planning Center authority-bound requests", () => {
  beforeEach(() => {
    mocks.fetchIntegrations.mockReset();
    mocks.fetchCatalog.mockReset();
    mocks.importPlan.mockReset();
    mocks.connectPlanningCenter.mockReset();
    mocks.browserOpen.mockReset();
    mocks.browserOpen.mockResolvedValue(undefined);
    mocks.connectPlanningCenter.mockResolvedValue({ authorizeUrl: "https://api.planningcenteronline.com/oauth/authorize" });
    mocks.fetchCatalog.mockResolvedValue(serviceTypes([]));
  });

  it("drops a stale summary and catalog after the account and church identity change", async () => {
    const oldSummary = deferred<PresentationIntegrationSummary>();
    mocks.fetchIntegrations
      .mockReturnValueOnce(oldSummary.promise)
      .mockResolvedValueOnce(integrationSummary("connected", "Nueva iglesia"));
    mocks.fetchCatalog.mockResolvedValue(serviceTypes([{ id: "type-new", name: "Tipo nuevo" }]));
    const view = render(<PresentationIntegrationsPanel {...panelProps()} />);
    await waitFor(() => expect(mocks.fetchIntegrations).toHaveBeenCalledOnce());

    view.rerender(<PresentationIntegrationsPanel {...panelProps({ accountId: "account-2", churchId: "church-2", externalAuthorityScope: "account-2::church-2::service-1::online::controller" })} />);
    expect(await screen.findByText("Nueva iglesia")).toBeInTheDocument();
    await act(async () => oldSummary.resolve(integrationSummary("connected", "Iglesia anterior")));

    expect(screen.queryByText("Iglesia anterior")).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Tipo nuevo" })).toBeInTheDocument();
  });

  it("drops a stale load-more page after identity changes", async () => {
    const oldMore = deferred<PlanningCenterCatalogResponse>();
    let initialPage = 0;
    mocks.fetchIntegrations.mockResolvedValue(integrationSummary("connected"));
    mocks.fetchCatalog.mockImplementation((input: { offset?: number }) => {
      if (input.offset === 25) return oldMore.promise;
      initialPage += 1;
      return Promise.resolve(initialPage === 1
        ? serviceTypes([{ id: "old-base", name: "Tipo anterior" }], 25)
        : serviceTypes([{ id: "new-base", name: "Tipo actual" }]));
    });
    const view = render(<PresentationIntegrationsPanel {...panelProps()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Cargar más tipos/i }));
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledWith({ offset: 25 }));

    view.rerender(<PresentationIntegrationsPanel {...panelProps({ accountId: "account-2", churchId: "church-2", externalAuthorityScope: "account-2::church-2::service-1::online::controller" })} />);
    expect(await screen.findByRole("option", { name: "Tipo actual" })).toBeInTheDocument();
    await act(async () => oldMore.resolve(serviceTypes([{ id: "stale-more", name: "Tipo filtrado" }])));

    expect(screen.queryByRole("option", { name: "Tipo filtrado" })).not.toBeInTheDocument();
  });

  it("keeps only the newest service-type detail when selections resolve in reverse order", async () => {
    const plansA = deferred<PlanningCenterCatalogResponse>();
    mocks.fetchIntegrations.mockResolvedValue(integrationSummary("connected"));
    mocks.fetchCatalog.mockImplementation((input: { serviceTypeId?: string }) => {
      if (input.serviceTypeId === "type-a") return plansA.promise;
      if (input.serviceTypeId === "type-b") return Promise.resolve(plans("type-b", [{ id: "plan-b", title: "Plan B" }]));
      return Promise.resolve(serviceTypes([{ id: "type-a", name: "Tipo A" }, { id: "type-b", name: "Tipo B" }]));
    });
    render(<PresentationIntegrationsPanel {...panelProps()} />);

    fireEvent.click(await screen.findByRole("option", { name: "Tipo A" }));
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledWith({ serviceTypeId: "type-a" }));
    fireEvent.click(screen.getByRole("option", { name: "Tipo B" }));
    expect(await screen.findByRole("option", { name: /Plan B/ })).toBeInTheDocument();
    await act(async () => plansA.resolve(plans("type-a", [{ id: "plan-a", title: "Plan A" }])));

    expect(screen.queryByRole("option", { name: /Plan A/ })).not.toBeInTheDocument();
  });

  it("drops a preview response after the service-type and plan selection change", async () => {
    const previewA = deferred<PlanningCenterImportResponse>();
    mocks.fetchIntegrations.mockResolvedValue(integrationSummary("connected"));
    mocks.fetchCatalog.mockImplementation((input: { serviceTypeId?: string }) => {
      if (input.serviceTypeId === "type-a") return Promise.resolve(plans("type-a", [{ id: "plan-a", title: "Plan A" }]));
      if (input.serviceTypeId === "type-b") return Promise.resolve(plans("type-b", [{ id: "plan-b", title: "Plan B" }]));
      return Promise.resolve(serviceTypes([{ id: "type-a", name: "Tipo A" }, { id: "type-b", name: "Tipo B" }]));
    });
    mocks.importPlan.mockReturnValue(previewA.promise);
    render(<PresentationIntegrationsPanel {...panelProps()} />);

    fireEvent.click(await screen.findByRole("option", { name: "Tipo A" }));
    fireEvent.click(await screen.findByRole("option", { name: /Plan A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }));
    await waitFor(() => expect(mocks.importPlan).toHaveBeenCalledWith("service-1", { serviceTypeId: "type-a", planId: "plan-a", operation: "preview" }));
    fireEvent.click(screen.getByRole("option", { name: "Tipo B" }));
    fireEvent.click(await screen.findByRole("option", { name: /Plan B/ }));
    await act(async () => previewA.resolve(importResult("type-a", "plan-a", "Vista anterior")));

    expect(screen.queryByText("Vista anterior")).not.toBeInTheDocument();
    expect(screen.queryByText(/Vista previa lista/)).not.toBeInTheDocument();
  });

  it("ignores unsolicited and old-identity OAuth relays but accepts the initiated current identity", async () => {
    mocks.fetchIntegrations.mockResolvedValue(integrationSummary("not_connected"));
    const view = render(<PresentationIntegrationsPanel {...panelProps()} />);
    await screen.findByRole("button", { name: /Conectar con OAuth/i });

    act(() => window.dispatchEvent(new CustomEvent(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, {
      detail: { serviceId: "service-1", outcome: "complete", summary: integrationSummary("connected", "No solicitada") },
    })));
    expect(screen.queryByText("No solicitada")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Conectar con OAuth/i }));
    await waitFor(() => expect(mocks.browserOpen).toHaveBeenCalledOnce());
    view.rerender(<PresentationIntegrationsPanel {...panelProps({ accountId: "account-2", churchId: "church-2", externalAuthorityScope: "account-2::church-2::service-1::online::controller" })} />);
    await waitFor(() => expect(mocks.fetchIntegrations).toHaveBeenCalledTimes(2));
    act(() => window.dispatchEvent(new CustomEvent(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, {
      detail: { serviceId: "service-1", outcome: "complete", summary: integrationSummary("connected", "Identidad anterior") },
    })));
    expect(screen.queryByText("Identidad anterior")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Conectar con OAuth/i }));
    await waitFor(() => expect(mocks.browserOpen).toHaveBeenCalledTimes(2));
    act(() => window.dispatchEvent(new CustomEvent(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, {
      detail: { serviceId: "service-1", outcome: "complete", summary: integrationSummary("connected", "Identidad actual") },
    })));
    expect(await screen.findByText("Identidad actual")).toBeInTheDocument();
  });

  it("does not fetch Planning Center catalog metadata for a non-editor", async () => {
    mocks.fetchIntegrations.mockResolvedValue(integrationSummary("connected"));
    render(<PresentationIntegrationsPanel {...panelProps({ canEdit: false, canOperateExternal: false, externalAuthorityScope: "account-1::church-1::service-1::online::observer" })} />);
    expect(await screen.findByText("Tchurch")).toBeInTheDocument();
    expect(mocks.fetchCatalog).not.toHaveBeenCalled();
  });
});
