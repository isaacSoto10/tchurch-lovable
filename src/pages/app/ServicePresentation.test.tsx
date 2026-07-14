import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationLiveSnapshot, PresentationNetworkState, PresentationTiming } from "@/lib/presentationLive";
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
  liveCommandPending: false,
  rehearsalControllerLeaseActive: false,
  rehearsalError: null as string | null,
  liveNetworkState: "online" as PresentationNetworkState,
  rehearsalNetworkState: "online" as PresentationNetworkState,
  reconcileObsAuthority: vi.fn(),
  liveSend: vi.fn(),
  remoteSend: vi.fn(),
  rehearsalSend: vi.fn(),
  livePrepareRelease: vi.fn(),
  rehearsalPrepareRelease: vi.fn(),
  liveResume: vi.fn(),
  rehearsalResume: vi.fn(),
  audienceOutputProps: [] as Array<Record<string, unknown>>,
  remoteSurfaceProps: [] as Array<Record<string, unknown>>,
  liveHookOptions: [] as Array<Record<string, unknown>>,
  rehearsalHookOptions: [] as Array<Record<string, unknown>>,
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

vi.mock("@/lib/presentationLocalConnectors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentationLocalConnectors")>("@/lib/presentationLocalConnectors");
  return { ...actual, reconcileActivePresentationObsAuthority: mocks.reconcileObsAuthority };
});

vi.mock("@/lib/presentationWorkspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentationWorkspace")>("@/lib/presentationWorkspace");
  return {
    ...actual,
    fetchPresentationWorkspaceForPreferredView: mocks.fetchWorkspace,
  };
});

vi.mock("@/hooks/usePresentationLive", () => ({
  usePresentationLive: (options: Record<string, unknown>) => {
    mocks.liveHookOptions.push(options);
    return ({
    snapshot: mocks.liveSnapshot,
    presentationPackage: mocks.livePackage,
    activeView: "operator",
    networkState: mocks.liveNetworkState,
    offlineQueueCount: 0,
    isLocalState: false,
    controllerLeaseActive: mocks.liveControllerLeaseActive,
    timing: mocks.liveTiming,
    messages: [],
    loading: false,
    error: null,
    notice: null,
    commandPending: mocks.liveCommandPending,
    clientId: "11111111-1111-4111-8111-111111111111",
    sendCommand: mocks.liveSend,
    refresh: vi.fn(async () => undefined),
    reconcileOffline: vi.fn(async () => undefined),
    discardOfflineChanges: vi.fn(async () => undefined),
    clearNotice: vi.fn(),
    });
  },
}));

vi.mock("@/hooks/usePresentationRehearsal", () => ({
  usePresentationRehearsal: (options: Record<string, unknown>) => {
    mocks.rehearsalHookOptions.push(options);
    return ({
    snapshot: mocks.rehearsalSnapshot,
    activeView: "operator",
    networkState: mocks.rehearsalNetworkState,
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
    });
  },
}));

vi.mock("@/hooks/usePresentationRemoteIntents", () => ({
  usePresentationRemoteIntents: (options: { controllerOwned: boolean }) => {
    const controller = mocks.liveSnapshot?.session?.controller;
    const available = Boolean(
      controller
      && !options.controllerOwned
      && mocks.liveSnapshot?.viewer.canControl
      && mocks.liveNetworkState === "online",
    );
    return {
      available,
      pending: false,
      status: { phase: "idle", intentId: null, type: null, message: null },
      send: mocks.remoteSend,
      clearStatus: vi.fn(),
    };
  },
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
  PresentationRemoteIntentStatus: () => null,
  PresentationRemoteSurface: (props: Record<string, unknown>) => {
    mocks.remoteSurfaceProps.push(props);
    return null;
  },
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

function chordSheetService(): PresentationService {
  return {
    id: "service-shared",
    title: "Chord sheet fixture",
    date: "2026-07-11T19:00:00.000Z",
    type: "service",
    notes: null,
    items: [{
      id: "song-item",
      title: "Song with chords",
      type: "song",
      position: 0,
      duration: 4,
      details: { serviceKey: "B" },
      song: {
        id: "song-1",
        title: "Song with chords",
        author: "Tchurch",
        key: "B",
        lyrics: "{title: Song with chords}\n{key: B}\n{start_of_verse}\n[F#m]Con acordes visibles\n[E]Siguiente línea\n{end_of_verse}",
        arrangements: [],
      },
    }],
  };
}

function videoService(): PresentationService {
  return {
    id: "service-shared",
    title: "Video fixture",
    date: "2026-07-11T19:00:00.000Z",
    type: "service",
    notes: null,
    items: [{
      id: "video-item",
      title: "Video de bienvenida",
      type: "video",
      position: 0,
      duration: 1,
      song: null,
      details: {
        presentation: {
          kind: "video",
          src: "https://cdn.example.com/welcome.mp4",
          posterSrc: null,
          mimeType: "video/mp4",
          muted: false,
          autoplay: false,
          loop: true,
          durationMs: 60_000,
        },
      },
    }],
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
    controllerVersion: "controller-v1",
    controllerAuthorityVersion: `sha256:${"a".repeat(64)}`,
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

function observedLiveSnapshot() {
  const value = liveSnapshot({ next: true, notes: true });
  value.viewer = { view: "operator", roles: ["all"], canEdit: true, canStart: true, canControl: true, canForceTakeover: false };
  value.session = value.session ? {
    ...value.session,
    controller: {
      clientId: "33333333-3333-4333-8333-333333333333",
      displayName: "Mac del santuario",
      leaseExpiresAt: "2099-07-11T19:01:00.000Z",
      ownedByViewer: false,
    },
  } : null;
  return value;
}

function ownedVideoSnapshot(sessionId: string, revision: number, playing = false) {
  const value = ownedSnapshot("live");
  if (!value.session) return value;
  value.session = {
    ...value.session,
    id: sessionId,
    revision,
    cursor: { itemId: "video-item", itemIndex: 0, stepId: null, stepIndex: 0, partIndex: 0, sectionAnchorId: null },
    playback: playing ? {
      itemId: "video-item",
      slideId: "video-item:video:0",
      kind: "video",
      status: "playing",
      positionMs: 2_000,
      startedAt: "2026-07-11T19:00:00.000Z",
      rate: 1,
      loop: true,
    } : null,
  };
  return value;
}

function releasedSnapshot(value: PresentationLiveSnapshot) {
  return { ...value, session: value.session ? { ...value.session, revision: value.session.revision + 1, controller: null } : null };
}

describe("ServicePresentation load authority", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.accountId = "account-old";
    mocks.church = { id: "church-old", role: "ADMIN" };
    mocks.livePackage = null;
    mocks.liveSnapshot = null;
    mocks.liveTiming = null;
    mocks.rehearsalSnapshot = null;
    mocks.rehearsalTiming = null;
    mocks.liveControllerLeaseActive = false;
    mocks.liveCommandPending = false;
    mocks.rehearsalControllerLeaseActive = false;
    mocks.rehearsalError = null;
    mocks.liveNetworkState = "online";
    mocks.rehearsalNetworkState = "online";
    mocks.reconcileObsAuthority.mockReset();
    mocks.liveSend.mockReset();
    mocks.remoteSend.mockReset();
    mocks.rehearsalSend.mockReset();
    mocks.livePrepareRelease.mockReset();
    mocks.rehearsalPrepareRelease.mockReset();
    mocks.liveResume.mockReset();
    mocks.rehearsalResume.mockReset();
    mocks.liveSend.mockResolvedValue(undefined);
    mocks.remoteSend.mockResolvedValue({ phase: "applied", intentId: "remote-intent", type: "program_next", message: "Aplicado" });
    mocks.rehearsalSend.mockResolvedValue(undefined);
    mocks.livePrepareRelease.mockResolvedValue(4);
    mocks.rehearsalPrepareRelease.mockResolvedValue(4);
    mocks.audienceOutputProps = [];
    mocks.remoteSurfaceProps = [];
    mocks.liveHookOptions = [];
    mocks.rehearsalHookOptions = [];
    mocks.apiFetch.mockReset();
    mocks.fetchWorkspace.mockReset();
    mocks.fetchWorkspace.mockResolvedValue(workspace());
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Element.prototype.scrollIntoView = vi.fn();
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

  it("keeps the chord toggle and chord chart available when private notes fail and the production layout hides chords", async () => {
    const snapshot = liveSnapshot({ next: true, notes: true });
    snapshot.session = null;
    mocks.liveSnapshot = snapshot;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId, email: "operator@example.com" })
      : Promise.resolve(chordSheetService()));
    mocks.fetchWorkspace.mockRejectedValue(new Error("presentation-config unavailable"));

    render(<ServicePresentation />);
    await screen.findByText("Chord sheet fixture");
    expect(await screen.findByText(/Las notas guardadas no están disponibles ahora/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hoja" }));
    expect(screen.getByRole("button", { name: "Ocultar acordes" })).toBeEnabled();
    expect(screen.getByText("F#m")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ocultar acordes" }));
    expect(screen.getByRole("button", { name: "Mostrar acordes" })).toBeEnabled();
    expect(screen.queryByText("F#m")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    expect(screen.getByRole("button", { name: "Mostrar acordes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar acordes" }));
    expect(screen.getByText("F#m")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usar ensayo aislado" }));
    expect(screen.getByText(/Ensayo aislado · no cambia la sesión en vivo/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar acordes" })).toBeEnabled();
  });

  it("activates exactly one session runtime when switching between live and rehearsal", async () => {
    mocks.liveSnapshot = liveSnapshot({ next: true, notes: true });
    mocks.liveTiming = timing();
    mocks.rehearsalSnapshot = ownedSnapshot("rehearsal");
    mocks.rehearsalTiming = mocks.rehearsalSnapshot.session!.timing;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    await waitFor(() => {
      expect(mocks.liveHookOptions.at(-1)).toMatchObject({ enabled: true, active: true });
      expect(mocks.rehearsalHookOptions.at(-1)).toMatchObject({ enabled: true, active: false });
    });

    fireEvent.click(screen.getByRole("button", { name: "Usar ensayo aislado" }));
    await waitFor(() => {
      expect(mocks.liveHookOptions.at(-1)).toMatchObject({ enabled: true, active: false });
      expect(mocks.rehearsalHookOptions.at(-1)).toMatchObject({ enabled: true, active: true });
    });

    fireEvent.click(screen.getByRole("button", { name: "Usar sesión en vivo" }));
    await waitFor(() => {
      expect(mocks.liveHookOptions.at(-1)).toMatchObject({ enabled: true, active: true });
      expect(mocks.rehearsalHookOptions.at(-1)).toMatchObject({ enabled: true, active: false });
    });
  });

  it("keeps explicit iPad surface selections when the private layout uses production mode", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    const snapshot = liveSnapshot({ next: true, notes: true });
    snapshot.viewer = { view: "operator", roles: ["all"], canEdit: true, canStart: true, canControl: true, canForceTakeover: false };
    mocks.liveSnapshot = snapshot;
    mocks.liveTiming = timing();
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId, email: "operator@example.com" })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");

    const operator = screen.getByRole("button", { name: "Operador" });
    const stage = screen.getByRole("button", { name: "Escenario" });
    const remote = screen.getByRole("button", { name: "Control" });

    await waitFor(() => expect(operator).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText("Notas del equipo")).toBeInTheDocument();

    fireEvent.click(stage);
    expect(stage).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Notas del equipo")).not.toBeInTheDocument();
    expect(screen.queryByText("Para ti")).not.toBeInTheDocument();
    expect(screen.queryByText("Salto rápido")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir salto rápido" })).toBeEnabled();

    fireEvent.click(remote);
    expect(remote).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(stage);
    expect(stage).toHaveAttribute("aria-pressed", "true");
  });

  it("sends media controls with the exact live target and never rebases them across a new session", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    mocks.liveSnapshot = ownedVideoSnapshot("video-session-a", 20);
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(videoService()));

    const view = render(<ServicePresentation />);
    await screen.findByText("Video fixture");
    const mediaPanel = screen.getByText("Reproducción").closest("div.mt-4");
    expect(mediaPanel).toHaveClass("border-violet-300/20", "bg-violet-400/[0.08]");
    expect(mediaPanel?.className).not.toContain("amber");
    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    await waitFor(() => expect(mocks.liveSend).toHaveBeenCalledWith("media_play", {
      sessionId: "video-session-a",
      itemId: "video-item",
      slideId: "video-item:video:0",
      kind: "video",
      positionMs: 0,
      loop: true,
    }, expect.objectContaining({
      expectedRevision: 20,
      allowOffline: false,
      mediaBinding: expect.objectContaining({
        target: { sessionId: "video-session-a", itemId: "video-item", slideId: "video-item:video:0" },
        activeCursor: { itemId: "video-item", stepId: null, partIndex: 0 },
        expectedRevision: 20,
        playbackMatches: false,
      }),
    })));

    mocks.liveSend.mockClear();
    mocks.liveSnapshot = ownedVideoSnapshot("video-session-b", 3, true);
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    view.rerender(<ServicePresentation />);

    const position = screen.getByRole("slider", { name: "Posición del contenido" });
    fireEvent.change(position, { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    fireEvent.click(screen.getByRole("button", { name: "Buscar posición" }));
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar" }));
    fireEvent.click(screen.getByRole("button", { name: "Detener" }));

    const target = { sessionId: "video-session-b", itemId: "video-item", slideId: "video-item:video:0" };
    await waitFor(() => {
      const options = expect.objectContaining({ expectedRevision: 3, allowOffline: false, mediaBinding: expect.objectContaining({ target, expectedRevision: 3, playbackMatches: true }) });
      expect(mocks.liveSend).toHaveBeenCalledWith("media_pause", target, options);
      expect(mocks.liveSend).toHaveBeenCalledWith("media_seek", { ...target, positionMs: 12_000 }, options);
      expect(mocks.liveSend).toHaveBeenCalledWith("media_restart", target, options);
      expect(mocks.liveSend).toHaveBeenCalledWith("media_stop", target, options);
    });
    expect(mocks.liveSend.mock.calls.flatMap((call) => JSON.stringify(call))).not.toContain("video-session-a");
  });

  it("disables media mutations when Program or connectivity no longer matches the rendered video", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    const snapshot = ownedVideoSnapshot("video-session", 7, true);
    snapshot.session!.cursor.itemId = "another-item";
    mocks.liveSnapshot = snapshot;
    mocks.liveTiming = snapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(videoService()));

    const view = render(<ServicePresentation />);
    await screen.findByText("Video fixture");
    expect(screen.getByRole("button", { name: "Reproducir" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pausar" })).toBeDisabled();

    mocks.liveSnapshot = ownedVideoSnapshot("video-session", 8, true);
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveNetworkState = "offline";
    view.rerender(<ServicePresentation />);
    expect(screen.getByRole("button", { name: "Reproducir" })).toBeDisabled();
    expect(screen.getByText(/Toma el control y conéctate/i)).toBeInTheDocument();
  });

  it("shows a fail-closed notice when a media ACK is not confirmed and does not retry", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    mocks.liveSnapshot = ownedVideoSnapshot("video-session", 7);
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.liveSend.mockRejectedValue(new Error("late media ACK"));
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(videoService()));

    render(<ServicePresentation />);
    await screen.findByText("Video fixture");
    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));

    expect(await screen.findByText(/No se confirmó la acción multimedia. Actualiza la sesión antes de reintentar./i)).toBeInTheDocument();
    expect(mocks.liveSend).toHaveBeenCalledTimes(1);
  });

  it("takes control from the iPad stage before allowing a live advance", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    const snapshot = liveSnapshot({ next: true, notes: true });
    snapshot.viewer = { view: "operator", roles: ["all"], canEdit: true, canStart: true, canControl: true, canForceTakeover: false };
    mocks.liveSnapshot = snapshot;
    mocks.liveTiming = timing();
    const claimedSnapshot = {
      ...snapshot,
      serverNow: "2026-07-11T19:00:00.000Z",
      session: snapshot.session ? {
        ...snapshot.session,
        revision: 5,
        controller: {
          clientId: "11111111-1111-4111-8111-111111111111",
          displayName: "Este iPad",
          leaseExpiresAt: "2099-07-11T19:01:00.000Z",
          ownedByViewer: true,
        },
      } : null,
    };
    mocks.liveSend.mockResolvedValue({ snapshot: claimedSnapshot, local: false });
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Escenario" }));
    fireEvent.click(screen.getByRole("button", { name: "Tomar control para avanzar" }));

    await waitFor(() => expect(mocks.liveSend).toHaveBeenNthCalledWith(1, "claim_control", {}, undefined));
    expect(mocks.liveSend).toHaveBeenNthCalledWith(2, "jump", {
      itemId: "next-item",
      stepId: null,
      partIndex: 0,
    }, { expectedRevision: 5, allowOffline: false });
  });

  it("does not advance after a claim ACK that names another exact controller client", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    const initial = liveSnapshot({ next: true, notes: true });
    initial.viewer = { view: "operator", roles: ["all"], canEdit: true, canStart: true, canControl: true, canForceTakeover: false };
    mocks.liveSnapshot = initial;
    mocks.liveTiming = timing();
    const forgedClaim = {
      ...initial,
      serverNow: "2026-07-11T19:00:00.000Z",
      session: initial.session ? {
        ...initial.session,
        revision: 5,
        controller: {
          clientId: "33333333-3333-4333-8333-333333333333",
          displayName: "Otro iPad",
          leaseExpiresAt: "2099-07-11T19:01:00.000Z",
          ownedByViewer: true,
        },
      } : null,
    };
    mocks.liveSend.mockResolvedValue({ snapshot: forgedClaim, local: false });
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Escenario" }));
    fireEvent.click(screen.getByRole("button", { name: "Tomar control para avanzar" }));

    expect(await screen.findByText(/Tchurch todavía no confirmó el control/i)).toBeInTheDocument();
    expect(mocks.liveSend).toHaveBeenCalledOnce();
    expect(mocks.liveSend).toHaveBeenCalledWith("claim_control", {}, undefined);
    expect(mocks.liveSend).not.toHaveBeenCalledWith("jump", expect.anything(), expect.anything());
  });

  it("advances the live session from the iPad stage only while this device owns the lease", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    mocks.liveSnapshot = ownedSnapshot("live");
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Escenario" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(mocks.liveSend).toHaveBeenCalledWith("jump", {
      itemId: "next-item",
      stepId: null,
      partIndex: 0,
    }, undefined));
    expect(mocks.liveSend).not.toHaveBeenCalledWith("claim_control", expect.anything(), expect.anything());
    expect(mocks.remoteSend).not.toHaveBeenCalled();
  });

  it("routes account-scoped HID actions through the exact live controller and pauses them behind production UI", async () => {
    mocks.liveSnapshot = ownedSnapshot("live");
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));
    localStorage.setItem("tchurch_live_pedal_v1:church-old", JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      bindings: {
        next: ["PageDown"],
        previous: ["PageUp"],
        toggle_blackout: ["KeyB"],
        toggle_chords: ["KeyC"],
      },
    }));

    const view = render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.keyDown(window, { code: "PageDown" });
    fireEvent.keyDown(window, { code: "PageDown" });
    await waitFor(() => expect(mocks.liveSend).toHaveBeenCalledTimes(1));
    expect(mocks.liveSend).toHaveBeenCalledWith("jump", {
      itemId: "next-item",
      stepId: null,
      partIndex: 0,
    }, undefined);
    expect(localStorage.getItem("tchurch.presentation.hardware.v5:account-old:church-old")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Abrir centro de producción" }));
    fireEvent.keyDown(window, { code: "KeyB" });
    expect(mocks.liveSend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar centro de producción" }));

    mocks.liveCommandPending = true;
    view.rerender(<ServicePresentation />);
    fireEvent.keyDown(window, { code: "KeyC" });
    expect(mocks.liveSend).toHaveBeenCalledTimes(1);

    mocks.liveCommandPending = false;
    view.rerender(<ServicePresentation />);
    fireEvent.keyDown(window, { code: "KeyB" });
    await waitFor(() => expect(mocks.liveSend).toHaveBeenCalledWith("set_blackout", { blackout: true }, undefined));
  });

  it("uses the remote-intent path for the same account on a different controller client without claiming control", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    mocks.liveSnapshot = observedLiveSnapshot();
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Escenario" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar siguiente al Programa" }));

    await waitFor(() => expect(mocks.remoteSend).toHaveBeenCalledWith("program_next", {}));
    expect(mocks.liveSend).not.toHaveBeenCalledWith("claim_control", expect.anything(), expect.anything());
    expect(mocks.liveSend).not.toHaveBeenCalledWith("jump", expect.anything(), expect.anything());
  });

  it("does not trust account-level ownedByViewer when the controller belongs to another client", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    mocks.liveSnapshot = observedLiveSnapshot();
    mocks.liveSnapshot.session!.controller!.ownedByViewer = true;
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Escenario" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar siguiente al Programa" }));

    await waitFor(() => expect(mocks.remoteSend).toHaveBeenCalledWith("program_next", {}));
    expect(mocks.liveSend).not.toHaveBeenCalledWith("jump", expect.anything(), expect.anything());
  });

  it("wires the current remote authority, status, pending flag and sender into the Control surface", async () => {
    mocks.liveSnapshot = observedLiveSnapshot();
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    await waitFor(() => expect(mocks.remoteSurfaceProps.length).toBeGreaterThan(0));
    expect(mocks.remoteSurfaceProps.at(-1)).toMatchObject({
      remoteAvailable: true,
      remotePending: false,
      remoteStatus: { phase: "idle" },
      onRemoteIntent: mocks.remoteSend,
    });
  });

  it("offers a safe control claim from the iPad previous arrow instead of failing silently", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    const snapshot = liveSnapshot({ next: true, notes: true });
    snapshot.viewer = { view: "operator", roles: ["all"], canEdit: true, canStart: true, canControl: true, canForceTakeover: false };
    snapshot.session = snapshot.session ? {
      ...snapshot.session,
      cursor: { itemId: "next-item", itemIndex: 1, stepId: null, stepIndex: 1, partIndex: 0, sectionAnchorId: null },
    } : null;
    mocks.liveSnapshot = snapshot;
    mocks.liveTiming = timing();
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(stageService()));

    render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    fireEvent.click(screen.getByRole("button", { name: "Escenario" }));

    expect(screen.getByRole("button", { name: "Tomar control para retroceder" })).toBeEnabled();
  });

  it("fits the current Slides page to the expanded iPad stage without changing operator typography", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1366 });
    const snapshot = liveSnapshot({ next: true, notes: true });
    snapshot.session = null;
    mocks.liveSnapshot = snapshot;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me"
      ? Promise.resolve({ id: mocks.accountId })
      : Promise.resolve(chordSheetService()));

    render(<ServicePresentation />);
    await screen.findByText("Chord sheet fixture");
    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    const operatorLyrics = screen.getByText("Con acordes visibles");
    expect(operatorLyrics.style.fontSize).not.toBe("46px");

    fireEvent.click(screen.getByRole("button", { name: "Escenario" }));
    const stageLyrics = screen.getByText("Con acordes visibles");
    expect(stageLyrics.style.fontSize).toBe("46px");
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

  it("revokes external-system authority when the owned live session goes offline", async () => {
    mocks.liveSnapshot = ownedSnapshot("live");
    mocks.liveTiming = mocks.liveSnapshot.session!.timing;
    mocks.liveControllerLeaseActive = true;
    mocks.apiFetch.mockImplementation((path: string) => path === "/users/me" ? Promise.resolve({ id: mocks.accountId }) : Promise.resolve(stageService()));
    const view = render(<ServicePresentation />);
    await screen.findByText("Stage fixture");
    await waitFor(() => expect(mocks.reconcileObsAuthority).toHaveBeenLastCalledWith(expect.stringContaining("online"), true));

    mocks.liveNetworkState = "offline";
    view.rerender(<ServicePresentation />);

    await waitFor(() => expect(mocks.reconcileObsAuthority).toHaveBeenLastCalledWith(expect.stringContaining("offline"), false));
  });
});
