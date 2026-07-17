import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type StudioLANChannel = "audience" | "stage";
export type StudioLANPhase = "idle" | "discovering" | "connecting" | "authenticating" | "connected" | "reconnecting" | "failed" | "suspended";

export type StudioLANService = { id: string; name: string };
export type StudioLANStatus = {
  supported: boolean;
  phase: StudioLANPhase;
  services: StudioLANService[];
  selectedServiceId: string | null;
  channel: StudioLANChannel | null;
  paired: boolean;
  message: string | null;
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

export type StudioLANUpdate = {
  channel: StudioLANChannel;
  payloadVersion: 1 | 2 | 3;
  sequence: string;
  revision: string;
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
};

interface StudioLANNativePlugin {
  startDiscovery(): Promise<{ accepted: boolean }>;
  stopDiscovery(): Promise<{ accepted: boolean }>;
  connect(options: { serviceId: string; channel: StudioLANChannel; pairingCode?: string }): Promise<{ accepted: boolean }>;
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
}

const StudioLANNative = registerPlugin<StudioLANNativePlugin>("StudioLANClient");
const PHASES = new Set<StudioLANPhase>(["idle", "discovering", "connecting", "authenticating", "connected", "reconnecting", "failed", "suspended"]);
const UINT64 = /^(0|[1-9][0-9]{0,19})$/;
const SERVICE_ID = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID = /^sha256:[0-9a-f]{64}$/;
const CHORD_KEY = /^(?:[A-G](?:#|b)?|Do|Re|Mi|Fa|Sol|La|Si)$/i;
const CHORD_TOKEN = /^(?:(?:[A-G](?:#|b)?)(?:(?:maj|min|m|dim|aug|sus|add)?[0-9]*)?(?:\/[A-G](?:#|b)?)?|N\.?C\.?|[1-7](?:#|b)?(?:m)?(?:\/[1-7](?:#|b)?)?)$/i;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const MAXIMUM_IMAGE_BYTES = 64 * 1_024 * 1_024;
const CONTROL_CHARACTER = /\p{Cc}/u;
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
]);
const SAFE_ASSET_MESSAGES = new Set([
  "Preparando imagen offline…",
  "Descargando imagen offline…",
  "No hay espacio suficiente para guardar esta imagen offline.",
  "La imagen excede el límite seguro para este dispositivo.",
  "La imagen no pudo verificarse y no se mostrará.",
  "Studio no pudo entregar esta imagen offline.",
]);

const DEFAULT_STATUS: StudioLANStatus = {
  supported: false,
  phase: "idle",
  services: [],
  selectedServiceId: null,
  channel: null,
  paired: false,
  message: "Tchurch Studio LAN está disponible en la app de iPhone o iPad.",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

function cue(value: unknown, payloadVersion: 1 | 2 | 3): StudioLANCue | null | undefined {
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
  const services = Array.isArray(source?.services) ? source.services.flatMap((item) => {
    const service = record(item);
    const id = boundedString(service?.id, 32);
    const name = boundedString(service?.name, 120);
    return id && SERVICE_ID.test(id) && name ? [{ id, name }] : [];
  }).slice(0, 64) : [];
  return {
    supported: true,
    phase: typeof phase === "string" && PHASES.has(phase as StudioLANPhase) ? phase as StudioLANPhase : "failed",
    services,
    selectedServiceId: typeof selectedServiceId === "string" && SERVICE_ID.test(selectedServiceId) ? selectedServiceId : null,
    channel: channel === "audience" || channel === "stage" ? channel : null,
    paired: source?.paired === true,
    message: safeMessage(source?.message),
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
  if (payloadVersion !== 1 && payloadVersion !== 2 && payloadVersion !== 3) return null;
  const audienceCue = cue(audience.cue, payloadVersion);
  if ((channel !== "audience" && channel !== "stage")
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
  if (channel === "stage" && !stage) return null;
  if (channel === "audience" && stage) return null;

  const receivedAtMs = Number(source.receivedAtMs);
  if (!Number.isSafeInteger(receivedAtMs)) return null;
  return {
    channel,
    payloadVersion: payloadVersion as 1 | 2 | 3,
    sequence,
    revision,
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

export async function connectStudioLANBridge(callbacks: {
  onStatus: (status: StudioLANStatus) => void;
  onUpdate: (update: StudioLANUpdate) => void;
  onImageAsset: (status: StudioLANImageAssetStatus) => void;
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

export async function connectToStudioLAN(serviceId: string, channel: StudioLANChannel, pairingCode: string) {
  if (!isStudioLANSupported() || !SERVICE_ID.test(serviceId)) throw new Error("studio_lan_unavailable");
  await StudioLANNative.connect({ serviceId, channel, ...(pairingCode.trim() ? { pairingCode } : {}) });
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
