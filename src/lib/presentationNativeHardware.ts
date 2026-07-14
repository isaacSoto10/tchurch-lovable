import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import {
  MAX_PRESENTATION_HARDWARE_BINDINGS,
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

type PresentationNativeHardwareStartOptions = {
  gamepadEnabled: boolean;
  midiEnabled: boolean;
  gamepadBindings: Array<Pick<PresentationGamepadBinding, "deviceId" | "control">>;
  midiBindings: Array<Pick<PresentationMidiBinding, "deviceId" | "message" | "channel" | "number" | "activation" | "threshold" | "releaseThreshold">>;
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

function statusWithSupport(payload: NativeStatusPayload): PresentationNativeHardwareStatus {
  return { supported: true, ...payload };
}

export function presentationNativeHardwareStartOptions(settings: PresentationHardwareSettings): PresentationNativeHardwareStartOptions {
  const enabled = settings.enabled;
  return {
    gamepadEnabled: enabled && settings.sources.gamepad,
    midiEnabled: enabled && settings.sources.midi,
    gamepadBindings: settings.bindings
      .filter((binding): binding is PresentationGamepadBinding => binding.source === "gamepad" && binding.enabled)
      .slice(0, MAX_PRESENTATION_HARDWARE_BINDINGS)
      .map(({ deviceId, control }) => ({ deviceId, control })),
    midiBindings: settings.bindings
      .filter((binding): binding is PresentationMidiBinding => binding.source === "midi" && binding.enabled)
      .slice(0, MAX_PRESENTATION_HARDWARE_BINDINGS)
      .map(({ deviceId, message, channel, number, activation, threshold, releaseThreshold }) => ({
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
      PresentationHardwareNative.addListener("hardwareInput", callbacks.onInput),
      PresentationHardwareNative.addListener("hardwareLearned", callbacks.onLearned),
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
        message: "No se pudo iniciar el bridge nativo de entradas.",
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
