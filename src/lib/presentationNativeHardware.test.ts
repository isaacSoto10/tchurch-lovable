import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
  setPresentationHardwareSourceEnabled,
  updatePresentationGamepadBinding,
  updatePresentationMidiBinding,
} from "./presentationPedal";
import { presentationNativeHardwareStartOptions } from "./presentationNativeHardware";

describe("presentation native hardware bridge contract", () => {
  it("sends only enabled, normalized native bindings and never actions or account scope", () => {
    let settings = setPresentationHardwareSourceEnabled(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "gamepad", true);
    settings = setPresentationHardwareSourceEnabled(settings, "midi", true);
    settings = updatePresentationGamepadBinding(settings, "next", {
      deviceId: "gamepad-one",
      control: "dpad_right",
    });
    settings = updatePresentationMidiBinding(settings, "toggle_chords", {
      source: "midi",
      deviceId: "midi-one",
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
      gamepadBindings: [{ deviceId: "gamepad-one", control: "dpad_right" }],
      midiBindings: [{
        deviceId: "midi-one",
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
});
