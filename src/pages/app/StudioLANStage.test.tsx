import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioLANStatus, StudioLANUpdate } from "@/lib/studioLANClient";

const mocks = vi.hoisted(() => ({
  status: null as StudioLANStatus | null,
  update: null as StudioLANUpdate | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  forget: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/hooks/useStudioLANClient", () => ({
  useStudioLANClient: () => ({
    status: mocks.status,
    update: mocks.update,
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
    cue: { cueId: "cue-1", title: "Verso", lines: ["Gracia sobre gracia"], mediaAssetId: null },
  },
  stage: {
    nextCue: { cueId: "cue-2", title: "Coro", lines: ["Siguiente línea"], mediaAssetId: null },
    chordLines: ["C  G  Am  F"],
    timers: [],
    message: "Puente dos veces",
  },
};

describe("Studio LAN stage route", () => {
  beforeEach(() => {
    mocks.status = baseStatus;
    mocks.update = null;
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.forget.mockReset().mockResolvedValue(undefined);
    mocks.refresh.mockReset().mockResolvedValue(undefined);
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
});
