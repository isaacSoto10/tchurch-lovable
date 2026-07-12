export const PRESENTATION_PEDAL_SCHEMA_VERSION = 1 as const;
export const PRESENTATION_PEDAL_STORAGE_PREFIX = "tchurch_live_pedal_v1";

export type PresentationPedalAction = "next" | "previous" | "toggle_blackout" | "toggle_chords";

export type PresentationPedalMapping = {
  schemaVersion: typeof PRESENTATION_PEDAL_SCHEMA_VERSION;
  enabled: boolean;
  bindings: Record<PresentationPedalAction, string[]>;
};

export type PresentationPedalContext = {
  mode: "live" | "rehearsal";
  controllerOwned: boolean;
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

const ACTIONS: PresentationPedalAction[] = ["next", "previous", "toggle_blackout", "toggle_chords"];
const MAX_BINDING_LENGTH = 40;

export const DEFAULT_PRESENTATION_PEDAL_MAPPING: PresentationPedalMapping = {
  schemaVersion: PRESENTATION_PEDAL_SCHEMA_VERSION,
  enabled: true,
  bindings: {
    next: ["ArrowRight", "ArrowDown", "PageDown", "Space"],
    previous: ["ArrowLeft", "ArrowUp", "PageUp"],
    toggle_blackout: ["KeyB"],
    toggle_chords: ["KeyC"],
  },
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeBinding(value: unknown) {
  const binding = stringValue(value);
  if (!binding || binding.length > MAX_BINDING_LENGTH || /[^A-Za-z0-9 _-]/.test(binding)) return "";
  return binding;
}

function safeBindings(value: unknown, fallback: string[]) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const bindings = [...new Set(values.map(safeBinding).filter(Boolean))].slice(0, 4);
  return bindings.length ? bindings : [...fallback];
}

export function normalizePresentationPedalMapping(value: unknown): PresentationPedalMapping {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (source && source.schemaVersion !== PRESENTATION_PEDAL_SCHEMA_VERSION) {
    return {
      ...DEFAULT_PRESENTATION_PEDAL_MAPPING,
      bindings: {
        next: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.next],
        previous: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.previous],
        toggle_blackout: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.toggle_blackout],
        toggle_chords: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.toggle_chords],
      },
    };
  }
  const rawBindings = source?.bindings && typeof source.bindings === "object" && !Array.isArray(source.bindings)
    ? source.bindings as Record<string, unknown>
    : null;

  const bindings = ACTIONS.reduce<PresentationPedalMapping["bindings"]>((current, action) => {
    current[action] = safeBindings(rawBindings?.[action], DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings[action]);
    return current;
  }, {
    next: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.next],
    previous: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.previous],
    toggle_blackout: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.toggle_blackout],
    toggle_chords: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.toggle_chords],
  });

  return {
    schemaVersion: PRESENTATION_PEDAL_SCHEMA_VERSION,
    enabled: typeof source?.enabled === "boolean" ? source.enabled : DEFAULT_PRESENTATION_PEDAL_MAPPING.enabled,
    bindings,
  };
}

export function presentationPedalStorageKey(churchId?: string | null) {
  return `${PRESENTATION_PEDAL_STORAGE_PREFIX}:${encodeURIComponent(churchId?.trim() || "none")}`;
}

export function readPresentationPedalMapping(churchId?: string | null): PresentationPedalMapping {
  if (typeof localStorage === "undefined") return normalizePresentationPedalMapping(null);
  try {
    const raw = localStorage.getItem(presentationPedalStorageKey(churchId));
    return normalizePresentationPedalMapping(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizePresentationPedalMapping(null);
  }
}

export function writePresentationPedalMapping(churchId: string | null | undefined, mapping: PresentationPedalMapping) {
  const normalized = normalizePresentationPedalMapping(mapping);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(presentationPedalStorageKey(churchId), JSON.stringify(normalized));
  }
  return normalized;
}

export function presentationKeyCode(event: Pick<PresentationKeyLike, "code" | "key">) {
  const code = stringValue(event.code);
  if (code) return code;
  const key = stringValue(event.key);
  if (key === " ") return "Space";
  if (key.length === 1 && /[a-z0-9]/i.test(key)) return `Key${key.toUpperCase()}`;
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
  return Boolean(target.closest("input, textarea, select, [contenteditable=true], [role=textbox]"));
}

/**
 * Resolves only the four intentionally safe presentation actions. In a live
 * or rehearsal session the device must own that mode's controller lease.
 * Rehearsal mutations go to its isolated backend session, never to live.
 */
export function resolvePresentationPedalAction(
  event: PresentationKeyLike,
  mapping: PresentationPedalMapping,
  context: PresentationPedalContext,
): PresentationPedalAction | null {
  if (
    !mapping.enabled ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isPresentationEditableTarget(event.target)
  ) return null;
  if (!context.controllerOwned) return null;

  const code = presentationKeyCode(event);
  if (!code || code === "Dead" || code === "Process" || code === "Unidentified") return null;
  return ACTIONS.find((action) => mapping.bindings[action].includes(code)) || null;
}

export function updatePresentationPedalBinding(
  mapping: PresentationPedalMapping,
  action: PresentationPedalAction,
  code: string,
) {
  const normalized = normalizePresentationPedalMapping(mapping);
  const nextCode = safeBinding(code);
  if (!nextCode) return normalized;
  const bindings = Object.fromEntries(ACTIONS.map((candidate) => [
    candidate,
    normalized.bindings[candidate].filter((binding) => candidate === action || binding !== nextCode),
  ])) as PresentationPedalMapping["bindings"];
  for (const candidate of ACTIONS) {
    if (candidate !== action) bindings[candidate] = bindings[candidate].filter((binding) => binding !== nextCode);
  }
  bindings[action] = [nextCode];
  return { ...normalized, bindings };
}
