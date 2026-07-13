import type { PresentationStageMode } from "./presentationOutput";
import type { PresentationLayout, PresentationSongMode } from "./servicePresentation";

export type PresentationSurface = "operator" | "stage" | "remote";

export function resolvePresentationSurface(input: {
  requested: PresentationSurface;
  isTablet: boolean;
  stageMode: PresentationStageMode;
}): PresentationSurface {
  if (input.requested === "remote") return "remote";
  return input.isTablet ? input.requested : "stage";
}

function scaledClamp(minRem: number, preferredVw: number, maxRem: number, scale: number) {
  return `clamp(${(minRem * scale).toFixed(2)}rem, ${(preferredVw * scale).toFixed(2)}vw, ${(maxRem * scale).toFixed(2)}rem)`;
}

export function resolvePresentationSongTypography(input: {
  layout: PresentationLayout;
  songMode: PresentationSongMode;
  expandedStage: boolean;
  zoomScale: number;
  chartWidth: number;
  chartHeight: number;
  maxColumns: number;
  rows: number;
}) {
  const compact = input.chartWidth < 640;
  const widthLimited = (input.chartWidth / Math.max(input.maxColumns, 1)) * (compact ? 2.05 : 1.8);
  const heightLimited = (input.chartHeight / Math.max(input.rows, 1)) * (compact ? 0.94 : 0.9);
  const minimumLyricPx = compact ? 20 : 24;
  const maximumLyricPx = compact ? 24 : input.expandedStage && input.songMode === "paged" ? 46 : 38;
  const lyricPx = Math.round(Math.max(minimumLyricPx, Math.min(widthLimited, heightLimited, maximumLyricPx)));
  const maximumChordPx = compact ? 22 : input.expandedStage && input.songMode === "paged" ? 42 : 34;
  const chordPx = Math.round(Math.max(compact ? 18 : 22, Math.min(lyricPx - 1, maximumChordPx)));

  if (input.layout !== "tablet" || input.expandedStage && input.songMode === "paged") {
    return {
      lyricFontSize: `${Math.round(lyricPx * input.zoomScale)}px`,
      chordFontSize: `${Math.round(chordPx * input.zoomScale)}px`,
    };
  }

  if (input.expandedStage) {
    return {
      lyricFontSize: scaledClamp(1.2, 3, 2.2, input.zoomScale),
      chordFontSize: scaledClamp(1, 2.4, 1.7, input.zoomScale),
    };
  }

  return {
    lyricFontSize: scaledClamp(1, 2.35, 1.75, input.zoomScale),
    chordFontSize: scaledClamp(0.86, 1.85, 1.35, input.zoomScale),
  };
}
