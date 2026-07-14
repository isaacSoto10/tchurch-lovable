import { useEffect, useRef } from "react";
import {
  createPresentationInputDeduper,
  resolvePresentationHardwareInput,
  type PresentationHardwareAction,
  type PresentationHardwareContext,
  type PresentationHardwareSettings,
} from "@/lib/presentationPedal";

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
  currentRef.current = { settings, context, onAction };

  useEffect(() => {
    deduperRef.current.reset();
  }, [scope]);

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
}
