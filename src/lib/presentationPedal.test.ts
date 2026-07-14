import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
  MAX_PRESENTATION_HARDWARE_BINDINGS,
  PRESENTATION_HARDWARE_SCHEMA_VERSION,
  createPresentationInputDeduper,
  legacyPresentationPedalStorageKey,
  normalizePresentationHardwareSettings,
  presentationHardwareBindingFingerprint,
  presentationHardwareStorageKey,
  presentationKeyboardBindingsForAction,
  readPresentationHardwareSettings,
  resolvePresentationHardwareAction,
  setPresentationHardwareSourceEnabled,
  updatePresentationKeyboardBinding,
  writePresentationHardwareSettings,
  type PresentationHardwareContext,
} from "./presentationPedal";

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
    setItem: (key: string, value: string) => values.set(key, value),
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

  it("migrates the legacy church pedal document once into the account scope", () => {
    const storage = memoryStorage();
    storage.setItem(legacyPresentationPedalStorageKey("church-1"), JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      bindings: {
        next: ["PageDown", "KeyN"],
        previous: ["PageUp"],
        toggle_blackout: ["KeyB"],
        toggle_chords: ["KeyC"],
      },
    }));

    const migrated = readPresentationHardwareSettings("account-1", "church-1", storage);
    expect(migrated.schemaVersion).toBe(5);
    expect(presentationKeyboardBindingsForAction(migrated, "next").map((binding) => binding.code)).toEqual(["PageDown", "KeyN"]);
    const v5Key = presentationHardwareStorageKey("account-1", "church-1");
    expect(storage.values.has(v5Key)).toBe(true);

    storage.setItem(legacyPresentationPedalStorageKey("church-1"), JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      bindings: { next: ["KeyX"] },
    }));
    expect(readPresentationHardwareSettings("account-1", "church-1", storage)).toEqual(migrated);
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
});
