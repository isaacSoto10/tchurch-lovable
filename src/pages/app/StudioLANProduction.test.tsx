import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioLANRemoteFeedback, StudioLANStatus, StudioLANUpdate } from "@/lib/studioLANClient";

const mocks = vi.hoisted(() => ({
  status: null as StudioLANStatus | null,
  update: null as StudioLANUpdate | null,
  remoteFeedback: null as StudioLANRemoteFeedback | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  forget: vi.fn(),
  refresh: vi.fn(),
  sendRemoteCommand: vi.fn(),
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
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    forget: mocks.forget,
    refresh: mocks.refresh,
    sendRemoteCommand: mocks.sendRemoteCommand,
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
};

const controlUpdate: StudioLANUpdate = {
  channel: "control",
  payloadVersion: 4,
  sequence: "12",
  revision: "8",
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
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.forget.mockReset().mockResolvedValue(undefined);
    mocks.refresh.mockReset().mockResolvedValue(undefined);
    mocks.sendRemoteCommand.mockReset().mockResolvedValue(undefined);
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
    expect(controls).toHaveTextContent(/Stage separado/i);
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }));
    await waitFor(() => expect(mocks.sendRemoteCommand).toHaveBeenCalledWith({ kind: "next" }));

    mocks.status = { ...connectedStatus, remoteControlAvailable: false, remoteCommandInFlight: true };
    view.rerender(<MemoryRouter><StudioLANProduction /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Anterior/i })).toBeDisabled();
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
    fireEvent.change(screen.getByLabelText(/Saltar a una diapositiva/i), { target: { value: "cue-2" } });
    fireEvent.click(screen.getByRole("button", { name: /Ir a selección/i }));
    await waitFor(() => expect(mocks.sendRemoteCommand).toHaveBeenCalledWith({ kind: "jump", cueId: "cue-2" }));
    expect(screen.getByTestId("studio-lan-production-feedback")).toHaveTextContent(/revisión nueva/i);
  });
});
