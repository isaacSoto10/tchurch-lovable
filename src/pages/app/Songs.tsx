import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";
import { getSongDisplayKey, type SongArrangement } from "@/lib/songDisplay";
import { compareSongsByDateAddedDesc, compareSongsByLastUsedDesc, formatSongLastUsedLabel } from "@/lib/songUsage";

interface Song {
  id: string;
  title: string;
  name?: string;
  author?: string;
  key?: string;
  bpm?: number;
  notes?: string;
  tags?: string | null;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  arrangements?: SongArrangement[] | null;
}

type SongSort = "lastUsed" | "createdAt" | "title" | "artist" | "key";

const MUSICAL_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B", "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm"];
const SONG_SEARCH_DEBOUNCE_MS = 900;
const SONG_SEARCH_MIN_LENGTH = 2;

export default function Songs() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [artistFilter, setArtistFilter] = useState("all");
  const [keyFilter, setKeyFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SongSort>("lastUsed");
  const [loading, setLoading] = useState(true);
  const songRequestIdRef = useRef(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    author: "",
    key: "",
    bpm: "",
    notes: "",
  });

  const loadSongs = useCallback((nextSearch: string) => {
    const requestId = songRequestIdRef.current + 1;
    songRequestIdRef.current = requestId;
    const params = new URLSearchParams();
    const trimmedSearch = nextSearch.trim();
    params.set("limit", trimmedSearch ? "150" : "400");
    params.set("sort", sortBy);
    if (trimmedSearch) params.set("q", trimmedSearch);

    setLoading(true);
    fetchApi(`/songs?${params.toString()}`)
      .then((data) => {
        if (songRequestIdRef.current !== requestId) return;
        setSongs(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (songRequestIdRef.current === requestId) console.error("No se pudieron cargar las canciones:", e);
      })
      .finally(() => {
        if (songRequestIdRef.current === requestId) setLoading(false);
      });
  }, [fetchApi, sortBy]);

  useEffect(() => {
    const trimmedSearch = search.trim();
    if (!trimmedSearch) {
      setAppliedSearch("");
      return;
    }
    if (trimmedSearch.length < SONG_SEARCH_MIN_LENGTH) return;

    const timer = window.setTimeout(() => setAppliedSearch(trimmedSearch), SONG_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    loadSongs(appliedSearch);
  }, [appliedSearch, loadSongs]);

  const openNewDialog = () => {
    setEditingSong(null);
    setFormData({ title: "", author: "", key: "", bpm: "", notes: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (song: Song) => {
    setEditingSong(song);
    setFormData({
      title: song.title || "",
      author: song.author || "",
      key: song.key || "",
      bpm: song.bpm?.toString() || "",
      notes: song.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast({ title: "El título es obligatorio", variant: "destructive" });
      return;
    }

    const payload = {
      title: formData.title.trim(),
      author: formData.author.trim() || undefined,
      key: formData.key || undefined,
      bpm: formData.bpm ? parseInt(formData.bpm) : undefined,
      notes: formData.notes.trim() || undefined,
    };

    try {
      if (editingSong) {
        await fetchApi(`/songs/${editingSong.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "Canción actualizada" });
      } else {
        await fetchApi("/songs", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Canción creada" });
      }
      setDialogOpen(false);
      loadSongs(appliedSearch);
    } catch (e) {
      toast({ title: editingSong ? "No se pudo actualizar la canción" : "No se pudo crear la canción", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await fetchApi(`/songs/${deleteId}`, { method: "DELETE" });
      toast({ title: "Canción eliminada" });
      setDeleteId(null);
      loadSongs(appliedSearch);
    } catch (e) {
      toast({ title: "No se pudo eliminar la canción", variant: "destructive" });
    }
  };

  const getTitle = (song: Song) => song.title || song.name || "";
  const getEffectiveKey = (song: Song) => getSongDisplayKey(song) || "";

  const artists = useMemo(
    () => Array.from(new Set(songs.map((song) => song.author).filter(Boolean) as string[])).sort(),
    [songs]
  );

  const keys = useMemo(
    () => Array.from(new Set(songs.map(getEffectiveKey).filter(Boolean))).sort(),
    [songs]
  );

  const filtered = useMemo(() => {
    const normalizedSearch = appliedSearch.trim().toLowerCase();

    return [...songs]
      .filter((song) => {
        const title = getTitle(song);
        const effectiveKey = getEffectiveKey(song);
        const searchable = [title, song.author, effectiveKey, song.tags, song.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return (
          (!normalizedSearch || searchable.includes(normalizedSearch)) &&
          (artistFilter === "all" || song.author === artistFilter) &&
          (keyFilter === "all" || effectiveKey === keyFilter)
        );
      })
      .sort((a, b) => {
        if (sortBy === "lastUsed") return compareSongsByLastUsedDesc(a, b);
        if (sortBy === "createdAt") return compareSongsByDateAddedDesc(a, b);
        if (sortBy === "artist") return (a.author || "").localeCompare(b.author || "") || getTitle(a).localeCompare(getTitle(b));
        if (sortBy === "key") return getEffectiveKey(a).localeCompare(getEffectiveKey(b)) || getTitle(a).localeCompare(getTitle(b));
        return getTitle(a).localeCompare(getTitle(b));
      });
  }, [appliedSearch, artistFilter, keyFilter, songs, sortBy]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="mobile-page space-y-5">
      <div className="app-card-soft p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mobile-section-title">Biblioteca</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">Canciones</h1>
            <p className="mt-1 text-sm text-muted-foreground">Encuentra acordes, letras, tonalidades y videos para el equipo.</p>
          </div>
          {isAdmin && <Button size="sm" onClick={openNewDialog} className="h-11 shrink-0 rounded-2xl px-4"><Plus className="w-4 h-4 mr-1" /> Nueva</Button>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_160px_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, artista o tonalidad..."
            className="h-12 rounded-2xl border-zinc-200 bg-white pl-9 shadow-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={artistFilter} onValueChange={setArtistFilter}>
          <SelectTrigger className="h-12 rounded-2xl border-zinc-200 bg-white shadow-sm">
            <SelectValue placeholder="Artista" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los artistas</SelectItem>
            {artists.map((artist) => (
              <SelectItem key={artist} value={artist}>{artist}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={keyFilter} onValueChange={setKeyFilter}>
          <SelectTrigger className="h-12 rounded-2xl border-zinc-200 bg-white shadow-sm">
            <SelectValue placeholder="Tonalidad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las tonalidades</SelectItem>
            {keys.map((key) => (
              <SelectItem key={key} value={key}>{key}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as SongSort)}>
          <SelectTrigger aria-label="Ordenar canciones" className="h-12 rounded-2xl border-zinc-200 bg-white shadow-sm">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lastUsed">Últimas usadas</SelectItem>
            <SelectItem value="createdAt">Fecha agregada</SelectItem>
            <SelectItem value="title">Título</SelectItem>
            <SelectItem value="artist">Artista</SelectItem>
            <SelectItem value="key">Tonalidad</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSong ? "Editar canción" : "Nueva canción"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Título *</label>
              <Input
                placeholder="Título de la canción"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Autor</label>
              <Input
                placeholder="Nombre del autor"
                value={formData.author}
                onChange={(e) => setFormData({ ...formData, author: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tonalidad</label>
                <Select value={formData.key} onValueChange={(v) => setFormData({ ...formData, key: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar tonalidad" />
                  </SelectTrigger>
                  <SelectContent>
                    {MUSICAL_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tempo (BPM)</label>
                <Input
                  type="number"
                  placeholder="ej. 120"
                  value={formData.bpm}
                  onChange={(e) => setFormData({ ...formData, bpm: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notas</label>
              <Textarea
                placeholder="Agrega notas o letras..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSubmit}>{editingSong ? "Actualizar" : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar canción</AlertDialogTitle>
            <AlertDialogDescription>¿Seguro que quieres eliminar esta canción? Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-3">
        {filtered.map((s) => (
          <Card key={s.id} className="app-card cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md" onClick={() => navigate(`/app/songs/${s.id}`)}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-sm font-bold text-primary">
                  {getEffectiveKey(s) || "—"}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-bold text-zinc-950">{getTitle(s)}</div>
                  {s.author && <div className="text-sm text-muted-foreground">{s.author}</div>}
                  <div className="text-xs text-muted-foreground">{formatSongLastUsedLabel(s.lastUsedAt)}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {s.bpm && <span className="mr-1 rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-muted-foreground">{s.bpm} BPM</span>}
                {isAdmin && (
                  <>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => openEditDialog(s)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setDeleteId(s.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="app-card p-8 text-center text-sm text-muted-foreground">No se encontraron canciones.</div>
        )}
      </div>
    </div>
  );
}
