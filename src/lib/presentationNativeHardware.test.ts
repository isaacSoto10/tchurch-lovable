import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
  setPresentationHardwareSourceEnabled,
  updatePresentationGamepadBinding,
  updatePresentationMidiBinding,
} from "./presentationPedal";
import {
  presentationNativeHardwareStartOptions,
  presentationNativeHardwareStatusMessage,
} from "./presentationNativeHardware";

const GAMEPAD_ID = `gamepad-${"a".repeat(64)}`;
const MIDI_ID = "midi-42";

describe("presentation native hardware bridge contract", () => {
  it("sends only enabled, normalized native bindings and never actions or account scope", () => {
    let settings = setPresentationHardwareSourceEnabled(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "gamepad", true);
    settings = setPresentationHardwareSourceEnabled(settings, "midi", true);
    settings = updatePresentationGamepadBinding(settings, "next", {
      deviceId: GAMEPAD_ID,
      control: "dpad_right",
    });
    settings = updatePresentationMidiBinding(settings, "toggle_chords", {
      source: "midi",
      deviceId: MIDI_ID,
      deviceName: "MIDI One",
      message: "control_change",
      channel: 0,
      number: 1,
      value: 1,
    });

    const options = presentationNativeHardwareStartOptions(settings);
    expect(options).toEqual({
      gamepadEnabled: true,
      midiEnabled: true,
      gamepadBindings: [{ deviceId: GAMEPAD_ID, control: "dpad_right" }],
      midiBindings: [{
        ruleKey: `midi:${MIDI_ID}:control_change:0:1`,
        deviceId: MIDI_ID,
        message: "control_change",
        channel: 0,
        number: 1,
        activation: "positive",
        threshold: 1,
        releaseThreshold: 0,
      }],
    });
    expect(JSON.stringify(options)).not.toContain("toggle_chords");
    expect(JSON.stringify(options)).not.toContain("account");
  });

  it("fully disables native monitoring behind the master switch", () => {
    const options = presentationNativeHardwareStartOptions({
      ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      enabled: false,
      sources: { keyboard: true, gamepad: true, midi: true },
    });
    expect(options.gamepadEnabled).toBe(false);
    expect(options.midiEnabled).toBe(false);
  });

  it("drops non-canonical runtime identifiers before crossing the native bridge", () => {
    const options = presentationNativeHardwareStartOptions({
      ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      sources: { keyboard: false, gamepad: true, midi: true },
      bindings: [
        { id: "bad-gamepad", enabled: true, source: "gamepad", deviceId: "550e8400-e29b-41d4-a716-446655440000", control: "button_a", action: "next" },
        { id: "bad-midi", enabled: true, source: "midi", deviceId: "route-1", message: "note_on", channel: 0, number: 60, activation: "positive", threshold: 1, releaseThreshold: 0, action: "next" },
      ],
    });

    expect(options.gamepadBindings).toEqual([]);
    expect(options.midiBindings).toEqual([]);
  });

  it("maps unexpected native details to one safe, actionable status message", () => {
    const sanitized = presentationNativeHardwareStatusMessage("CoreMIDI -50 at /private/path; endpoint=9");
    expect(sanitized).toMatch(/entradas nativas no están disponibles/i);
    expect(sanitized).toMatch(/vuelve a conectar/i);
    expect(sanitized).not.toMatch(/CoreMIDI|-50|private|endpoint/i);
    expect(presentationNativeHardwareStatusMessage("En espera: Tchurch está en segundo plano.")).toBe("En espera: Tchurch está en segundo plano.");
    expect(presentationNativeHardwareStatusMessage(null)).toBeNull();
  });
});
