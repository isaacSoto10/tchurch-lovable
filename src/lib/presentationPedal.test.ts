import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
  MAX_PRESENTATION_HARDWARE_BINDINGS,
  PRESENTATION_HARDWARE_SCHEMA_VERSION,
  calibratePresentationMidiInput,
  createPresentationInputDeduper,
  isCanonicalPresentationGamepadDeviceId,
  isCanonicalPresentationMidiDeviceId,
  isAllowedPresentationHardwareKeyCode,
  legacyPresentationPedalStorageKey,
  normalizePresentationHardwareSettings,
  presentationHardwareBindingFingerprint,
  presentationHardwareMigrationBackupKey,
  presentationHardwareMigrationGuardKey,
  presentationHardwareMigrationQuarantineKey,
  presentationHardwareStorageKey,
  presentationGamepadBindingsForAction,
  presentationKeyboardBindingsForAction,
  readPresentationHardwareSettings,
  resolvePresentationHardwareAction,
  resolvePresentationHardwareInput,
  resolvePresentationNativeHardwareInput,
  setPresentationHardwareSourceEnabled,
  updatePresentationKeyboardBinding,
  updatePresentationGamepadBinding,
  updatePresentationMidiBinding,
  writePresentationHardwareSettings,
  type PresentationHardwareContext,
} from "./presentationPedal";

const GAMEPAD_A = `gamepad-${"a".repeat(64)}`;
const GAMEPAD_B = `gamepad-${"b".repeat(64)}`;
const MIDI_A = "midi-42";

const readyContext: PresentationHardwareContext = {
  mode: "live",
  controllerOwned: true,
  commandPending: false,
  appActive: true,
  documentVisible: true,
  modalOpen: false,
  editorOpen: false,
  captureActive: false,
  networkDiverged: false,
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("presentation hardware schema v5", () => {
  beforeEach(() => localStorage.clear());

  it("ships a bounded keyboard-first contract with reserved native sources", () => {
    expect(DEFAULT_PRESENTATION_HARDWARE_SETTINGS.schemaVersion).toBe(PRESENTATION_HARDWARE_SCHEMA_VERSION);
    expect(DEFAULT_PRESENTATION_HARDWARE_SETTINGS.sources).toEqual({ keyboard: true, gamepad: false, midi: false });
    expect(presentationKeyboardBindingsForAction(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "next").map((binding) => binding.code)).toEqual([
      "ArrowRight",
      "ArrowDown",
      "PageDown",
      "Space",
    ]);
    expect(presentationKeyboardBindingsForAction(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "toggle_blackout")[0]?.code).toBe("KeyB");
    expect(new Set(DEFAULT_PRESENTATION_HARDWARE_SETTINGS.bindings.map(presentationHardwareBindingFingerprint)).size).toBe(DEFAULT_PRESENTATION_HARDWARE_SETTINGS.bindings.length);
  });

  it("persists settings by account and church without credentials", () => {
    const storage = memoryStorage();
    const changed = setPresentationHardwareSourceEnabled(
      updatePresentationKeyboardBinding(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "next", "KeyN"),
      "keyboard",
      true,
    );
    const saved = writePresentationHardwareSettings("account/1", "church/1", changed, storage);

    expect(readPresentationHardwareSettings("account/1", "church/1", storage)).toEqual(saved);
    expect(readPresentationHardwareSettings("account/2", "church/1", storage)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(readPresentationHardwareSettings("account/1", "church/2", storage)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    const key = presentationHardwareStorageKey("account/1", "church/1");
    expect(key).toContain("account%2F1");
    expect(key).toContain("church%2F1");
    expect(storage.values.get(key)).not.toMatch(/password|token|secret/i);
  });

  it("atomically consumes the shared legacy document so only account A can migrate it", () => {
    const storage = memoryStorage();
    const legacyKey = legacyPresentationPedalStorageKey("church-1");
    const legacyRaw = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      bindings: {
        next: ["PageDown", "KeyN"],
        previous: ["PageUp"],
        toggle_blackout: ["KeyB"],
        toggle_chords: ["KeyC"],
      },
    });
    storage.setItem(legacyKey, legacyRaw);

    const migrated = readPresentationHardwareSettings("account-1", "church-1", storage);
    expect(migrated.schemaVersion).toBe(5);
    expect(presentationKeyboardBindingsForAction(migrated, "next").map((binding) => binding.code)).toEqual(["PageDown", "KeyN"]);
    const v5Key = presentationHardwareStorageKey("account-1", "church-1");
    expect(storage.values.has(v5Key)).toBe(true);
    expect(storage.values.has(legacyKey)).toBe(false);
    expect(storage.values.get(presentationHardwareMigrationGuardKey("church-1"))).toBe(`committed:${v5Key}`);
    expect(storage.values.get(presentationHardwareMigrationBackupKey("account-1", "church-1"))).toBe(legacyRaw);
    expect(storage.values.has(presentationHardwareMigrationBackupKey("account-2", "church-1"))).toBe(false);

    storage.setItem(legacyKey, JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      bindings: { next: ["KeyX"] },
    }));
    expect(readPresentationHardwareSettings("account-1", "church-1", storage)).toEqual(migrated);
    expect(readPresentationHardwareSettings("account-2", "church-1", storage)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(storage.values.has(presentationHardwareStorageKey("account-2", "church-1"))).toBe(false);
  });

  it("fails closed on corrupt legacy data and storage failures without exposing a partial migration", () => {
    const corrupt = memoryStorage();
    corrupt.setItem(legacyPresentationPedalStorageKey("church-corrupt"), "{not-json");
    expect(readPresentationHardwareSettings("account-a", "church-corrupt", corrupt)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(corrupt.values.has(presentationHardwareStorageKey("account-a", "church-corrupt"))).toBe(false);

    const failing = memoryStorage();
    const legacyKey = legacyPresentationPedalStorageKey("church-fail");
    failing.setItem(legacyKey, JSON.stringify({ schemaVersion: 1, enabled: true, bindings: { next: ["KeyN"] } }));
    const originalRemove = failing.removeItem;
    failing.removeItem = (key: string) => {
      if (key === legacyKey) throw new Error("remove unavailable");
      return originalRemove(key);
    };

    expect(readPresentationHardwareSettings("account-a", "church-fail", failing)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    const accountAKey = presentationHardwareStorageKey("account-a", "church-fail");
    expect(failing.values.has(accountAKey)).toBe(false);
    expect(failing.values.get(presentationHardwareMigrationGuardKey("church-fail"))).toBe(`claimed:${accountAKey}`);
    expect(readPresentationHardwareSettings("account-b", "church-fail", failing)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(failing.values.has(presentationHardwareStorageKey("account-b", "church-fail"))).toBe(false);
  });

  it("quarantines a transient guard write failure so a later account cannot retry the legacy", () => {
    const setFailure = memoryStorage();
    const setFailureLegacyKey = legacyPresentationPedalStorageKey("church-set-fail");
    const setFailureGuardKey = presentationHardwareMigrationGuardKey("church-set-fail");
    setFailure.setItem(setFailureLegacyKey, JSON.stringify({ schemaVersion: 1, enabled: true, bindings: { next: ["KeyN"] } }));
    const originalSet = setFailure.setItem;
    let guardFailuresRemaining = 1;
    setFailure.setItem = (key: string, value: string) => {
      if (key === setFailureGuardKey && guardFailuresRemaining > 0) {
        guardFailuresRemaining -= 1;
        throw new Error("set temporarily unavailable");
      }
      return originalSet(key, value);
    };
    expect(readPresentationHardwareSettings("account-a", "church-set-fail", setFailure)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(setFailure.values.has(setFailureLegacyKey)).toBe(false);
    expect(setFailure.values.get(presentationHardwareMigrationQuarantineKey("church-set-fail"))).toBe("blocked");
    setFailure.setItem(setFailureLegacyKey, JSON.stringify({ schemaVersion: 1, enabled: true, bindings: { next: ["KeyX"] } }));
    expect(readPresentationHardwareSettings("account-b", "church-set-fail", setFailure)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(setFailure.values.has(presentationHardwareStorageKey("account-b", "church-set-fail"))).toBe(false);
  });

  it("detects a silently dropped guard and quarantines the shared legacy even if removal fails", () => {
    const storage = memoryStorage();
    const churchId = "church-silent-drop";
    const legacyKey = legacyPresentationPedalStorageKey(churchId);
    const guardKey = presentationHardwareMigrationGuardKey(churchId);
    const quarantineKey = presentationHardwareMigrationQuarantineKey(churchId);
    storage.setItem(legacyKey, JSON.stringify({ schemaVersion: 1, enabled: true, bindings: { next: ["KeyN"] } }));
    const originalSet = storage.setItem;
    const originalRemove = storage.removeItem;
    storage.setItem = (key: string, value: string) => {
      if (key === guardKey) return;
      originalSet(key, value);
    };
    storage.removeItem = (key: string) => {
      if (key === legacyKey) throw new Error("legacy removal unavailable");
      originalRemove(key);
    };

    expect(readPresentationHardwareSettings("account-a", churchId, storage)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(storage.values.has(presentationHardwareStorageKey("account-a", churchId))).toBe(false);
    expect(storage.values.has(legacyKey)).toBe(true);
    expect(storage.values.get(quarantineKey)).toBe("blocked");
    expect(readPresentationHardwareSettings("account-b", churchId, storage)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    expect(storage.values.has(presentationHardwareStorageKey("account-b", churchId))).toBe(false);
  });

  it("validates reserved bindings, removes duplicate physical inputs, and caps the document", () => {
    const bindings = Array.from({ length: 40 }, (_, index) => ({
      id: `key-${index}`,
      enabled: true,
      source: "keyboard",
      code: `Key${String.fromCharCode(65 + (index % 26))}${index}`,
      action: "next",
    }));
    bindings.splice(1, 0, { ...bindings[0], id: "duplicate", action: "previous" });
    const normalized = normalizePresentationHardwareSettings({
      schemaVersion: 5,
      enabled: true,
      sources: { keyboard: true, gamepad: true, midi: true },
      bindings: [
        { id: "gamepad-a", enabled: true, source: "gamepad", control: "button_a", action: "next" },
        { id: "midi-cc", enabled: true, source: "midi", message: "control_change", channel: null, number: 20, action: "toggle_chords" },
        ...bindings,
        { id: "bad-midi", enabled: true, source: "midi", message: "sysex", channel: 30, number: 400, action: "next" },
      ],
    });

    expect(normalized.bindings).toHaveLength(MAX_PRESENTATION_HARDWARE_BINDINGS);
    expect(new Set(normalized.bindings.map(presentationHardwareBindingFingerprint)).size).toBe(normalized.bindings.length);
    expect(normalized.bindings.some((binding) => binding.source === "gamepad" && binding.control === "button_a")).toBe(true);
    expect(normalized.bindings.some((binding) => binding.source === "midi" && binding.message === "control_change")).toBe(true);
    expect(normalized.bindings.filter((binding) => binding.source === "keyboard" && binding.code === bindings[0].code)).toHaveLength(1);
    expect(normalizePresentationHardwareSettings({ schemaVersion: 99, bindings: [] })).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
  });

  it("keeps one physical key unique when learning a replacement", () => {
    const changed = updatePresentationKeyboardBinding(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "next", "ArrowLeft");
    expect(presentationKeyboardBindingsForAction(changed, "next").map((binding) => binding.code)).toEqual(["ArrowLeft"]);
    expect(presentationKeyboardBindingsForAction(changed, "previous").map((binding) => binding.code)).toEqual(["ArrowUp", "PageUp"]);
  });

  it("persists device-scoped gamepad and calibrated MIDI bindings inside schema v5", () => {
    const gamepad = updatePresentationGamepadBinding(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "next", {
      deviceId: GAMEPAD_A,
      control: "dpad_right",
    });
    expect(presentationGamepadBindingsForAction(gamepad, "next")).toEqual([
      expect.objectContaining({ source: "gamepad", deviceId: GAMEPAD_A, control: "dpad_right" }),
    ]);

    const midiZero = updatePresentationMidiBinding(gamepad, "toggle_blackout", {
      source: "midi",
      deviceId: MIDI_A,
      deviceName: "MIDI A",
      message: "control_change",
      channel: 0,
      number: 64,
      value: 0,
    });
    expect(midiZero.bindings).toContainEqual(expect.objectContaining({
      source: "midi",
      deviceId: MIDI_A,
      activation: "zero",
      threshold: 0,
      releaseThreshold: 1,
    }));
    expect(calibratePresentationMidiInput({ message: "control_change", value: 1 })).toEqual({ activation: "positive", threshold: 1, releaseThreshold: 0 });
    expect(calibratePresentationMidiInput({ message: "note_on", value: 127 })).toEqual({ activation: "positive", threshold: 1, releaseThreshold: 0 });
  });

  it("accepts only source-canonical persisted device IDs with the same contract as Swift", () => {
    const gamepadHash = `gamepad-${"0a".repeat(32)}`;
    const midiHash = `midi-${"0f".repeat(32)}`;
    for (const accepted of [gamepadHash, GAMEPAD_A]) {
      expect(isCanonicalPresentationGamepadDeviceId(accepted)).toBe(true);
    }
    for (const rejected of [
      "gamepad-a",
      `gamepad-${"A".repeat(64)}`,
      `gamepad-${"a".repeat(63)}`,
      "gamepad-550e8400-e29b-41d4-a716-446655440000",
      "runtime-1",
      MIDI_A,
    ]) {
      expect(isCanonicalPresentationGamepadDeviceId(rejected)).toBe(false);
    }
    for (const accepted of ["midi-0", "midi-42", "midi-4294967295", midiHash]) {
      expect(isCanonicalPresentationMidiDeviceId(accepted)).toBe(true);
    }
    for (const rejected of [
      "midi-00",
      "midi-042",
      "midi-4294967296",
      "midi--1",
      `midi-${"F".repeat(64)}`,
      "midi-550e8400-e29b-41d4-a716-446655440000",
      "route-1",
      GAMEPAD_A,
    ]) {
      expect(isCanonicalPresentationMidiDeviceId(rejected)).toBe(false);
    }

    const normalized = normalizePresentationHardwareSettings({
      schemaVersion: 5,
      enabled: true,
      sources: { keyboard: false, gamepad: true, midi: true },
      bindings: [
        { id: "valid-gamepad", enabled: true, source: "gamepad", deviceId: GAMEPAD_A, control: "button_a", action: "next" },
        { id: "runtime-gamepad", enabled: true, source: "gamepad", deviceId: "550e8400-e29b-41d4-a716-446655440000", control: "button_b", action: "previous" },
        { id: "valid-midi", enabled: true, source: "midi", deviceId: MIDI_A, message: "note_on", channel: 0, number: 60, activation: "positive", threshold: 1, releaseThreshold: 0, action: "next" },
        { id: "runtime-midi", enabled: true, source: "midi", deviceId: "route-1", message: "note_on", channel: 0, number: 61, activation: "positive", threshold: 1, releaseThreshold: 0, action: "previous" },
      ],
    });
    expect(normalized.bindings.map((binding) => binding.id)).toEqual(["valid-gamepad", "valid-midi"]);
  });

  it("rejects navigation, destructive, system, and media keys from stored or learned bindings", () => {
    for (const code of ["Tab", "Enter", "NumpadEnter", "Backspace", "Delete", "Escape", "Home", "End", "F1", "MediaPlayPause", "AudioVolumeUp", "BrowserBack", "LaunchMail", "BrightnessUp"]) {
      expect(isAllowedPresentationHardwareKeyCode(code)).toBe(false);
      expect(updatePresentationKeyboardBinding(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "next", code)).toEqual(DEFAULT_PRESENTATION_HARDWARE_SETTINGS);
    }
    expect(isAllowedPresentationHardwareKeyCode("PageDown")).toBe(true);
    expect(normalizePresentationHardwareSettings({
      schemaVersion: 5,
      enabled: true,
      sources: { keyboard: true, gamepad: false, midi: false },
      bindings: [
        { id: "blocked", enabled: true, source: "keyboard", code: "Enter", action: "next" },
        { id: "safe", enabled: true, source: "keyboard", code: "PageDown", action: "next" },
      ],
    }).bindings).toEqual([{ id: "safe", enabled: true, source: "keyboard", code: "PageDown", action: "next" }]);
  });
});

describe("presentation hardware execution gates", () => {
  it("resolves only the four keyboard actions while the exact controller owns the lease", () => {
    expect(resolvePresentationHardwareAction({ code: "ArrowRight" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBe("next");
    expect(resolvePresentationHardwareAction({ code: "ArrowLeft" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBe("previous");
    expect(resolvePresentationHardwareAction({ code: "KeyB" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBe("toggle_blackout");
    expect(resolvePresentationHardwareAction({ code: "KeyC" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBe("toggle_chords");
    expect(resolvePresentationHardwareAction({ code: "KeyX" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBeNull();
  });

  it.each([
    ["lease", { controllerOwned: false }],
    ["pending command", { commandPending: true }],
    ["background app", { appActive: false }],
    ["hidden document", { documentVisible: false }],
    ["modal", { modalOpen: true }],
    ["editor", { editorOpen: true }],
    ["learn capture", { captureActive: true }],
    ["divergent queue", { networkDiverged: true }],
  ])("fails closed for the %s gate", (_label, overrides) => {
    expect(resolvePresentationHardwareAction(
      { code: "PageDown" },
      DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      { ...readyContext, ...overrides },
    )).toBeNull();
  });

  it("rejects repeats, composition, modifiers, editable fields, dialogs, and disabled keyboard input", () => {
    const input = document.createElement("input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogButton = document.createElement("button");
    dialog.append(dialogButton);
    document.body.append(input, dialog);

    expect(resolvePresentationHardwareAction({ code: "PageDown", repeat: true }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBeNull();
    expect(resolvePresentationHardwareAction({ code: "PageDown", isComposing: true }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBeNull();
    expect(resolvePresentationHardwareAction({ code: "PageDown", metaKey: true }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBeNull();
    expect(resolvePresentationHardwareAction({ code: "PageDown", target: input }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBeNull();
    expect(resolvePresentationHardwareAction({ code: "PageDown", target: dialogButton }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBeNull();
    expect(resolvePresentationHardwareAction({ code: "Unidentified" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toBeNull();
    const disabled = setPresentationHardwareSourceEnabled(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "keyboard", false);
    expect(resolvePresentationHardwareAction({ code: "PageDown" }, disabled, readyContext)).toBeNull();

    input.remove();
    dialog.remove();
  });

  it("never consumes accessibility widgets or unbound/system keys", () => {
    const button = document.createElement("button");
    const link = document.createElement("a");
    link.href = "/services";
    const widget = document.createElement("div");
    widget.setAttribute("role", "switch");
    document.body.append(button, link, widget);

    for (const target of [button, link, widget]) {
      expect(resolvePresentationHardwareInput({ code: "Space", target }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toEqual({ action: null, consume: false });
    }
    expect(resolvePresentationHardwareInput({ code: "KeyX", repeat: true }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext)).toEqual({ action: null, consume: false });
    expect(resolvePresentationHardwareInput({ code: "MediaPlayPause" }, {
      ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      bindings: [...DEFAULT_PRESENTATION_HARDWARE_SETTINGS.bindings, { id: "media", enabled: true, source: "keyboard", code: "MediaPlayPause", action: "next" }],
    }, readyContext)).toEqual({ action: null, consume: false });

    button.remove();
    link.remove();
    widget.remove();
  });

  it("consumes repeat, pending, and bounce only after a binding passes every eligibility gate", () => {
    const deduper = createPresentationInputDeduper();
    expect(resolvePresentationHardwareInput({ code: "PageDown", repeat: true }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext, deduper)).toEqual({ action: null, consume: true });
    expect(resolvePresentationHardwareInput({ code: "PageDown" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, { ...readyContext, commandPending: true }, deduper)).toEqual({ action: null, consume: true });
    expect(resolvePresentationHardwareInput({ code: "PageDown" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, { ...readyContext, controllerOwned: false }, deduper)).toEqual({ action: null, consume: false });
    expect(resolvePresentationHardwareInput({ code: "PageDown" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext, deduper)).toEqual({ action: "next", consume: true });
    expect(resolvePresentationHardwareInput({ code: "PageDown" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext, deduper)).toEqual({ action: null, consume: true });
    expect(resolvePresentationHardwareInput({ code: "KeyX", repeat: true }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext, deduper)).toEqual({ action: null, consume: false });
  });

  it("deduplicates the same physical input inside 200 ms", () => {
    const deduper = createPresentationInputDeduper();
    expect(deduper.accept("keyboard:PageDown", 1_000)).toBe(true);
    expect(deduper.accept("keyboard:PageDown", 1_199)).toBe(false);
    expect(deduper.accept("keyboard:PageUp", 1_199)).toBe(true);
    expect(deduper.accept("keyboard:PageDown", 1_200)).toBe(true);
    deduper.reset();
    expect(deduper.accept("keyboard:PageDown", 1_201)).toBe(true);

    const runtimeDeduper = { accept: vi.fn(() => false), reset: vi.fn() };
    expect(resolvePresentationHardwareAction({ code: "PageDown" }, DEFAULT_PRESENTATION_HARDWARE_SETTINGS, readyContext, runtimeDeduper)).toBeNull();
    expect(runtimeDeduper.accept).toHaveBeenCalledWith("keyboard:PageDown");
  });

  it("revalidates native device edges through every authority gate and 200 ms dedupe", () => {
    const settings = updatePresentationGamepadBinding(setPresentationHardwareSourceEnabled(DEFAULT_PRESENTATION_HARDWARE_SETTINGS, "gamepad", true), "next", {
      deviceId: GAMEPAD_A,
      control: "button_a",
    });
    const event = { source: "gamepad" as const, deviceId: GAMEPAD_A, deviceName: "Control", control: "button_a" as const };
    const deduper = createPresentationInputDeduper();

    expect(resolvePresentationNativeHardwareInput(event, settings, readyContext, deduper)).toBe("next");
    expect(resolvePresentationNativeHardwareInput(event, settings, readyContext, deduper)).toBeNull();
    deduper.reset();
    expect(resolvePresentationNativeHardwareInput({ ...event, deviceId: GAMEPAD_B }, settings, readyContext, deduper)).toBeNull();
    expect(resolvePresentationNativeHardwareInput({ ...event, deviceId: "runtime-route-1" }, settings, readyContext, deduper)).toBeNull();
    expect(resolvePresentationNativeHardwareInput(event, settings, { ...readyContext, commandPending: true }, deduper)).toBeNull();
    expect(resolvePresentationNativeHardwareInput(event, settings, { ...readyContext, captureActive: true }, deduper)).toBeNull();
    expect(resolvePresentationNativeHardwareInput(event, settings, { ...readyContext, modalOpen: true }, deduper)).toBeNull();
    expect(resolvePresentationNativeHardwareInput(event, settings, { ...readyContext, appActive: false }, deduper)).toBeNull();
    expect(resolvePresentationNativeHardwareInput(event, settings, { ...readyContext, networkDiverged: true }, deduper)).toBeNull();
  });

  it("resolves the exact MIDI rule that crossed instead of preferring an inactive specific rule", () => {
    const settings = normalizePresentationHardwareSettings({
      ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      sources: { ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS.sources, midi: true },
      bindings: [
        ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS.bindings,
        {
          id: "midi-wildcard",
          enabled: true,
          source: "midi",
          deviceId: null,
          message: "control_change",
          channel: 0,
          number: 7,
          activation: "positive",
          threshold: 1,
          releaseThreshold: 0,
          action: "next",
        },
        {
          id: "midi-specific",
          enabled: true,
          source: "midi",
          deviceId: MIDI_A,
          message: "control_change",
          channel: 0,
          number: 7,
          activation: "positive",
          threshold: 80,
          releaseThreshold: 40,
          action: "toggle_blackout",
        },
      ],
    });
    const baseEvent = {
      source: "midi" as const,
      deviceId: MIDI_A,
      deviceName: "Pedal",
      message: "control_change" as const,
      channel: 0,
      number: 7,
      value: 1,
    };

    expect(resolvePresentationNativeHardwareInput({ ...baseEvent, deviceId: "route-1" }, settings, readyContext)).toBeNull();
    expect(resolvePresentationNativeHardwareInput({
      ...baseEvent,
      ruleKey: "midi:control_change:0:7",
    }, settings, readyContext)).toBe("next");
    expect(resolvePresentationNativeHardwareInput({
      ...baseEvent,
      ruleKey: `midi:${MIDI_A}:control_change:0:7`,
    }, settings, readyContext)).toBeNull();
    expect(resolvePresentationNativeHardwareInput(baseEvent, settings, readyContext)).toBe("next");
    expect(resolvePresentationNativeHardwareInput({
      ...baseEvent,
      value: 100,
      ruleKey: `midi:${MIDI_A}:control_change:0:7`,
    }, settings, readyContext)).toBe("toggle_blackout");
  });
});
