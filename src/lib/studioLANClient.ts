import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type StudioLANChannel = "audience" | "stage" | "control";
export type StudioLANPhase = "idle" | "discovering" | "connecting" | "authenticating" | "connected" | "reconnecting" | "failed" | "suspended";
export type StudioLANDeviceEnrollmentState = "unenrolled" | "pending" | "approved" | "revoked";
export type StudioLANDeviceRole = "audience" | "worshipLeader" | "musicians" | "preacher" | "production";
export type StudioLANDevicePermission = "observe" | "controlProgram";

export type StudioLANService = { id: string; name: string; protocolFloor: number };
export type StudioLANStatus = {
  supported: boolean;
  phase: StudioLANPhase;
  services: StudioLANService[];
  selectedServiceId: string | null;
  channel: StudioLANChannel | null;
  paired: boolean;
  message: string | null;
  enrollmentState: StudioLANDeviceEnrollmentState;
  protocolFloor: number;
  role: StudioLANDeviceRole | null;
  permissions: StudioLANDevicePermission[];
  permissionRevision: string;
  revocationGeneration: string;
  studioId: string | null;
  remoteControlAvailable: boolean;
  remoteCommandInFlight: boolean;
  operatorTimerControlAvailable: boolean;
  operatorTimerCommandInFlight: boolean;
  localBroadcastLowerThirdControlAvailable: boolean;
  localBroadcastLowerThirdCommandInFlight: boolean;
};

export type StudioLANCue = {
  cueId: string;
  title: string | null;
  lines: string[];
  mediaAssetId: string | null;
  imageAsset: StudioLANImageAssetDescriptor | null;
};

export type StudioLANImageAssetDescriptor = {
  schemaVersion: 1;
  referenceId: string;
  objectId: string;
  kind: "image";
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/avif" | "image/gif";
  byteSize: string;
  required: boolean;
  imageFit: "contain" | "cover";
};

export type StudioLANImageAssetStatus = {
  cueId: string;
  objectId: string;
  phase: "loading" | "ready" | "unavailable";
  receivedBytes: string;
  totalBytes: string;
  imageFit: "contain" | "cover";
  localUrl: string | null;
  message: string | null;
};

export type StudioLANChordToken = { value: string; offsetUtf16: number };
export type StudioLANChordLine = { text: string; chords: StudioLANChordToken[] };
export type StudioLANChordSlide = { cueId: string; key: string | null; lines: StudioLANChordLine[] };

export type StudioLANTimer = {
  id: string;
  label: string;
  mode: "countUp" | "countDown";
  anchorAtMs: number;
  anchorValueMs: number;
  durationMs: number | null;
  isRunning: boolean;
};

export type StudioLANRouting = {
  schemaVersion: 1;
  localAudience: boolean;
  localBroadcast: boolean;
  stageAndMusicians: boolean;
  lanRemoteControl: true;
  lightingAndMIDI: boolean;
  tchurchCloudProgram: false;
};

export type StudioLANCueCatalogManifest = {
  schemaVersion: 1;
  catalogId: string;
  totalCount: number;
  pageSize: 128;
};

export type StudioLANCueCatalogStatus = {
  phase: "loading" | "ready" | "unavailable";
  catalogId: string;
  routeEpoch: string;
  totalCount: number;
  receivedCount: number;
  cues: Array<{ cueId: string; title: string }> | null;
  message: string | null;
};

export type StudioLANOperatorTimerScope = "service" | "item";
export type StudioLANOperatorTimerOperation = "start" | "pause";

export type StudioLANOperatorTimerState = {
  scope: StudioLANOperatorTimerScope;
  anchorTimestampMilliseconds: number;
  anchorValueMilliseconds: number;
  isRunning: boolean;
};

export type StudioLANOperatorTimers = {
  schemaVersion: 1;
  revision: string;
  timers: [StudioLANOperatorTimerState, StudioLANOperatorTimerState];
};

export type StudioLANLocalBroadcastLowerThird = {
  schemaVersion: 1;
  revision: string;
  target: "localBrowserOBS";
  visible: boolean;
  title?: string;
  subtitle?: string;
};

export type StudioLANUpdate = {
  channel: StudioLANChannel;
  payloadVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  sequence: string;
  revision: string;
  issuedAtMs: number;
  receivedAtMs: number;
  authority: {
    runId: string;
    authorityEpoch: string;
    packageId: string;
    serviceVersion: string;
  };
  audience: {
    currentCueId: string | null;
    currentCueIndex: number | null;
    cueCount: number;
    isBlackout: boolean;
    countdown: { id: string; label: string; targetAtMs: number } | null;
    cue: StudioLANCue | null;
  };
  stage: {
    nextCue: StudioLANCue | null;
    chordLines: string[];
    currentChordSlide: StudioLANChordSlide | null;
    timers: StudioLANTimer[];
    message: string | null;
  } | null;
  control: {
    chordsVisible: boolean;
    lightingArmed: boolean;
    healthyOutputCount: number;
    expectedOutputCount: number;
    routeEpoch: string;
    cueCatalog: Array<{ cueId: string; title: string }> | null;
    routing: StudioLANRouting | null;
    cueCatalogManifest: StudioLANCueCatalogManifest | null;
    operatorTimers: StudioLANOperatorTimers | null;
    localBroadcastLowerThird: StudioLANLocalBroadcastLowerThird | null;
  } | null;
};

export type StudioLANRemoteAction =
  | { kind: "next" | "previous" }
  | { kind: "jump"; cueId: string }
  | { kind: "setBlackout"; enabled: boolean };

export type StudioLANRemoteRejection =
  | "routeDisabled"
  | "unauthorizedDevice"
  | "staleRoute"
  | "authorityMismatch"
  | "expiredCommand"
  | "invalidSignature"
  | "invalidCommand"
  | "revisionConflict"
  | "commandIDCollision"
  | "rateLimited"
  | "unavailable";

export type StudioLANRemoteFeedback = {
  commandId: string;
  kind: StudioLANRemoteAction["kind"];
  cueId: string | null;
  enabled: boolean | null;
  state: "queued" | "accepted" | "rejected" | "timedOut" | "interrupted";
  rejection: StudioLANRemoteRejection | null;
  revision: string | null;
  wasIdempotentReplay: boolean;
};

export type StudioLANOperatorTimerAction = {
  scope: StudioLANOperatorTimerScope;
  operation: StudioLANOperatorTimerOperation;
};

export type StudioLANOperatorTimerFeedback = {
  commandId: string;
  kind: "operatorTimer";
  scope: StudioLANOperatorTimerScope;
  operation: StudioLANOperatorTimerOperation;
  state: "queued" | "accepted" | "rejected" | "timedOut" | "interrupted";
  rejection: StudioLANRemoteRejection | null;
  timerRevision: string | null;
  wasIdempotentReplay: boolean;
};

export type StudioLANLocalBroadcastLowerThirdAction =
  | {
    kind: "localBroadcastLowerThird";
    operation: "show";
    title: string;
    subtitle?: string;
  }
  | {
    kind: "localBroadcastLowerThird";
    operation: "hide";
  };

export type StudioLANLocalBroadcastLowerThirdFeedback = {
  commandId: string;
  kind: "localBroadcastLowerThird";
  operation: "show" | "hide";
  title: string | null;
  subtitle: string | null;
  state: "queued" | "accepted" | "rejected" | "timedOut" | "interrupted";
  rejection: StudioLANRemoteRejection | null;
  lowerThirdRevision: string | null;
  wasIdempotentReplay: boolean;
};

export function projectStudioLANOperatorTimerMilliseconds(
  timer: StudioLANOperatorTimerState,
  signedEnvelopeIssuedAtMilliseconds: number,
  capturedPerformanceAtEnvelopeReceipt: number,
  performanceNowMilliseconds: number,
) {
  const baseAtEnvelope = timer.anchorValueMilliseconds + (timer.isRunning ? Math.max(
    0,
    signedEnvelopeIssuedAtMilliseconds - timer.anchorTimestampMilliseconds,
  ) : 0);
  const projectedValueMilliseconds = baseAtEnvelope + (timer.isRunning
    ? Math.max(0, performanceNowMilliseconds - capturedPerformanceAtEnvelopeReceipt)
    : 0);
  return Math.min(604_800_000, Math.max(0, projectedValueMilliseconds));
}

interface StudioLANNativePlugin {
  startDiscovery(): Promise<{ accepted: boolean }>;
  stopDiscovery(): Promise<{ accepted: boolean }>;
  connect(options: { serviceId: string; channel: StudioLANChannel; requestedRole: StudioLANDeviceRole; pairingCode?: string }): Promise<{ accepted: boolean }>;
  sendRemoteCommand(options: StudioLANRemoteAction): Promise<{ accepted: boolean; commandId: string }>;
  sendOperatorTimerCommand(options: StudioLANOperatorTimerAction): Promise<{ accepted: boolean; commandId: string }>;
  sendLocalBroadcastLowerThirdCommand(options: StudioLANLocalBroadcastLowerThirdAction): Promise<{ accepted: boolean; commandId: string }>;
  requestDeviceReapproval(): Promise<{ accepted: boolean; deviceId: string }>;
  disconnect(): Promise<{ accepted: boolean }>;
  forgetPairing(options: { serviceId: string }): Promise<{ accepted: boolean }>;
  purgePrivateState(): Promise<{ accepted: boolean }>;
  synchronizePrivacyContext(options: {
    access: "unknown" | "principal" | "authorized" | "signedOut" | "revoked";
    principalId?: string;
    churchId?: string;
  }): Promise<{ accepted: boolean }>;
  setDisplayAwake(options: { active: boolean }): Promise<{ accepted: boolean }>;
  getStatus(): Promise<unknown>;
  addListener(eventName: "studioLANStatus", listener: (status: unknown) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "studioLANUpdate", listener: (update: unknown) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "studioLANImageAsset", listener: (status: unknown) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "studioLANRemoteFeedback", listener: (feedback: unknown) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "studioLANOperatorTimerFeedback", listener: (feedback: unknown) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "studioLANLocalBroadcastLowerThirdFeedback", listener: (feedback: unknown) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "studioLANCueCatalog", listener: (status: unknown) => void): Promise<PluginListenerHandle>;
}

const StudioLANNative = registerPlugin<StudioLANNativePlugin>("StudioLANClient");
const PHASES = new Set<StudioLANPhase>(["idle", "discovering", "connecting", "authenticating", "connected", "reconnecting", "failed", "suspended"]);
const ENROLLMENT_STATES = new Set<StudioLANDeviceEnrollmentState>(["unenrolled", "pending", "approved", "revoked"]);
const DEVICE_ROLES = new Set<StudioLANDeviceRole>(["audience", "worshipLeader", "musicians", "preacher", "production"]);
const UINT64 = /^(0|[1-9][0-9]{0,19})$/;
const SERVICE_ID = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID = /^sha256:[0-9a-f]{64}$/;
const CATALOG_ID = /^sha256:[0-9a-f]{64}$/;
const CHORD_KEY = /^(?:[A-G](?:#|b)?|Do|Re|Mi|Fa|Sol|La|Si)$/i;
const CHORD_TOKEN = /^(?:(?:[A-G](?:#|b)?)(?:(?:maj|min|m|dim|aug|sus|add)?[0-9]*)?(?:\/[A-G](?:#|b)?)?|N\.?C\.?|[1-7](?:#|b)?(?:m)?(?:\/[1-7](?:#|b)?)?)$/i;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const REMOTE_REJECTIONS = new Set<StudioLANRemoteRejection>([
  "routeDisabled", "unauthorizedDevice", "staleRoute", "authorityMismatch", "expiredCommand",
  "invalidSignature", "invalidCommand", "revisionConflict", "commandIDCollision", "rateLimited", "unavailable",
]);
const MAXIMUM_IMAGE_BYTES = 64 * 1_024 * 1_024;
const CONTROL_CHARACTER = /\p{Cc}/u;
const UNICODE_LINE_SEPARATOR = /[\u2028\u2029]/u;
const SAFE_MESSAGES = new Set([
  "Selecciona un Tchurch Studio disponible.",
  "Ingresa el código de emparejamiento de Tchurch Studio.",
  "El código de emparejamiento no es válido.",
  "No se pudo buscar Tchurch Studio en esta red.",
  "No se encontró Tchurch Studio. Verifica que la Mac esté abierta y en esta red.",
  "Esperando que Tchurch Studio vuelva a aparecer.",
  "Vuelve a ingresar el código de emparejamiento.",
  "Reconectando con Tchurch Studio…",
  "Studio usa el protocolo LAN anterior. Verificando compatibilidad segura…",
  "En espera: abre Tchurch para volver a conectar.",
  "No se pudo autenticar. Revisa el código de emparejamiento.",
  "El emparejamiento cambió. Escanea el QR actual de Tchurch Studio.",
  "Studio envió datos que no pudieron verificarse. La pantalla quedó cerrada por seguridad.",
  "Se perdió la conexión LAN. Reintentando…",
  "No se pudo borrar el emparejamiento guardado.",
  "Borrando datos privados de Studio antes de continuar…",
  "Verificando el acceso local de Studio antes de continuar…",
  "No se pudo completar el borrado privado de Studio. Intenta de nuevo.",
  "Studio no aceptó la conexión. Conservamos el emparejamiento; usa Olvidar solo si cambió el QR.",
  "No se pudo usar el almacenamiento seguro. Conservamos los datos existentes y reintentaremos.",
  "Conectado de forma segura, pero el emparejamiento no pudo guardarse. Si cierras la app, vuelve a escanear el QR.",
  "Studio respondió a una verificación LAN inválida. Cerramos ese transporte y reconectaremos.",
  "No se pudo verificar la conexión LAN. Reconectando…",
  "Studio dejó de responder en la red local. Reconectando…",
  "Este dispositivo fue revocado en Tchurch Studio.",
  "No se pudo proteger la identidad local de este dispositivo.",
  "El rol solicitado no corresponde a esta salida local.",
  "Studio no confirmó el control local. Reconectando…",
  "Studio no confirmó el timer local. Reconectando…",
  "Studio no confirmó el lower third local. Reconectando…",
]);
const SAFE_ASSET_MESSAGES = new Set([
  "Preparando imagen offline…",
  "Descargando imagen offline…",
  "No hay espacio suficiente para guardar esta imagen offline.",
  "La imagen excede el límite seguro para este dispositivo.",
  "La imagen no pudo verificarse y no se mostrará.",
  "Studio no pudo entregar esta imagen offline.",
]);
const SAFE_CATALOG_MESSAGES = new Set([
  "Cargando el catálogo local firmado…",
  "Studio no respondió al catálogo local. Los controles directos siguen disponibles.",
  "Studio está ocupado. Los controles directos siguen disponibles.",
  "El catálogo cambió en Studio. Esperando el manifiesto nuevo…",
  "Studio rechazó esta página del catálogo local.",
  "El catálogo local se cerró con la conexión.",
  "Studio usa el catálogo compatible del protocolo v4.",
  "La ruta local cambió en Studio. Esperando el estado firmado nuevo…",
]);

const DEFAULT_STATUS: StudioLANStatus = {
  supported: false,
  phase: "idle",
  services: [],
  selectedServiceId: null,
  channel: null,
  paired: false,
  message: "Tchurch Studio LAN está disponible en la app de iPhone o iPad.",
  enrollmentState: "unenrolled",
  protocolFloor: 1,
  role: null,
  permissions: [],
  permissionRevision: "0",
  revocationGeneration: "0",
  studioId: null,
  remoteControlAvailable: false,
  remoteCommandInFlight: false,
  operatorTimerControlAvailable: false,
  operatorTimerCommandInFlight: false,
  localBroadcastLowerThirdControlAvailable: false,
  localBroadcastLowerThirdCommandInFlight: false,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasOnlyKeys(source: Record<string, unknown>, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(source).every((key) => allowed.has(key));
}

function hasExactKeys(source: Record<string, unknown>, expectedKeys: readonly string[]) {
  return Object.keys(source).length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function canonicalSingleLine(value: unknown, maximumBytes: number) {
  const normalized = boundedString(value, maximumBytes);
  return normalized != null && normalized === normalized.trim()
    && !UNICODE_LINE_SEPARATOR.test(normalized) ? normalized : null;
}

function localBroadcastLowerThirdProjection(
  value: unknown,
): StudioLANLocalBroadcastLowerThird | null | undefined {
  if (value === null || value === undefined) return null;
  const lowerThird = record(value);
  const revision = boundedString(lowerThird?.revision, 20);
  if (!lowerThird || lowerThird.schemaVersion !== 1
    || !revision || !UINT64.test(revision)
    || BigInt(revision) > 9_007_199_254_740_991n
    || lowerThird.target !== "localBrowserOBS"
    || typeof lowerThird.visible !== "boolean") return undefined;
  if (!lowerThird.visible) {
    return hasExactKeys(lowerThird, ["schemaVersion", "revision", "target", "visible"])
      ? { schemaVersion: 1, revision, target: "localBrowserOBS", visible: false }
      : undefined;
  }
  if (!hasOnlyKeys(lowerThird, [
    "schemaVersion", "revision", "target", "visible", "title", "subtitle",
  ]) || !Object.prototype.hasOwnProperty.call(lowerThird, "title")) return undefined;
  const title = canonicalSingleLine(lowerThird.title, 160);
  const subtitle = lowerThird.subtitle === undefined
    ? null : canonicalSingleLine(lowerThird.subtitle, 240);
  if (!title || (lowerThird.subtitle !== undefined && !subtitle)) return undefined;
  return {
    schemaVersion: 1,
    revision,
    target: "localBrowserOBS",
    visible: true,
    title,
    ...(subtitle ? { subtitle } : {}),
  };
}

function boundedString(value: unknown, maximum = 16_384) {
  return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= maximum
    && !CONTROL_CHARACTER.test(value) ? value : null;
}

function boundedLine(value: unknown, allowsEmpty: boolean, maximum = 16_384) {
  return typeof value === "string" && (allowsEmpty || value.length > 0)
    && new TextEncoder().encode(value).length <= maximum && !CONTROL_CHARACTER.test(value) ? value : null;
}

function nullableString(value: unknown, maximum = 16_384) {
  if (value === null || value === undefined) return null;
  return boundedString(value, maximum);
}

function safeMessage(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && SAFE_MESSAGES.has(value)
    ? value
    : "La conexión LAN no está disponible. Desconecta y vuelve a emparejar.";
}

function imageAsset(value: unknown): StudioLANImageAssetDescriptor | null | undefined {
  if (value === null || value === undefined) return null;
  const source = record(value);
  const referenceId = boundedString(source?.referenceId, 71);
  const objectId = boundedString(source?.objectId, 71);
  const byteSize = boundedString(source?.byteSize, 20);
  const mimeType = source?.mimeType;
  const imageFit = source?.imageFit;
  if (!source || source.schemaVersion !== 1 || !referenceId || !ASSET_ID.test(referenceId)
    || !objectId || !ASSET_ID.test(objectId) || source.kind !== "image"
    || typeof mimeType !== "string" || !IMAGE_MIME_TYPES.has(mimeType)
    || !byteSize || !UINT64.test(byteSize) || BigInt(byteSize) <= 0n || BigInt(byteSize) > BigInt(MAXIMUM_IMAGE_BYTES)
    || typeof source.required !== "boolean" || (imageFit !== "contain" && imageFit !== "cover")) return undefined;
  return {
    schemaVersion: 1,
    referenceId,
    objectId,
    kind: "image",
    mimeType: mimeType as StudioLANImageAssetDescriptor["mimeType"],
    byteSize,
    required: source.required,
    imageFit,
  };
}

function cue(value: unknown, payloadVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7): StudioLANCue | null | undefined {
  if (value === null || value === undefined) return null;
  const source = record(value);
  if (!source) return undefined;
  const cueId = boundedString(source.cueId, 160);
  const title = nullableString(source.title);
  if (!cueId || (source.title != null && title == null) || !Array.isArray(source.lines) || source.lines.length > 128) return undefined;
  const lines = source.lines.map((line) => {
    const bounded = boundedLine(line, payloadVersion >= 2);
    return bounded != null && (payloadVersion >= 2 || bounded === bounded.trim()) ? bounded : null;
  });
  if (lines.some((line) => line == null)) return undefined;
  const mediaAssetId = source.mediaAssetId == null ? null : boundedString(source.mediaAssetId, 71);
  if (mediaAssetId && !ASSET_ID.test(mediaAssetId)) return undefined;
  const normalizedImageAsset = imageAsset(source.imageAsset);
  if (normalizedImageAsset === undefined || (payloadVersion < 3 && normalizedImageAsset != null)
    || (normalizedImageAsset && normalizedImageAsset.objectId !== mediaAssetId)) return undefined;
  return { cueId, title, lines: lines as string[], mediaAssetId, imageAsset: normalizedImageAsset };
}

function timer(value: unknown): StudioLANTimer | null {
  const source = record(value);
  const id = boundedString(source?.id, 160);
  const label = boundedString(source?.label);
  const mode = source?.mode;
  if (!source || !id || !label || (mode !== "countUp" && mode !== "countDown")) return null;
  const anchorAtMs = Number(source.anchorAtMs);
  const anchorValueMs = Number(source.anchorValueMs);
  const durationMs = source.durationMs == null ? null : Number(source.durationMs);
  if (![anchorAtMs, anchorValueMs].every(Number.isSafeInteger) || (durationMs != null && !Number.isSafeInteger(durationMs))) return null;
  return { id, label, mode, anchorAtMs, anchorValueMs, durationMs, isRunning: source.isRunning === true };
}

function isUtf16Boundary(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return !(previous >= 0xD800 && previous <= 0xDBFF && current >= 0xDC00 && current <= 0xDFFF);
}

function chordSlide(value: unknown): StudioLANChordSlide | null | undefined {
  if (value === null || value === undefined) return null;
  const source = record(value);
  const cueId = boundedString(source?.cueId, 160);
  const key = nullableString(source?.key, 20);
  if (!source || !cueId || (source.key != null && (key == null || !CHORD_KEY.test(key))) || !Array.isArray(source.lines)
    || source.lines.length === 0 || source.lines.length > 128) return undefined;
  const lines: StudioLANChordLine[] = [];
  let totalChordTokens = 0;
  for (const rawLine of source.lines) {
    const line = record(rawLine);
    const text = boundedLine(line?.text, true);
    if (!line || text == null || !Array.isArray(line.chords) || line.chords.length > 12) return undefined;
    totalChordTokens += line.chords.length;
    if (totalChordTokens > 48) return undefined;
    const chords: StudioLANChordToken[] = [];
    let previousOffset = -1;
    for (const rawToken of line.chords) {
      const token = record(rawToken);
      const tokenValue = boundedString(token?.value, 24);
      const offsetUtf16 = Number(token?.offsetUtf16);
      if (!token || !tokenValue || !CHORD_TOKEN.test(tokenValue) || !Number.isSafeInteger(offsetUtf16) || offsetUtf16 < previousOffset
        || offsetUtf16 < 0 || offsetUtf16 > text.length || !isUtf16Boundary(text, offsetUtf16)) return undefined;
      chords.push({ value: tokenValue, offsetUtf16 });
      previousOffset = offsetUtf16;
    }
    lines.push({ text, chords });
  }
  if (totalChordTokens === 0) return undefined;
  return { cueId, key, lines };
}

function legacyChordLines(slide: StudioLANChordSlide | null) {
  if (!slide) return [];
  return slide.lines.flatMap((line) => {
    const values = line.chords.map((token) => token.value);
    return values.length > 0 ? [values.join("   ")] : [];
  });
}

export function normalizeStudioLANPairingQR(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const prefix = "tchurch-studio:";
  if (!trimmed.toLowerCase().startsWith(prefix)) return null;
  const encoded = trimmed.slice(prefix.length);
  if (encoded.length < 43 || encoded.length > 86 || encoded.length % 4 === 1
    || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  return `${prefix}${encoded}`;
}

export function normalizeStudioLANStatus(value: unknown): StudioLANStatus {
  if (!isStudioLANSupported()) return DEFAULT_STATUS;
  const source = record(value);
  const phase = source?.phase;
  const channel = source?.channel;
  const selectedServiceId = source?.selectedServiceId;
  const enrollmentState = source?.enrollmentState;
  const protocolFloor = Number(source?.protocolFloor ?? 1);
  const role = source?.role;
  const permissionRevision = boundedString(source?.permissionRevision ?? "0", 20);
  const revocationGeneration = boundedString(source?.revocationGeneration ?? "0", 20);
  const studioId = source?.studioId == null ? null : boundedString(source.studioId, 36);
  const rawPermissions = Array.isArray(source?.permissions) ? source.permissions : [];
  const permissions = rawPermissions.filter((permission): permission is StudioLANDevicePermission => permission === "observe" || permission === "controlProgram");
  const services = Array.isArray(source?.services) ? source.services.flatMap((item) => {
    const service = record(item);
    const id = boundedString(service?.id, 32);
    const name = boundedString(service?.name, 120);
    const serviceProtocolFloor = Number(service?.protocolFloor ?? 1);
    return id && SERVICE_ID.test(id) && name && (serviceProtocolFloor === 1 || serviceProtocolFloor === 4)
      ? [{ id, name, protocolFloor: serviceProtocolFloor }] : [];
  }).slice(0, 64) : [];
  const normalizedEnrollmentState = typeof enrollmentState === "string" && ENROLLMENT_STATES.has(enrollmentState as StudioLANDeviceEnrollmentState)
    ? enrollmentState as StudioLANDeviceEnrollmentState : "unenrolled";
  const normalizedRole = typeof role === "string" && DEVICE_ROLES.has(role as StudioLANDeviceRole) ? role as StudioLANDeviceRole : null;
  const permissionsAreCanonical = permissions.length === rawPermissions.length
    && permissions.every((permission, index) => permission === (["observe", "controlProgram"] as const).filter((candidate) => permissions.includes(candidate))[index]);
  const trustIsValid = (protocolFloor === 1 || protocolFloor === 4)
    && (normalizedEnrollmentState === "unenrolled" ? protocolFloor === 1 : protocolFloor === 4)
    && permissionRevision != null && UINT64.test(permissionRevision)
    && revocationGeneration != null && UINT64.test(revocationGeneration)
    && permissionsAreCanonical
    && (source?.studioId == null || (studioId != null && UUID.test(studioId)))
    && (source?.role == null || normalizedRole != null)
    && (normalizedEnrollmentState !== "approved" || (normalizedRole != null && permissions.includes("observe")));
  return {
    supported: true,
    phase: trustIsValid && typeof phase === "string" && PHASES.has(phase as StudioLANPhase) ? phase as StudioLANPhase : "failed",
    services,
    selectedServiceId: typeof selectedServiceId === "string" && SERVICE_ID.test(selectedServiceId) ? selectedServiceId : null,
    channel: channel === "audience" || channel === "stage" || channel === "control" ? channel : null,
    paired: source?.paired === true,
    message: trustIsValid ? safeMessage(source?.message) : "La conexión LAN no está disponible. Desconecta y vuelve a emparejar.",
    enrollmentState: normalizedEnrollmentState,
    protocolFloor: trustIsValid ? protocolFloor : 4,
    role: normalizedRole,
    permissions: permissionsAreCanonical ? permissions : [],
    permissionRevision: permissionRevision && UINT64.test(permissionRevision) ? permissionRevision : "0",
    revocationGeneration: revocationGeneration && UINT64.test(revocationGeneration) ? revocationGeneration : "0",
    studioId: studioId && UUID.test(studioId) ? studioId.toLowerCase() : null,
    remoteControlAvailable: source?.remoteControlAvailable === true
      && phase === "connected"
      && channel === "control"
      && normalizedEnrollmentState === "approved"
      && normalizedRole === "production"
      && permissions.includes("observe")
      && permissions.includes("controlProgram"),
    remoteCommandInFlight: source?.remoteCommandInFlight === true
      && phase === "connected"
      && channel === "control",
    operatorTimerControlAvailable: source?.operatorTimerControlAvailable === true
      && phase === "connected"
      && channel === "control"
      && normalizedEnrollmentState === "approved"
      && normalizedRole === "production"
      && permissions.includes("observe")
      && permissions.includes("controlProgram"),
    operatorTimerCommandInFlight: source?.operatorTimerCommandInFlight === true
      && phase === "connected"
      && channel === "control",
    localBroadcastLowerThirdControlAvailable: source?.localBroadcastLowerThirdControlAvailable === true
      && phase === "connected"
      && channel === "control"
      && normalizedEnrollmentState === "approved"
      && normalizedRole === "production"
      && permissions.includes("observe")
      && permissions.includes("controlProgram"),
    localBroadcastLowerThirdCommandInFlight: source?.localBroadcastLowerThirdCommandInFlight === true
      && phase === "connected"
      && channel === "control",
  };
}

export function normalizeStudioLANUpdate(value: unknown): StudioLANUpdate | null {
  const source = record(value);
  const authority = record(source?.authority);
  const audience = record(source?.audience);
  if (!source || !authority || !audience) return null;
  const channel = source.channel;
  const payloadVersion = Number(source.payloadVersion);
  const sequence = boundedString(source.sequence, 20);
  const revision = boundedString(source.revision, 20);
  const runId = boundedString(authority.runId, 36);
  const authorityEpoch = boundedString(authority.authorityEpoch, 20);
  const packageId = boundedString(authority.packageId, 160);
  const serviceVersion = boundedString(authority.serviceVersion, 160);
  const currentCueId = audience.currentCueId == null ? null : boundedString(audience.currentCueId, 160);
  const currentCueIndex = audience.currentCueIndex == null ? null : Number(audience.currentCueIndex);
  const cueCount = Number(audience.cueCount);
  if (payloadVersion !== 1 && payloadVersion !== 2 && payloadVersion !== 3
    && payloadVersion !== 4 && payloadVersion !== 5 && payloadVersion !== 6
    && payloadVersion !== 7) return null;
  if ((payloadVersion === 6 || payloadVersion === 7) && channel !== "control") return null;
  const audienceCue = cue(audience.cue, payloadVersion);
  if ((channel !== "audience" && channel !== "stage" && channel !== "control")
    || !sequence || !UINT64.test(sequence) || !revision || !UINT64.test(revision)
    || !runId || !UUID.test(runId) || !authorityEpoch || !UINT64.test(authorityEpoch) || !packageId || !serviceVersion
    || (audience.currentCueId != null && !currentCueId) || (currentCueIndex != null && !Number.isSafeInteger(currentCueIndex))
    || (currentCueIndex != null && (currentCueIndex < 0 || currentCueIndex >= cueCount))
    || !Number.isSafeInteger(cueCount) || cueCount < 0 || audienceCue === undefined
    || (audienceCue != null && audienceCue.cueId !== currentCueId)
    || (audienceCue == null && currentCueId != null)) return null;

  let countdown: StudioLANUpdate["audience"]["countdown"] = null;
  if (audience.countdown != null) {
    const sourceCountdown = record(audience.countdown);
    const id = boundedString(sourceCountdown?.id, 160);
    const label = boundedString(sourceCountdown?.label);
    const targetAtMs = Number(sourceCountdown?.targetAtMs);
    if (!id || !label || !Number.isSafeInteger(targetAtMs)) return null;
    countdown = { id, label, targetAtMs };
  }

  let stage: StudioLANUpdate["stage"] = null;
  if (source.stage != null) {
    const sourceStage = record(source.stage);
    const nextCue = cue(sourceStage?.nextCue, payloadVersion);
    const currentChordSlide = chordSlide(sourceStage?.currentChordSlide);
    const message = sourceStage?.message == null ? null : boundedString(sourceStage.message);
    if (!sourceStage || nextCue === undefined || currentChordSlide === undefined || (sourceStage.message != null && !message)
      || !Array.isArray(sourceStage.chordLines) || sourceStage.chordLines.length > 128
      || !Array.isArray(sourceStage.timers) || sourceStage.timers.length > 64) return null;
    const chordLines = sourceStage.chordLines.map((line) => boundedString(line));
    const timers = sourceStage.timers.map(timer);
    if (chordLines.some((line) => line == null) || timers.some((item) => item == null)) return null;
    if (payloadVersion === 1 && currentChordSlide != null) return null;
    if (payloadVersion >= 2) {
      const derivedChordLines = legacyChordLines(currentChordSlide);
      if (chordLines.length !== derivedChordLines.length
        || (chordLines as string[]).some((line, index) => line !== derivedChordLines[index])) return null;
    }
    if (currentChordSlide && (!audienceCue || currentChordSlide.cueId !== currentCueId
      || currentChordSlide.cueId !== audienceCue.cueId
      || currentChordSlide.lines.length !== audienceCue.lines.length
      || currentChordSlide.lines.some((line, index) => line.text !== audienceCue.lines[index]))) return null;
    stage = { nextCue, chordLines: chordLines as string[], currentChordSlide, timers: timers as StudioLANTimer[], message };
  }
  if ((channel === "stage" || channel === "control") && !stage) return null;
  if (channel === "audience" && stage) return null;

  let control: StudioLANUpdate["control"] = null;
  if (source.control != null) {
    const sourceControl = record(source.control);
    const healthyOutputCount = Number(sourceControl?.healthyOutputCount);
    const expectedOutputCount = Number(sourceControl?.expectedOutputCount);
    const routeEpoch = boundedString(sourceControl?.routeEpoch, 20);
    if (!sourceControl || channel !== "control"
      || (payloadVersion !== 4 && payloadVersion !== 5 && payloadVersion !== 6
        && payloadVersion !== 7)
      || typeof sourceControl.chordsVisible !== "boolean" || typeof sourceControl.lightingArmed !== "boolean"
      || !Number.isSafeInteger(healthyOutputCount) || healthyOutputCount < 0
      || !Number.isSafeInteger(expectedOutputCount) || expectedOutputCount < healthyOutputCount
      || !routeEpoch || !UINT64.test(routeEpoch) || BigInt(routeEpoch) <= 0n || BigInt(routeEpoch) >= 18_446_744_073_709_551_615n
      || (sourceControl.chordsVisible === false && stage?.currentChordSlide != null)) return null;
    let cueCatalog: Array<{ cueId: string; title: string }> | null = null;
    let routing: StudioLANRouting | null = null;
    let cueCatalogManifest: StudioLANCueCatalogManifest | null = null;
    let operatorTimers: StudioLANOperatorTimers | null = null;
    let localBroadcastLowerThird: StudioLANLocalBroadcastLowerThird | null = null;
    if (payloadVersion === 4) {
      if (!Array.isArray(sourceControl.cueCatalog) || sourceControl.cueCatalog.length > cueCount
        || sourceControl.cueCatalog.length > 4_096
        || sourceControl.routing != null || sourceControl.cueCatalogManifest != null
        || sourceControl.operatorTimers != null
        || sourceControl.localBroadcastLowerThird != null) return null;
      cueCatalog = sourceControl.cueCatalog.flatMap((value) => {
        const item = record(value);
        const cueId = boundedString(item?.cueId, 160);
        const title = boundedString(item?.title);
        return item && cueId && title ? [{ cueId, title }] : [];
      });
      if (cueCatalog.length !== sourceControl.cueCatalog.length
        || new Set(cueCatalog.map((item) => item.cueId)).size !== cueCatalog.length) return null;
    } else {
      const rawRouting = record(sourceControl.routing);
      const rawManifest = record(sourceControl.cueCatalogManifest);
      const catalogId = boundedString(rawManifest?.catalogId, 71);
      const totalCount = Number(rawManifest?.totalCount);
      if (sourceControl.cueCatalog != null || !rawRouting || !rawManifest
        || rawRouting.schemaVersion !== 1
        || typeof rawRouting.localAudience !== "boolean"
        || typeof rawRouting.localBroadcast !== "boolean"
        || typeof rawRouting.stageAndMusicians !== "boolean"
        || rawRouting.lanRemoteControl !== true
        || typeof rawRouting.lightingAndMIDI !== "boolean"
        || rawRouting.tchurchCloudProgram !== false
        || rawManifest.schemaVersion !== 1
        || !catalogId || !CATALOG_ID.test(catalogId)
        || !Number.isSafeInteger(totalCount) || totalCount < 0 || totalCount > 20_000
        || totalCount !== cueCount || rawManifest.pageSize !== 128) return null;
      routing = {
        schemaVersion: 1,
        localAudience: rawRouting.localAudience,
        localBroadcast: rawRouting.localBroadcast,
        stageAndMusicians: rawRouting.stageAndMusicians,
        lanRemoteControl: true,
        lightingAndMIDI: rawRouting.lightingAndMIDI,
        tchurchCloudProgram: false,
      };
      cueCatalogManifest = { schemaVersion: 1, catalogId, totalCount, pageSize: 128 };
      if (payloadVersion === 5) {
        if (sourceControl.operatorTimers != null) return null;
      } else if (sourceControl.operatorTimers != null) {
        const rawOperatorTimers = record(sourceControl.operatorTimers);
        const timerRevision = boundedString(rawOperatorTimers?.revision, 20);
        if (!rawOperatorTimers || rawOperatorTimers.schemaVersion !== 1
          || !timerRevision || !UINT64.test(timerRevision)
          || BigInt(timerRevision) > 9_007_199_254_740_991n
          || !Array.isArray(rawOperatorTimers.timers)
          || rawOperatorTimers.timers.length !== 2) return null;
        const normalizedTimers = rawOperatorTimers.timers.flatMap((value, index) => {
          const item = record(value);
          const scope = item?.scope;
          const anchorTimestampMilliseconds = Number(item?.anchorTimestampMilliseconds);
          const anchorValueMilliseconds = Number(item?.anchorValueMilliseconds);
          const expectedScope = index === 0 ? "service" : "item";
          return item && scope === expectedScope
            && Number.isSafeInteger(anchorTimestampMilliseconds)
            && anchorTimestampMilliseconds >= 0
            && anchorTimestampMilliseconds <= 9_007_199_254_740_991
            && Number.isSafeInteger(anchorValueMilliseconds)
            && anchorValueMilliseconds >= 0
            && anchorValueMilliseconds <= 604_800_000
            && typeof item.isRunning === "boolean"
            ? [{
              scope,
              anchorTimestampMilliseconds,
              anchorValueMilliseconds,
              isRunning: item.isRunning,
            } as StudioLANOperatorTimerState]
            : [];
        });
        if (normalizedTimers.length !== 2) return null;
        operatorTimers = {
          schemaVersion: 1,
          revision: timerRevision,
          timers: normalizedTimers as [StudioLANOperatorTimerState, StudioLANOperatorTimerState],
        };
      }
      const normalizedLowerThird = localBroadcastLowerThirdProjection(
        sourceControl.localBroadcastLowerThird,
      );
      if (normalizedLowerThird === undefined
        || (payloadVersion <= 6 && normalizedLowerThird != null)
        || (normalizedLowerThird != null && rawRouting.localBroadcast !== true)) return null;
      if (payloadVersion === 7) localBroadcastLowerThird = normalizedLowerThird;
    }
    control = {
      chordsVisible: sourceControl.chordsVisible,
      lightingArmed: sourceControl.lightingArmed,
      healthyOutputCount,
      expectedOutputCount,
      routeEpoch,
      cueCatalog,
      routing,
      cueCatalogManifest,
      operatorTimers,
      localBroadcastLowerThird,
    };
  }
  if (channel === "control" && !control) return null;
  if (channel !== "control" && control) return null;

  const issuedAtMs = Number(source.issuedAtMs);
  const receivedAtMs = Number(source.receivedAtMs);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0
    || !Number.isSafeInteger(receivedAtMs)) return null;
  return {
    channel,
    payloadVersion: payloadVersion as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    sequence,
    revision,
    issuedAtMs,
    receivedAtMs,
    authority: { runId, authorityEpoch, packageId, serviceVersion },
    audience: {
      currentCueId,
      currentCueIndex,
      cueCount,
      isBlackout: audience.isBlackout === true,
      countdown,
      cue: audienceCue,
    },
    stage,
    control,
  };
}

export function isStudioLANSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

function portableImageURL(value: unknown) {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    return ["capacitor:", "http:", "https:"].includes(url.protocol)
      && url.hostname === "localhost"
      && url.pathname.startsWith("/_capacitor_file_/")
      && !url.username && !url.password && !url.search && !url.hash ? value : null;
  } catch {
    return null;
  }
}

export function normalizeStudioLANImageAssetStatus(value: unknown): StudioLANImageAssetStatus | null {
  const source = record(value);
  const cueId = boundedString(source?.cueId, 160);
  const objectId = boundedString(source?.objectId, 71);
  const phase = source?.phase;
  const receivedBytes = boundedString(source?.receivedBytes, 20);
  const totalBytes = boundedString(source?.totalBytes, 20);
  const imageFit = source?.imageFit;
  const localUrl = source?.localUrl == null ? null : portableImageURL(source.localUrl);
  const message = source?.message == null ? null
    : typeof source.message === "string" && SAFE_ASSET_MESSAGES.has(source.message) ? source.message : null;
  if (!source || !cueId || !objectId || !ASSET_ID.test(objectId)
    || (phase !== "loading" && phase !== "ready" && phase !== "unavailable")
    || !receivedBytes || !UINT64.test(receivedBytes) || !totalBytes || !UINT64.test(totalBytes)
    || BigInt(totalBytes) <= 0n || BigInt(totalBytes) > BigInt(MAXIMUM_IMAGE_BYTES)
    || BigInt(receivedBytes) > BigInt(totalBytes)
    || (imageFit !== "contain" && imageFit !== "cover")
    || (phase === "ready" ? !localUrl || BigInt(receivedBytes) !== BigInt(totalBytes) : localUrl != null)
    || (source.message != null && message == null)) return null;
  return { cueId, objectId, phase, receivedBytes, totalBytes, imageFit, localUrl, message };
}

export function normalizeStudioLANCueCatalogStatus(value: unknown): StudioLANCueCatalogStatus | null {
  const source = record(value);
  const phase = source?.phase;
  const catalogId = boundedString(source?.catalogId, 71);
  const routeEpoch = boundedString(source?.routeEpoch, 20);
  const totalCount = Number(source?.totalCount);
  const receivedCount = Number(source?.receivedCount);
  const message = source?.message == null ? null
    : typeof source.message === "string" && SAFE_CATALOG_MESSAGES.has(source.message) ? source.message : null;
  if (!source || (phase !== "loading" && phase !== "ready" && phase !== "unavailable")
    || !catalogId || !CATALOG_ID.test(catalogId)
    || !routeEpoch || !UINT64.test(routeEpoch) || BigInt(routeEpoch) <= 0n
    || !Number.isSafeInteger(totalCount) || totalCount < 0 || totalCount > 20_000
    || !Number.isSafeInteger(receivedCount) || receivedCount < 0 || receivedCount > totalCount
    || (source.message != null && message == null)) return null;
  if (phase !== "ready") {
    if (source.cues != null) return null;
    return { phase, catalogId, routeEpoch, totalCount, receivedCount, cues: null, message };
  }
  if (!Array.isArray(source.cues) || source.cues.length !== totalCount || receivedCount !== totalCount) return null;
  const cues = source.cues.flatMap((value) => {
    const item = record(value);
    const cueId = boundedString(item?.cueId, 160);
    const title = boundedString(item?.title, 512);
    return item && cueId && title ? [{ cueId, title }] : [];
  });
  if (cues.length !== source.cues.length || new Set(cues.map((item) => item.cueId)).size !== cues.length) return null;
  return { phase, catalogId, routeEpoch, totalCount, receivedCount, cues, message };
}

export function normalizeStudioLANRemoteFeedback(value: unknown): StudioLANRemoteFeedback | null {
  const source = record(value);
  const commandId = boundedString(source?.commandId, 36);
  const kind = source?.kind;
  const state = source?.state;
  const cueId = source?.cueId == null ? null : boundedString(source.cueId, 160);
  const enabled = source?.enabled == null ? null : source.enabled;
  const rejection = source?.rejection == null ? null : source.rejection;
  const revision = source?.revision == null ? null : boundedString(source.revision, 20);
  if (!source || !commandId || !UUID.test(commandId)
    || (kind !== "next" && kind !== "previous" && kind !== "jump" && kind !== "setBlackout")
    || (state !== "queued" && state !== "accepted" && state !== "rejected" && state !== "timedOut" && state !== "interrupted")
    || (kind === "jump" ? !cueId || enabled != null : cueId != null)
    || (kind === "setBlackout" ? typeof enabled !== "boolean" : enabled != null)
    || (rejection != null && (typeof rejection !== "string" || !REMOTE_REJECTIONS.has(rejection as StudioLANRemoteRejection)))
    || (state === "rejected" ? rejection == null : rejection != null)
    || (revision != null && !UINT64.test(revision))
    || typeof source.wasIdempotentReplay !== "boolean") return null;
  return {
    commandId: commandId.toLowerCase(),
    kind,
    cueId,
    enabled: enabled as boolean | null,
    state,
    rejection: rejection as StudioLANRemoteRejection | null,
    revision,
    wasIdempotentReplay: source.wasIdempotentReplay,
  };
}

export function normalizeStudioLANOperatorTimerFeedback(
  value: unknown,
): StudioLANOperatorTimerFeedback | null {
  const source = record(value);
  const commandId = boundedString(source?.commandId, 36);
  const scope = source?.scope;
  const operation = source?.operation;
  const state = source?.state;
  const rejection = source?.rejection == null ? null : source.rejection;
  const timerRevision = source?.timerRevision == null
    ? null : boundedString(source.timerRevision, 20);
  if (!source || !commandId || !UUID.test(commandId)
    || source.kind !== "operatorTimer"
    || (scope !== "service" && scope !== "item")
    || (operation !== "start" && operation !== "pause")
    || (state !== "queued" && state !== "accepted" && state !== "rejected"
      && state !== "timedOut" && state !== "interrupted")
    || (rejection != null
      && (typeof rejection !== "string"
        || !REMOTE_REJECTIONS.has(rejection as StudioLANRemoteRejection)))
    || (state === "rejected" ? rejection == null : rejection != null)
    || (timerRevision != null && !UINT64.test(timerRevision))
    || typeof source.wasIdempotentReplay !== "boolean") return null;
  return {
    commandId: commandId.toLowerCase(),
    kind: "operatorTimer",
    scope,
    operation,
    state,
    rejection: rejection as StudioLANRemoteRejection | null,
    timerRevision,
    wasIdempotentReplay: source.wasIdempotentReplay,
  };
}

export function normalizeStudioLANLocalBroadcastLowerThirdAction(
  value: unknown,
): StudioLANLocalBroadcastLowerThirdAction | null {
  const source = record(value);
  if (!source || source.kind !== "localBroadcastLowerThird") return null;
  if (source.operation === "hide") {
    return hasExactKeys(source, ["kind", "operation"])
      ? { kind: "localBroadcastLowerThird", operation: "hide" }
      : null;
  }
  if (source.operation !== "show"
    || !hasOnlyKeys(source, ["kind", "operation", "title", "subtitle"])
    || !Object.prototype.hasOwnProperty.call(source, "title")) return null;
  const title = canonicalSingleLine(source.title, 160);
  const subtitle = source.subtitle === undefined
    ? null : canonicalSingleLine(source.subtitle, 240);
  if (!title || (source.subtitle !== undefined && !subtitle)) return null;
  return {
    kind: "localBroadcastLowerThird",
    operation: "show",
    title,
    ...(subtitle ? { subtitle } : {}),
  };
}

export function normalizeStudioLANLocalBroadcastLowerThirdFeedback(
  value: unknown,
): StudioLANLocalBroadcastLowerThirdFeedback | null {
  const source = record(value);
  const commandId = boundedString(source?.commandId, 36);
  const operation = source?.operation;
  const state = source?.state;
  const title = source?.title == null ? null : canonicalSingleLine(source.title, 160);
  const subtitle = source?.subtitle == null
    ? null : canonicalSingleLine(source.subtitle, 240);
  const rejection = source?.rejection == null ? null : source.rejection;
  const lowerThirdRevision = source?.lowerThirdRevision == null
    ? null : boundedString(source.lowerThirdRevision, 20);
  if (!source
    || !hasExactKeys(source, [
      "commandId", "kind", "operation", "title", "subtitle", "state", "rejection",
      "lowerThirdRevision", "wasIdempotentReplay",
    ])
    || !commandId || !UUID.test(commandId)
    || source.kind !== "localBroadcastLowerThird"
    || (operation !== "show" && operation !== "hide")
    || (state !== "queued" && state !== "accepted" && state !== "rejected"
      && state !== "timedOut" && state !== "interrupted")
    || (operation === "show" ? !title : title != null || subtitle != null)
    || (source.title != null && title == null)
    || (source.subtitle != null && subtitle == null)
    || (rejection != null
      && (typeof rejection !== "string"
        || !REMOTE_REJECTIONS.has(rejection as StudioLANRemoteRejection)))
    || (state === "rejected" ? rejection == null : rejection != null)
    || (lowerThirdRevision != null
      && (!UINT64.test(lowerThirdRevision)
        || BigInt(lowerThirdRevision) > 9_007_199_254_740_991n))
    || typeof source.wasIdempotentReplay !== "boolean") return null;
  return {
    commandId: commandId.toLowerCase(),
    kind: "localBroadcastLowerThird",
    operation,
    title,
    subtitle,
    state,
    rejection: rejection as StudioLANRemoteRejection | null,
    lowerThirdRevision,
    wasIdempotentReplay: source.wasIdempotentReplay,
  };
}

export async function connectStudioLANBridge(callbacks: {
  onStatus: (status: StudioLANStatus) => void;
  onUpdate: (update: StudioLANUpdate) => void;
  onImageAsset: (status: StudioLANImageAssetStatus) => void;
  onRemoteFeedback?: (feedback: StudioLANRemoteFeedback) => void;
  onOperatorTimerFeedback?: (feedback: StudioLANOperatorTimerFeedback) => void;
  onLocalBroadcastLowerThirdFeedback?: (feedback: StudioLANLocalBroadcastLowerThirdFeedback) => void;
  onCueCatalog?: (status: StudioLANCueCatalogStatus) => void;
}) {
  if (!isStudioLANSupported()) {
    callbacks.onStatus(DEFAULT_STATUS);
    return { disconnect: async () => undefined };
  }
  const handles = await Promise.all([
    StudioLANNative.addListener("studioLANStatus", (value) => callbacks.onStatus(normalizeStudioLANStatus(value))),
    StudioLANNative.addListener("studioLANUpdate", (value) => {
      const update = normalizeStudioLANUpdate(value);
      if (update) callbacks.onUpdate(update);
    }),
    StudioLANNative.addListener("studioLANImageAsset", (value) => {
      const status = normalizeStudioLANImageAssetStatus(value);
      if (status) callbacks.onImageAsset(status);
    }),
    StudioLANNative.addListener("studioLANRemoteFeedback", (value) => {
      const feedback = normalizeStudioLANRemoteFeedback(value);
      if (feedback) callbacks.onRemoteFeedback?.(feedback);
    }),
    StudioLANNative.addListener("studioLANOperatorTimerFeedback", (value) => {
      const feedback = normalizeStudioLANOperatorTimerFeedback(value);
      if (feedback) callbacks.onOperatorTimerFeedback?.(feedback);
    }),
    StudioLANNative.addListener("studioLANLocalBroadcastLowerThirdFeedback", (value) => {
      const feedback = normalizeStudioLANLocalBroadcastLowerThirdFeedback(value);
      if (feedback) callbacks.onLocalBroadcastLowerThirdFeedback?.(feedback);
    }),
    StudioLANNative.addListener("studioLANCueCatalog", (value) => {
      const status = normalizeStudioLANCueCatalogStatus(value);
      if (status) callbacks.onCueCatalog?.(status);
    }),
  ]);
  try {
    await StudioLANNative.setDisplayAwake({ active: true });
    callbacks.onStatus(normalizeStudioLANStatus(await StudioLANNative.getStatus().catch(() => null)));
    await StudioLANNative.startDiscovery();
    return {
      async disconnect() {
        await StudioLANNative.disconnect().catch(() => undefined);
        await StudioLANNative.stopDiscovery().catch(() => undefined);
        await StudioLANNative.setDisplayAwake({ active: false }).catch(() => undefined);
        await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
      },
    };
  } catch (error) {
    await StudioLANNative.setDisplayAwake({ active: false }).catch(() => undefined);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
    throw error;
  }
}

export async function connectToStudioLAN(
  serviceId: string,
  channel: StudioLANChannel,
  pairingCode: string,
  requestedRole: StudioLANDeviceRole = channel === "audience" ? "audience" : channel === "control" ? "production" : "musicians",
) {
  if (!isStudioLANSupported() || !SERVICE_ID.test(serviceId)) throw new Error("studio_lan_unavailable");
  await StudioLANNative.connect({ serviceId, channel, requestedRole, ...(pairingCode.trim() ? { pairingCode } : {}) });
}

export async function sendStudioLANRemoteCommand(action: StudioLANRemoteAction) {
  if (!isStudioLANSupported()) throw new Error("studio_lan_unavailable");
  if (action.kind === "jump") {
    if (!boundedString(action.cueId, 160) || action.cueId.trim() !== action.cueId) {
      throw new Error("studio_lan_invalid_action");
    }
  }
  return StudioLANNative.sendRemoteCommand(action);
}

export async function sendStudioLANOperatorTimerCommand(
  action: StudioLANOperatorTimerAction,
) {
  if (!isStudioLANSupported()) throw new Error("studio_lan_unavailable");
  if ((action.scope !== "service" && action.scope !== "item")
    || (action.operation !== "start" && action.operation !== "pause")) {
    throw new Error("studio_lan_invalid_action");
  }
  return StudioLANNative.sendOperatorTimerCommand(action);
}

export async function sendStudioLANLocalBroadcastLowerThirdCommand(
  action: StudioLANLocalBroadcastLowerThirdAction,
) {
  if (!isStudioLANSupported()) throw new Error("studio_lan_unavailable");
  const normalized = normalizeStudioLANLocalBroadcastLowerThirdAction(action);
  if (!normalized) throw new Error("studio_lan_invalid_action");
  return StudioLANNative.sendLocalBroadcastLowerThirdCommand(normalized);
}

export async function requestStudioLANDeviceReapproval() {
  if (!isStudioLANSupported()) throw new Error("studio_lan_unavailable");
  const result = await StudioLANNative.requestDeviceReapproval();
  if (!result.accepted || !UUID.test(result.deviceId)) {
    throw new Error("studio_lan_reapproval_failed");
  }
  return { ...result, deviceId: result.deviceId.toLowerCase() };
}

export async function refreshStudioLANDiscovery() {
  if (isStudioLANSupported()) await StudioLANNative.startDiscovery();
}

export async function disconnectFromStudioLAN() {
  if (isStudioLANSupported()) await StudioLANNative.disconnect();
}

export async function forgetStudioLANPairing(serviceId: string) {
  if (isStudioLANSupported() && SERVICE_ID.test(serviceId)) await StudioLANNative.forgetPairing({ serviceId });
}

export async function purgeStudioLANPrivateState() {
  if (isStudioLANSupported()) await StudioLANNative.purgePrivateState();
}

export type StudioLANPrivacyContext =
  | { access: "unknown" }
  | { access: "signedOut" | "revoked" }
  | { access: "principal"; principalId: string }
  | { access: "authorized"; principalId: string; churchId: string };

function validPrivacyIdentifier(value: unknown) {
  return typeof value === "string" && value.length > 0
    && new TextEncoder().encode(value).length <= 256
    && !CONTROL_CHARACTER.test(value);
}

export async function synchronizeStudioLANPrivacyContext(context: StudioLANPrivacyContext) {
  if (!isStudioLANSupported()) return;
  if (context.access === "principal") {
    if (!validPrivacyIdentifier(context.principalId)) {
      throw new Error("studio_lan_invalid_privacy_context");
    }
    await StudioLANNative.synchronizePrivacyContext(context);
    return;
  }
  if (context.access === "authorized") {
    if (!validPrivacyIdentifier(context.principalId) || !validPrivacyIdentifier(context.churchId)) {
      throw new Error("studio_lan_invalid_privacy_context");
    }
    await StudioLANNative.synchronizePrivacyContext(context);
    return;
  }
  await StudioLANNative.synchronizePrivacyContext({ access: context.access });
}
