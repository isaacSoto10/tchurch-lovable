import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_HARDWARE_SETTINGS, presentationKeyboardBindingsForAction } from "@/lib/presentationPedal";
import { PresentationProductionHub } from "./PresentationProductionHub";

vi.mock("@/components/presentation/PresentationAutomationPanel", () => ({ PresentationAutomationPanel: () => null }));
vi.mock("@/components/presentation/PresentationBroadcastPanel", () => ({ PresentationBroadcastPanel: () => null }));
vi.mock("@/components/presentation/PresentationIntegrationsPanel", () => ({ PresentationIntegrationsPanel: () => null }));
vi.mock("@/components/presentation/PresentationPrivateChat", () => ({ PresentationPrivateChat: () => null }));
vi.mock("@/components/presentation/PresentationReportPanel", () => ({ PresentationReportPanel: () => null }));

function renderHub(overrides: Partial<Parameters<typeof PresentationProductionHub>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onHardwareSettingsChange = vi.fn();
  const onHardwareCaptureChange = vi.fn();
  render(<PresentationProductionHub
    open
    onOpenChange={onOpenChange}
    serviceId="service-1"
    serviceTitle="Domingo"
    mode="live"
    canEdit
    controllerOwned
    viewerRoles={["all"]}
    privacyScope="account::church::service"
    churchId="church-1"
    networkState="online"
    snapshot={null}
    clientId="client-1"
    automationState={{ phase: "idle", notice: null, queuedEvents: 0, lastAppliedAt: null }}
    hardwareSettings={DEFAULT_PRESENTATION_HARDWARE_SETTINGS}
    hardwareAppActive
    hardwareCommandPending={false}
    onHardwareSettingsChange={onHardwareSettingsChange}
    onHardwareCaptureChange={onHardwareCaptureChange}
    initialTab="pedal"
    {...overrides}
  />);
  return { onOpenChange, onHardwareSettingsChange, onHardwareCaptureChange };
}

describe("PresentationProductionHub hardware panel", () => {
  it("shows the current HID source and reserves gamepad and MIDI without enabling them", () => {
    renderHub();
    expect(screen.getByText("Teclado HID")).toBeInTheDocument();
    expect(screen.getByText("Gamepad")).toBeInTheDocument();
    expect(screen.getByText("MIDI")).toBeInTheDocument();
    expect(screen.getAllByText("Reservado para la siguiente etapa")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Habilitar teclado HID" })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(/Listo para aprender entradas/i);
  });

  it("learns one keyboard input, reports capture state, and does not close on capture Escape", async () => {
    const { onOpenChange, onHardwareSettingsChange, onHardwareCaptureChange } = renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Aprender entrada para Siguiente" }));
    await waitFor(() => expect(onHardwareCaptureChange).toHaveBeenLastCalledWith(true));

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onHardwareCaptureChange).toHaveBeenLastCalledWith(false));

    fireEvent.click(screen.getByRole("button", { name: "Aprender entrada para Siguiente" }));
    fireEvent.keyDown(window, { key: "n", code: "KeyN" });
    expect(onHardwareSettingsChange).toHaveBeenCalledTimes(1);
    const learned = onHardwareSettingsChange.mock.calls[0][0];
    expect(learned.schemaVersion).toBe(5);
    expect(presentationKeyboardBindingsForAction(learned, "next").map((binding) => binding.code)).toEqual(["KeyN"]);
  });

  it("explains why execution is paused instead of presenting a false ready state", () => {
    renderHub({ controllerOwned: false, hardwareCommandPending: true });
    expect(screen.getByRole("status")).toHaveTextContent(/Solo lectura/i);
  });
});
