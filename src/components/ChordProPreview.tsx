import { useMemo, useState } from "react";
import { chordProToDisplayLines, hasChordPro } from "@/lib/songDisplay";
import { ALL_KEYS, normalizeKey, transposeChordPro } from "@/lib/musicUtils";

type ChordProPreviewProps = {
  value: string | null | undefined;
  maxLines?: number;
  emptyText?: string;
  originalKey?: string | null;
};

export function ChordProPreview({
  value,
  maxLines = 48,
  emptyText = "No ChordPro lyrics saved yet.",
  originalKey,
}: ChordProPreviewProps) {
  const [transposeKey, setTransposeKey] = useState("");
  const normalizedOriginalKey = normalizeKey(originalKey);
  const displayValue = useMemo(() => {
    if (!value || !normalizedOriginalKey || !transposeKey) return value;
    return transposeChordPro(value, normalizedOriginalKey, transposeKey);
  }, [normalizedOriginalKey, transposeKey, value]);

  if (!hasChordPro(value)) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-center text-sm text-zinc-500">
        {emptyText}
      </div>
    );
  }

  const lines = chordProToDisplayLines(displayValue, maxLines);
  const isTruncated = Boolean(displayValue && displayValue.replace(/\r\n/g, "\n").split("\n").length > maxLines);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">ChordPro</p>
        <div className="flex items-center gap-2">
          {normalizedOriginalKey && (
            <label className="flex items-center gap-1 text-xs text-zinc-500">
              Key
              <select
                value={transposeKey}
                onChange={(event) => setTransposeKey(event.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                <option value="">Original {originalKey}</option>
                {ALL_KEYS.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </label>
          )}
          {isTruncated && <p className="text-xs text-zinc-400">Preview</p>}
        </div>
      </div>
      <div className="max-h-[30rem] overflow-auto px-4 py-3 font-mono text-[13px] leading-6">
        {lines.map((line, index) => {
          if (line.kind === "blank") {
            return <div key={index} className="h-3" />;
          }

          if (line.kind === "section") {
            return (
              <div key={index} className="mb-2 mt-3 first:mt-0">
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">
                  {line.label}
                </span>
              </div>
            );
          }

          if (line.kind === "meta") {
            return (
              <div key={index} className="text-xs font-semibold text-zinc-400">
                {line.label}
              </div>
            );
          }

          return (
            <div key={index} className="min-w-max py-0.5">
              {line.chords && (
                <div className="whitespace-pre font-bold text-primary">
                  {line.chords}
                </div>
              )}
              {line.lyrics && (
                <div className="whitespace-pre text-zinc-900">
                  {line.lyrics}
                </div>
              )}
            </div>
          );
        })}
        {isTruncated && (
          <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            Open the full song to see and edit the complete chart.
          </div>
        )}
      </div>
    </div>
  );
}
