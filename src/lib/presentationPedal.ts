export const PRESENTATION_HARDWARE_SCHEMA_VERSION = 5 as const;
export const PRESENTATION_HARDWARE_STORAGE_PREFIX = "tchurch.presentation.hardware.v5";
export const LEGACY_PRESENTATION_PEDAL_STORAGE_PREFIX = "tchurch_live_pedal_v1";
export const MAX_PRESENTATION_HARDWARE_BINDINGS = 32;
export const PRESENTATION_HARDWARE_DEDUPE_MS = 200;

export type PresentationHardwareAction = "next" | "previous" | "toggle_blackout" | "toggle_chords";
export type PresentationHardwareSource = "keyboard" | "gamepad" | "midi";

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
  control: string;
};

export type PresentationMidiBinding = PresentationHardwareBindingBase & {
  source: "midi";
  message: "note_on" | "control_change";
  channel: number | null;
  number: number;
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

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
type LegacyPedalDocument = {
  schemaVersion: 1;
  enabled?: unknown;
  bindings?: Partial<Record<PresentationHardwareAction, unknown>>;
};

const ACTIONS: PresentationHardwareAction[] = ["next", "previous", "toggle_blackout", "toggle_chords"];
const ACTION_SET = new Set<PresentationHardwareAction>(ACTIONS);
const MAX_BINDING_VALUE_LENGTH = 40;
const MAX_SCOPE_LENGTH = 200;

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
  control: string;
} | {
  source: "midi";
  message: "note_on" | "control_change";
  channel: number | null;
  number: number;
}) {
  if (binding.source === "keyboard") return `keyboard:${binding.code}`;
  if (binding.source === "gamepad") return `gamepad:${binding.control}`;
  return `midi:${binding.message}:${binding.channel === null ? "any" : binding.channel}:${binding.number}`;
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
    if (!code) return null;
    const fingerprint = presentationHardwareBindingFingerprintInput({ source: "keyboard", code });
    return { id: safeBindingId(value.id, fingerprint), enabled, source: "keyboard", code, action };
  }

  if (value.source === "gamepad") {
    const control = safeInputValue(value.control);
    if (!control) return null;
    const fingerprint = presentationHardwareBindingFingerprintInput({ source: "gamepad", control });
    return { id: safeBindingId(value.id, fingerprint), enabled, source: "gamepad", control, action };
  }

  if (value.source === "midi") {
    const message = value.message === "note_on" || value.message === "control_change" ? value.message : null;
    const channel = value.channel === null ? null : integerInRange(value.channel, 0, 15);
    const number = integerInRange(value.number, 0, 127);
    if (!message || (value.channel !== null && channel === null) || number === null) return null;
    const fingerprint = presentationHardwareBindingFingerprintInput({ source: "midi", message, channel, number });
    return { id: safeBindingId(value.id, fingerprint), enabled, source: "midi", message, channel, number, action };
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

function resolveReadStorage(storage?: StorageReader & Partial<StorageWriter>): (StorageReader & Partial<StorageWriter>) | null {
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
  storage?: StorageReader & Partial<StorageWriter>,
): PresentationHardwareSettings {
  const target = resolveReadStorage(storage);
  if (!target) return cloneDefaultSettings();
  const key = presentationHardwareStorageKey(accountId, churchId);
  try {
    const raw = target.getItem(key);
    if (raw !== null) return normalizePresentationHardwareSettings(JSON.parse(raw));

    const legacyRaw = target.getItem(legacyPresentationPedalStorageKey(churchId));
    const migrated = legacyRaw ? migrateLegacyPedalDocument(JSON.parse(legacyRaw)) : null;
    if (!migrated) return cloneDefaultSettings();
    target.setItem?.(key, JSON.stringify(migrated));
    return migrated;
  } catch {
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
  return isPresentationEditableTarget(target) || Boolean(target.closest("[role=dialog], [data-presentation-hardware-block=true]"));
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

export function resolvePresentationHardwareAction(
  event: PresentationKeyLike,
  settings: PresentationHardwareSettings,
  context: PresentationHardwareContext,
  deduper?: PresentationInputDeduper,
): PresentationHardwareAction | null {
  if (
    !settings.enabled
    || !settings.sources.keyboard
    || !context.controllerOwned
    || context.commandPending
    || !context.appActive
    || !context.documentVisible
    || context.modalOpen
    || context.editorOpen
    || context.captureActive
    || context.networkDiverged
    || event.defaultPrevented
    || event.repeat
    || event.isComposing
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || isPresentationHardwareBlockedTarget(event.target)
  ) return null;

  const code = presentationKeyCode(event);
  if (!code || code === "Dead" || code === "Process" || code === "Unidentified") return null;
  const binding = settings.bindings.find((candidate): candidate is PresentationKeyboardBinding => (
    candidate.source === "keyboard" && candidate.enabled && candidate.code === code
  ));
  if (!binding) return null;
  const fingerprint = presentationHardwareBindingFingerprint(binding);
  return !deduper || deduper.accept(fingerprint) ? binding.action : null;
}

export function presentationKeyboardBindingsForAction(settings: PresentationHardwareSettings, action: PresentationHardwareAction) {
  return settings.bindings.filter((binding): binding is PresentationKeyboardBinding => binding.source === "keyboard" && binding.action === action);
}

export function updatePresentationKeyboardBinding(
  settings: PresentationHardwareSettings,
  action: PresentationHardwareAction,
  code: string,
) {
  const normalized = normalizePresentationHardwareSettings(settings);
  const nextCode = safeInputValue(code);
  if (!nextCode) return normalized;
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
