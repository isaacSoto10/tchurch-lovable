import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowLeft, Plus, Trash2, Music2, Play, PlayCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ChordProPreview } from "@/components/ChordProPreview";
import { buildSongNotes, getSongYoutubeUrl, parseSongNotes } from "@/lib/songDisplay";
import { inferChordProKey } from "@/lib/musicUtils";

const MUSICAL_KEYS = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B",
  "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm"];
const COMMON_METERS = ["4/4", "3/4", "6/8", "2/4", "12/8", "7/8", "5/4"];

type Section = "info" | "arrangements" | "lyrics" | "preview";

type Song = {
  id: string;
  title: string;
  author: string | null;
  bpm: number | null;
  meter: string | null;
  key: string | null;
  notes: string | null;
  ccliNumber: string | null;
  copyright: string | null;
  tags: string | null;
  scriptureRef: string | null;
  lyrics: string | null;
  youtubeUrl: string | null;
  createdAt: string;
};

type Arrangement = {
  id: string;
  name: string;
  songId: string;
  key: string | null;
  bpm: number | null;
  meter: string | null;
  sequence: unknown[];
  lyrics: string | null;
  notes: string | null;
  createdAt: string;
};

function splitSlides(lyrics: string): string[] {
  return lyrics.split(/\n\n+/).filter((s) => s.trim());
}

function PresentationSlide({ text }: { text: string }) {
  const lines = text.trim().split("\n");
  const isSection = lines[0]?.startsWith("[") && lines[0]?.endsWith("]");
  return (
    <div className="bg-zinc-900 text-white min-h-48 rounded-xl p-8 flex flex-col justify-center space-y-1">
      {lines.map((line, i) => (
        <p
          key={i}
          className={isSection && i === 0 ? "text-primary font-bold text-center text-lg" : "text-center text-base font-semibold"}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

export default function SongDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [song, setSong] = useState<Song | null>(null);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>("info");
  const [activeArrangement, setActiveArrangement] = useState<Arrangement | null>(null);
  const [showAddArrangement, setShowAddArrangement] = useState(false);
  const [showDeleteSong, setShowDeleteSong] = useState(false);

  // Info form
  const [infoForm, setInfoForm] = useState({
    title: "", author: "", ccliNumber: "", copyright: "", tags: "", scriptureRef: "", key: "", bpm: "", meter: "", youtubeUrl: "", notes: "",
  });

  // Arrangement form
  const [arrForm, setArrForm] = useState({ name: "", key: "", bpm: "", meter: "", lyrics: "" });
  const [saving, setSaving] = useState(false);
  const previewLyrics = activeArrangement?.lyrics || song?.lyrics || "";

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const [songData, arrData] = await Promise.all([
          apiFetch<Song>(`/songs/${id}`),
          apiFetch<Arrangement[]>(`/songs/${id}/arrangements`),
        ]);
        if (songData.error) {
          navigate("/app/songs");
          return;
        }
        setSong(songData);
        const songNotes = parseSongNotes(songData.notes);
        setInfoForm({
          title: songData.title || "",
          author: songData.author || "",
          ccliNumber: songData.ccliNumber || "",
          copyright: songData.copyright || "",
          tags: songData.tags || "",
          scriptureRef: songData.scriptureRef || "",
          key: songData.key || "",
          bpm: songData.bpm?.toString() || "",
          meter: songData.meter || "",
          youtubeUrl: songData.youtubeUrl || songNotes.youtubeUrl || "",
          notes: songNotes.plainNotes || "",
        });
        setArrangements(arrData || []);
        if (arrData?.length > 0) setActiveArrangement(arrData[0]);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, navigate]);

  async function saveField(field: string, value: string) {
    if (!id || !song) return;
    setSong({ ...song, [field]: value });
    try {
      await apiFetch(`/songs/${id}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: value }),
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSaveInfo() {
    if (!id) return;
    setSaving(true);
    try {
      const updates = {
        title: infoForm.title,
        author: infoForm.author || null,
        ccliNumber: infoForm.ccliNumber || null,
        copyright: infoForm.copyright || null,
        tags: infoForm.tags || null,
        scriptureRef: infoForm.scriptureRef || null,
        key: infoForm.key || null,
        bpm: infoForm.bpm ? parseInt(infoForm.bpm) : null,
        meter: infoForm.meter || null,
        notes: buildSongNotes(infoForm.youtubeUrl.trim() || null, infoForm.notes.trim() || null),
      };
      await apiFetch(`/songs/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      setSong((prev) => prev ? { ...prev, ...updates } : prev);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddArrangement(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      const data = await apiFetch<Arrangement>(`/arrangements`, {
        method: "POST",
        body: JSON.stringify({
          songId: id,
          name: arrForm.name,
          key: arrForm.key || null,
          bpm: arrForm.bpm ? parseInt(arrForm.bpm) : null,
          meter: arrForm.meter || null,
          lyrics: arrForm.lyrics || null,
          sequence: [],
        }),
      });
      setArrangements((prev) => [...prev, data]);
      setActiveArrangement(data);
      setShowAddArrangement(false);
      setArrForm({ name: "", key: "", bpm: "", meter: "", lyrics: "" });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteArrangement(arrId: string) {
    if (!id) return;
    try {
      await apiFetch(`/arrangements/${arrId}`, { method: "DELETE" });
      setArrangements((prev) => prev.filter((a) => a.id !== arrId));
      if (activeArrangement?.id === arrId) setActiveArrangement(arrangements.find((a) => a.id !== arrId) || null);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteSong() {
    if (!id) return;
    try {
      await apiFetch(`/songs/${id}`, { method: "DELETE" });
      navigate("/app/songs");
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSaveLyrics() {
    if (!activeArrangement) return;
    setSaving(true);
    try {
      await apiFetch(`/arrangements/${activeArrangement.id}`, {
        method: "PUT",
        body: JSON.stringify({ lyrics: activeArrangement.lyrics }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!song) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Canción no encontrada</p>
        <Button variant="ghost" onClick={() => navigate("/app/songs")} className="mt-2">Volver a canciones</Button>
      </div>
    );
  }

  return (
    <div className="app-page space-y-4">
      {/* Header */}
      <div className="app-page-header overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate("/app/songs")} className="-ml-1 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card shadow-sm hover:bg-secondary">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="app-page-kicker">Canción</p>
            <h1 className="truncate text-xl font-semibold text-foreground">{song.title}</h1>
            {song.author && <p className="mt-0.5 truncate text-sm text-muted-foreground">por {song.author}</p>}
          </div>
          {getSongYoutubeUrl(song) && (
            <Button asChild variant="outline" size="sm" className="h-10 w-10 rounded-md p-0">
              <a href={getSongYoutubeUrl(song) || "#"} target="_blank" rel="noreferrer">
                <PlayCircle className="w-4 h-4" />
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-10 w-10 rounded-md text-red-500" onClick={() => setShowDeleteSong(true)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-4 pb-3">
          <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as Section)}>
            <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-md bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsTrigger value="info" className="shrink-0 rounded-sm text-xs">Info</TabsTrigger>
              <TabsTrigger value="arrangements" className="shrink-0 rounded-sm text-xs">Arreglos</TabsTrigger>
              <TabsTrigger value="lyrics" className="shrink-0 rounded-sm text-xs">Letras</TabsTrigger>
              <TabsTrigger value="preview" className="shrink-0 rounded-sm text-xs">Vista</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="space-y-4">

        {/* INFO TAB */}
        {activeSection === "info" && (
          <div className="space-y-4">
            <Card className="app-list-card">
              <CardContent className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label>Título</Label>
                  <Input value={infoForm.title} onChange={(e) => setInfoForm({ ...infoForm, title: e.target.value })} onBlur={() => saveField("title", infoForm.title)} />
                </div>
                <div className="space-y-2">
                  <Label>Autor</Label>
                  <Input value={infoForm.author} onChange={(e) => setInfoForm({ ...infoForm, author: e.target.value })} onBlur={() => saveField("author", infoForm.author)} placeholder="Ej. Tradicional, Bethel Music" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>CCLI #</Label>
                    <Input value={infoForm.ccliNumber} onChange={(e) => setInfoForm({ ...infoForm, ccliNumber: e.target.value })} onBlur={() => saveField("ccliNumber", infoForm.ccliNumber)} />
                  </div>
                  <div className="space-y-2">
                  <Label>Copyright</Label>
                    <Input value={infoForm.copyright} onChange={(e) => setInfoForm({ ...infoForm, copyright: e.target.value })} onBlur={() => saveField("copyright", infoForm.copyright)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Etiquetas</Label>
                  <Input value={infoForm.tags} onChange={(e) => setInfoForm({ ...infoForm, tags: e.target.value })} onBlur={() => saveField("tags", infoForm.tags)} placeholder="adoración, alabanza, coro" />
                </div>
                <div className="space-y-2">
                  <Label>Referencia bíblica</Label>
                  <Input value={infoForm.scriptureRef} onChange={(e) => setInfoForm({ ...infoForm, scriptureRef: e.target.value })} onBlur={() => saveField("scriptureRef", infoForm.scriptureRef)} placeholder="Ej. Salmo 23" />
                </div>
                <div className="space-y-2">
                  <Label>Link de YouTube</Label>
                  <Input
                    type="url"
                    value={infoForm.youtubeUrl}
                    onChange={(e) => setInfoForm({ ...infoForm, youtubeUrl: e.target.value })}
                    placeholder="https://youtube.com/watch?v=..."
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Tono</Label>
                    <Select value={infoForm.key} onValueChange={(v) => { setInfoForm({ ...infoForm, key: v }); saveField("key", v); }}>
                      <SelectTrigger><SelectValue placeholder="Tono" /></SelectTrigger>
                      <SelectContent>
                        {MUSICAL_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>BPM</Label>
                    <Input type="number" value={infoForm.bpm} onChange={(e) => setInfoForm({ ...infoForm, bpm: e.target.value })} onBlur={() => saveField("bpm", infoForm.bpm)} placeholder="120" />
                  </div>
                  <div className="space-y-2">
                    <Label>Compás</Label>
                    <Select value={infoForm.meter} onValueChange={(v) => { setInfoForm({ ...infoForm, meter: v }); saveField("meter", v); }}>
                      <SelectTrigger><SelectValue placeholder="Compás" /></SelectTrigger>
                      <SelectContent>
                        {COMMON_METERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notas para el equipo</Label>
                  <Textarea
                    value={infoForm.notes}
                    onChange={(e) => setInfoForm({ ...infoForm, notes: e.target.value })}
                    placeholder="Notas de arreglo, capo, intro, detalles de ensayo..."
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSaveInfo} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar detalles"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ARRANGEMENTS TAB */}
        {activeSection === "arrangements" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" className="rounded-md" onClick={() => setShowAddArrangement(true)}>
                <Plus className="w-4 h-4 mr-1" /> Agregar arreglo
              </Button>
            </div>

            {arrangements.length === 0 ? (
              <Card className="app-empty-state">
                <CardContent className="p-8 text-center">
                  <Music2 className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Todavía no hay arreglos. Agrega uno para comenzar.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {arrangements.map((arr) => (
                  <Card
                    key={arr.id}
                    className={`app-list-card cursor-pointer transition-all ${activeArrangement?.id === arr.id ? "border-primary ring-1 ring-primary" : ""}`}
                    onClick={() => setActiveArrangement(arr)}
                  >
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="app-icon-tile">
                        <Music2 className="w-5 h-5 text-primary shrink-0" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{arr.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[arr.key, arr.bpm ? `${arr.bpm} BPM` : null, arr.meter].filter(Boolean).join(" · ") || "Sin detalles"}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteArrangement(arr.id); }}
                        className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LYRICS TAB */}
        {activeSection === "lyrics" && (
          <div className="space-y-3">
            {activeArrangement ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{activeArrangement.name} — Letras</p>
                  <Button size="sm" variant="outline" className="rounded-md" onClick={handleSaveLyrics} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
                  </Button>
                </div>
                <Textarea
                  value={activeArrangement.lyrics || ""}
                  onChange={(e) => setActiveArrangement({ ...activeArrangement, lyrics: e.target.value })}
                  className="min-h-96 font-mono text-sm"
                  placeholder={`[Verso 1]\nLetra aquí...\n\n[Coro]\nLetra aquí...`}
                />
                <p className="text-xs text-muted-foreground">Usa líneas en blanco para separar slides. Encabezados en [corchetes].</p>
              </>
            ) : (
              <Card className="app-empty-state">
                <CardContent className="p-8 text-center">
                  <Music2 className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Selecciona un arreglo para editar letras, o crea uno primero.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* PREVIEW TAB */}
        {activeSection === "preview" && (
          <div className="space-y-3">
            {previewLyrics ? (
              <>
                <p className="text-sm font-medium text-muted-foreground">{activeArrangement?.name || "Canción principal"} — Hoja de acordes</p>
                <ChordProPreview
                  value={previewLyrics}
                  maxLines={120}
                  originalKey={activeArrangement?.key || song.key || inferChordProKey(previewLyrics)}
                  title={song.title}
                  artist={song.author}
                />
                <p className="text-xs text-muted-foreground">{splitSlides(previewLyrics).length} slides</p>
                <div className="space-y-3">
                  {splitSlides(previewLyrics).map((slide, i) => (
                    <PresentationSlide key={i} text={slide} />
                  ))}
                </div>
              </>
            ) : (
              <Card className="app-empty-state">
                <CardContent className="p-8 text-center">
                  <Play className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Agrega letras a un arreglo para previsualizar slides.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ADD ARRANGEMENT DIALOG */}
      <Dialog open={showAddArrangement} onOpenChange={setShowAddArrangement}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo arreglo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddArrangement} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={arrForm.name} onChange={(e) => setArrForm({ ...arrForm, name: e.target.value })} placeholder="Ej. Tono original, acústico" required />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Tono</Label>
                <Select value={arrForm.key} onValueChange={(v) => setArrForm({ ...arrForm, key: v })}>
                  <SelectTrigger><SelectValue placeholder="Tono" /></SelectTrigger>
                  <SelectContent>
                    {MUSICAL_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>BPM</Label>
                <Input type="number" value={arrForm.bpm} onChange={(e) => setArrForm({ ...arrForm, bpm: e.target.value })} placeholder="120" />
              </div>
              <div className="space-y-2">
                <Label>Compás</Label>
                <Select value={arrForm.meter} onValueChange={(v) => setArrForm({ ...arrForm, meter: v })}>
                  <SelectTrigger><SelectValue placeholder="Compás" /></SelectTrigger>
                  <SelectContent>
                    {COMMON_METERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Letras (opcional)</Label>
              <Textarea value={arrForm.lyrics} onChange={(e) => setArrForm({ ...arrForm, lyrics: e.target.value })} className="min-h-32 font-mono text-sm" placeholder="[Verso 1]&#10;Letra aquí..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddArrangement(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE SONG DIALOG */}
      <Dialog open={showDeleteSong} onOpenChange={setShowDeleteSong}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar canción</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">¿Seguro que quieres eliminar "{song.title}"? Esta acción no se puede deshacer.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteSong(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteSong}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
