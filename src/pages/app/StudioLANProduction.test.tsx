import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioLANCueCatalogStatus, StudioLANLocalBroadcastLowerThirdFeedback, StudioLANLocalOBSSceneFeedback, StudioLANOperatorTimerFeedback, StudioLANRemoteFeedback, StudioLANStatus, StudioLANUpdate } from "@/lib/studioLANClient";

const mocks = vi.hoisted(() => ({
  status: null as StudioLANStatus | null,
  update: null as StudioLANUpdate | null,
  remoteFeedback: null as StudioLANRemoteFeedback | null,
  operatorTimerFeedback: null as StudioLANOperatorTimerFeedback | null,
  localBroadcastLowerThirdFeedback: null as StudioLANLocalBroadcastLowerThirdFeedback | null,
  localOBSSceneFeedback: null as StudioLANLocalOBSSceneFeedback | null,
  cueCatalog: null as StudioLANCueCatalogStatus | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  forget: vi.fn(),
  refresh: vi.fn(),
  sendRemoteCommand: vi.fn(),
  sendOperatorTimerCommand: vi.fn(),
  sendLocalBroadcastLowerThirdCommand: vi.fn(),
  sendLocalOBSSceneCommand: vi.fn(),
  requestReapproval: vi.fn(),
  scanBarcode: vi.fn(),
}));

vi.mock("@capacitor/barcode-scanner", () => ({
  CapacitorBarcodeScanner: { scanBarcode: mocks.scanBarcode },
  CapacitorBarcodeScannerCameraDirection: { BACK: "BACK" },
  CapacitorBarcodeScannerScanOrientation: { ADAPTIVE: "ADAPTIVE" },
  CapacitorBarcodeScannerTypeHint: { QR_CODE: "QR_CODE" },
}));

vi.mock("@/hooks/useStudioLANClient", () => ({
  useStudioLANClient: () => ({
    status: mocks.status,
    update: mocks.update,
    imageAsset: null,
    remoteFeedback: mocks.remoteFeedback,
    operatorTimerFeedback: mocks.operatorTimerFeedback,
    localBroadcastLowerThirdFeedback: mocks.localBroadcastLowerThirdFeedback,
    localOBSSceneFeedback: mocks.localOBSSceneFeedback,
    cueCatalog: mocks.cueCatalog,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    forget: mocks.forget,
    refresh: mocks.refresh,
    sendRemoteCommand: mocks.sendRemoteCommand,
    sendOperatorTimerCommand: mocks.sendOperatorTimerCommand,
    sendLocalBroadcastLowerThirdCommand: mocks.sendLocalBroadcastLowerThirdCommand,
    sendLocalOBSSceneCommand: mocks.sendLocalOBSSceneCommand,
    requestReapproval: mocks.requestReapproval,
  }),
}));

import StudioLANProduction from "./StudioLANProduction";

const serviceId = "a".repeat(32);
const baseStatus: StudioLANStatus = {
  supported: true,
  phase: "idle",
  services: [{ id: serviceId, name: "Tchurch Studio", protocolFloor: 4 }],
  selectedServiceId: null,
  channel: null,
  paired: false,
  message: null,
  enrollmentState: "unenrolled",
  protocolFloor: 1,
  role: null,
  permissions: [],
  permissionRevision: "0",
  revocationGeneration: "0",
  studioId: null,
  remoteControlAvailable: false,
  remoteCommandInFlight: false,
  operatorTimerControlAvailable: false,
  operatorTimerCommandInFlight: false,
  localBroadcastLowerThirdControlAvailable: false,
  localBroadcastLowerThirdCommandInFlight: false,
  localOBSSceneControlAvailable: false,
  localOBSSceneCommandInFlight: false,
};

const controlUpdate: StudioLANUpdate = {
  channel: "control",
  payloadVersion: 4,
  sequence: "12",
  revision: "8",
  issuedAtMs: 1_800_000_004_000,
  receivedAtMs: Date.now(),
  authority: {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authorityEpoch: "7",
    packageId: "package",
    serviceVersion: "v4",
  },
  audience: {
    currentCueId: "cue-1",
    currentCueIndex: 0,
    cueCount: 2,
    isBlackout: false,
    countdown: null,
    cue: { cueId: "cue-1", title: "Verso", lines: ["Gracia"], mediaAssetId: null, imageAsset: null },
  },
  stage: {
    nextCue: { cueId: "cue-2", title: "Coro", lines: ["Siguiente"], mediaAssetId: null, imageAsset: null },
    chordLines: [],
    currentChordSlide: null,
    timers: [],
    message: null,
  },
  control: {
    chordsVisible: true,
    lightingArmed: false,
    healthyOutputCount: 2,
    expectedOutputCount: 2,
    routeEpoch: "5",
    cueCatalog: [{ cueId: "cue-1", title: "Verso" }, { cueId: "cue-2", title: "Coro" }],
    routing: null,
    cueCatalogManifest: null,
    operatorTimers: null,
    localBroadcastLowerThird: null,
    localOBS: null,
  },
};

const connectedStatus: StudioLANStatus = {
  ...baseStatus,
  phase: "connected",
  selectedServiceId: serviceId,
  channel: "control",
  paired: true,
  enrollmentState: "approved",
  protocolFloor: 4,
  role: "production",
  permissions: ["observe", "controlProgram"],
  permissionRevision: "7",
  revocationGeneration: "2",
  studioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  remoteControlAvailable: true,
};

describe("Studio LAN production route", () => {
  beforeEach(() => {
    mocks.status = baseStatus;
    mocks.update = null;
    mocks.remoteFeedback = null;
    mocks.operatorTimerFeedback = null;
    mocks.localBroadcastLowerThirdFeedback = null;
    mocks.localOBSSceneFeedback = null;
    mocks.cueCatalog = null;
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.forget.mockReset().mockResolvedValue(undefined);
    mocks.refresh.mockReset().mockResolvedValue(undefined);
    mocks.sendRemoteCommand.mockReset().mockResolvedValue(undefined);
    mocks.sendOperatorTimerCommand.mockReset().mockResolvedValue(undefined);
    mocks.sendLocalBroadcastLowerThirdCommand.mockReset().mockResolvedValue(undefined);
    mocks.sendLocalOBSSceneCommand.mockReset().mockResolvedValue(undefined);
    mocks.requestReapproval.mockReset().mockResolvedValue(undefined);
    mocks.scanBarcode.mockReset().mockResolvedValue({ ScanResult: "" });
  });

  it("requests production/control from the first enrollment", async () => {
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText(/Emparejar como Producción/i), {
      target: { value: `tchurch-studio:${"A".repeat(43)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Solicitar acceso de Producción/i }));

    await waitFor(() => expect(mocks.connect).toHaveBeenCalledWith(
      serviceId,
      "control",
      `tchurch-studio:${"A".repeat(43)}`,
      "production",
    ));
  });

  it("keeps controls closed until Studio approves controlProgram", () => {
    mocks.status = { ...baseStatus, phase: "authenticating", enrollmentState: "pending", protocolFloor: 4 };
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    expect(screen.getByTestId("studio-lan-production-pending")).toHaveTextContent(/Control Program/i);
    expect(screen.queryByTestId("studio-lan-production-controls")).not.toBeInTheDocument();
  });

  it("rotates a revoked identity before requesting approval again", async () => {
    mocks.status = {
      ...baseStatus,
      phase: "failed",
      enrollmentState: "revoked",
      protocolFloor: 4,
      studioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    expect(screen.getByRole("alert")).toHaveTextContent(/identidad revocada nunca se reutiliza/i);
    fireEvent.click(screen.getByRole("button", { name: /Solicitar nueva aprobación/i }));
    await waitFor(() => expect(mocks.requestReapproval).toHaveBeenCalledOnce());
  });

  it("sends only the closed Program commands and locks while one is in flight", async () => {
    mocks.status = connectedStatus;
    mocks.update = controlUpdate;
    const view = render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const controls = await screen.findByTestId("studio-lan-production-controls");
    expect(controls).toHaveTextContent(/Routing firmado por la Mac/i);
    expect(controls).toHaveTextContent(/Músicos.*Compat\. v4.*Cloud.*Compat\. v4.*OBS.*Compat\. v4.*Luces.*Compat\. v4/i);
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente$/i }));
    await waitFor(() => expect(mocks.sendRemoteCommand).toHaveBeenCalledWith({ kind: "next" }));

    mocks.status = { ...connectedStatus, remoteControlAvailable: false, remoteCommandInFlight: true };
    view.rerender(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /^Anterior$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Activar blackout/i })).toBeDisabled();
  });

  it("jumps only to a cue from the signed catalog and exposes verified rejection feedback", async () => {
    mocks.status = connectedStatus;
    mocks.update = controlUpdate;
    mocks.remoteFeedback = {
      commandId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
      kind: "jump",
      cueId: "cue-2",
      enabled: null,
      state: "rejected",
      rejection: "revisionConflict",
      revision: "9",
      wasIdempotentReplay: false,
    };
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    await screen.findByTestId("studio-lan-production-controls");
    fireEvent.click(screen.getByRole("button", { name: /Coro/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ir a selección/i }));
    await waitFor(() => expect(mocks.sendRemoteCommand).toHaveBeenCalledWith({ kind: "jump", cueId: "cue-2" }));
    expect(screen.getByTestId("studio-lan-production-feedback")).toHaveTextContent(/revisión nueva/i);
  });

  it("shows signed v5 routes and keeps direct controls open while the full catalog loads", async () => {
    const catalogId = `sha256:${"8".repeat(64)}`;
    mocks.status = connectedStatus;
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 5,
      authority: { ...controlUpdate.authority, serviceVersion: "v5" },
      control: {
        ...controlUpdate.control!,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: true,
          stageAndMusicians: false,
          lanRemoteControl: true,
          lightingAndMIDI: false,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: { schemaVersion: 1, catalogId, totalCount: 2, pageSize: 128 },
      },
    };
    mocks.cueCatalog = {
      phase: "loading",
      catalogId,
      routeEpoch: "5",
      totalCount: 2,
      receivedCount: 0,
      cues: null,
      message: "Cargando el catálogo local firmado…",
    };
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const routing = await screen.findByTestId("studio-lan-production-routing");
    expect(routing).toHaveTextContent(/MúsicosApagadoCloudApagadoOBSActivoLucesApagado/i);
    expect(screen.getByRole("button", { name: /^Siguiente$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Activar blackout/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Ir a selección/i })).toBeDisabled();
    expect(screen.getByTestId("studio-lan-production-catalog-status")).toHaveTextContent(/Cargando el catálogo/i);
  });

  it("shows complete signed v8 routing and lighting telemetry without exposing mutations", async () => {
    const catalogId = `sha256:${"6".repeat(64)}`;
    mocks.status = connectedStatus;
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 8,
      authority: { ...controlUpdate.authority, serviceVersion: "v8" },
      control: {
        ...controlUpdate.control!,
        lightingArmed: false,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: true,
          stageAndMusicians: false,
          lanRemoteControl: true,
          lightingAndMIDI: true,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: { schemaVersion: 1, catalogId, totalCount: 2, pageSize: 128 },
        operatorTimers: null,
        localBroadcastLowerThird: null,
        localOBS: null,
      },
    };
    mocks.cueCatalog = {
      phase: "ready",
      catalogId,
      routeEpoch: "5",
      totalCount: 2,
      receivedCount: 2,
      cues: [{ cueId: "cue-1", title: "Verso" }, { cueId: "cue-2", title: "Coro" }],
      message: null,
    };
    const view = render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const routing = await screen.findByTestId("studio-lan-production-routing");
    expect(screen.getByTestId("studio-lan-routing-localAudience")).toHaveTextContent(/Audiencia localActivo/i);
    expect(screen.getByTestId("studio-lan-routing-lanRemoteControl")).toHaveTextContent(/Control LANActivo/i);
    expect(screen.getByTestId("studio-lan-routing-lightingAndMIDI")).toHaveTextContent(/Ruta luces \/ MIDIHabilitada/i);
    expect(screen.getByTestId("studio-lan-routing-lightingArmed")).toHaveTextContent(/Luces armadasDesarmadas/i);
    expect(screen.getByTestId("studio-lan-lighting-routing-note")).toHaveTextContent(/estados distintos.*no puede modificarlos/i);
    expect(within(routing).queryByRole("button")).not.toBeInTheDocument();
    expect(within(routing).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(routing).queryByRole("checkbox")).not.toBeInTheDocument();

    mocks.update = {
      ...mocks.update,
      control: { ...mocks.update.control!, lightingArmed: true },
    };
    view.rerender(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    expect(screen.getByTestId("studio-lan-routing-lightingArmed")).toHaveTextContent(/Luces armadasArmadas/i);
    expect(mocks.sendRemoteCommand).not.toHaveBeenCalled();
    expect(mocks.sendLocalOBSSceneCommand).not.toHaveBeenCalled();
  });

  it("pages the verified v5 catalog locally without exposing routing toggles", async () => {
    const catalogId = `sha256:${"9".repeat(64)}`;
    const cues = Array.from({ length: 49 }, (_, index) => ({
      cueId: `cue-${index + 1}`,
      title: `Diapositiva ${index + 1}`,
    }));
    mocks.status = connectedStatus;
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 5,
      authority: { ...controlUpdate.authority, serviceVersion: "v5" },
      control: {
        ...controlUpdate.control!,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: true,
          stageAndMusicians: false,
          lanRemoteControl: true,
          lightingAndMIDI: false,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: { schemaVersion: 1, catalogId, totalCount: cues.length, pageSize: 128 },
      },
    };
    mocks.cueCatalog = {
      phase: "ready",
      catalogId,
      routeEpoch: "5",
      totalCount: cues.length,
      receivedCount: cues.length,
      cues,
      message: null,
    };
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const catalog = await screen.findByTestId("studio-lan-production-catalog");
    expect(catalog).toHaveTextContent("Diapositiva 48");
    expect(catalog).not.toHaveTextContent("Diapositiva 49");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Página siguiente/i }));
    expect(catalog).toHaveTextContent("Diapositiva 49");
    expect(catalog).not.toHaveTextContent("Diapositiva 48");
    fireEvent.click(screen.getByRole("button", { name: /Diapositiva 49/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ir a selección/i }));
    await waitFor(() => expect(mocks.sendRemoteCommand).toHaveBeenCalledWith({ kind: "jump", cueId: "cue-49" }));
  });

  it("shows both signed v6 Production-local timers and sends only the closed timer action", async () => {
    const catalogId = `sha256:${"7".repeat(64)}`;
    mocks.status = {
      ...connectedStatus,
      operatorTimerControlAvailable: true,
    };
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 6,
      authority: { ...controlUpdate.authority, serviceVersion: "v6" },
      control: {
        ...controlUpdate.control!,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: false,
          stageAndMusicians: false,
          lanRemoteControl: true,
          lightingAndMIDI: false,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: { schemaVersion: 1, catalogId, totalCount: 2, pageSize: 128 },
        operatorTimers: {
          schemaVersion: 1,
          revision: "12",
          timers: [
            {
              scope: "service",
              anchorTimestampMilliseconds: 1_800_000_004_000,
              anchorValueMilliseconds: 90_000,
              isRunning: false,
            },
            {
              scope: "item",
              anchorTimestampMilliseconds: 1_800_000_000_000,
              anchorValueMilliseconds: 30_000,
              isRunning: true,
            },
          ],
        },
      },
    };
    mocks.cueCatalog = {
      phase: "ready",
      catalogId,
      routeEpoch: "5",
      totalCount: 2,
      receivedCount: 2,
      cues: [{ cueId: "cue-1", title: "Verso" }, { cueId: "cue-2", title: "Coro" }],
      message: null,
    };
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const timers = await screen.findByTestId("studio-lan-operator-timers");
    expect(timers).toHaveTextContent(/Producción local · Stage\/músicos aislados · sin Cloud/i);
    expect(timers).toHaveTextContent(/Servicio.*0:01:30.*En pausa/i);
    expect(timers).toHaveTextContent(/Elemento.*0:00:34.*En curso/i);
    expect(screen.getByRole("button", { name: /Iniciar timer de servicio en Producción local/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Pausar timer de elemento en Producción local/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Iniciar timer de servicio en Producción local/i }));
    await waitFor(() => expect(mocks.sendOperatorTimerCommand).toHaveBeenCalledWith({
      scope: "service",
      operation: "start",
    }));
    expect(mocks.sendRemoteCommand).not.toHaveBeenCalled();
  });

  it("keeps v4/v5 free of timer mutation UI and leaves Program/catalog usable when v6 timers are unavailable", async () => {
    mocks.status = connectedStatus;
    mocks.update = controlUpdate;
    const view = render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    await screen.findByTestId("studio-lan-production-controls");
    expect(screen.queryByTestId("studio-lan-operator-timers")).not.toBeInTheDocument();

    const catalogId = `sha256:${"6".repeat(64)}`;
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 6,
      authority: { ...controlUpdate.authority, serviceVersion: "v6" },
      control: {
        ...controlUpdate.control!,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: false,
          stageAndMusicians: false,
          lanRemoteControl: true,
          lightingAndMIDI: false,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: { schemaVersion: 1, catalogId, totalCount: 2, pageSize: 128 },
        operatorTimers: null,
      },
    };
    mocks.cueCatalog = {
      phase: "ready",
      catalogId,
      routeEpoch: "5",
      totalCount: 2,
      receivedCount: 2,
      cues: [{ cueId: "cue-1", title: "Verso" }, { cueId: "cue-2", title: "Coro" }],
      message: null,
    };
    view.rerender(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    expect(await screen.findByTestId("studio-lan-operator-timers")).toHaveTextContent(
      /Program y catálogo local siguen disponibles/i,
    );
    expect(screen.queryByRole("button", { name: /timer de (servicio|elemento)/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente$/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Coro/i }));
    expect(screen.getByRole("button", { name: /Ir a selección/i })).toBeEnabled();
  });

  it("shows the v7-only isolated OBS lower-third card and sends only its closed actions", async () => {
    const catalogId = `sha256:${"5".repeat(64)}`;
    mocks.status = {
      ...connectedStatus,
      operatorTimerControlAvailable: true,
      localBroadcastLowerThirdControlAvailable: true,
    };
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 7,
      authority: { ...controlUpdate.authority, serviceVersion: "v7" },
      control: {
        ...controlUpdate.control!,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: true,
          stageAndMusicians: false,
          lanRemoteControl: true,
          lightingAndMIDI: false,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: { schemaVersion: 1, catalogId, totalCount: 2, pageSize: 128 },
        operatorTimers: {
          schemaVersion: 1,
          revision: "12",
          timers: [
            {
              scope: "service",
              anchorTimestampMilliseconds: 1_800_000_004_000,
              anchorValueMilliseconds: 90_000,
              isRunning: false,
            },
            {
              scope: "item",
              anchorTimestampMilliseconds: 1_800_000_000_000,
              anchorValueMilliseconds: 30_000,
              isRunning: true,
            },
          ],
        },
        localBroadcastLowerThird: {
          schemaVersion: 1,
          revision: "21",
          target: "localBrowserOBS",
          visible: true,
          title: "Pastor Isaac Soto",
          subtitle: "Tchurch",
        },
      },
    };
    mocks.cueCatalog = {
      phase: "ready",
      catalogId,
      routeEpoch: "5",
      totalCount: 2,
      receivedCount: 2,
      cues: [{ cueId: "cue-1", title: "Verso" }, { cueId: "cue-2", title: "Coro" }],
      message: null,
    };
    const view = render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const lowerThird = await screen.findByTestId("studio-lan-local-broadcast-lower-third");
    expect(lowerThird).toHaveTextContent(/OBS local.*sin Program.*Músicos aislados.*sin Cloud/i);
    expect(lowerThird).toHaveTextContent(/Visible en OBS local.*Revisión 21/i);
    expect(screen.getByLabelText(/^Título$/i)).toHaveValue("Pastor Isaac Soto");
    expect(screen.getByLabelText(/Subtítulo/i)).toHaveValue("Tchurch");
    const timers = screen.getByTestId("studio-lan-operator-timers");
    expect(timers).toHaveTextContent(/Producción local · Stage\/músicos aislados · sin Cloud/i);
    const startServiceTimer = screen.getByRole("button", {
      name: /Iniciar timer de servicio en Producción local/i,
    });
    expect(startServiceTimer).toBeEnabled();
    fireEvent.click(startServiceTimer);
    await waitFor(() => expect(mocks.sendOperatorTimerCommand).toHaveBeenCalledWith({
      scope: "service",
      operation: "start",
    }));
    mocks.operatorTimerFeedback = {
      commandId: "12345678-1234-4abc-8def-123456789abc",
      kind: "operatorTimer",
      scope: "service",
      operation: "start",
      state: "accepted",
      rejection: null,
      timerRevision: "13",
      wasIdempotentReplay: false,
    };
    view.rerender(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", {
      name: /Mostrar \/ actualizar/i,
    })).toBeEnabled());

    fireEvent.change(screen.getByLabelText(/^Título$/i), {
      target: { value: "  Pastor Isaac Soto  " },
    });
    fireEvent.change(screen.getByLabelText(/Subtítulo/i), {
      target: { value: "  Tchurch Studio  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Mostrar \/ actualizar/i }));
    await waitFor(() => expect(mocks.sendLocalBroadcastLowerThirdCommand).toHaveBeenCalledWith({
      kind: "localBroadcastLowerThird",
      operation: "show",
      title: "Pastor Isaac Soto",
      subtitle: "Tchurch Studio",
    }));
    expect(mocks.sendRemoteCommand).not.toHaveBeenCalled();
    expect(mocks.sendOperatorTimerCommand).toHaveBeenCalledTimes(1);

    mocks.localBroadcastLowerThirdFeedback = {
      commandId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
      kind: "localBroadcastLowerThird",
      operation: "show",
      title: "Pastor Isaac Soto",
      subtitle: "Tchurch Studio",
      state: "accepted",
      rejection: null,
      lowerThirdRevision: "22",
      wasIdempotentReplay: false,
    };
    view.rerender(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Ocultar$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^Ocultar$/i }));
    await waitFor(() => expect(mocks.sendLocalBroadcastLowerThirdCommand).toHaveBeenLastCalledWith({
      kind: "localBroadcastLowerThird",
      operation: "hide",
    }));
  });

  it("selects only a signed v8 local OBS scene and treats uncertainty as terminal", async () => {
    const catalogId = `sha256:${"3".repeat(64)}`;
    const programSceneId = `sha256:${"1".repeat(64)}`;
    const messageSceneId = `sha256:${"2".repeat(64)}`;
    mocks.status = {
      ...connectedStatus,
      permissions: ["observe", "controlProgram", "controlLocalOBS"],
      localOBSSceneControlAvailable: true,
    };
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 8,
      authority: { ...controlUpdate.authority, serviceVersion: "v8" },
      control: {
        ...controlUpdate.control!,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: true,
          stageAndMusicians: true,
          lanRemoteControl: true,
          lightingAndMIDI: true,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: { schemaVersion: 1, catalogId, totalCount: 2, pageSize: 128 },
        operatorTimers: null,
        localBroadcastLowerThird: null,
        localOBS: {
          schemaVersion: 1,
          revision: "31",
          connectionId: "90000000-0000-4000-8000-000000000001",
          availability: "ready",
          currentSceneId: programSceneId,
          scenes: [
            { sceneId: programSceneId, title: "Program" },
            { sceneId: messageSceneId, title: "Message" },
          ],
        },
      },
    };
    mocks.cueCatalog = {
      phase: "ready",
      catalogId,
      routeEpoch: "5",
      totalCount: 2,
      receivedCount: 2,
      cues: [{ cueId: "cue-1", title: "Verso" }, { cueId: "cue-2", title: "Coro" }],
      message: null,
    };
    const view = render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const card = await screen.findByTestId("studio-lan-local-obs-scenes");
    expect(card).toHaveTextContent(/catálogo firmado.*No toca stream, grabación, credenciales, músicos, Stage, Cloud ni luces/i);
    expect(card).toHaveTextContent(/OBS listo.*Revisión OBS 31/i);
    const selector = screen.getByLabelText(/Escena firmada/i);
    expect(selector).toHaveValue(programSceneId);
    fireEvent.change(selector, { target: { value: messageSceneId } });
    fireEvent.click(screen.getByRole("button", { name: /Cambiar escena en OBS local/i }));
    await waitFor(() => expect(mocks.sendLocalOBSSceneCommand).toHaveBeenCalledWith({
      kind: "selectLocalOBSScene",
      sceneId: messageSceneId,
    }));
    expect(mocks.sendRemoteCommand).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /stream|grabar|endpoint|contraseña/i })).not.toBeInTheDocument();

    mocks.localOBSSceneFeedback = {
      commandId: "12345678-1234-4abc-8def-123456789abc",
      kind: "selectLocalOBSScene",
      sceneId: messageSceneId,
      state: "unconfirmed",
      rejection: null,
      uncertaintyReason: "mutationMayHaveExecuted",
      obsRevision: null,
    };
    mocks.status = {
      ...connectedStatus,
      permissions: ["observe", "controlProgram", "controlLocalOBS"],
      localOBSSceneControlAvailable: false,
    };
    view.rerender(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    expect(await screen.findByTestId("studio-lan-local-obs-scene-feedback")).toHaveTextContent(
      /puede haber ejecutado.*No lo repetiremos.*estado firmado nuevo/i,
    );
    expect(mocks.sendLocalOBSSceneCommand).toHaveBeenCalledTimes(1);
  });

  it("keeps the v7 card fail-closed when its signed sidecar is unavailable", async () => {
    mocks.status = {
      ...connectedStatus,
      localBroadcastLowerThirdControlAvailable: false,
    };
    mocks.update = {
      ...controlUpdate,
      payloadVersion: 7,
      control: {
        ...controlUpdate.control!,
        cueCatalog: null,
        routing: {
          schemaVersion: 1,
          localAudience: true,
          localBroadcast: true,
          stageAndMusicians: false,
          lanRemoteControl: true,
          lightingAndMIDI: false,
          tchurchCloudProgram: false,
        },
        cueCatalogManifest: {
          schemaVersion: 1,
          catalogId: `sha256:${"4".repeat(64)}`,
          totalCount: 2,
          pageSize: 128,
        },
        operatorTimers: null,
        localBroadcastLowerThird: null,
      },
    };
    render(<MemoryRouter><StudioLANProduction /></MemoryRouter>);

    const lowerThird = await screen.findByTestId("studio-lan-local-broadcast-lower-third");
    expect(lowerThird).toHaveTextContent(/no publicó el estado firmado/i);
    expect(lowerThird).toHaveTextContent(/Program y los demás controles locales siguen disponibles/i);
    expect(screen.getByRole("button", { name: /Mostrar \/ actualizar/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Ocultar$/i })).toBeDisabled();
  });
});
