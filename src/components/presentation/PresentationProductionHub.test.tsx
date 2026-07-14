import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_HARDWARE_SETTINGS, presentationKeyboardBindingsForAction } from "@/lib/presentationPedal";
import { PresentationProductionHub } from "./PresentationProductionHub";

const GAMEPAD_ID = `gamepad-${"a".repeat(64)}`;
const MIDI_ID = "midi-42";

vi.mock("@/components/presentation/PresentationAutomationPanel", () => ({ PresentationAutomationPanel: () => null }));
vi.mock("@/components/presentation/PresentationBroadcastPanel", () => ({ PresentationBroadcastPanel: () => null }));
vi.mock("@/components/presentation/PresentationIntegrationsPanel", () => ({ PresentationIntegrationsPanel: () => null }));
vi.mock("@/components/presentation/PresentationPrivateChat", () => ({ PresentationPrivateChat: () => null }));
vi.mock("@/components/presentation/PresentationReportPanel", () => ({ PresentationReportPanel: () => null }));

function renderHub(overrides: Partial<Parameters<typeof PresentationProductionHub>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onHardwareSettingsChange = vi.fn();
  const onHardwareCaptureChange = vi.fn();
  const onLearnNativeHardwareInput = vi.fn(async () => null);
  const onCancelNativeHardwareLearning = vi.fn();
  let props: Parameters<typeof PresentationProductionHub>[0] = {
    open: true,
    onOpenChange,
    serviceId: "service-1",
    serviceTitle: "Domingo",
    mode: "live",
    canEdit: true,
    controllerOwned: true,
    viewerRoles: ["all"],
    privacyScope: "account::church::service",
    churchId: "church-1",
    networkState: "online",
    snapshot: null,
    clientId: "client-1",
    automationState: { phase: "idle", notice: null, queuedEvents: 0, lastAppliedAt: null },
    hardwareSettings: DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
    hardwareAppActive: true,
    hardwareCommandPending: false,
    hardwareNativeStatus: { supported: true, active: true, gamepads: [{ id: GAMEPAD_ID, name: "Control Uno" }], midiSources: [{ id: MIDI_ID, name: "Interfaz Uno" }], learningSource: null, message: null },
    onHardwareSettingsChange,
    onHardwareCaptureChange,
    onLearnNativeHardwareInput,
    onCancelNativeHardwareLearning,
    initialTab: "pedal",
    ...overrides,
  };
  const view = render(<PresentationProductionHub {...props} />);
  return {
    onOpenChange,
    onHardwareSettingsChange,
    onHardwareCaptureChange,
    onLearnNativeHardwareInput,
    onCancelNativeHardwareLearning,
    rerenderHub(nextOverrides: Partial<Parameters<typeof PresentationProductionHub>[0]>) {
      props = { ...props, ...nextOverrides };
      view.rerender(<PresentationProductionHub {...props} />);
    },
  };
}

describe("PresentationProductionHub hardware panel", () => {
  it("shows native Gamepad/MIDI devices and keeps every source opt-in", () => {
    renderHub();
    expect(screen.getByText("Teclado HID")).toBeInTheDocument();
    expect(screen.getAllByText("Gamepad").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MIDI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Desactivado")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Habilitar teclado HID" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Habilitar Gamepad" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Habilitar MIDI" })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(/Listo para aprender entradas/i);
  });

  it("learns one keyboard input, reports capture state, and does not close on capture Escape", async () => {
    const { onOpenChange, onHardwareSettingsChange, onHardwareCaptureChange } = renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Aprender teclado para Siguiente" }));
    await waitFor(() => expect(onHardwareCaptureChange).toHaveBeenLastCalledWith(true));

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onHardwareCaptureChange).toHaveBeenLastCalledWith(false));

    fireEvent.click(screen.getByRole("button", { name: "Aprender teclado para Siguiente" }));
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

  it("fails closed on native startup errors and recovers without exposing bridge details", () => {
    const enabled = {
      ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      sources: { ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS.sources, gamepad: true },
    };
    const { rerenderHub } = renderHub({
      hardwareSettings: enabled,
      hardwareNativeStatus: {
        supported: true,
        active: false,
        gamepads: [],
        midiSources: [],
        learningSource: null,
        message: "CoreMIDI -50 at /private/path; endpoint=9",
      },
    });

    expect(screen.getByRole("status")).toHaveTextContent(/entradas nativas no están disponibles/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/Listo|CoreMIDI|-50|private|endpoint/i);
    expect(screen.getByText("Configurado · entrada no disponible")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Habilitar Gamepad" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Aprender Gamepad para Siguiente" })).toBeDisabled();

    rerenderHub({
      hardwareNativeStatus: {
        supported: true,
        active: true,
        gamepads: [{ id: GAMEPAD_ID, name: "Control Uno" }],
        midiSources: [],
        learningSource: null,
        message: null,
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Listo para aprender entradas físicas/i);
    expect(screen.getByRole("button", { name: "Aprender Gamepad para Siguiente" })).toBeEnabled();
  });

  it("does not learn navigation, destructive, or media keys", () => {
    const { onHardwareSettingsChange } = renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Aprender teclado para Siguiente" }));

    for (const code of ["Tab", "Enter", "NumpadEnter", "Backspace", "Delete", "Home", "End", "MediaPlayPause"]) {
      fireEvent.keyDown(window, { key: code === "Tab" ? "Tab" : "", code });
    }

    expect(onHardwareSettingsChange).not.toHaveBeenCalled();
    expect(screen.getByText(/reservada para navegación, accesibilidad o controles del sistema/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprender teclado para Siguiente" })).toHaveTextContent(/Cancelar/i);
  });

  it("learns a native gamepad edge without executing it inside the modal", async () => {
    const enabled = {
      ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      sources: { ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS.sources, gamepad: true },
    };
    const learned = { source: "gamepad" as const, deviceId: GAMEPAD_ID, deviceName: "Control Uno", control: "button_a" as const };
    const onLearnNativeHardwareInput = vi.fn(async () => learned);
    const { onHardwareSettingsChange, onHardwareCaptureChange } = renderHub({ hardwareSettings: enabled, onLearnNativeHardwareInput });

    fireEvent.click(screen.getByRole("button", { name: "Aprender Gamepad para Siguiente" }));
    await waitFor(() => expect(onLearnNativeHardwareInput).toHaveBeenCalledWith("gamepad", 10_000));
    await waitFor(() => expect(onHardwareSettingsChange).toHaveBeenCalledTimes(1));
    expect(onHardwareSettingsChange.mock.calls[0][0].bindings).toContainEqual(expect.objectContaining({ source: "gamepad", deviceId: GAMEPAD_ID, control: "button_a", action: "next" }));
    expect(onHardwareCaptureChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onHardwareCaptureChange).toHaveBeenLastCalledWith(false));
  });

  it("learns MIDI CC value zero with calibrated inverse thresholds", async () => {
    const enabled = {
      ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      sources: { ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS.sources, midi: true },
    };
    const learned = { source: "midi" as const, deviceId: MIDI_ID, deviceName: "Interfaz Uno", message: "control_change" as const, channel: 0, number: 64, value: 0, activation: "zero" as const, threshold: 0, releaseThreshold: 1 };
    const onLearnNativeHardwareInput = vi.fn(async () => learned);
    const { onHardwareSettingsChange } = renderHub({ hardwareSettings: enabled, onLearnNativeHardwareInput });

    fireEvent.click(screen.getByRole("button", { name: "Aprender MIDI para Salida en negro" }));
    await waitFor(() => expect(onHardwareSettingsChange).toHaveBeenCalledTimes(1));
    expect(onHardwareSettingsChange.mock.calls[0][0].bindings).toContainEqual(expect.objectContaining({ source: "midi", activation: "zero", threshold: 0, releaseThreshold: 1, action: "toggle_blackout" }));
  });
});
