import { Check, Music, Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSongLastUsedLabel } from "@/lib/songUsage";
import { cn } from "@/lib/utils";

export type SongPickerSong = {
  id: string;
  title: string;
  author?: string | null;
  key?: string | null;
  bpm?: number | null;
  meter?: string | null;
  lastUsedAt?: string | null;
};

type ServiceSongPickerProps<TSong extends SongPickerSong> = {
  search: string;
  songs: TSong[];
  selectedSongs: TSong[];
  onSearchChange: (value: string) => void;
  onToggleSong: (song: TSong) => void;
  disabled?: boolean;
  footer?: ReactNode;
};

function getSongMeta(song: SongPickerSong) {
  return [
    song.author ? `por ${song.author}` : null,
    song.key ? `Tono ${song.key}` : null,
    song.bpm ? `${song.bpm} BPM` : null,
    song.meter || null,
    formatSongLastUsedLabel(song.lastUsedAt),
  ].filter(Boolean).join(" · ");
}

export function ServiceSongPicker<TSong extends SongPickerSong>({
  search,
  songs,
  selectedSongs,
  onSearchChange,
  onToggleSong,
  disabled,
  footer,
}: ServiceSongPickerProps<TSong>) {
  const trimmedSearch = search.trim();
  const hasSearch = trimmedSearch.length >= 2;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 bg-zinc-50/80 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por título, autor o tono"
            aria-label="Buscar canciones"
            disabled={disabled}
            className="h-12 rounded-xl border-zinc-200 bg-white pl-10 pr-3 text-base shadow-none placeholder:text-zinc-500"
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-950">Canciones seleccionadas</p>
            <p className="text-xs leading-5 text-zinc-500">Toca una canción para agregarla o quitarla.</p>
          </div>
          <Badge variant={selectedSongs.length > 0 ? "default" : "outline"} className="shrink-0">
            {selectedSongs.length}
          </Badge>
        </div>

        {selectedSongs.length > 0 && (
          <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
            {selectedSongs.map((song) => (
              <button
                key={song.id}
                type="button"
                className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-left text-xs font-semibold text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onToggleSong(song)}
                disabled={disabled}
              >
                <span className="truncate">{song.title}</span>
                <X className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="max-h-[min(46svh,26rem)] overflow-y-auto p-2">
        {!hasSearch && songs.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-5 text-center">
            <Music className="mb-3 h-8 w-8 text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-900">Busca en la biblioteca</p>
            <p className="mt-1 max-w-64 text-xs leading-5 text-zinc-500">Escribe al menos 2 letras para encontrar cantos rápido.</p>
          </div>
        ) : songs.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center rounded-xl bg-zinc-50 px-5 text-center">
            <p className="text-sm font-semibold text-zinc-900">No hay resultados</p>
            <p className="mt-1 max-w-64 text-xs leading-5 text-zinc-500">Revisa el nombre o crea la canción si este servicio la necesita.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {songs.map((song) => {
              const selected = selectedSongs.some((selectedSong) => selectedSong.id === song.id);
              const meta = getSongMeta(song);

              return (
                <button
                  key={song.id}
                  type="button"
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary/35 bg-primary/10 text-zinc-950"
                      : "border-transparent bg-white hover:border-zinc-200 hover:bg-zinc-50",
                  )}
                  onClick={() => onToggleSong(song)}
                  disabled={disabled}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-zinc-200 bg-zinc-50 text-zinc-500",
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <Check className="h-4 w-4" /> : <Music className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-950">{song.title}</span>
                    <span className="mt-0.5 block truncate text-xs leading-5 text-zinc-500">
                      {meta || "Biblioteca de canciones"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {footer && <div className="border-t border-zinc-100 bg-zinc-50/70 p-3">{footer}</div>}
    </div>
  );
}
