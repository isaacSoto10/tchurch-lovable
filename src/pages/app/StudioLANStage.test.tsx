import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioLANImageAssetStatus, StudioLANStatus, StudioLANUpdate } from "@/lib/studioLANClient";

const mocks = vi.hoisted(() => ({
  status: null as StudioLANStatus | null,
  update: null as StudioLANUpdate | null,
  imageAsset: null as StudioLANImageAssetStatus | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  forget: vi.fn(),
  refresh: vi.fn(),
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
    imageAsset: mocks.imageAsset,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    forget: mocks.forget,
    refresh: mocks.refresh,
  }),
}));

import StudioLANStage from "./StudioLANStage";

const serviceId = "a".repeat(32);
const baseStatus: StudioLANStatus = {
  supported: true,
  phase: "discovering",
  services: [{ id: serviceId, name: "Tchurch Studio" }],
  selectedServiceId: null,
  channel: null,
  paired: false,
  message: null,
};

const update: StudioLANUpdate = {
  channel: "stage",
  payloadVersion: 1,
  sequence: "12",
  revision: "8",
  receivedAtMs: Date.now(),
  authority: { runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorityEpoch: "7", packageId: "package", serviceVersion: "v1" },
  audience: {
    currentCueId: "cue-1",
    currentCueIndex: 0,
    cueCount: 2,
    isBlackout: false,
    countdown: null,
    cue: { cueId: "cue-1", title: "Verso", lines: ["Gracia sobre gracia"], mediaAssetId: null, imageAsset: null },
  },
  stage: {
    nextCue: { cueId: "cue-2", title: "Coro", lines: ["Siguiente línea"], mediaAssetId: null, imageAsset: null },
    chordLines: ["C  G  Am  F"],
    currentChordSlide: null,
    timers: [],
    message: "Puente dos veces",
  },
};

const imageObjectA = `sha256:${"a".repeat(64)}`;
const imageObjectB = `sha256:${"b".repeat(64)}`;

function imageUpdate(objectId = imageObjectA): StudioLANUpdate {
  return {
    ...update,
    payloadVersion: 3,
    audience: {
      ...update.audience,
      cue: {
        ...update.audience.cue!,
        mediaAssetId: objectId,
        imageAsset: {
          schemaVersion: 1,
          referenceId: `sha256:${"c".repeat(64)}`,
          objectId,
          kind: "image",
          mimeType: "image/png",
          byteSize: "1024",
          required: true,
          imageFit: "cover",
        },
      },
    },
    stage: { ...update.stage!, chordLines: [], currentChordSlide: null },
  };
}

function imageStatus(
  objectId = imageObjectA,
  phase: StudioLANImageAssetStatus["phase"] = "ready",
): StudioLANImageAssetStatus {
  return {
    cueId: "cue-1",
    objectId,
    phase,
    receivedBytes: phase === "ready" ? "1024" : "512",
    totalBytes: "1024",
    imageFit: "cover",
    localUrl: phase === "ready" ? "capacitor://localhost/_capacitor_file_/private/cache/image.png" : null,
    message: phase === "loading" ? "Descargando imagen offline…" : null,
  };
}

describe("Studio LAN stage route", () => {
  beforeEach(() => {
    mocks.status = baseStatus;
    mocks.update = null;
    mocks.imageAsset = null;
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.forget.mockReset().mockResolvedValue(undefined);
    mocks.refresh.mockReset().mockResolvedValue(undefined);
    mocks.scanBarcode.mockReset().mockResolvedValue({ ScanResult: "" });
  });

  it("leaves discovery loading and offers a retry when Studio is absent", () => {
    mocks.status = {
      ...baseStatus,
      phase: "idle",
      services: [],
      message: "No se encontró Tchurch Studio. Verifica que la Mac esté abierta y en esta red.",
    };
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent(/no se encontró Tchurch Studio/i);
    expect(screen.getByText(/ningún Tchurch Studio visible/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /buscar de nuevo/i }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("explains the read-only fallback and exposes no production controls", () => {
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.getByText("Pantalla de músicos y escenario")).toBeInTheDocument();
    expect(screen.getByText(/no puede avanzar slides ni controlar producción/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tchurch Studio/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /siguiente|anterior|blackout/i })).not.toBeInTheDocument();
  });

  it("renders only sanitized stage data in a scrollable live surface", () => {
    mocks.status = { ...baseStatus, phase: "connected", selectedServiceId: serviceId, channel: "stage", paired: true };
    mocks.update = update;
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.getByText("Gracia sobre gracia")).toBeInTheDocument();
    expect(screen.getByLabelText("Acordes actuales")).toHaveTextContent(
      /C\s+G\s+Am\s+F/,
    );
    expect(screen.getByText("Puente dos veces")).toBeInTheDocument();
    expect(screen.getByText("Coro")).toBeInTheDocument();
    expect(screen.getByTestId("studio-lan-scroll")).toHaveClass("overflow-y-auto");
    expect(screen.queryByText(/privateNotes|token=/i)).not.toBeInTheDocument();
  });

  it("fails the visual output closed while Studio is black", () => {
    mocks.status = { ...baseStatus, phase: "connected", selectedServiceId: serviceId, channel: "stage", paired: true };
    mocks.update = { ...update, audience: { ...update.audience, isBlackout: true } };
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.getByLabelText("Salida en negro")).toBeInTheDocument();
    expect(screen.queryByText("Gracia sobre gracia")).not.toBeInTheDocument();
    expect(screen.queryByText("Puente dos veces")).not.toBeInTheDocument();
  });

  it("scans a Studio QR without rendering the pairing secret", async () => {
    const pairingQR = `tchurch-studio:${"A".repeat(43)}`;
    mocks.scanBarcode.mockResolvedValue({ ScanResult: pairingQR });
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /escanear QR de Studio/i }));
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledWith(serviceId, "stage", pairingQR));
    expect(screen.queryByText(pairingQR)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/código de emparejamiento/i)).toHaveValue("");
  });

  it("rejects a foreign QR before it reaches the native connection", async () => {
    mocks.scanBarcode.mockResolvedValue({ ScanResult: "https://example.com/not-studio" });
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /escanear QR de Studio/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pertenece a Tchurch Studio/i);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("renders v2 chords at their UTF-16 lyric offsets, including grouped tokens", () => {
    const text = "Dios 🙌 es fiel";
    mocks.status = { ...baseStatus, phase: "connected", selectedServiceId: serviceId, channel: "stage", paired: true };
    mocks.update = {
      ...update, payloadVersion: 2,
      audience: { ...update.audience, cue: { ...update.audience.cue!, lines: [text] } },
      stage: { ...update.stage!, currentChordSlide: { cueId: "cue-1", key: "C", lines: [{ text, chords: [
        { value: "C", offsetUtf16: 0 }, { value: "C/E", offsetUtf16: 0 }, { value: "G", offsetUtf16: 8 },
      ] }] } },
    };
    const { container } = render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.getByText(/Tono · C/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Acordes y letra actuales")).toHaveTextContent(text);
    expect(container.querySelector('[data-chord-offset-utf16="0"]')).toHaveTextContent("C / C/E");
    expect(container.querySelector('[data-chord-offset-utf16="8"]')).toHaveTextContent("G");
    expect(screen.queryByLabelText("Acordes actuales")).not.toBeInTheDocument();
  });

  it("shows a placeholder until the current cue image is verified and ready", () => {
    mocks.status = { ...baseStatus, phase: "connected", selectedServiceId: serviceId, channel: "stage", paired: true };
    mocks.update = imageUpdate();
    mocks.imageAsset = imageStatus(imageObjectA, "loading");
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.getByTestId("studio-lan-image-placeholder")).toHaveTextContent("Descargando imagen offline…");
    expect(screen.queryByTestId("studio-lan-image")).not.toBeInTheDocument();
    expect(screen.getByText("Gracia sobre gracia")).toBeInTheDocument();
  });

  it("renders only the exact current cue object with its signed fit", () => {
    mocks.status = { ...baseStatus, phase: "connected", selectedServiceId: serviceId, channel: "stage", paired: true };
    mocks.update = imageUpdate();
    mocks.imageAsset = imageStatus();
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    const image = screen.getByTestId("studio-lan-image");
    expect(image).toHaveAttribute("src", "capacitor://localhost/_capacitor_file_/private/cache/image.png");
    expect(image).toHaveStyle({ objectFit: "cover" });
    expect(screen.queryByTestId("studio-lan-image-placeholder")).not.toBeInTheDocument();
  });

  it("never renders a stale A image after the current cue changes to B", () => {
    mocks.status = { ...baseStatus, phase: "connected", selectedServiceId: serviceId, channel: "stage", paired: true };
    mocks.update = imageUpdate(imageObjectB);
    mocks.imageAsset = imageStatus(imageObjectA);
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.queryByTestId("studio-lan-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-lan-image-placeholder")).toHaveTextContent("Preparando imagen offline…");
  });

  it("keeps blackout authoritative even when a verified image is ready", () => {
    mocks.status = { ...baseStatus, phase: "connected", selectedServiceId: serviceId, channel: "stage", paired: true };
    const withImage = imageUpdate();
    mocks.update = { ...withImage, audience: { ...withImage.audience, isBlackout: true } };
    mocks.imageAsset = imageStatus();
    render(<MemoryRouter><StudioLANStage /></MemoryRouter>);
    expect(screen.getByLabelText("Salida en negro")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-lan-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("studio-lan-image-placeholder")).not.toBeInTheDocument();
  });
});
