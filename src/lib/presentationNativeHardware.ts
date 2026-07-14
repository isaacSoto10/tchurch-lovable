import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import {
  MAX_PRESENTATION_HARDWARE_BINDINGS,
  isCanonicalPresentationGamepadDeviceId,
  isCanonicalPresentationMidiDeviceId,
  presentationHardwareBindingFingerprint,
  type PresentationGamepadBinding,
  type PresentationHardwareSettings,
  type PresentationMidiBinding,
  type PresentationNativeHardwareInput,
  type PresentationNativeHardwareLearnedInput,
  type PresentationHardwareSource,
} from "@/lib/presentationPedal";

export type PresentationNativeHardwareDevice = {
  id: string;
  name: string;
};

export type PresentationNativeHardwareStatus = {
  supported: boolean;
  active: boolean;
  gamepads: PresentationNativeHardwareDevice[];
  midiSources: PresentationNativeHardwareDevice[];
  learningSource: "gamepad" | "midi" | null;
  message: string | null;
};

type NativeStatusPayload = Omit<PresentationNativeHardwareStatus, "supported">;

export type PresentationNativeHardwareStartOptions = {
  gamepadEnabled: boolean;
  midiEnabled: boolean;
  gamepadBindings: Array<Pick<PresentationGamepadBinding, "deviceId" | "control">>;
  midiBindings: Array<Pick<PresentationMidiBinding, "deviceId" | "message" | "channel" | "number" | "activation" | "threshold" | "releaseThreshold"> & { ruleKey: string }>;
};

type LearningEndedEvent = {
  source: "gamepad" | "midi" | null;
  reason: "cancelled" | "timeout" | "learned" | "stopped" | "background";
};

interface PresentationHardwareNativePlugin {
  start(options: PresentationNativeHardwareStartOptions): Promise<NativeStatusPayload>;
  stop(): Promise<NativeStatusPayload>;
  getStatus(): Promise<NativeStatusPayload>;
  beginLearning(options: { source: "gamepad" | "midi"; timeoutMs: number }): Promise<NativeStatusPayload>;
  cancelLearning(): Promise<NativeStatusPayload>;
  addListener(eventName: "hardwareInput", listener: (event: PresentationNativeHardwareInput) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "hardwareLearned", listener: (event: PresentationNativeHardwareLearnedInput) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "hardwareLearningEnded", listener: (event: LearningEndedEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "hardwareStatus", listener: (event: NativeStatusPayload) => void): Promise<PluginListenerHandle>;
}

const PresentationHardwareNative = registerPlugin<PresentationHardwareNativePlugin>("PresentationHardware");

const PRESENTATION_NATIVE_HARDWARE_FAILURE_MESSAGE = "Las entradas nativas no están disponibles. Mantén Tchurch en primer plano, vuelve a conectar el dispositivo y reactiva las entradas.";
const SAFE_PRESENTATION_NATIVE_HARDWARE_MESSAGES = new Set([
  "En espera: Tchurch está en segundo plano.",
  "En espera: Tchurch debe estar visible y en primer plano.",
  "No se pudo iniciar Gamepad. Vuelve a conectar el control y reactiva las entradas.",
  "No se pudo iniciar MIDI. Vuelve a conectar la interfaz y reactiva las entradas.",
  "No se pudieron iniciar Gamepad y MIDI. Vuelve a conectar los dispositivos y reactiva las entradas.",
]);

export const DEFAULT_PRESENTATION_NATIVE_HARDWARE_STATUS: PresentationNativeHardwareStatus = {
  supported: false,
  active: false,
  gamepads: [],
  midiSources: [],
  learningSource: null,
  message: "Gamepad y MIDI nativos están disponibles en la app de iPhone o iPad.",
};

export function isPresentationNativeHardwareSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function presentationNativeHardwareStatusMessage(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && SAFE_PRESENTATION_NATIVE_HARDWARE_MESSAGES.has(value)
    ? value
    : PRESENTATION_NATIVE_HARDWARE_FAILURE_MESSAGE;
}

function nativeDeviceList(source: "gamepad" | "midi", value: unknown): PresentationNativeHardwareDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const idIsCanonical = source === "gamepad"
      ? isCanonicalPresentationGamepadDeviceId(record.id)
      : isCanonicalPresentationMidiDeviceId(record.id);
    if (!idIsCanonical) return [];
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 120) : "";
    return [{ id: record.id as string, name: name || (source === "gamepad" ? "Control" : "Fuente MIDI") }];
  });
}

function statusWithSupport(payload: NativeStatusPayload): PresentationNativeHardwareStatus {
  return {
    supported: true,
    active: payload?.active === true,
    gamepads: nativeDeviceList("gamepad", payload?.gamepads),
    midiSources: nativeDeviceList("midi", payload?.midiSources),
    learningSource: payload?.learningSource === "gamepad" || payload?.learningSource === "midi" ? payload.learningSource : null,
    message: presentationNativeHardwareStatusMessage(payload?.message),
  };
}

function hasCanonicalEventDeviceId(event: unknown): event is PresentationNativeHardwareInput | PresentationNativeHardwareLearnedInput {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const record = event as Record<string, unknown>;
  if (record.source === "gamepad") return isCanonicalPresentationGamepadDeviceId(record.deviceId);
  if (record.source === "midi") return isCanonicalPresentationMidiDeviceId(record.deviceId);
  return false;
}

export function presentationNativeHardwareStartOptions(settings: PresentationHardwareSettings): PresentationNativeHardwareStartOptions {
  const enabled = settings.enabled;
  return {
    gamepadEnabled: enabled && settings.sources.gamepad,
    midiEnabled: enabled && settings.sources.midi,
    gamepadBindings: settings.bindings
      .filter((binding): binding is PresentationGamepadBinding => (
        binding.source === "gamepad"
        && binding.enabled
        && (binding.deviceId === null || isCanonicalPresentationGamepadDeviceId(binding.deviceId))
      ))
      .slice(0, MAX_PRESENTATION_HARDWARE_BINDINGS)
      .map(({ deviceId, control }) => ({ deviceId, control })),
    midiBindings: settings.bindings
      .filter((binding): binding is PresentationMidiBinding => (
        binding.source === "midi"
        && binding.enabled
        && (binding.deviceId === null || isCanonicalPresentationMidiDeviceId(binding.deviceId))
      ))
      .slice(0, MAX_PRESENTATION_HARDWARE_BINDINGS)
      .map(({ deviceId, message, channel, number, activation, threshold, releaseThreshold }) => ({
        ruleKey: presentationHardwareBindingFingerprint({ source: "midi", deviceId, message, channel, number }),
        deviceId,
        message,
        channel,
        number,
        activation,
        threshold,
        releaseThreshold,
      })),
  };
}

export type PresentationNativeHardwareSessionCallbacks = {
  onInput: (event: PresentationNativeHardwareInput) => void;
  onLearned: (event: PresentationNativeHardwareLearnedInput) => void;
  onLearningEnded: (event: LearningEndedEvent) => void;
  onStatus: (status: PresentationNativeHardwareStatus) => void;
};

let lifecycleQueue: Promise<void> = Promise.resolve();
let activeOwner = 0;
let nextOwner = 1;
let activeHandles: PluginListenerHandle[] = [];

function enqueueLifecycle(operation: () => Promise<void>) {
  lifecycleQueue = lifecycleQueue.then(operation, operation);
  return lifecycleQueue;
}

async function removeActiveHandles() {
  const handles = activeHandles;
  activeHandles = [];
  await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
}

export function connectPresentationNativeHardware(
  settings: PresentationHardwareSettings,
  callbacks: PresentationNativeHardwareSessionCallbacks,
) {
  const owner = nextOwner++;
  let disconnected = false;
  const supported = isPresentationNativeHardwareSupported();
  if (!supported) {
    callbacks.onStatus(DEFAULT_PRESENTATION_NATIVE_HARDWARE_STATUS);
    return {
      owner,
      ready: Promise.resolve(),
      disconnect: () => Promise.resolve(),
    };
  }

  const ready = enqueueLifecycle(async () => {
    await removeActiveHandles();
    await PresentationHardwareNative.stop().catch(() => undefined);
    if (disconnected) return;
    activeOwner = owner;
    const handles = await Promise.all([
      PresentationHardwareNative.addListener("hardwareInput", (event) => {
        if (hasCanonicalEventDeviceId(event)) callbacks.onInput(event);
      }),
      PresentationHardwareNative.addListener("hardwareLearned", (event) => {
        if (hasCanonicalEventDeviceId(event)) callbacks.onLearned(event);
      }),
      PresentationHardwareNative.addListener("hardwareLearningEnded", callbacks.onLearningEnded),
      PresentationHardwareNative.addListener("hardwareStatus", (status) => callbacks.onStatus(statusWithSupport(status))),
    ]);
    if (disconnected || activeOwner !== owner) {
      await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
      return;
    }
    activeHandles = handles;
    try {
      const status = await PresentationHardwareNative.start(presentationNativeHardwareStartOptions(settings));
      if (!disconnected && activeOwner === owner) callbacks.onStatus(statusWithSupport(status));
    } catch {
      if (!disconnected && activeOwner === owner) callbacks.onStatus({
        supported: true,
        active: false,
        gamepads: [],
        midiSources: [],
        learningSource: null,
        message: PRESENTATION_NATIVE_HARDWARE_FAILURE_MESSAGE,
      });
    }
  });

  return {
    owner,
    ready,
    disconnect() {
      disconnected = true;
      return enqueueLifecycle(async () => {
        if (activeOwner !== owner) return;
        activeOwner = 0;
        await removeActiveHandles();
        await PresentationHardwareNative.stop().catch(() => undefined);
      });
    },
  };
}

export async function beginPresentationNativeHardwareLearning(source: Extract<PresentationHardwareSource, "gamepad" | "midi">, timeoutMs = 10_000) {
  await lifecycleQueue;
  if (!isPresentationNativeHardwareSupported() || !activeOwner) throw new Error("native_hardware_unavailable");
  const boundedTimeout = Math.max(3_000, Math.min(30_000, Math.round(timeoutMs)));
  return statusWithSupport(await PresentationHardwareNative.beginLearning({ source, timeoutMs: boundedTimeout }));
}

export async function cancelPresentationNativeHardwareLearning() {
  await lifecycleQueue;
  if (!isPresentationNativeHardwareSupported() || !activeOwner) return DEFAULT_PRESENTATION_NATIVE_HARDWARE_STATUS;
  return statusWithSupport(await PresentationHardwareNative.cancelLearning());
}
