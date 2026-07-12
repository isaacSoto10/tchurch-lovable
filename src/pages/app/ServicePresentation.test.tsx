import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationLiveSnapshot, PresentationTiming } from "@/lib/presentationLive";
import type { PresentationService } from "@/lib/servicePresentation";
import type { PresentationWorkspace } from "@/lib/presentationWorkspace";

const mocks = vi.hoisted(() => ({
  accountId: "account-old",
  church: { id: "church-old", role: "ADMIN" },
  livePackage: null as unknown,
  liveSnapshot: null as PresentationLiveSnapshot | null,
  liveTiming: null as PresentationTiming | null,
  rehearsalSnapshot: null as PresentationLiveSnapshot | null,
  rehearsalTiming: null as PresentationTiming | null,
  liveControllerLeaseActive: false,
  rehearsalControllerLeaseActive: false,
  rehearsalError: null as string | null,
  liveSend: vi.fn(),
  rehearsalSend: vi.fn(),
  livePrepareRelease: vi.fn(),
  rehearsalPrepareRelease: vi.fn(),
  liveResume: vi.fn(),
  rehearsalResume: vi.fn(),
  audienceOutputProps: [] as Array<Record<string, unknown>>,
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
    snapshot: mocks.liveSnapshot,
    presentationPackage: mocks.livePackage,
    activeView: "operator",
    networkState: "online",
    offlineQueueCount: 0,
    isLocalState: false,
    controllerLeaseActive: mocks.liveControllerLeaseActive,
    timing: mocks.liveTiming,
    messages: [],
    loading: false,
    error: null,
    notice: null,
    commandPending: false,
    clientId: "11111111-1111-4111-8111-111111111111",
    sendCommand: mocks.liveSend,
    refresh: vi.fn(async () => undefined),
    reconcileOffline: vi.fn(async () => undefined),
    discardOfflineChanges: vi.fn(async () => undefined),
    clearNotice: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePresentationRehearsal", () => ({
  usePresentationRehearsal: () => ({
    snapshot: mocks.rehearsalSnapshot,
    activeView: "operator",
    networkState: "online",
    controllerLeaseActive: mocks.rehearsalControllerLeaseActive,
    timing: mocks.rehearsalTiming,
    messages: [],
    loading: false,
    error: mocks.rehearsalError,
    notice: null,
    commandPending: false,
    clientId: "22222222-2222-4222-8222-222222222222",
    clientName: "Test rehearsal",
    sendCommand: mocks.rehearsalSend,
    refresh: vi.fn(async () => mocks.rehearsalSnapshot),
    clearNotice: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePresentationAutomations", () => ({
  usePresentationAutomationRuleThresholds: () => ({ thresholds: { live: [], rehearsal: [] }, error: null }),
  usePresentationAutomations: ({ mode }: { mode: "live" | "rehearsal" }) => ({
    state: { phase: "idle", notice: null, queuedEvents: 0, lastAppliedAt: null },
    prepareSessionEnd: vi.fn(async () => 4),
    prepareControlRelease: mode === "live" ? mocks.livePrepareRelease : mocks.rehearsalPrepareRelease,
    resumeAfterControlRelease: mode === "live" ? mocks.liveResume : mocks.rehearsalResume,
    clearNotice: vi.fn(),
  }),
}));

vi.mock("@/components/presentation/PresentationAudienceOutput", () => ({
  PresentationAudienceOutput: (props: Record<string, unknown>) => {
    mocks.audienceOutputProps.push(props);
    return null;
  },
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

function workspace(legacyNotes: string[] = []): PresentationWorkspace {
  return {
    schemaVersion: 1,
    serviceId: "service-shared",
    serviceVersion: "service-v1",
    viewer: { view: "editor", churchRole: "ADMIN", roles: ["all"], canEdit: true },
    items: [],
    legacyNotes,
    source: "api",
  };
}

function stageService(): PresentationService {
  return {
    id: "service-shared",
    title: "Stage fixture",
    date: "2026-07-11T19:00:00.000Z",
    type: "service",
    notes: null,
    items: [
      {
        id: "countdown-item",
        title: "Cuenta congregacional",
        type: "other",
        position: 0,
        duration: 5,
        song: null,
        details: { presentation: { kind: "countdown", label: "Comenzamos", durationSeconds: 300 } },
      },
      {
        id: "next-item",
        title: "Segundo elemento privado",
        type: "other",
        position: 1,
        duration: 1,
        song: null,
        details: { presentation: { kind: "blank", tone: "black" } },
      },
    ],
  };
}

function timing(targetAt = "2026-07-11T19:00:47.000Z"): PresentationTiming {
  return {
    service: { status: "paused", plannedSeconds: 360, elapsedSeconds: 0, remainingSeconds: 360, overrunSeconds: 0, projectedEndAt: null, startedAt: null, pausedAt: null, accumulatedPausedMs: 0 },
    item: { itemId: "countdown-item", status: "paused", plannedSeconds: 300, elapsedSeconds: 0, overrunSeconds: 0, startedAt: null, pausedAt: null, accumulatedPausedMs: 0 },
    countdown: { durationSeconds: 47, targetAt, remainingSeconds: 47 },
  };
}

function liveSnapshot(show: { next: boolean; notes: boolean }, targetAt = "2026-07-11T19:00:47.000Z"): PresentationLiveSnapshot {
  const liveTiming = timing(targetAt);
  return {
    schemaVersion: 2,
    serviceId: "service-shared",
    serviceVersion: "service-v1",
    viewerVersion: "viewer-v1",
    serverNow: "2026-07-11T19:00:00.000Z",
    receivedAtMs: Date.parse("2026-07-11T19:00:00.000Z"),
    viewer: { view: "operator", roles: ["all"], canEdit: true, canStart: true, canControl: false, canForceTakeover: false },
    viewerLayout: {
      schemaVersion: 3,
      id: "private-layout",
      name: "Private layout",
      targetRole: "production",
      mode: "production",
      fontScale: 1,
      show: { current: true, next: show.next, notes: show.notes, chords: false, clock: false, serviceTimer: false, itemTimer: false, messages: false },
      version: 1,
    },
    session: {
      id: "session-1",
      mode: "live",
      status: "live",
      revision: 4,
      startedAt: "2026-07-11T18:59:00.000Z",
      endedAt: null,
      controller: null,
      presence: [],
      cursor: { itemId: "countdown-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
      display: { blackout: false, chordsVisible: true, broadcastVisible: true },
      playback: null,
      timing: liveTiming,
      messages: [],
      lastCommand: null,
    },
  };
}

function ownedSnapshot(mode: "live" | "rehearsal") {
  const value = liveSnapshot({ next: true, notes: true });
  value.session = value.session ? {
    ...value.session,
    id: `${mode}-session-1`,
    mode,
    controller: { clientId: mode === "live" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222", displayName: "Test controller", leaseExpiresAt: "2099-07-11T19:01:00.000Z", ownedByViewer: true },
  } : null;
  return value;
}

function releasedSnapshot(value: PresentationLiveSnapshot) {
  return { ...value, session: value.session ? { ...value.session, revision: value.session.revision + 1, controller: null } : null };
}

describe("ServicePresentation load authority", () => {
  beforeEach(() => {
    mocks.accountId = "account-old";
    mocks.church = { id: "church-old", role: "ADMIN" };
    mocks.livePackage = null;
    mocks.liveSnapshot = null;
    mocks.liveTiming = null;
    mocks.rehearsalSnapshot = null;
    mocks.rehearsalTiming = null;
    mocks.liveControllerLeaseActive = false;
    mocks.rehearsalControllerLeaseActive = false;
    mocks.rehearsalError = null;
    mocks.liveSend.mockReset();
    mocks.rehearsalSend.mockReset();
    mocks.livePrepareRelease.mockReset();
    mocks.rehearsalPrepareRelease.mockReset();
    mocks.liveResume.mockReset();
    mocks.rehearsalResume.mockReset();
    mocks.liveSend.mockResolvedValue(undefined);
    mocks.rehearsalSend.mockResolvedValue(undefined);
    mocks.livePrepareRelease.mockResolvedValue(4);
    mocks.rehearsalPrepareRelease.mockResolvedValue(4);
    mocks.audienceOutputProps = [];
    mocks.apiFetch.mockReset();
    mocks.fetchWorkspace.mockReset();
    mocks.fetchWorkspace.mockResolvedValue(workspace());
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
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

  it("keeps the live countdown on the authoritative server target across reconnect renders", async () => {
    const authoritativeTargetAt = "2026-07-11T19:00:47.000Z";
    mocks.liveSnapshot = liveSnapshot({ next: true, notes: true }, authoritativeTargetAt);
    mocks.liveTiming = timing(authoritativeTargetAt);
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId, email: "operator@example.com" })
      : Promise.resolve(stageService()));
    mocks.fetchWorkspace.mockResolvedValue(workspace(["Entrada después del contador"]));

    const view = render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    await waitFor(() => {
      const latest = mocks.audienceOutputProps.at(-1);
      expect(latest?.countdown).toEqual({ durationSeconds: 47, targetAt: authoritativeTargetAt });
      expect(latest?.authoritativePlayback).toBe(true);
    });

    mocks.liveSnapshot = {
      ...mocks.liveSnapshot,
      serverNow: "2026-07-11T19:00:12.000Z",
      receivedAtMs: Date.parse("2026-07-11T19:00:12.000Z"),
    };
    mocks.liveTiming = { ...timing(authoritativeTargetAt), countdown: { durationSeconds: 47, targetAt: authoritativeTargetAt, remainingSeconds: 35 } };
    view.rerender(<ServicePresentation />);

    await waitFor(() => {
      const latest = mocks.audienceOutputProps.at(-1);
      expect(latest?.countdown).toEqual({ durationSeconds: 47, targetAt: authoritativeTargetAt });
    });
  });

  it("hides next content while preserving notes when the phone role layout requests it", async () => {
    mocks.liveSnapshot = liveSnapshot({ next: false, notes: true });
    mocks.liveTiming = timing();
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId, email: "operator@example.com" })
      : Promise.resolve(stageService()));
    mocks.fetchWorkspace.mockResolvedValue(workspace(["Entrada después del contador"]));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");

    expect(screen.queryByText("Siguiente")).not.toBeInTheDocument();
    expect(screen.queryByText("Segundo elemento privado")).not.toBeInTheDocument();
    expect(screen.getByText("Entrada después del contador")).toBeInTheDocument();
  });

  it("hides notes while preserving next content when the phone role layout requests it", async () => {
    mocks.liveSnapshot = liveSnapshot({ next: true, notes: false });
    mocks.liveTiming = timing();
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId, email: "operator@example.com" })
      : Promise.resolve(stageService()));
    mocks.fetchWorkspace.mockResolvedValue(workspace(["Entrada después del contador"]));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");

    expect(screen.getByText("Siguiente")).toBeInTheDocument();
    expect(screen.getByText("Segundo elemento privado")).toBeInTheDocument();
    expect(screen.queryByText("Entrada después del contador")).not.toBeInTheDocument();
  });

  it("switches directly when this device does not own the current controller", async () => {
    mocks.liveSnapshot = liveSnapshot({ next: true, notes: true });
    mocks.liveTiming = timing();
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me" ? Promise.resolve({ id: mocks.accountId }) : Promise.resolve(stageService()));
    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Usar ensayo aislado" }));
    expect(screen.queryByRole("dialog", { name: "Confirmar cambio de modo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar ensayo aislado" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.liveSend).not.toHaveBeenCalledWith("release_control", expect.anything(), expect.anything());
  });

  it("drains and releases owned control before switching in both directions", async () => {
    mocks.liveSnapshot = ownedSnapshot("live");
    mocks.rehearsalSnapshot = ownedSnapshot("rehearsal");
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.rehearsalTiming = mocks.rehearsalSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.rehearsalControllerLeaseActive = true;
    mocks.livePrepareRelease.mockResolvedValue(9);
    mocks.rehearsalPrepareRelease.mockResolvedValue(12);
    mocks.liveSend.mockResolvedValue({ snapshot: releasedSnapshot(mocks.liveSnapshot), local: false });
    mocks.rehearsalSend.mockResolvedValue({ snapshot: releasedSnapshot(mocks.rehearsalSnapshot), local: false });
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me" ? Promise.resolve({ id: mocks.accountId }) : Promise.resolve(stageService()));
    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");

    fireEvent.click(screen.getByRole("button", { name: "Usar ensayo aislado" }));
    expect(screen.getByRole("dialog", { name: "Confirmar cambio de modo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Drenar y cambiar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar ensayo aislado" })).toHaveAttribute("aria-pressed", "true"));
    expect(mocks.livePrepareRelease).toHaveBeenCalledOnce();
    expect(mocks.liveSend).toHaveBeenCalledWith("release_control", {}, { expectedRevision: 9, allowOffline: false });

    fireEvent.click(screen.getByRole("button", { name: "Usar sesión en vivo" }));
    expect(screen.getByRole("dialog", { name: "Confirmar cambio de modo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Drenar y cambiar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar sesión en vivo" })).toHaveAttribute("aria-pressed", "true"));
    expect(mocks.rehearsalPrepareRelease).toHaveBeenCalledOnce();
    expect(mocks.rehearsalSend).toHaveBeenCalledWith("release_control", {}, { expectedRevision: 12, allowOffline: false });
  });

  it("keeps the current mode when releasing owned control fails", async () => {
    mocks.liveSnapshot = ownedSnapshot("live");
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.livePrepareRelease.mockResolvedValue(9);
    mocks.liveSend.mockRejectedValue(new Error("No se confirmó release"));
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me" ? Promise.resolve({ id: mocks.accountId }) : Promise.resolve(stageService()));
    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Usar ensayo aislado" }));
    fireEvent.click(screen.getByRole("button", { name: "Drenar y cambiar" }));
    expect(await screen.findByText(/No cambiamos de modo: No se confirmó release/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar sesión en vivo" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.liveResume).toHaveBeenCalled();
  });

  it("does not bypass drain/release when returning from the rehearsal error screen", async () => {
    mocks.liveSnapshot = liveSnapshot({ next: true, notes: true });
    mocks.liveTiming = timing();
    mocks.rehearsalSnapshot = ownedSnapshot("rehearsal");
    mocks.rehearsalTiming = mocks.rehearsalSnapshot.session!.timing;
    mocks.rehearsalControllerLeaseActive = true;
    mocks.rehearsalError = "Ensayo temporalmente no disponible";
    mocks.rehearsalPrepareRelease.mockResolvedValue(12);
    mocks.rehearsalSend.mockResolvedValue({ snapshot: releasedSnapshot(mocks.rehearsalSnapshot), local: false });
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me" ? Promise.resolve({ id: mocks.accountId }) : Promise.resolve(stageService()));
    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Usar ensayo aislado" }));
    expect(await screen.findByText("Ensayo temporalmente no disponible")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Soltar control y volver a en vivo" }));
    await waitFor(() => expect(mocks.rehearsalSend).toHaveBeenCalledWith("release_control", {}, { expectedRevision: 12, allowOffline: false }));
    expect(mocks.rehearsalPrepareRelease).toHaveBeenCalledOnce();
  });
});
