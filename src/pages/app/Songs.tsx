import { useCallback, useEffect, useMemo, useState } from "react";
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

const MUSICAL_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B", "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm"];

export default function Songs() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [artistFilter, setArtistFilter] = useState("all");
  const [keyFilter, setKeyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("lastUsed");
  const [loading, setLoading] = useState(true);

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

  const loadSongs = useCallback((nextSearch = search) => {
    const params = new URLSearchParams();
    const trimmedSearch = nextSearch.trim();
    params.set("limit", trimmedSearch ? "150" : "400");
    if (trimmedSearch) params.set("q", trimmedSearch);

    setLoading(true);
    fetchApi(`/songs?${params.toString()}`)
      .then((data) => setSongs(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load songs:", e))
      .finally(() => setLoading(false));
  }, [fetchApi, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadSongs(search), search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadSongs, search]);

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
      toast({ title: "Title is required", variant: "destructive" });
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
        toast({ title: "Song updated successfully" });
      } else {
        await fetchApi("/songs", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Song created successfully" });
      }
      setDialogOpen(false);
      loadSongs();
    } catch (e) {
      toast({ title: editingSong ? "Failed to update song" : "Failed to create song", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await fetchApi(`/songs/${deleteId}`, { method: "DELETE" });
      toast({ title: "Song deleted successfully" });
      setDeleteId(null);
      loadSongs();
    } catch (e) {
      toast({ title: "Failed to delete song", variant: "destructive" });
    }
  };

  const getTitle = (song: Song) => song.title || song.name || "";
  const getEffectiveKey = (song: Song) => getSongDisplayKey(song) || "";
  const getTime = (value?: string | null) => (value ? new Date(value).getTime() || 0 : 0);

  const artists = useMemo(
    () => Array.from(new Set(songs.map((song) => song.author).filter(Boolean) as string[])).sort(),
    [songs]
  );

  const keys = useMemo(
    () => Array.from(new Set(songs.map(getEffectiveKey).filter(Boolean))).sort(),
    [songs]
  );

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

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
        if (sortBy === "lastUsed") return getTime(b.lastUsedAt) - getTime(a.lastUsedAt) || getTitle(a).localeCompare(getTitle(b));
        if (sortBy === "recent") return getTime(b.createdAt) - getTime(a.createdAt) || getTitle(a).localeCompare(getTitle(b));
        if (sortBy === "artist") return (a.author || "").localeCompare(b.author || "") || getTitle(a).localeCompare(getTitle(b));
        if (sortBy === "key") return getEffectiveKey(a).localeCompare(getEffectiveKey(b)) || getTitle(a).localeCompare(getTitle(b));
        return getTitle(a).localeCompare(getTitle(b));
      });
  }, [artistFilter, keyFilter, search, songs, sortBy]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Songs</h1>
        {isAdmin && <Button size="sm" onClick={openNewDialog}><Plus className="w-4 h-4 mr-1" /> New Song</Button>}
      </div>
      <div className="mb-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, artist, key..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={artistFilter} onValueChange={setArtistFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Artist" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All artists</SelectItem>
            {artists.map((artist) => (
              <SelectItem key={artist} value={artist}>{artist}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={keyFilter} onValueChange={setKeyFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Key" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All keys</SelectItem>
            {keys.map((key) => (
              <SelectItem key={key} value={key}>{key}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger>
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lastUsed">Last used</SelectItem>
            <SelectItem value="recent">Most recent</SelectItem>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="artist">Artist</SelectItem>
            <SelectItem value="key">Key</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSong ? "Edit Song" : "New Song"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title *</label>
              <Input
                placeholder="Song title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Author</label>
              <Input
                placeholder="Author name"
                value={formData.author}
                onChange={(e) => setFormData({ ...formData, author: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Key</label>
                <Select value={formData.key} onValueChange={(v) => setFormData({ ...formData, key: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select key" />
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
                  placeholder="e.g. 120"
                  value={formData.bpm}
                  onChange={(e) => setFormData({ ...formData, bpm: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                placeholder="Add notes or lyrics..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit}>{editingSong ? "Update" : "Create"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Song</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this song? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-3">
        {filtered.map((s) => (
          <Card key={s.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/app/songs/${s.id}`)}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center text-sm font-bold text-primary">
                  {s.key || "—"}
                </div>
                <div>
                  <div className="font-medium">{getTitle(s)}</div>
                  {s.author && <div className="text-sm text-muted-foreground">{s.author}</div>}
                  {s.lastUsedAt && (
                    <div className="text-xs text-muted-foreground">Last used {new Date(s.lastUsedAt).toLocaleDateString()}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {s.bpm && <span className="text-sm text-muted-foreground mr-2">{s.bpm} BPM</span>}
                {isAdmin && (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(s)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(s.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No songs found.</p>
        )}
      </div>
    </div>
  );
}
