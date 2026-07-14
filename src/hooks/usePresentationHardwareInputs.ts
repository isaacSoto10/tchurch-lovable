import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPresentationInputDeduper,
  resolvePresentationNativeHardwareInput,
  resolvePresentationHardwareInput,
  type PresentationHardwareAction,
  type PresentationHardwareContext,
  type PresentationHardwareSettings,
  type PresentationNativeHardwareLearnedInput,
  type PresentationHardwareSource,
} from "@/lib/presentationPedal";
import {
  beginPresentationNativeHardwareLearning,
  cancelPresentationNativeHardwareLearning,
  connectPresentationNativeHardware,
  DEFAULT_PRESENTATION_NATIVE_HARDWARE_STATUS,
  isPresentationNativeHardwareSupported,
  type PresentationNativeHardwareStatus,
} from "@/lib/presentationNativeHardware";

type PresentationHardwareInputContext = Omit<PresentationHardwareContext, "documentVisible">;

export function usePresentationHardwareInputs({
  settings,
  context,
  scope,
  onAction,
}: {
  settings: PresentationHardwareSettings;
  context: PresentationHardwareInputContext;
  scope: string;
  onAction: (action: PresentationHardwareAction) => void;
}) {
  const currentRef = useRef({ settings, context, onAction });
  const deduperRef = useRef(createPresentationInputDeduper());
  const pendingLearningRef = useRef<{
    source: "gamepad" | "midi";
    resolve: (input: PresentationNativeHardwareLearnedInput | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [nativeStatus, setNativeStatus] = useState<PresentationNativeHardwareStatus>(DEFAULT_PRESENTATION_NATIVE_HARDWARE_STATUS);
  currentRef.current = { settings, context, onAction };
  const settleLearning = useCallback((input: PresentationNativeHardwareLearnedInput | null) => {
    const pending = pendingLearningRef.current;
    if (!pending) return;
    if (input && input.source !== pending.source) return;
    pendingLearningRef.current = null;
    clearTimeout(pending.timer);
    pending.resolve(input);
  }, []);

  useEffect(() => {
    deduperRef.current.reset();
    settleLearning(null);
  }, [scope, settleLearning]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const current = currentRef.current;
      const resolution = resolvePresentationHardwareInput(event, current.settings, {
        ...current.context,
        documentVisible: document.visibilityState !== "hidden",
      }, deduperRef.current);
      if (resolution.consume) event.preventDefault();
      if (resolution.action) current.onAction(resolution.action);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isPresentationNativeHardwareSupported()) {
      setNativeStatus(DEFAULT_PRESENTATION_NATIVE_HARDWARE_STATUS);
      return undefined;
    }
    if (!context.appActive || document.visibilityState === "hidden") {
      setNativeStatus({
        ...DEFAULT_PRESENTATION_NATIVE_HARDWARE_STATUS,
        supported: true,
        message: "En espera: Tchurch debe estar visible y en primer plano.",
      });
      return undefined;
    }

    const session = connectPresentationNativeHardware(settings, {
      onInput(event) {
        const current = currentRef.current;
        const action = resolvePresentationNativeHardwareInput(event, current.settings, {
          ...current.context,
          documentVisible: document.visibilityState !== "hidden",
        }, deduperRef.current);
        if (action) current.onAction(action);
      },
      onLearned: settleLearning,
      onLearningEnded(event) {
        if (event.reason !== "learned") settleLearning(null);
      },
      onStatus: setNativeStatus,
    });
    return () => {
      settleLearning(null);
      void session.disconnect();
    };
  }, [context.appActive, scope, settings, settleLearning]);

  const learnNativeInput = useCallback(async (source: Extract<PresentationHardwareSource, "gamepad" | "midi">, timeoutMs = 10_000) => {
    settleLearning(null);
    if (!currentRef.current.context.appActive || document.visibilityState === "hidden") return null;
    return new Promise<PresentationNativeHardwareLearnedInput | null>((resolve) => {
      const boundedTimeout = Math.max(3_000, Math.min(30_000, Math.round(timeoutMs)));
      pendingLearningRef.current = {
        source,
        resolve,
        timer: setTimeout(() => settleLearning(null), boundedTimeout + 750),
      };
      void beginPresentationNativeHardwareLearning(source, boundedTimeout).catch(() => settleLearning(null));
    });
  }, [settleLearning]);

  const cancelNativeLearning = useCallback(() => {
    settleLearning(null);
    void cancelPresentationNativeHardwareLearning();
  }, [settleLearning]);

  useEffect(() => () => settleLearning(null), [settleLearning]);

  return { nativeStatus, learnNativeInput, cancelNativeLearning };
}
