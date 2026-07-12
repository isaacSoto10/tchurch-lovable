import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_PEDAL_MAPPING,
  normalizePresentationPedalMapping,
  presentationPedalStorageKey,
  readPresentationPedalMapping,
  resolvePresentationPedalAction,
  updatePresentationPedalBinding,
  writePresentationPedalMapping,
} from "./presentationPedal";

describe("presentation pedal safety", () => {
  beforeEach(() => localStorage.clear());

  it("persists a church-scoped mapping without credentials", () => {
    const saved = writePresentationPedalMapping("church/1", {
      ...DEFAULT_PRESENTATION_PEDAL_MAPPING,
      bindings: { ...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings, next: ["PageDown"] },
    });
    expect(readPresentationPedalMapping("church/1")).toEqual(saved);
    expect(readPresentationPedalMapping("church-2").bindings.next).toEqual(["ArrowRight", "ArrowDown", "PageDown", "Space"]);
    expect(presentationPedalStorageKey("church/1")).toContain("church%2F1");
    expect(localStorage.getItem(presentationPedalStorageKey("church/1"))).not.toMatch(/password|token|secret/i);
  });

  it("ignores editable, composing, repeated, modified and unidentified key events", () => {
    const input = document.createElement("input");
    const context = { mode: "live" as const, controllerOwned: true };
    expect(resolvePresentationPedalAction({ code: "ArrowRight", target: input }, DEFAULT_PRESENTATION_PEDAL_MAPPING, context)).toBeNull();
    expect(resolvePresentationPedalAction({ code: "ArrowRight", isComposing: true }, DEFAULT_PRESENTATION_PEDAL_MAPPING, context)).toBeNull();
    expect(resolvePresentationPedalAction({ code: "ArrowRight", repeat: true }, DEFAULT_PRESENTATION_PEDAL_MAPPING, context)).toBeNull();
    expect(resolvePresentationPedalAction({ code: "ArrowRight", metaKey: true }, DEFAULT_PRESENTATION_PEDAL_MAPPING, context)).toBeNull();
    expect(resolvePresentationPedalAction({ code: "Unidentified" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, context)).toBeNull();
  });

  it("allows only safe mappings while the live controller lease is owned", () => {
    expect(resolvePresentationPedalAction({ code: "ArrowRight" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: false })).toBeNull();
    expect(resolvePresentationPedalAction({ code: "ArrowRight" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("next");
    expect(resolvePresentationPedalAction({ code: "ArrowDown" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("next");
    expect(resolvePresentationPedalAction({ code: "ArrowLeft" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("previous");
    expect(resolvePresentationPedalAction({ code: "ArrowUp" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("previous");
    expect(resolvePresentationPedalAction({ code: "PageDown" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("next");
    expect(resolvePresentationPedalAction({ code: "Space" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("next");
    expect(resolvePresentationPedalAction({ code: "PageUp" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("previous");
    expect(resolvePresentationPedalAction({ code: "KeyB" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBe("toggle_blackout");
    expect(resolvePresentationPedalAction({ code: "KeyX" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "live", controllerOwned: true })).toBeNull();
  });

  it("keeps rehearsal pedal movement on its owned controller and removes duplicate bindings", () => {
    expect(resolvePresentationPedalAction({ code: "ArrowLeft" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "rehearsal", controllerOwned: false })).toBeNull();
    expect(resolvePresentationPedalAction({ code: "ArrowLeft" }, DEFAULT_PRESENTATION_PEDAL_MAPPING, { mode: "rehearsal", controllerOwned: true })).toBe("previous");
    const changed = updatePresentationPedalBinding(DEFAULT_PRESENTATION_PEDAL_MAPPING, "next", "ArrowLeft");
    expect(changed.bindings.next).toEqual(["ArrowLeft"]);
    expect(changed.bindings.previous).toEqual(["ArrowUp", "PageUp"]);
  });

  it("fails closed to the default schema for malformed durable state", () => {
    expect(normalizePresentationPedalMapping({ schemaVersion: 99, enabled: "yes", bindings: { next: "<script>" } })).toEqual(DEFAULT_PRESENTATION_PEDAL_MAPPING);
    expect(normalizePresentationPedalMapping({ schemaVersion: 99, enabled: true, bindings: { next: ["PageDown"] } })).toEqual(DEFAULT_PRESENTATION_PEDAL_MAPPING);
  });
});
