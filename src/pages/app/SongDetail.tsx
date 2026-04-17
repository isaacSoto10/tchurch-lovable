import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowLeft, Plus, Trash2, Music2, Play } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";

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
  sequence: any[];
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
  const { selectedChurch } = useChurch();

  const [song, setSong] = useState<Song | null>(null);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>("info");
  const [activeArrangement, setActiveArrangement] = useState<Arrangement | null>(null);
  const [showAddArrangement, setShowAddArrangement] = useState(false);
  const [showDeleteSong, setShowDeleteSong] = useState(false);

  // Info form
  const [infoForm, setInfoForm] = useState({
    title: "", author: "", ccliNumber: "", copyright: "", tags: "", scriptureRef: "", key: "", bpm: "", meter: "",
  });

  // Arrangement form
  const [arrForm, setArrForm] = useState({ name: "", key: "", bpm: "", meter: "", lyrics: "" });
  const [saving, setSaving] = useState(false);

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
  }, [id]);

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
        <p className="text-muted-foreground">Song not found</p>
        <Button variant="ghost" onClick={() => navigate("/app/songs")} className="mt-2">Back to Songs</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/app/songs")} className="p-2 -ml-2 rounded-lg hover:bg-zinc-100">
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-zinc-900 truncate">{song.title}</h1>
            {song.author && <p className="text-xs text-zinc-500 truncate">by {song.author}</p>}
          </div>
          <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setShowDeleteSong(true)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-4 pb-3">
          <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as Section)}>
            <TabsList className="w-full grid grid-cols-4 h-9 bg-zinc-100/60 p-1 rounded-lg">
              <TabsTrigger value="info" className="text-xs">Info</TabsTrigger>
              <TabsTrigger value="arrangements" className="text-xs">Arrangements</TabsTrigger>
              <TabsTrigger value="lyrics" className="text-xs">Lyrics</TabsTrigger>
              <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* INFO TAB */}
        {activeSection === "info" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={infoForm.title} onChange={(e) => setInfoForm({ ...infoForm, title: e.target.value })} onBlur={() => saveField("title", infoForm.title)} />
                </div>
                <div className="space-y-2">
                  <Label>Author</Label>
                  <Input value={infoForm.author} onChange={(e) => setInfoForm({ ...infoForm, author: e.target.value })} onBlur={() => saveField("author", infoForm.author)} placeholder="e.g. Traditional, John Doe" />
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
                  <Label>Tags</Label>
                  <Input value={infoForm.tags} onChange={(e) => setInfoForm({ ...infoForm, tags: e.target.value })} onBlur={() => saveField("tags", infoForm.tags)} placeholder="worship, praise, chorus" />
                </div>
                <div className="space-y-2">
                  <Label>Scripture Reference</Label>
                  <Input value={infoForm.scriptureRef} onChange={(e) => setInfoForm({ ...infoForm, scriptureRef: e.target.value })} onBlur={() => saveField("scriptureRef", infoForm.scriptureRef)} placeholder="e.g. Psalm 23" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Key</Label>
                    <Select value={infoForm.key} onValueChange={(v) => { setInfoForm({ ...infoForm, key: v }); saveField("key", v); }}>
                      <SelectTrigger><SelectValue placeholder="Select key" /></SelectTrigger>
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
                    <Label>Meter</Label>
                    <Select value={infoForm.meter} onValueChange={(v) => { setInfoForm({ ...infoForm, meter: v }); saveField("meter", v); }}>
                      <SelectTrigger><SelectValue placeholder="Meter" /></SelectTrigger>
                      <SelectContent>
                        {COMMON_METERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ARRANGEMENTS TAB */}
        {activeSection === "arrangements" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowAddArrangement(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add Arrangement
              </Button>
            </div>

            {arrangements.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Music2 className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">No arrangements yet. Add one to get started.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {arrangements.map((arr) => (
                  <Card
                    key={arr.id}
                    className={`cursor-pointer transition-all ${activeArrangement?.id === arr.id ? "border-primary ring-1 ring-primary" : ""}`}
                    onClick={() => setActiveArrangement(arr)}
                  >
                    <CardContent className="p-4 flex items-center gap-3">
                      <Music2 className="w-5 h-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{arr.name}</p>
                        <p className="text-xs text-zinc-500">
                          {[arr.key, arr.bpm ? `${arr.bpm} BPM` : null, arr.meter].filter(Boolean).join(" · ") || "No details"}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteArrangement(arr.id); }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
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
                  <p className="text-sm font-medium text-zinc-600">{activeArrangement.name} — Lyrics</p>
                  <Button size="sm" variant="outline" onClick={handleSaveLyrics} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <Textarea
                  value={activeArrangement.lyrics || ""}
                  onChange={(e) => setActiveArrangement({ ...activeArrangement, lyrics: e.target.value })}
                  className="min-h-96 font-mono text-sm"
                  placeholder={`[Verse 1]\nLyrics here...\n\n[Chorus]\nLyrics here...`}
                />
                <p className="text-xs text-zinc-400">Use blank lines to separate slides. Section headers in [brackets].</p>
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Music2 className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">Select an arrangement to edit lyrics, or create one first.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* PREVIEW TAB */}
        {activeSection === "preview" && (
          <div className="space-y-3">
            {activeArrangement?.lyrics ? (
              <>
                <p className="text-sm font-medium text-zinc-600">{activeArrangement.name} — Presentation</p>
                <p className="text-xs text-zinc-400">{splitSlides(activeArrangement.lyrics).length} slides</p>
                <div className="space-y-3">
                  {splitSlides(activeArrangement.lyrics).map((slide, i) => (
                    <PresentationSlide key={i} text={slide} />
                  ))}
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Play className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">Add lyrics to an arrangement to preview slides.</p>
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
            <DialogTitle>New Arrangement</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddArrangement} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={arrForm.name} onChange={(e) => setArrForm({ ...arrForm, name: e.target.value })} placeholder="e.g. Original Key, Acoustic" required />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Key</Label>
                <Select value={arrForm.key} onValueChange={(v) => setArrForm({ ...arrForm, key: v })}>
                  <SelectTrigger><SelectValue placeholder="Key" /></SelectTrigger>
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
                <Label>Meter</Label>
                <Select value={arrForm.meter} onValueChange={(v) => setArrForm({ ...arrForm, meter: v })}>
                  <SelectTrigger><SelectValue placeholder="Meter" /></SelectTrigger>
                  <SelectContent>
                    {COMMON_METERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Lyrics (optional)</Label>
              <Textarea value={arrForm.lyrics} onChange={(e) => setArrForm({ ...arrForm, lyrics: e.target.value })} className="min-h-32 font-mono text-sm" placeholder="[Verse 1]&#10;Lyrics here..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddArrangement(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE SONG DIALOG */}
      <Dialog open={showDeleteSong} onOpenChange={setShowDeleteSong}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Song</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete "{song.title}"? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteSong(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSong}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
