import { describe, expect, it } from "vitest";

import { resolvePresentationSongTypography, resolvePresentationSurface } from "./presentationSurface";

describe("resolvePresentationSurface", () => {
  it("preserves every explicit surface selection on an iPad production layout", () => {
    const selections = ["operator", "stage", "remote", "stage"] as const;

    expect(selections.map((requested) => resolvePresentationSurface({
      requested,
      isTablet: true,
      stageMode: "production",
    }))).toEqual(["operator", "stage", "remote", "stage"]);
  });

  it("keeps the existing iPhone stage and remote semantics", () => {
    expect(resolvePresentationSurface({ requested: "operator", isTablet: false, stageMode: "production" })).toBe("stage");
    expect(resolvePresentationSurface({ requested: "stage", isTablet: false, stageMode: "confidence" })).toBe("stage");
    expect(resolvePresentationSurface({ requested: "remote", isTablet: false, stageMode: "confidence" })).toBe("remote");
  });

  it("fits paged iPad lyrics to the current frame and grows them when the stage widens", () => {
    const constrained = resolvePresentationSongTypography({
      layout: "tablet", songMode: "paged", expandedStage: true, zoomScale: 1,
      chartWidth: 500, chartHeight: 620, maxColumns: 30, rows: 5,
    });
    const wide = resolvePresentationSongTypography({
      layout: "tablet", songMode: "paged", expandedStage: true, zoomScale: 1,
      chartWidth: 1_000, chartHeight: 620, maxColumns: 30, rows: 5,
    });

    expect(Number.parseInt(wide.lyricFontSize, 10)).toBeGreaterThan(Number.parseInt(constrained.lyricFontSize, 10));
    expect(wide.lyricFontSize).toBe("46px");
    expect(wide.chordFontSize).toBe("42px");
  });

  it("keeps the operator typography unchanged while expanding the iPad stage sheet", () => {
    const operator = resolvePresentationSongTypography({
      layout: "tablet", songMode: "scroll", expandedStage: false, zoomScale: 1,
      chartWidth: 500, chartHeight: 620, maxColumns: 30, rows: 5,
    });
    const stage = resolvePresentationSongTypography({
      layout: "tablet", songMode: "scroll", expandedStage: true, zoomScale: 1,
      chartWidth: 1_000, chartHeight: 620, maxColumns: 30, rows: 5,
    });

    expect(operator.lyricFontSize).toBe("clamp(1.00rem, 2.35vw, 1.75rem)");
    expect(stage.lyricFontSize).toBe("clamp(1.20rem, 3.00vw, 2.20rem)");
  });
});
