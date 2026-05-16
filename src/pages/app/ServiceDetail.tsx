import { useRef, useState, useEffect, type DragEvent, type PointerEvent, type SyntheticEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Plus, Trash2, GripVertical, Check, X, Clock, Users, Music, ExternalLink, PlayCircle, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";
import { useToast } from "@/components/ui/use-toast";
import { ChordProPreview } from "@/components/ChordProPreview";
import {
  getPrimaryArrangement,
  getSongDisplayKey,
  getSongChordPro,
  getSongPlainNotes,
  getSongYoutubeUrl,
  isSongItemType,
  type SongArrangement,
  type SongLike,
} from "@/lib/songDisplay";

type ServiceItem = {
  id: string;
  title: string;
  type: string;
  position: number;
  duration: number | null;
  song: SongLike | null;
};

type Assignment = {
  id: string;
  userId: string;
  position: string;
  confirmed: boolean;
  responseStatus?: "pending" | "accepted" | "declined" | null;
  respondedAt?: string | null;
  user: { firstName: string | null; lastName: string | null; email: string } | null;
};

type Service = {
  id: string;
  title: string;
  date: string;
  type: string;
  status: string;
  notes: string | null;
  items: ServiceItem[];
  assignments: Assignment[];
};

type ServiceResponse = Service & {
  error?: string;
};

type SongOption = {
  id: string;
  title: string;
  author?: string | null;
  key?: string | null;
  bpm?: number | null;
  meter?: string | null;
  notes?: string | null;
  lyrics?: string | null;
  arrangements?: SongArrangement[] | null;
};

type UserOption = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

type Tab = "flow" | "team";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("es-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

const ITEM_TYPES = [
  { label: "Canción", value: "song" },
  { label: "Oración", value: "prayer" },
  { label: "Escritura", value: "scripture" },
  { label: "Anuncio", value: "announcement" },
  { label: "Video", value: "video" },
  { label: "Otro", value: "other" },
];

function formatItemType(type: string) {
  return ITEM_TYPES.find((item) => item.value === type.toLowerCase())?.label || type;
}

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("flow");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [expandedSongItems, setExpandedSongItems] = useState<Record<string, boolean>>({});
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const suppressNextCardClickRef = useRef(false);

  // Add item form
  const [itemTitle, setItemTitle] = useState("");
  const [itemType, setItemType] = useState("song");
  const [itemDuration, setItemDuration] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const [songResults, setSongResults] = useState<SongOption[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongOption | null>(null);

  // Assign form
  const [assignUserId, setAssignUserId] = useState("");
  const [assignPosition, setAssignPosition] = useState("");
  const [availableUsers, setAvailableUsers] = useState<UserOption[]>([]);

  const isAdmin = selectedChurch?.role === "ADMIN";
  const isPlanner = selectedChurch?.role === "PLANNER" || isAdmin;

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const data = await apiFetch<ServiceResponse>(`/services/${id}`);
        if (data.error) { navigate("/app/services"); return; }
        // Sort items by position
        const sorted = { ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) };
        setService(sorted);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, navigate]);

  useEffect(() => {
    apiFetch<{ id: string }>("/users/me")
      .then((user) => setCurrentUserId(user.id))
      .catch(() => setCurrentUserId(null));
  }, []);

  useEffect(() => {
    if (!showAssign) return;
    apiFetch<UserOption[]>("/users")
      .then((data) => {
        const existing = new Set(service?.assignments.map((assignment) => assignment.userId) || []);
        setAvailableUsers((Array.isArray(data) ? data : []).filter((user) => !existing.has(user.id)));
      })
      .catch(() => setAvailableUsers([]));
  }, [showAssign, service?.assignments]);

  useEffect(() => {
    if (isSongItemType(itemType) && songSearch.length >= 2) {
      const timeout = setTimeout(async () => {
        try {
          const data = await apiFetch<SongOption[]>(`/songs?q=${encodeURIComponent(songSearch)}&limit=20`);
          setSongResults(Array.isArray(data) ? data.slice(0, 5) : []);
        } catch { setSongResults([]); }
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [songSearch, itemType]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (isSongItemType(itemType) && !selectedSong) return;
    if (!isSongItemType(itemType) && !itemTitle.trim()) return;

    setSubmitting(true);
    try {
      const item = {
        serviceId: id,
        title: selectedSong ? selectedSong.title : itemTitle,
        type: itemType.toLowerCase(),
        duration: itemDuration ? parseInt(itemDuration) : null,
        songId: selectedSong?.id || null,
        position: service?.items.length || 0,
        details: {},
      };
      await apiFetch(`/service-items`, {
        method: "POST",
        body: JSON.stringify(item),
      });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService({ ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) });
      resetItemForm();
      setShowAddItem(false);
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  }

  async function handleDeleteItem(itemId: string) {
    if (!id) return;
    try {
      await apiFetch(`/service-items/${itemId}`, { method: "DELETE" });
      setService((prev) => prev ? { ...prev, items: prev.items.filter((i) => i.id !== itemId) } : prev);
    } catch (e) { console.error(e); }
  }

  async function moveItem(item: ServiceItem, direction: "up" | "down") {
    if (!service || !id) return;
    const idx = service.items.findIndex((i) => i.id === item.id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= service.items.length) return;

    const reordered = [...service.items];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    const withPositions = reordered.map((serviceItem, position) => ({ ...serviceItem, position }));

    setService({ ...service, items: withPositions });
    try {
      await apiFetch(`/service-items/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ items: withPositions.map(({ id, position }) => ({ id, position })) }),
      });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService({ ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) });
    } catch (e) {
      console.error(e);
      setService(service);
    }
  }

  async function reorderItem(draggedId: string, targetId: string) {
    if (!service || !id || draggedId === targetId) return;
    const fromIndex = service.items.findIndex((item) => item.id === draggedId);
    const toIndex = service.items.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...service.items];
    const [dragged] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, dragged);
    const withPositions = reordered.map((serviceItem, position) => ({ ...serviceItem, position }));

    setService({ ...service, items: withPositions });
    try {
      await apiFetch(`/service-items/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ items: withPositions.map(({ id, position }) => ({ id, position })) }),
      });
    } catch (e) {
      console.error(e);
      setService(service);
      toast({ title: e instanceof Error ? e.message : "No se pudo reordenar el servicio", variant: "destructive" });
    }
  }

  function handleDragStart(event: DragEvent, itemId: string) {
    event.dataTransfer.effectAllowed = "move";
    suppressNextCardClickRef.current = true;
    setDraggingItemId(itemId);
  }

  function handleDragOver(event: DragEvent, itemId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverItemId(itemId);
  }

  async function handleDrop(event: DragEvent, targetId: string) {
    event.preventDefault();
    if (draggingItemId) {
      await reorderItem(draggingItemId, targetId);
    }
    setDraggingItemId(null);
    setDragOverItemId(null);
  }

  function handleDragEnd() {
    setDraggingItemId(null);
    setDragOverItemId(null);
    window.setTimeout(() => {
      suppressNextCardClickRef.current = false;
    }, 0);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!draggingItemId) return;
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-service-item-id]");
    if (target?.dataset.serviceItemId) {
      setDragOverItemId(target.dataset.serviceItemId);
    }
  }

  async function handlePointerUp(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    suppressNextCardClickRef.current = true;
    if (draggingItemId && dragOverItemId) {
      await reorderItem(draggingItemId, dragOverItemId);
    }
    setDraggingItemId(null);
    setDragOverItemId(null);
    window.setTimeout(() => {
      suppressNextCardClickRef.current = false;
    }, 0);
  }

  async function handleMoveUp(item: ServiceItem) {
    await moveItem(item, "up");
  }

  async function handleMoveDown(item: ServiceItem) {
    await moveItem(item, "down");
  }

  async function handleAssignMember(e: React.FormEvent) {
    e.preventDefault();
    if (!assignUserId || !id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/service-assignments`, {
        method: "POST",
        body: JSON.stringify({ userId: assignUserId, serviceId: id, position: assignPosition || "Member" }),
      });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService(data);
      setShowAssign(false);
      setAssignUserId("");
      setAssignPosition("");
    } catch (e) {
      console.error(e);
      toast({
        title: e instanceof Error ? e.message : "No se pudo asignar el miembro",
        variant: "destructive",
      });
    }
    finally { setSubmitting(false); }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    if (!id) return;
    try {
      await apiFetch(`/service-assignments/${assignmentId}`, { method: "DELETE" });
      setService((prev) => prev ? { ...prev, assignments: prev.assignments.filter((a) => a.id !== assignmentId) } : prev);
    } catch (e) { console.error(e); }
  }

  async function handleConfirmAssignment(assignmentId: string, confirmed: boolean) {
    if (!id) return;
    try {
      await apiFetch(`/service-assignments/${assignmentId}`, {
        method: "PUT",
        body: JSON.stringify({ confirmed }),
      });
      setService((prev) => prev ? {
        ...prev,
        assignments: prev.assignments.map((a) => a.id === assignmentId ? { ...a, confirmed } : a),
      } : prev);
    } catch (e) { console.error(e); }
  }

  async function handleAssignmentResponse(assignmentId: string, action: "accept" | "decline") {
    setRespondingId(assignmentId);
    try {
      const result = await apiFetch<{ confirmed: boolean; responseStatus: "accepted" | "declined" }>(`/service-assignments/${assignmentId}/respond`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      setService((prev) => prev ? {
        ...prev,
        assignments: prev.assignments.map((assignment) =>
          assignment.id === assignmentId
            ? { ...assignment, confirmed: result.confirmed, responseStatus: result.responseStatus, respondedAt: new Date().toISOString() }
            : assignment
        ),
      } : prev);
    } catch (e) {
      console.error(e);
      toast({
        title: e instanceof Error ? e.message : "No se pudo responder la asignación",
        variant: "destructive",
      });
    } finally {
      setRespondingId(null);
    }
  }

  async function handleDeleteService() {
    if (!id) return;
    try {
      await apiFetch(`/services/${id}`, { method: "DELETE" });
      navigate("/app/services");
    } catch (e) { console.error(e); }
  }

  function resetItemForm() {
    setItemTitle("");
    setItemType("song");
    setItemDuration("");
    setSongSearch("");
    setSongResults([]);
    setSelectedSong(null);
  }

  function toggleSongItem(itemId: string) {
    setExpandedSongItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  function stopInteractiveTap(event: SyntheticEvent) {
    event.stopPropagation();
  }

  function getDisplayKey(item: ServiceItem) {
    if (!item.song) return null;
    return getSongDisplayKey(item.song);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Servicio no encontrado</p>
        <Button variant="ghost" onClick={() => navigate("/app/services")} className="mt-2">Volver</Button>
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-4">
      {/* Header */}
      <div className="app-card-soft overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate("/app/services")} className="-ml-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-zinc-50">
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-xl font-black tracking-tight text-zinc-950">{service.title}</h1>
            <p className="mt-0.5 truncate text-sm text-zinc-500">{formatDate(service.date)}</p>
          </div>
          {isAdmin && (
            <Button variant="ghost" size="sm" className="h-10 w-10 rounded-2xl text-red-500" onClick={handleDeleteService}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="px-4 pb-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-2xl bg-zinc-100/70 p-1">
              <TabsTrigger value="flow" className="text-xs flex items-center gap-1">
                <Music className="w-3 h-3" /> Flujo
              </TabsTrigger>
              <TabsTrigger value="team" className="text-xs flex items-center gap-1">
                <Users className="w-3 h-3" /> Equipo
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="space-y-4">

        {/* SERVICE INFO */}
        <Card className="app-card">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-medium">{service.type}</span>
              {service.notes && <span>· {service.notes}</span>}
            </div>
          </CardContent>
        </Card>

        {/* FLOW TAB */}
        {activeTab === "flow" && (
          <div className="space-y-3">
            {isPlanner && (
              <div className="flex justify-end">
                <Button size="sm" className="h-10 rounded-2xl" onClick={() => setShowAddItem(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Agregar
                </Button>
              </div>
            )}

            {service.items.length === 0 ? (
              <Card className="app-card">
                <CardContent className="p-8 text-center">
                  <Music className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">Todavía no hay elementos en este servicio.</p>
                  {isPlanner && (
                    <Button size="sm" variant="outline" onClick={() => setShowAddItem(true)} className="mt-3">
                      Agregar primero
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {service.items.map((item, idx) => (
                  <Card
                    key={item.id}
                    data-service-item-id={item.id}
                    className={`app-card overflow-hidden transition-all ${draggingItemId === item.id ? "opacity-50" : ""} ${
                      dragOverItemId === item.id && draggingItemId !== item.id ? "ring-2 ring-primary ring-offset-2" : ""
                    }`}
                    draggable
                    onDragStart={(event) => handleDragStart(event, item.id)}
                    onDragOver={(event) => handleDragOver(event, item.id)}
                    onDrop={(event) => handleDrop(event, item.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      if (suppressNextCardClickRef.current) return;
                      if (isSongItemType(item.type) && item.song) toggleSongItem(item.id);
                    }}
                  >
                    <CardContent className="p-0">
                      <div className="flex items-center gap-3 p-3">
                        <div className="flex flex-col gap-1 shrink-0">
                          {idx > 0 && (
                            <button onClick={(event) => { event.stopPropagation(); handleMoveUp(item); }} className="p-0.5 rounded hover:bg-zinc-100 text-zinc-400">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" /></svg>
                            </button>
                          )}
                          <GripVertical
                            className="w-4 h-4 cursor-grab touch-none text-zinc-300 active:cursor-grabbing"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              suppressNextCardClickRef.current = true;
                              setDraggingItemId(item.id);
                              setDragOverItemId(item.id);
                            }}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                          />
                          {idx < service.items.length - 1 && (
                            <button onClick={(event) => { event.stopPropagation(); handleMoveDown(item); }} className="p-0.5 rounded hover:bg-zinc-100 text-zinc-400">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" /></svg>
                            </button>
                          )}
                        </div>
                        <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                          {isSongItemType(item.type) ? <Music className="w-4 h-4 text-primary" /> : <Clock className="w-4 h-4 text-primary" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm text-zinc-950">{item.song?.title || item.title}</p>
                          <p className="text-xs text-zinc-500">
                            {formatItemType(item.type)}{item.duration ? ` · ${item.duration} min` : ""}
                            {item.song?.author ? ` · ${item.song.author}` : ""}
                          </p>
                        </div>
                        {getDisplayKey(item) && (
                          <Badge variant="secondary" className="shrink-0 rounded-full text-xs">Tono {getDisplayKey(item)}</Badge>
                        )}
                        {item.song && (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={(event) => { event.stopPropagation(); navigate(`/app/songs/${item.song?.id}`); }}>
                              <FileText className="w-3 h-3" />
                              Canción
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-xl"
                              aria-label={expandedSongItems[item.id] ? "Contraer detalles de canción" : "Expandir detalles de canción"}
                              onClick={(event) => { event.stopPropagation(); toggleSongItem(item.id); }}
                            >
                              {expandedSongItems[item.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </Button>
                          </div>
                        )}
                        {isPlanner && (
                          <button
                            onClick={(event) => { event.stopPropagation(); handleDeleteItem(item.id); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {isSongItemType(item.type) && item.song && expandedSongItems[item.id] && (
                          <div className="space-y-3 border-t border-zinc-100 bg-gradient-to-br from-white to-zinc-50/80 p-3" onClick={stopInteractiveTap} onPointerDown={stopInteractiveTap} onTouchStart={stopInteractiveTap}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {getDisplayKey(item) && (
                                  <Badge variant="secondary" className="rounded-full">Tono {getDisplayKey(item)}</Badge>
                                )}
                                {(getPrimaryArrangement(item.song)?.bpm || item.song.bpm) && (
                                  <Badge variant="secondary" className="rounded-full">{getPrimaryArrangement(item.song)?.bpm || item.song.bpm} BPM</Badge>
                                )}
                                {(getPrimaryArrangement(item.song)?.meter || item.song.meter) && (
                                  <Badge variant="secondary" className="rounded-full">{getPrimaryArrangement(item.song)?.meter || item.song.meter}</Badge>
                                )}
                                {item.song.arrangements?.length ? (
                                  <Badge variant="outline" className="rounded-full">{item.song.arrangements.length} arreglo{item.song.arrangements.length === 1 ? "" : "s"}</Badge>
                                ) : null}
                              </div>
                              {getSongPlainNotes(item.song) && (
                                <p className="text-xs leading-5 text-zinc-500">{getSongPlainNotes(item.song)}</p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              {getSongYoutubeUrl(item.song) && (
                                <Button asChild variant="outline" size="sm" className="rounded-xl">
                                  <a href={getSongYoutubeUrl(item.song) || "#"} target="_blank" rel="noreferrer">
                                    <PlayCircle className="w-3 h-3" />
                                    YouTube
                                  </a>
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="rounded-xl" onClick={(event) => { event.stopPropagation(); navigate(`/app/songs/${item.song?.id}`); }}>
                                <ExternalLink className="w-3 h-3" />
                                Ver acordes
                              </Button>
                            </div>
                          </div>

                          <ChordProPreview
                            value={getSongChordPro(item.song)}
                            originalKey={getDisplayKey(item)}
                            title={item.song.title}
                            artist={item.song.author}
                            maxLines={36}
                            emptyText="Esta canción todavía no tiene acordes guardados."
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TEAM TAB */}
        {activeTab === "team" && (
          <div className="space-y-3">
            {isPlanner && (
              <div className="flex justify-end">
                <Button size="sm" className="h-10 rounded-2xl" onClick={() => setShowAssign(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Asignar
                </Button>
              </div>
            )}

            {service.assignments.length === 0 ? (
              <Card className="app-card">
                <CardContent className="p-8 text-center">
                  <Users className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">Todavía no hay miembros asignados.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {service.assignments.map((a) => (
                  <Card key={a.id} className="app-card">
                    <CardContent className="flex items-center gap-3 p-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(a.user?.firstName, a.user?.lastName, a.user?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {a.user?.firstName} {a.user?.lastName}
                        </p>
                        <p className="text-xs text-zinc-500">{a.position}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {(a.responseStatus === "accepted" || (!a.responseStatus && a.confirmed)) ? (
                          <Badge variant="default" className="text-xs bg-emerald-100 text-emerald-700">Confirmado</Badge>
                        ) : a.responseStatus === "declined" ? (
                          <Badge variant="secondary" className="text-xs bg-red-50 text-red-700">Declinado</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Pendiente</Badge>
                        )}
                        {a.userId === currentUserId && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-red-500 hover:bg-red-50 hover:text-red-600"
                              disabled={respondingId === a.id}
                              onClick={() => handleAssignmentResponse(a.id, "decline")}
                            >
                              <X className="w-3 h-3" />
                              Rechazar
                            </Button>
                            <Button
                              size="sm"
                              className="h-8"
                              disabled={respondingId === a.id}
                              onClick={() => handleAssignmentResponse(a.id, "accept")}
                            >
                              <Check className="w-3 h-3" />
                              Aceptar
                            </Button>
                          </div>
                        )}
                        {isPlanner && (
                          <button
                            onClick={() => handleRemoveAssignment(a.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ADD ITEM DIALOG */}
      <Dialog open={showAddItem} onOpenChange={(open) => { setShowAddItem(open); if (!open) resetItemForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar elemento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddItem} className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isSongItemType(itemType) ? (
              <div className="space-y-2">
                <Label>Canción</Label>
                <Input
                  value={songSearch}
                  onChange={(e) => { setSongSearch(e.target.value); setSelectedSong(null); }}
                  placeholder="Buscar canciones..."
                />
                {songResults.length > 0 && !selectedSong && (
                  <div className="border rounded-lg overflow-hidden">
                    {songResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 border-b last:border-b-0"
                        onClick={() => { setSelectedSong(s); setItemTitle(s.title); setSongSearch(s.title); setSongResults([]); }}
                      >
                        <p className="font-medium">{s.title}</p>
                        {s.author && <p className="text-xs text-zinc-500">{s.author}</p>}
                        <p className="text-xs text-zinc-400">
                          {[s.key, s.bpm ? `${s.bpm} BPM` : null].filter(Boolean).join(" · ") || "Biblioteca de canciones"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Título</Label>
                <Input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="Título del elemento" required />
              </div>
            )}
            <div className="space-y-2">
              <Label>Duración (minutos)</Label>
              <Input type="number" value={itemDuration} onChange={(e) => setItemDuration(e.target.value)} placeholder="5" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddItem(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting || (isSongItemType(itemType) ? !selectedSong : !itemTitle.trim())}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Agregar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ASSIGN MEMBER DIALOG */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar miembro</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAssignMember} className="space-y-4">
            <div className="space-y-2">
              <Label>Miembro</Label>
              <select
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              >
                <option value="">Elige un miembro</option>
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}
                    {user.email ? ` (${user.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Posición</Label>
              <Input value={assignPosition} onChange={(e) => setAssignPosition(e.target.value)} placeholder="Ej. Voz, guitarra, director de alabanza" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAssign(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Asignar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
