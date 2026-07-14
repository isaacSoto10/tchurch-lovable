export const PRESENTATION_HARDWARE_SCHEMA_VERSION = 5 as const;
export const PRESENTATION_HARDWARE_STORAGE_PREFIX = "tchurch.presentation.hardware.v5";
export const LEGACY_PRESENTATION_PEDAL_STORAGE_PREFIX = "tchurch_live_pedal_v1";
export const PRESENTATION_HARDWARE_MIGRATION_GUARD_PREFIX = "tchurch.presentation.hardware.v5.migration";
export const PRESENTATION_HARDWARE_MIGRATION_BACKUP_PREFIX = "tchurch.presentation.hardware.v5.legacy-backup";
export const PRESENTATION_HARDWARE_MIGRATION_QUARANTINE_PREFIX = "tchurch.presentation.hardware.v5.migration-quarantine";
export const MAX_PRESENTATION_HARDWARE_BINDINGS = 32;
export const PRESENTATION_HARDWARE_DEDUPE_MS = 200;

export type PresentationHardwareAction = "next" | "previous" | "toggle_blackout" | "toggle_chords";
export type PresentationHardwareSource = "keyboard" | "gamepad" | "midi";
export const PRESENTATION_GAMEPAD_CONTROLS = [
  "button_a",
  "button_b",
  "button_x",
  "button_y",
  "left_shoulder",
  "right_shoulder",
  "left_trigger",
  "right_trigger",
  "left_thumbstick_button",
  "right_thumbstick_button",
  "dpad_up",
  "dpad_down",
  "dpad_left",
  "dpad_right",
  "left_stick_up",
  "left_stick_down",
  "left_stick_left",
  "left_stick_right",
  "right_stick_up",
  "right_stick_down",
  "right_stick_left",
  "right_stick_right",
] as const;
export type PresentationGamepadControl = typeof PRESENTATION_GAMEPAD_CONTROLS[number];
export type PresentationMidiActivation = "positive" | "zero";

type PresentationHardwareBindingBase = {
  id: string;
  enabled: boolean;
  action: PresentationHardwareAction;
};

export type PresentationKeyboardBinding = PresentationHardwareBindingBase & {
  source: "keyboard";
  code: string;
};

export type PresentationGamepadBinding = PresentationHardwareBindingBase & {
  source: "gamepad";
  deviceId: string | null;
  control: PresentationGamepadControl;
};

export type PresentationMidiBinding = PresentationHardwareBindingBase & {
  source: "midi";
  deviceId: string | null;
  message: "note_on" | "control_change";
  channel: number | null;
  number: number;
  activation: PresentationMidiActivation;
  threshold: number;
  releaseThreshold: number;
};

export type PresentationHardwareBinding = PresentationKeyboardBinding | PresentationGamepadBinding | PresentationMidiBinding;

export type PresentationHardwareSettings = {
  schemaVersion: typeof PRESENTATION_HARDWARE_SCHEMA_VERSION;
  enabled: boolean;
  sources: Record<PresentationHardwareSource, boolean>;
  bindings: PresentationHardwareBinding[];
};

export type PresentationHardwareContext = {
  mode: "live" | "rehearsal";
  controllerOwned: boolean;
  commandPending: boolean;
  appActive: boolean;
  documentVisible: boolean;
  modalOpen: boolean;
  editorOpen: boolean;
  captureActive: boolean;
  networkDiverged: boolean;
};

export type PresentationKeyLike = {
  code?: string;
  key?: string;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
};

export type PresentationInputDeduper = {
  accept: (fingerprint: string, now?: number) => boolean;
  reset: () => void;
};

export type PresentationHardwareResolution = {
  action: PresentationHardwareAction | null;
  consume: boolean;
};

export type PresentationNativeHardwareInput = {
  source: "gamepad";
  deviceId: string;
  deviceName: string;
  control: PresentationGamepadControl;
} | {
  source: "midi";
  deviceId: string;
  deviceName: string;
  ruleKey?: string;
  message: "note_on" | "control_change";
  channel: number;
  number: number;
  value: number;
};

export type PresentationNativeHardwareLearnedInput = PresentationNativeHardwareInput & {
  activation?: PresentationMidiActivation;
  threshold?: number;
  releaseThreshold?: number;
};

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
type MigrationStorage = StorageReader & Partial<Pick<Storage, "setItem" | "removeItem">>;
type LegacyPedalDocument = {
  schemaVersion: 1;
  enabled?: unknown;
  bindings?: Partial<Record<PresentationHardwareAction, unknown>>;
};

const ACTIONS: PresentationHardwareAction[] = ["next", "previous", "toggle_blackout", "toggle_chords"];
const ACTION_SET = new Set<PresentationHardwareAction>(ACTIONS);
const BLOCKED_KEYBOARD_CODES = new Set([
  "Tab",
  "Enter",
  "NumpadEnter",
  "Backspace",
  "Delete",
  "Escape",
  "Home",
  "End",
  "Insert",
  "ContextMenu",
  "PrintScreen",
  "ScrollLock",
  "Pause",
  "NumLock",
  "CapsLock",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "Power",
  "Sleep",
  "WakeUp",
  "Eject",
  "Fn",
  "FnLock",
]);
const BLOCKED_KEYBOARD_CODE_PREFIXES = [
  "Media",
  "AudioVolume",
  "Browser",
  "Launch",
  "Brightness",
  "KeyboardLayout",
  "Microphone",
  "Camera",
  "Speech",
];
const MAX_BINDING_VALUE_LENGTH = 40;
const MAX_DEVICE_ID_LENGTH = 160;
const MAX_SCOPE_LENGTH = 200;
const GAMEPAD_CONTROL_SET = new Set<string>(PRESENTATION_GAMEPAD_CONTROLS);

function keyboardBinding(code: string, action: PresentationHardwareAction): PresentationKeyboardBinding {
  return {
    id: presentationHardwareBindingFingerprint({ source: "keyboard", code }),
    enabled: true,
    source: "keyboard",
    code,
    action,
  };
}

export const DEFAULT_PRESENTATION_HARDWARE_SETTINGS: PresentationHardwareSettings = {
  schemaVersion: PRESENTATION_HARDWARE_SCHEMA_VERSION,
  enabled: true,
  sources: {
    keyboard: true,
    gamepad: false,
    midi: false,
  },
  bindings: [
    keyboardBinding("ArrowRight", "next"),
    keyboardBinding("ArrowDown", "next"),
    keyboardBinding("PageDown", "next"),
    keyboardBinding("Space", "next"),
    keyboardBinding("ArrowLeft", "previous"),
    keyboardBinding("ArrowUp", "previous"),
    keyboardBinding("PageUp", "previous"),
    keyboardBinding("KeyB", "toggle_blackout"),
    keyboardBinding("KeyC", "toggle_chords"),
  ],
};

function cloneDefaultSettings(): PresentationHardwareSettings {
  return {
    ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
    sources: { ...DEFAULT_PRESENTATION_HARDWARE_SETTINGS.sources },
    bindings: DEFAULT_PRESENTATION_HARDWARE_SETTINGS.bindings.map((binding) => ({ ...binding })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeInputValue(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate || candidate.length > MAX_BINDING_VALUE_LENGTH || /[^A-Za-z0-9 _-]/.test(candidate)) return "";
  return candidate;
}

function safeDeviceId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const candidate = stringValue(value);
  return candidate && candidate.length <= MAX_DEVICE_ID_LENGTH && /^[A-Za-z0-9._:-]+$/.test(candidate) ? candidate : null;
}

export function isAllowedPresentationGamepadControl(value: unknown): value is PresentationGamepadControl {
  return typeof value === "string" && GAMEPAD_CONTROL_SET.has(value);
}

export function isAllowedPresentationHardwareKeyCode(code: string) {
  const candidate = safeInputValue(code);
  if (!candidate || candidate === "Dead" || candidate === "Process" || candidate === "Unidentified") return false;
  if (BLOCKED_KEYBOARD_CODES.has(candidate)) return false;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(candidate)) return false;
  return !BLOCKED_KEYBOARD_CODE_PREFIXES.some((prefix) => candidate.startsWith(prefix));
}

function safeBindingId(value: unknown, fallback: string) {
  const candidate = stringValue(value);
  return candidate && candidate.length <= 96 && /^[A-Za-z0-9._:-]+$/.test(candidate) ? candidate : fallback;
}

function integerInRange(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function presentationHardwareBindingFingerprintInput(binding: {
  source: "keyboard";
  code: string;
} | {
  source: "gamepad";
  deviceId?: string | null;
  control: PresentationGamepadControl;
} | {
  source: "midi";
  deviceId?: string | null;
  message: "note_on" | "control_change";
  channel: number | null;
  number: number;
}) {
  if (binding.source === "keyboard") return `keyboard:${binding.code}`;
  const device = binding.deviceId ? `${binding.deviceId}:` : "";
  if (binding.source === "gamepad") return `gamepad:${device}${binding.control}`;
  return `midi:${device}${binding.message}:${binding.channel === null ? "any" : binding.channel}:${binding.number}`;
}

export function presentationHardwareBindingFingerprint(binding: PresentationHardwareBinding | Parameters<typeof presentationHardwareBindingFingerprintInput>[0]) {
  return presentationHardwareBindingFingerprintInput(binding);
}

function normalizeBinding(value: unknown): PresentationHardwareBinding | null {
  if (!isRecord(value) || !ACTION_SET.has(value.action as PresentationHardwareAction)) return null;
  const action = value.action as PresentationHardwareAction;
  const enabled = value.enabled !== false;

  if (value.source === "keyboard") {
    const code = safeInputValue(value.code);
    if (!isAllowedPresentationHardwareKeyCode(code)) return null;
    const fingerprint = presentationHardwareBindingFingerprintInput({ source: "keyboard", code });
    return { id: safeBindingId(value.id, fingerprint), enabled, source: "keyboard", code, action };
  }

  if (value.source === "gamepad") {
    const control = value.control;
    const deviceId = safeDeviceId(value.deviceId);
    if (!isAllowedPresentationGamepadControl(control) || (value.deviceId != null && !deviceId)) return null;
    const fingerprint = presentationHardwareBindingFingerprintInput({ source: "gamepad", deviceId, control });
    return { id: safeBindingId(value.id, fingerprint), enabled, source: "gamepad", deviceId, control, action };
  }

  if (value.source === "midi") {
    const deviceId = safeDeviceId(value.deviceId);
    const message = value.message === "note_on" || value.message === "control_change" ? value.message : null;
    const channel = value.channel === null ? null : integerInRange(value.channel, 0, 15);
    const number = integerInRange(value.number, 0, 127);
    const activation: PresentationMidiActivation = value.activation === "zero" ? "zero" : "positive";
    const threshold = integerInRange(value.threshold, 0, 127) ?? (activation === "zero" ? 0 : 1);
    const releaseThreshold = integerInRange(value.releaseThreshold, 0, 127) ?? (activation === "zero" ? 1 : 0);
    if (
      !message
      || (value.deviceId != null && !deviceId)
      || (value.channel !== null && channel === null)
      || number === null
      || (activation === "positive" && releaseThreshold >= threshold)
      || (activation === "zero" && releaseThreshold <= threshold)
    ) return null;
    const fingerprint = presentationHardwareBindingFingerprintInput({ source: "midi", deviceId, message, channel, number });
    return { id: safeBindingId(value.id, fingerprint), enabled, source: "midi", deviceId, message, channel, number, activation, threshold, releaseThreshold, action };
  }

  return null;
}

export function normalizePresentationHardwareSettings(value: unknown): PresentationHardwareSettings {
  if (!isRecord(value) || value.schemaVersion !== PRESENTATION_HARDWARE_SCHEMA_VERSION || !Array.isArray(value.bindings)) {
    return cloneDefaultSettings();
  }

  const sourceRecord = isRecord(value.sources) ? value.sources : {};
  const seenInputs = new Set<string>();
  const bindings: PresentationHardwareBinding[] = [];
  for (const candidate of value.bindings) {
    const binding = normalizeBinding(candidate);
    if (!binding) continue;
    const fingerprint = presentationHardwareBindingFingerprint(binding);
    if (seenInputs.has(fingerprint)) continue;
    seenInputs.add(fingerprint);
    bindings.push(binding);
    if (bindings.length >= MAX_PRESENTATION_HARDWARE_BINDINGS) break;
  }

  return {
    schemaVersion: PRESENTATION_HARDWARE_SCHEMA_VERSION,
    enabled: value.enabled !== false,
    sources: {
      keyboard: sourceRecord.keyboard !== false,
      gamepad: sourceRecord.gamepad === true,
      midi: sourceRecord.midi === true,
    },
    bindings,
  };
}

function storageScope(value: string | null | undefined, fallback: string) {
  return encodeURIComponent(value?.trim().slice(0, MAX_SCOPE_LENGTH) || fallback);
}

export function presentationHardwareStorageKey(accountId?: string | null, churchId?: string | null) {
  return `${PRESENTATION_HARDWARE_STORAGE_PREFIX}:${storageScope(accountId, "no-account")}:${storageScope(churchId, "no-church")}`;
}

export function legacyPresentationPedalStorageKey(churchId?: string | null) {
  return `${LEGACY_PRESENTATION_PEDAL_STORAGE_PREFIX}:${storageScope(churchId, "none")}`;
}

export function presentationHardwareMigrationGuardKey(churchId?: string | null) {
  return `${PRESENTATION_HARDWARE_MIGRATION_GUARD_PREFIX}:${storageScope(churchId, "none")}`;
}

export function presentationHardwareMigrationBackupKey(accountId?: string | null, churchId?: string | null) {
  return `${PRESENTATION_HARDWARE_MIGRATION_BACKUP_PREFIX}:${storageScope(accountId, "no-account")}:${storageScope(churchId, "no-church")}`;
}

export function presentationHardwareMigrationQuarantineKey(churchId?: string | null) {
  return `${PRESENTATION_HARDWARE_MIGRATION_QUARANTINE_PREFIX}:${storageScope(churchId, "none")}`;
}

function resolveReadStorage(storage?: MigrationStorage): MigrationStorage | null {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

function resolveWriteStorage(storage?: StorageWriter): StorageWriter | null {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

function migrateLegacyPedalDocument(value: unknown): PresentationHardwareSettings | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.bindings)) return null;
  const legacy = value as LegacyPedalDocument;
  const bindings: PresentationKeyboardBinding[] = [];
  const seen = new Set<string>();
  for (const action of ACTIONS) {
    const raw = legacy.bindings?.[action];
    const candidates = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    for (const candidate of candidates) {
      const code = safeInputValue(candidate);
      const fingerprint = code ? presentationHardwareBindingFingerprintInput({ source: "keyboard", code }) : "";
      if (!code || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      bindings.push(keyboardBinding(code, action));
      if (bindings.length >= MAX_PRESENTATION_HARDWARE_BINDINGS) break;
    }
    if (bindings.length >= MAX_PRESENTATION_HARDWARE_BINDINGS) break;
  }
  return normalizePresentationHardwareSettings({
    schemaVersion: PRESENTATION_HARDWARE_SCHEMA_VERSION,
    enabled: legacy.enabled !== false,
    sources: { keyboard: true, gamepad: false, midi: false },
    bindings: bindings.length ? bindings : cloneDefaultSettings().bindings,
  });
}

export function readPresentationHardwareSettings(
  accountId?: string | null,
  churchId?: string | null,
  storage?: MigrationStorage,
): PresentationHardwareSettings {
  const target = resolveReadStorage(storage);
  if (!target) return cloneDefaultSettings();
  const key = presentationHardwareStorageKey(accountId, churchId);
  const legacyKey = legacyPresentationPedalStorageKey(churchId);
  const guardKey = presentationHardwareMigrationGuardKey(churchId);
  const backupKey = presentationHardwareMigrationBackupKey(accountId, churchId);
  const quarantineKey = presentationHardwareMigrationQuarantineKey(churchId);
  let migrationAttempted = false;
  let guardClaimed = false;
  try {
    const raw = target.getItem(key);
    const guard = target.getItem(guardKey);
    const quarantined = target.getItem(quarantineKey);
    if (raw !== null) {
      if (guard === `claimed:${key}`) return cloneDefaultSettings();
      return normalizePresentationHardwareSettings(JSON.parse(raw));
    }

    if (guard !== null || quarantined !== null) return cloneDefaultSettings();
    const legacyRaw = target.getItem(legacyKey);
    const migrated = legacyRaw ? migrateLegacyPedalDocument(JSON.parse(legacyRaw)) : null;
    if (!migrated) return cloneDefaultSettings();

    if (!target.setItem || !target.removeItem) return cloneDefaultSettings();
    if (target.getItem(guardKey) !== null) return cloneDefaultSettings();
    migrationAttempted = true;
    const serialized = JSON.stringify(migrated);
    const claim = `claimed:${key}`;
    target.setItem(guardKey, claim);
    if (target.getItem(guardKey) !== claim) throw new Error("Legacy migration claim was not persisted");
    guardClaimed = true;
    if (target.getItem(legacyKey) !== legacyRaw) throw new Error("Legacy migration claim was superseded");
    target.setItem(backupKey, legacyRaw);
    if (target.getItem(backupKey) !== legacyRaw) throw new Error("Legacy migration backup was not persisted");
    target.setItem(key, serialized);
    if (target.getItem(key) !== serialized) throw new Error("Migrated hardware settings were not persisted");
    if (target.getItem(guardKey) !== claim || target.getItem(legacyKey) !== legacyRaw) throw new Error("Legacy migration claim changed before commit");
    target.removeItem(legacyKey);
    if (target.getItem(legacyKey) !== null) {
      try { target.setItem(quarantineKey, "blocked"); } catch { /* The owner guard still blocks every other account. */ }
      throw new Error("Shared legacy settings were not removed");
    }
    const committed = `committed:${key}`;
    target.setItem(guardKey, committed);
    if (target.getItem(guardKey) !== committed) throw new Error("Legacy migration commit was not persisted");
    return migrated;
  } catch {
    if (migrationAttempted) {
      try { target.removeItem?.(key); } catch { /* The owner guard keeps a partial target unreadable. */ }
      try { target.removeItem?.(backupKey); } catch { /* Backup is account-scoped and never used by normal reads. */ }
      if (!guardClaimed) {
        try { target.setItem?.(quarantineKey, "blocked"); } catch { /* Removing the shared legacy is the fallback. */ }
        try { target.removeItem?.(legacyKey); } catch { /* The quarantine is the fallback. */ }
      }
    }
    return cloneDefaultSettings();
  }
}

export function writePresentationHardwareSettings(
  accountId: string | null | undefined,
  churchId: string | null | undefined,
  settings: PresentationHardwareSettings,
  storage?: StorageWriter,
) {
  const normalized = normalizePresentationHardwareSettings(settings);
  const target = resolveWriteStorage(storage);
  try {
    target?.setItem(presentationHardwareStorageKey(accountId, churchId), JSON.stringify(normalized));
  } catch {
    // The in-memory setting remains usable when WebView storage is unavailable.
  }
  return normalized;
}

export function presentationKeyCode(event: Pick<PresentationKeyLike, "code" | "key">) {
  const code = stringValue(event.code);
  if (code) return code;
  const key = stringValue(event.key);
  if (key === " ") return "Space";
  if (key.length === 1 && /[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
  if (key.length === 1 && /[0-9]/.test(key)) return `Digit${key}`;
  return key;
}

export function formatPresentationKeyCode(code: string) {
  if (code === "Space") return "Espacio";
  if (code === "ArrowRight") return "Flecha derecha";
  if (code === "ArrowLeft") return "Flecha izquierda";
  if (code === "ArrowUp") return "Flecha arriba";
  if (code === "ArrowDown") return "Flecha abajo";
  if (code === "PageDown") return "Página abajo";
  if (code === "PageUp") return "Página arriba";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code || "Sin asignar";
}

export function isPresentationEditableTarget(target: EventTarget | null | undefined) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=true], [contenteditable=''], [role=textbox]"));
}

export function isPresentationHardwareBlockedTarget(target: EventTarget | null | undefined) {
  if (!(target instanceof Element)) return false;
  return isPresentationEditableTarget(target) || Boolean(target.closest([
    "a[href]",
    "area[href]",
    "button",
    "summary",
    "audio[controls]",
    "video[controls]",
    "iframe",
    "object",
    "embed",
    "[role=dialog]",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
    "[role=slider]",
    "[role=spinbutton]",
    "[role=combobox]",
    "[role=listbox]",
    "[role=option]",
    "[role=menuitem]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    "[role=tab]",
    "[role=treeitem]",
    "[role=gridcell]",
    "[aria-haspopup]",
    "[tabindex]:not([tabindex='-1'])",
    "[data-presentation-hardware-block=true]",
  ].join(", ")));
}

export function createPresentationInputDeduper(windowMs = PRESENTATION_HARDWARE_DEDUPE_MS): PresentationInputDeduper {
  const acceptedAt = new Map<string, number>();
  return {
    accept(fingerprint, now = typeof performance === "undefined" ? Date.now() : performance.now()) {
      const previous = acceptedAt.get(fingerprint);
      if (previous !== undefined && now - previous < windowMs) return false;
      acceptedAt.set(fingerprint, now);
      if (acceptedAt.size > MAX_PRESENTATION_HARDWARE_BINDINGS * 2) {
        for (const [candidate, accepted] of acceptedAt) {
          if (now - accepted >= windowMs) acceptedAt.delete(candidate);
        }
      }
      return true;
    },
    reset() {
      acceptedAt.clear();
    },
  };
}

function presentationHardwareContextAllowsInput(
  settings: PresentationHardwareSettings,
  context: PresentationHardwareContext,
) {
  return settings.enabled
    && context.controllerOwned
    && context.appActive
    && context.documentVisible
    && !context.modalOpen
    && !context.editorOpen
    && !context.captureActive
    && !context.networkDiverged;
}

export function resolvePresentationHardwareInput(
  event: PresentationKeyLike,
  settings: PresentationHardwareSettings,
  context: PresentationHardwareContext,
  deduper?: PresentationInputDeduper,
): PresentationHardwareResolution {
  if (
    !presentationHardwareContextAllowsInput(settings, context)
    || !settings.sources.keyboard
    || event.defaultPrevented
    || event.isComposing
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || isPresentationHardwareBlockedTarget(event.target)
  ) return { action: null, consume: false };

  const code = presentationKeyCode(event);
  if (!isAllowedPresentationHardwareKeyCode(code)) return { action: null, consume: false };
  const binding = settings.bindings.find((candidate): candidate is PresentationKeyboardBinding => (
    candidate.source === "keyboard" && candidate.enabled && candidate.code === code
  ));
  if (!binding) return { action: null, consume: false };
  if (context.commandPending || event.repeat) return { action: null, consume: true };
  const fingerprint = presentationHardwareBindingFingerprint(binding);
  if (deduper && !deduper.accept(fingerprint)) return { action: null, consume: true };
  return { action: binding.action, consume: true };
}

export function resolvePresentationNativeHardwareInput(
  event: PresentationNativeHardwareInput,
  settings: PresentationHardwareSettings,
  context: PresentationHardwareContext,
  deduper?: PresentationInputDeduper,
): PresentationHardwareAction | null {
  if (!presentationHardwareContextAllowsInput(settings, context) || context.commandPending || !settings.sources[event.source]) return null;
  const deviceId = safeDeviceId(event.deviceId);
  if (!deviceId) return null;

  let binding: PresentationGamepadBinding | PresentationMidiBinding | undefined;
  if (event.source === "gamepad") {
    if (!isAllowedPresentationGamepadControl(event.control)) return null;
    const candidates = settings.bindings.filter((candidate): candidate is PresentationGamepadBinding => (
      candidate.source === "gamepad"
      && candidate.enabled
      && candidate.control === event.control
      && (candidate.deviceId === null || candidate.deviceId === deviceId)
    ));
    binding = candidates.find((candidate) => candidate.deviceId === deviceId) ?? candidates.find((candidate) => candidate.deviceId === null);
  } else {
    const channel = integerInRange(event.channel, 0, 15);
    const number = integerInRange(event.number, 0, 127);
    const value = integerInRange(event.value, 0, 127);
    if (channel === null || number === null || value === null) return null;
    const candidates = settings.bindings.filter((candidate): candidate is PresentationMidiBinding => (
      candidate.source === "midi"
      && candidate.enabled
      && candidate.message === event.message
      && candidate.number === number
      && (candidate.channel === null || candidate.channel === channel)
      && (candidate.deviceId === null || candidate.deviceId === deviceId)
    ));
    const activeCandidates = candidates.filter((candidate) => (
      candidate.activation === "zero" ? value <= candidate.threshold : value >= candidate.threshold
    ));
    const eventRuleKey = typeof event.ruleKey === "string" && event.ruleKey.length <= 240
      ? event.ruleKey
      : null;
    if (eventRuleKey) {
      binding = activeCandidates.find((candidate) => presentationHardwareBindingFingerprint(candidate) === eventRuleKey);
    } else {
      binding = [...activeCandidates].sort((left, right) => {
        const leftSpecificity = (left.deviceId === deviceId ? 2 : 0) + (left.channel === channel ? 1 : 0);
        const rightSpecificity = (right.deviceId === deviceId ? 2 : 0) + (right.channel === channel ? 1 : 0);
        if (leftSpecificity !== rightSpecificity) return rightSpecificity - leftSpecificity;
        return presentationHardwareBindingFingerprint(left).localeCompare(presentationHardwareBindingFingerprint(right));
      })[0];
    }
  }
  if (!binding) return null;
  const fingerprint = presentationHardwareBindingFingerprint(binding);
  if (deduper && !deduper.accept(fingerprint)) return null;
  return binding.action;
}

export function resolvePresentationHardwareAction(
  event: PresentationKeyLike,
  settings: PresentationHardwareSettings,
  context: PresentationHardwareContext,
  deduper?: PresentationInputDeduper,
): PresentationHardwareAction | null {
  return resolvePresentationHardwareInput(event, settings, context, deduper).action;
}

export function presentationKeyboardBindingsForAction(settings: PresentationHardwareSettings, action: PresentationHardwareAction) {
  return settings.bindings.filter((binding): binding is PresentationKeyboardBinding => binding.source === "keyboard" && binding.action === action);
}

export function presentationGamepadBindingsForAction(settings: PresentationHardwareSettings, action: PresentationHardwareAction) {
  return settings.bindings.filter((binding): binding is PresentationGamepadBinding => binding.source === "gamepad" && binding.action === action);
}

export function presentationMidiBindingsForAction(settings: PresentationHardwareSettings, action: PresentationHardwareAction) {
  return settings.bindings.filter((binding): binding is PresentationMidiBinding => binding.source === "midi" && binding.action === action);
}

export function updatePresentationKeyboardBinding(
  settings: PresentationHardwareSettings,
  action: PresentationHardwareAction,
  code: string,
) {
  const normalized = normalizePresentationHardwareSettings(settings);
  const nextCode = safeInputValue(code);
  if (!isAllowedPresentationHardwareKeyCode(nextCode)) return normalized;
  const fingerprint = presentationHardwareBindingFingerprintInput({ source: "keyboard", code: nextCode });
  const bindings = normalized.bindings.filter((binding) => {
    if (presentationHardwareBindingFingerprint(binding) === fingerprint) return false;
    return binding.source !== "keyboard" || binding.action !== action;
  });
  return normalizePresentationHardwareSettings({
    ...normalized,
    bindings: [...bindings, keyboardBinding(nextCode, action)],
  });
}

export function updatePresentationGamepadBinding(
  settings: PresentationHardwareSettings,
  action: PresentationHardwareAction,
  input: Pick<Extract<PresentationNativeHardwareLearnedInput, { source: "gamepad" }>, "deviceId" | "control">,
) {
  const normalized = normalizePresentationHardwareSettings(settings);
  const deviceId = safeDeviceId(input.deviceId);
  if (!deviceId || !isAllowedPresentationGamepadControl(input.control)) return normalized;
  const fingerprint = presentationHardwareBindingFingerprintInput({ source: "gamepad", deviceId, control: input.control });
  const binding: PresentationGamepadBinding = {
    id: fingerprint,
    enabled: true,
    source: "gamepad",
    deviceId,
    control: input.control,
    action,
  };
  return normalizePresentationHardwareSettings({
    ...normalized,
    bindings: [
      ...normalized.bindings.filter((candidate) => (
        presentationHardwareBindingFingerprint(candidate) !== fingerprint
        && (candidate.source !== "gamepad" || candidate.action !== action)
      )),
      binding,
    ],
  });
}

export function calibratePresentationMidiInput(input: {
  message: "note_on" | "control_change";
  value: number;
}): Pick<PresentationMidiBinding, "activation" | "threshold" | "releaseThreshold"> {
  const value = integerInRange(input.value, 0, 127) ?? 0;
  if (input.message === "note_on") return { activation: "positive", threshold: 1, releaseThreshold: 0 };
  if (value === 0) return { activation: "zero", threshold: 0, releaseThreshold: 1 };
  if (value === 1) return { activation: "positive", threshold: 1, releaseThreshold: 0 };
  const threshold = Math.max(2, Math.min(127, Math.round(value * 0.65)));
  return { activation: "positive", threshold, releaseThreshold: Math.max(0, Math.floor(threshold * 0.5)) };
}

export function updatePresentationMidiBinding(
  settings: PresentationHardwareSettings,
  action: PresentationHardwareAction,
  input: Extract<PresentationNativeHardwareLearnedInput, { source: "midi" }>,
) {
  const normalized = normalizePresentationHardwareSettings(settings);
  const deviceId = safeDeviceId(input.deviceId);
  const channel = integerInRange(input.channel, 0, 15);
  const number = integerInRange(input.number, 0, 127);
  const value = integerInRange(input.value, 0, 127);
  if (!deviceId || channel === null || number === null || value === null) return normalized;
  const calibrated = calibratePresentationMidiInput(input);
  const activation = input.activation === "zero" || input.activation === "positive" ? input.activation : calibrated.activation;
  const threshold = integerInRange(input.threshold, 0, 127) ?? calibrated.threshold;
  const releaseThreshold = integerInRange(input.releaseThreshold, 0, 127) ?? calibrated.releaseThreshold;
  if ((activation === "positive" && releaseThreshold >= threshold) || (activation === "zero" && releaseThreshold <= threshold)) return normalized;
  const fingerprint = presentationHardwareBindingFingerprintInput({ source: "midi", deviceId, message: input.message, channel, number });
  const binding: PresentationMidiBinding = {
    id: fingerprint,
    enabled: true,
    source: "midi",
    deviceId,
    message: input.message,
    channel,
    number,
    activation,
    threshold,
    releaseThreshold,
    action,
  };
  return normalizePresentationHardwareSettings({
    ...normalized,
    bindings: [
      ...normalized.bindings.filter((candidate) => (
        presentationHardwareBindingFingerprint(candidate) !== fingerprint
        && (candidate.source !== "midi" || candidate.action !== action)
      )),
      binding,
    ],
  });
}

export function setPresentationHardwareSourceEnabled(
  settings: PresentationHardwareSettings,
  source: PresentationHardwareSource,
  enabled: boolean,
) {
  return normalizePresentationHardwareSettings({
    ...settings,
    sources: { ...settings.sources, [source]: enabled },
  });
}

// Compatibility aliases for callers that still describe keyboard HID controls as a pedal.
export type PresentationPedalAction = PresentationHardwareAction;
export type PresentationPedalMapping = PresentationHardwareSettings;
export const PRESENTATION_PEDAL_SCHEMA_VERSION = PRESENTATION_HARDWARE_SCHEMA_VERSION;
export const DEFAULT_PRESENTATION_PEDAL_MAPPING = DEFAULT_PRESENTATION_HARDWARE_SETTINGS;
