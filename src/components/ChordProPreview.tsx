import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { chordProToDisplayLines, hasChordPro } from "@/lib/songDisplay";
import { ALL_KEYS, normalizeKey, transposeChordPro } from "@/lib/musicUtils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { FileDown, Minus, Plus } from "lucide-react";

type ChordProPreviewProps = {
  value: string | null | undefined;
  maxLines?: number;
  emptyText?: string;
  originalKey?: string | null;
  selectedKey?: string | null;
  onSelectedKeyChange?: (key: string) => void | Promise<void>;
  title?: string | null;
  artist?: string | null;
  compact?: boolean;
};

export function ChordProPreview({
  value,
  maxLines = 48,
  emptyText = "Todavía no hay letras ChordPro guardadas.",
  originalKey,
  selectedKey: controlledSelectedKey,
  onSelectedKeyChange,
  title = "Hoja de acordes",
  artist,
  compact = false,
}: ChordProPreviewProps) {
  const { toast } = useToast();
  const normalizedOriginalKey = normalizeKey(originalKey);
  const normalizedControlledKey = normalizeKey(controlledSelectedKey);
  const [transposeKey, setTransposeKey] = useState(normalizedControlledKey || normalizedOriginalKey);
  const [creatingPdf, setCreatingPdf] = useState(false);
  const selectedKey = normalizedControlledKey || normalizeKey(transposeKey) || normalizedOriginalKey;
  const displayValue = useMemo(() => {
    if (!value || !normalizedOriginalKey || !selectedKey || selectedKey === normalizedOriginalKey) return value;
    return transposeChordPro(value, normalizedOriginalKey, selectedKey);
  }, [normalizedOriginalKey, selectedKey, value]);

  useEffect(() => {
    setTransposeKey(normalizedControlledKey || normalizedOriginalKey);
  }, [normalizedControlledKey, normalizedOriginalKey]);

  function stopCardToggle(event: SyntheticEvent) {
    event.stopPropagation();
  }

  function updateKey(nextKey: string) {
    setTransposeKey(nextKey);
    void onSelectedKeyChange?.(nextKey);
  }

  function changeKey(direction: -1 | 1) {
    if (!normalizedOriginalKey) return;
    setTransposeKey((current) => {
      const currentKey = normalizeKey(current) || selectedKey || normalizedOriginalKey;
      const currentIndex = ALL_KEYS.findIndex((key) => normalizeKey(key) === currentKey);
      const fallbackIndex = ALL_KEYS.findIndex((key) => normalizeKey(key) === normalizedOriginalKey);
      const safeIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
      if (safeIndex < 0) return current;
      const nextIndex = (safeIndex + direction + ALL_KEYS.length) % ALL_KEYS.length;
      const nextKey = ALL_KEYS[nextIndex];
      void onSelectedKeyChange?.(nextKey);
      return nextKey;
    });
  }

  async function handlePdf() {
    if (!displayValue) return;
    setCreatingPdf(true);
    try {
      const { generateChordChartPdf } = await import("@/lib/chordChartPdf");
      await generateChordChartPdf({
        title: title || "Hoja de acordes",
        artist,
        key: selectedKey || originalKey,
        chordPro: displayValue,
      });
    } catch (error) {
      console.error("No se pudo crear el PDF de acordes:", error);
      toast({ title: "No se pudo crear el PDF", variant: "destructive" });
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
  const headerClassName = compact
    ? "flex flex-col gap-2 border-b border-zinc-100 bg-zinc-50 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-3"
    : "flex flex-col gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4";
  const bodyClassName = compact
    ? "max-h-[44vh] overflow-auto px-2.5 py-2 font-mono text-[10px] leading-5 sm:max-h-[28rem] sm:px-3 sm:text-[12px]"
    : "max-h-[32rem] overflow-auto px-3 py-3 font-mono text-[12px] leading-6 sm:px-4 sm:text-[13px]";
  const controlButtonClassName = compact
    ? "flex h-8 w-8 items-center justify-center rounded-xl text-zinc-700 hover:bg-zinc-100 active:scale-95"
    : "flex h-9 w-9 items-center justify-center rounded-xl text-zinc-700 hover:bg-zinc-100 active:scale-95";
  const selectClassName = compact
    ? "h-8 rounded-xl border-0 bg-primary/10 px-2 text-xs font-bold text-primary outline-none"
    : "h-9 rounded-xl border-0 bg-primary/10 px-2 text-sm font-bold text-primary outline-none";

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/60">
      <div
        className={headerClassName}
        onClick={stopCardToggle}
        onPointerDown={stopCardToggle}
        onTouchStart={stopCardToggle}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Acordes</p>
        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
          {normalizedOriginalKey && (
            <div className="flex items-center gap-1 rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                className={controlButtonClassName}
                onClick={(event) => {
                  event.stopPropagation();
                  changeKey(-1);
                }}
                aria-label="Bajar tonalidad"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <select
                value={selectedKey || normalizedOriginalKey}
                onChange={(event) => updateKey(event.target.value)}
                onClick={stopCardToggle}
                onPointerDown={stopCardToggle}
                onTouchStart={stopCardToggle}
                className={selectClassName}
              >
                {ALL_KEYS.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
              <button
                type="button"
                className={controlButtonClassName}
                onClick={(event) => {
                  event.stopPropagation();
                  changeKey(1);
                }}
                aria-label="Subir tonalidad"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={compact ? "h-8 rounded-xl px-2.5 text-xs font-semibold" : "h-9 rounded-xl px-3 text-xs font-semibold"}
            onClick={(event) => {
              event.stopPropagation();
              handlePdf();
            }}
            disabled={creatingPdf || !displayValue}
          >
            <FileDown className="mr-1 h-3.5 w-3.5" />
            PDF
          </Button>
          {isTruncated && <p className="text-xs text-zinc-400">Vista previa</p>}
        </div>
      </div>
      <div className={bodyClassName}>
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
            <div key={index} className="w-max min-w-full max-w-none py-0.5 pr-3">
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
            Abre la canción completa para ver y editar toda la hoja.
          </div>
        )}
      </div>
    </div>
  );
}
