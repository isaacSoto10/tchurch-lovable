import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_HARDWARE_SETTINGS } from "@/lib/presentationPedal";
import { usePresentationHardwareInputs } from "./usePresentationHardwareInputs";

const readyContext = {
  mode: "live" as const,
  controllerOwned: true,
  commandPending: false,
  appActive: true,
  modalOpen: false,
  editorOpen: false,
  captureActive: false,
  networkDiverged: false,
};

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("usePresentationHardwareInputs", () => {
  it("dispatches a keyboard action once and resets dedupe when the presentation scope changes", () => {
    const onAction = vi.fn();
    const { rerender } = renderHook(
      ({ scope }) => usePresentationHardwareInputs({
        settings: DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
        context: readyContext,
        scope,
        onAction,
      }),
      { initialProps: { scope: "account-1::church-1::session-1" } },
    );

    fireEvent.keyDown(window, { code: "PageDown" });
    fireEvent.keyDown(window, { code: "PageDown" });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenLastCalledWith("next");

    rerender({ scope: "account-1::church-1::session-2" });
    fireEvent.keyDown(window, { code: "PageDown" });
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("stops immediately for lease, pending, modal, editor, capture, background, and divergence changes", () => {
    const onAction = vi.fn();
    const { rerender } = renderHook(
      ({ context }) => usePresentationHardwareInputs({
        settings: DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
        context,
        scope: "scope",
        onAction,
      }),
      { initialProps: { context: readyContext } },
    );

    const blockedContexts = [
      { ...readyContext, controllerOwned: false },
      { ...readyContext, commandPending: true },
      { ...readyContext, modalOpen: true },
      { ...readyContext, editorOpen: true },
      { ...readyContext, captureActive: true },
      { ...readyContext, appActive: false },
      { ...readyContext, networkDiverged: true },
    ];
    for (const context of blockedContexts) {
      rerender({ context });
      fireEvent.keyDown(window, { code: "ArrowRight" });
    }
    expect(onAction).not.toHaveBeenCalled();

    rerender({ context: readyContext });
    fireEvent.keyDown(window, { code: "ArrowRight" });
    expect(onAction).toHaveBeenCalledWith("next");
  });

  it("checks document visibility at event time and removes its listener on unmount", () => {
    const onAction = vi.fn();
    const { unmount } = renderHook(() => usePresentationHardwareInputs({
      settings: DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      context: readyContext,
      scope: "scope",
      onAction,
    }));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent.keyDown(window, { code: "PageUp" });
    expect(onAction).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent.keyDown(window, { code: "PageUp" });
    expect(onAction).toHaveBeenCalledWith("previous");
    unmount();
    fireEvent.keyDown(window, { code: "ArrowDown" });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("consumes only eligible bound presses while preserving native widget and unbound behavior", () => {
    const onAction = vi.fn();
    renderHook(() => usePresentationHardwareInputs({
      settings: DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
      context: readyContext,
      scope: "scope",
      onAction,
    }));

    const button = document.createElement("button");
    document.body.append(button);
    const widgetEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "Space" });
    button.dispatchEvent(widgetEvent);
    expect(widgetEvent.defaultPrevented).toBe(false);
    expect(onAction).not.toHaveBeenCalled();

    const unboundRepeat = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyX", repeat: true });
    window.dispatchEvent(unboundRepeat);
    expect(unboundRepeat.defaultPrevented).toBe(false);

    const boundRepeat = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "PageDown", repeat: true });
    window.dispatchEvent(boundRepeat);
    expect(boundRepeat.defaultPrevented).toBe(true);
    expect(onAction).not.toHaveBeenCalled();

    const accepted = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "PageDown" });
    window.dispatchEvent(accepted);
    expect(accepted.defaultPrevented).toBe(true);
    expect(onAction).toHaveBeenCalledWith("next");

    const bounce = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "PageDown" });
    window.dispatchEvent(bounce);
    expect(bounce.defaultPrevented).toBe(true);
    expect(onAction).toHaveBeenCalledTimes(1);
    button.remove();
  });
});
