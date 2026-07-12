import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationService } from "@/lib/servicePresentation";
import type { PresentationWorkspace } from "@/lib/presentationWorkspace";

const mocks = vi.hoisted(() => ({
  accountId: "account-old",
  church: { id: "church-old", role: "ADMIN" },
  livePackage: null as unknown,
  apiFetch: vi.fn(),
  fetchWorkspace: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "service-shared" }),
}));

vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({ selectedChurch: mocks.church }),
}));

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ userId: mocks.accountId }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: mocks.apiFetch };
});

vi.mock("@/lib/presentationWorkspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentationWorkspace")>("@/lib/presentationWorkspace");
  return {
    ...actual,
    fetchPresentationWorkspaceForPreferredView: mocks.fetchWorkspace,
  };
});

vi.mock("@/hooks/usePresentationLive", () => ({
  usePresentationLive: () => ({
    snapshot: null,
    presentationPackage: mocks.livePackage,
    activeView: "operator",
    networkState: "online",
    offlineQueueCount: 0,
    isLocalState: false,
    controllerLeaseActive: false,
    timing: null,
    messages: [],
    loading: false,
    error: null,
    notice: null,
    commandPending: false,
    sendCommand: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    reconcileOffline: vi.fn(async () => undefined),
    discardOfflineChanges: vi.fn(async () => undefined),
    clearNotice: vi.fn(),
  }),
}));

vi.mock("@/components/presentation/PresentationLiveControls", () => ({
  LiveConnectionBadge: () => null,
  PresentationLiveNotice: () => null,
  PresentationOwnershipControls: () => null,
  PresentationRemoteSurface: () => null,
  PresentationStageMessages: () => null,
  PresentationTimingPanel: () => null,
}));

vi.mock("@/components/presentation/PresentationWorkspaceEditor", () => ({
  PresentationWorkspaceEditor: () => null,
}));

import ServicePresentation from "./ServicePresentation";

function service(title: string): PresentationService {
  return {
    id: "service-shared",
    title,
    date: "2026-07-11T19:00:00.000Z",
    type: "service",
    notes: null,
    items: [],
  };
}

function workspace(): PresentationWorkspace {
  return {
    schemaVersion: 1,
    serviceId: "service-shared",
    serviceVersion: "service-v1",
    viewer: { view: "editor", churchRole: "ADMIN", roles: ["all"], canEdit: true },
    items: [],
    legacyNotes: [],
    source: "api",
  };
}

describe("ServicePresentation load authority", () => {
  beforeEach(() => {
    mocks.accountId = "account-old";
    mocks.church = { id: "church-old", role: "ADMIN" };
    mocks.livePackage = null;
    mocks.apiFetch.mockReset();
    mocks.fetchWorkspace.mockReset();
    mocks.fetchWorkspace.mockResolvedValue(workspace());
  });

  it("fails closed and ignores a late load when account and church change with the same role", async () => {
    let resolveMiddle: (value: PresentationService) => void = () => undefined;
    const middleService = new Promise<PresentationService>((resolve) => { resolveMiddle = resolve; });
    mocks.apiFetch.mockImplementation((path: string) => {
      const accountAtRequest = mocks.accountId;
      if (path === "/users/me") return Promise.resolve({ id: accountAtRequest, email: `${accountAtRequest}@example.com` });
      if (accountAtRequest === "account-middle") return middleService;
      return Promise.resolve(service(accountAtRequest === "account-old" ? "Old private service" : "New private service"));
    });

    const view = render(<ServicePresentation />);
    await screen.findByText("Old private service");

    await act(async () => {
      mocks.livePackage = {
        scope: { accountId: "account-old", churchId: "church-old", view: "operator", roleFingerprint: "all" },
        service: service("Old cached private service"),
        presentation: workspace(),
      };
      mocks.accountId = "account-middle";
      mocks.church = { id: "church-middle", role: "ADMIN" };
      view.rerender(<ServicePresentation />);
    });
    expect(screen.queryByText("Old private service")).not.toBeInTheDocument();
    expect(screen.getByText("Preparando Tchurch Live")).toBeInTheDocument();

    await act(async () => {
      mocks.accountId = "account-new";
      mocks.church = { id: "church-new", role: "ADMIN" };
      view.rerender(<ServicePresentation />);
    });
    await screen.findByText("New private service");

    await act(async () => {
      resolveMiddle(service("Late middle private service"));
      await middleService;
    });
    await waitFor(() => expect(screen.getByText("New private service")).toBeInTheDocument());
    expect(screen.queryByText("Late middle private service")).not.toBeInTheDocument();
  });
});
