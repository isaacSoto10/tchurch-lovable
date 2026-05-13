import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { chordProToDisplayLines, hasChordPro } from "@/lib/songDisplay";
import { ALL_KEYS, normalizeKey, transposeChordPro } from "@/lib/musicUtils";
import { generateChordChartPdf } from "@/lib/chordChartPdf";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { FileDown, Minus, Plus } from "lucide-react";

type ChordProPreviewProps = {
  value: string | null | undefined;
  maxLines?: number;
  emptyText?: string;
  originalKey?: string | null;
  title?: string | null;
  artist?: string | null;
};

export function ChordProPreview({
  value,
  maxLines = 48,
  emptyText = "No ChordPro lyrics saved yet.",
  originalKey,
  title = "Chord Chart",
  artist,
}: ChordProPreviewProps) {
  const { toast } = useToast();
  const normalizedOriginalKey = normalizeKey(originalKey);
  const [transposeKey, setTransposeKey] = useState(normalizedOriginalKey);
  const [creatingPdf, setCreatingPdf] = useState(false);
  const selectedKey = normalizeKey(transposeKey) || normalizedOriginalKey;
  const selectedKeyIndex = ALL_KEYS.findIndex((key) => normalizeKey(key) === selectedKey);
  const displayValue = useMemo(() => {
    if (!value || !normalizedOriginalKey || !selectedKey || selectedKey === normalizedOriginalKey) return value;
    return transposeChordPro(value, normalizedOriginalKey, selectedKey);
  }, [normalizedOriginalKey, selectedKey, value]);

  useEffect(() => {
    setTransposeKey(normalizedOriginalKey);
  }, [normalizedOriginalKey]);

  function stopCardToggle(event: SyntheticEvent) {
    event.stopPropagation();
  }

  function changeKey(direction: -1 | 1) {
    if (!normalizedOriginalKey) return;
    const currentIndex = selectedKeyIndex >= 0 ? selectedKeyIndex : ALL_KEYS.findIndex((key) => normalizeKey(key) === normalizedOriginalKey);
    if (currentIndex < 0) return;
    const nextIndex = (currentIndex + direction + ALL_KEYS.length) % ALL_KEYS.length;
    setTransposeKey(ALL_KEYS[nextIndex]);
  }

  async function handlePdf() {
    if (!displayValue) return;
    setCreatingPdf(true);
    try {
      await generateChordChartPdf({
        title: title || "Chord Chart",
        artist,
        key: selectedKey || originalKey,
        chordPro: displayValue,
      });
    } catch (error) {
      console.error("Failed to create chord chart PDF:", error);
      toast({ title: "Could not create PDF", variant: "destructive" });
    } finally {
      setCreatingPdf(false);
    }
  }

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
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2"
        onClick={stopCardToggle}
        onPointerDown={stopCardToggle}
        onTouchStart={stopCardToggle}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">ChordPro</p>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {normalizedOriginalKey && (
            <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
                onClick={(event) => {
                  event.stopPropagation();
                  changeKey(-1);
                }}
                aria-label="Transpose down"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <select
                value={selectedKey || normalizedOriginalKey}
                onChange={(event) => setTransposeKey(event.target.value)}
                onClick={stopCardToggle}
                onPointerDown={stopCardToggle}
                onTouchStart={stopCardToggle}
                className="h-7 rounded-lg border-0 bg-primary/10 px-2 text-xs font-bold text-primary outline-none"
              >
                {ALL_KEYS.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
                onClick={(event) => {
                  event.stopPropagation();
                  changeKey(1);
                }}
                aria-label="Transpose up"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-xl px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              handlePdf();
            }}
            disabled={creatingPdf || !displayValue}
          >
            <FileDown className="mr-1 h-3.5 w-3.5" />
            PDF
          </Button>
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
