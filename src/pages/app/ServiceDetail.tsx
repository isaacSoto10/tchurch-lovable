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
import { Loader2, ArrowLeft, Plus, Trash2, GripVertical, Check, X, Clock, Users, Music, ExternalLink, PlayCircle, FileText, ChevronDown, ChevronUp, FileDown } from "lucide-react";
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
import { normalizeKey, transposeChordPro } from "@/lib/musicUtils";
import { getYoutubeEmbedUrl } from "@/lib/youtube";
import { canUseServicePresentation } from "@/lib/servicePresentation";

type ServiceItem = {
  id: string;
  title: string;
  type: string;
  position: number;
  duration: number | null;
  details?: Record<string, unknown> | null;
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

type Tab = "flow" | "team" | "rehearse";

type PlanningNoteKey = "vocals" | "band" | "audioVisual" | "person";

type PlanningDetails = {
  timing?: string;
  serviceKey?: string;
  selectedKey?: string;
  key?: string;
  notes?: Partial<Record<PlanningNoteKey, string>>;
  [key: string]: unknown;
};

const NOTE_LABELS: Record<PlanningNoteKey, string> = {
  vocals: "Voces",
  band: "Banda",
  audioVisual: "Audio / Visual",
  person: "Persona",
};

const TIMING_LABELS: Record<string, string> = {
  pre_service: "Antes del servicio",
  during: "Durante el servicio",
  post_service: "Después del servicio",
};

const TEAM_MATRIX_GROUPS = [
  { title: "Liderazgo", positions: ["Preacher", "Service Director", "Worship Leader"] },
  { title: "Banda", positions: ["Vocals", "Acoustic Guitar", "Electric Guitar", "Bass", "Keys", "Drums"] },
  { title: "Audio / Visual", positions: ["Sound Tech", "Visuals Tech", "Camera", "Lyrics"] },
] as const;

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

function getPlanningDetails(item: ServiceItem): PlanningDetails {
  return (item.details || {}) as PlanningDetails;
}

function getItemTimingLabel(item: ServiceItem) {
  const timing = getPlanningDetails(item).timing;
  return typeof timing === "string" ? TIMING_LABELS[timing] || "Durante el servicio" : "Durante el servicio";
}

function getPlanningNotes(item: ServiceItem) {
  return getPlanningDetails(item).notes || {};
}

function hasPlanningNotes(item: ServiceItem) {
  const notes = getPlanningNotes(item);
  return (Object.keys(NOTE_LABELS) as PlanningNoteKey[]).some((key) => Boolean(notes[key]?.trim()));
}

function getPersonName(user: Assignment["user"]) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Sin nombre";
}

function getPositionAssignments(assignments: Assignment[], position: string) {
  const normalizedPosition = position.toLowerCase();
  return assignments.filter((assignment) => {
    const normalizedAssignment = assignment.position.toLowerCase();
    return normalizedAssignment === normalizedPosition || normalizedAssignment.includes(normalizedPosition);
  });
}

function getAssignmentStatusLabel(assignment: Assignment) {
  if (assignment.responseStatus === "accepted" || (!assignment.responseStatus && assignment.confirmed)) return "Aceptada";
  if (assignment.responseStatus === "declined") return "Declinada";
  return "Pendiente";
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
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [expandedSongItems, setExpandedSongItems] = useState<Record<string, boolean>>({});
  const [detailsEditingId, setDetailsEditingId] = useState<string | null>(null);
  const [detailDuration, setDetailDuration] = useState("");
  const [detailTiming, setDetailTiming] = useState("during");
  const [detailNotes, setDetailNotes] = useState<Record<PlanningNoteKey, string>>({
    vocals: "",
    band: "",
    audioVisual: "",
    person: "",
  });
  const [savingDetails, setSavingDetails] = useState(false);
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
  const selectedUserAssignments = assignUserId && service
    ? service.assignments.filter((assignment) => assignment.userId === assignUserId)
    : [];

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
    apiFetch<{ id: string; email?: string | null }>("/users/me")
      .then((user) => {
        setCurrentUserId(user.id);
        setCurrentUserEmail(user.email?.trim().toLowerCase() || null);
      })
      .catch(() => {
        setCurrentUserId(null);
        setCurrentUserEmail(null);
      });
  }, []);

  useEffect(() => {
    if (!showAssign) return;
    apiFetch<UserOption[]>("/users")
      .then((data) => {
        setAvailableUsers(Array.isArray(data) ? data : []);
      })
      .catch(() => setAvailableUsers([]));
  }, [showAssign]);

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

  function startItemDetails(item: ServiceItem) {
    const details = getPlanningDetails(item);
    const notes = details.notes || {};

    if (detailsEditingId === item.id) {
      setDetailsEditingId(null);
      return;
    }

    setDetailsEditingId(item.id);
    setDetailDuration(item.duration ? String(item.duration) : "");
    setDetailTiming(typeof details.timing === "string" ? details.timing : "during");
    setDetailNotes({
      vocals: notes.vocals || "",
      band: notes.band || "",
      audioVisual: notes.audioVisual || "",
      person: notes.person || "",
    });
  }

  async function saveItemDetails(item: ServiceItem) {
    const duration = detailDuration ? Number(detailDuration) : null;
    const nextDetails: PlanningDetails = {
      ...(item.details || {}),
      timing: detailTiming,
      notes: {
        vocals: detailNotes.vocals.trim(),
        band: detailNotes.band.trim(),
        audioVisual: detailNotes.audioVisual.trim(),
        person: detailNotes.person.trim(),
      },
    };

    setSavingDetails(true);
    try {
      await apiFetch(`/service-items/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ duration, details: nextDetails }),
      });

      setService((prev) => prev ? {
        ...prev,
        items: prev.items.map((serviceItem) =>
          serviceItem.id === item.id ? { ...serviceItem, duration, details: nextDetails } : serviceItem
        ),
      } : prev);
      setDetailsEditingId(null);
      toast({ title: "Detalles guardados" });
    } catch (error) {
      console.error("No se pudieron guardar los detalles:", error);
      toast({ title: "No se pudieron guardar los detalles", variant: "destructive" });
    } finally {
      setSavingDetails(false);
    }
  }

  function stopInteractiveTap(event: SyntheticEvent) {
    event.stopPropagation();
  }

  function getItemSavedKey(item: ServiceItem) {
    const details = item.details || {};
    const key =
      typeof details.serviceKey === "string" ? details.serviceKey :
      typeof details.selectedKey === "string" ? details.selectedKey :
      typeof details.key === "string" ? details.key :
      null;

    return normalizeKey(key);
  }

  function getOriginalKey(item: ServiceItem) {
    if (!item.song) return null;
    return getSongDisplayKey(item.song);
  }

  function getDisplayKey(item: ServiceItem) {
    if (!item.song) return null;
    return getItemSavedKey(item) || getOriginalKey(item);
  }

  function getDisplayChordPro(item: ServiceItem) {
    const chordPro = getSongChordPro(item.song);
    const originalKey = normalizeKey(getOriginalKey(item));
    const selectedKey = normalizeKey(getDisplayKey(item));

    if (!chordPro || !originalKey || !selectedKey || originalKey === selectedKey) {
      return chordPro;
    }

    return transposeChordPro(chordPro, originalKey, selectedKey);
  }

  async function handleSaveItemKey(item: ServiceItem, key: string) {
    const nextDetails = { ...(item.details || {}), serviceKey: key };
    setService((prev) => prev ? {
      ...prev,
      items: prev.items.map((serviceItem) =>
        serviceItem.id === item.id ? { ...serviceItem, details: nextDetails } : serviceItem
      ),
    } : prev);

    try {
      await apiFetch(`/service-items/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ details: nextDetails }),
      });
    } catch (error) {
      console.error("No se pudo guardar el tono del servicio:", error);
      toast({ title: "No se pudo guardar el tono", variant: "destructive" });
    }
  }

  async function handleGenerateServicePdf() {
    if (!service) return;
    const songItems = service.items
      .filter((item) => isSongItemType(item.type) && item.song && getDisplayChordPro(item))
      .map((item) => ({
        title: item.song?.title || item.title,
        artist: item.song?.author,
        key: getDisplayKey(item),
        chordPro: getDisplayChordPro(item) || "",
      }));

    if (songItems.length === 0) {
      toast({ title: "Este servicio no tiene canciones con acordes.", variant: "destructive" });
      return;
    }

    try {
      const { generateServiceChordChartsPdf } = await import("@/lib/chordChartPdf");
      await generateServiceChordChartsPdf({
        serviceTitle: service.title,
        serviceDate: service.date,
        items: songItems,
      });
    } catch (error) {
      console.error("No se pudo crear el PDF del servicio:", error);
      toast({ title: "No se pudo crear el PDF del servicio", variant: "destructive" });
    }
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

  const canPresentService = canUseServicePresentation(service, selectedChurch?.role, currentUserId, currentUserEmail);

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
          {canPresentService && (
            <Button
              variant="default"
              size="sm"
              className="h-10 rounded-2xl px-3"
              onClick={() => navigate(`/app/services/${service.id}/presentation`)}
            >
              <PlayCircle className="w-4 h-4" />
              Presentar
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-10 rounded-2xl px-3" onClick={handleGenerateServicePdf}>
            <FileDown className="w-4 h-4" />
            PDF
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="sm" className="h-10 w-10 rounded-2xl text-red-500" onClick={handleDeleteService}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="px-4 pb-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
            <TabsList className="grid h-11 w-full grid-cols-3 rounded-2xl bg-zinc-100/70 p-1">
              <TabsTrigger value="flow" className="text-xs flex items-center gap-1">
                <Music className="w-3 h-3" /> Flujo
              </TabsTrigger>
              <TabsTrigger value="team" className="text-xs flex items-center gap-1">
                <Users className="w-3 h-3" /> Equipo
              </TabsTrigger>
              <TabsTrigger value="rehearse" className="text-xs flex items-center gap-1">
                <PlayCircle className="w-3 h-3" /> Ensayo
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
                        <Badge variant="outline" className="hidden shrink-0 rounded-full text-xs sm:inline-flex">
                          {getItemTimingLabel(item)}
                        </Badge>
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
                          <Button
                            type="button"
                            variant={detailsEditingId === item.id ? "default" : "outline"}
                            size="sm"
                            className="h-9 rounded-xl px-2 text-xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              startItemDetails(item);
                            }}
                          >
                            Detalles
                          </Button>
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

                      {detailsEditingId === item.id && (
                        <div
                          className="space-y-3 border-t border-zinc-100 bg-white p-3"
                          onClick={stopInteractiveTap}
                          onPointerDown={stopInteractiveTap}
                          onTouchStart={stopInteractiveTap}
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Duración</Label>
                              <Input
                                type="number"
                                min="0"
                                placeholder="5"
                                value={detailDuration}
                                onChange={(event) => setDetailDuration(event.target.value)}
                                className="h-11 rounded-2xl"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Momento</Label>
                              <Select value={detailTiming} onValueChange={setDetailTiming}>
                                <SelectTrigger className="h-11 rounded-2xl">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pre_service">Antes del servicio</SelectItem>
                                  <SelectItem value="during">Durante el servicio</SelectItem>
                                  <SelectItem value="post_service">Después del servicio</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="grid gap-3">
                            {(Object.keys(NOTE_LABELS) as PlanningNoteKey[]).map((key) => (
                              <div key={key} className="space-y-1.5">
                                <Label className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{NOTE_LABELS[key]}</Label>
                                <Textarea
                                  value={detailNotes[key]}
                                  onChange={(event) => setDetailNotes((current) => ({ ...current, [key]: event.target.value }))}
                                  placeholder={`Notas para ${NOTE_LABELS[key].toLowerCase()}...`}
                                  rows={2}
                                  className="rounded-2xl"
                                />
                              </div>
                            ))}
                          </div>

                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setDetailsEditingId(null)}>
                              Cancelar
                            </Button>
                            <Button type="button" size="sm" className="rounded-xl" onClick={() => saveItemDetails(item)} disabled={savingDetails}>
                              {savingDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar detalles"}
                            </Button>
                          </div>
                        </div>
                      )}

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

                          <div className="grid gap-2 rounded-2xl border border-zinc-100 bg-white p-3">
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="rounded-full">{getItemTimingLabel(item)}</Badge>
                              {getPrimaryArrangement(item.song)?.sequence && (
                                <Badge variant="outline" className="rounded-full">Secuencia lista</Badge>
                              )}
                              {hasPlanningNotes(item) && (
                                <Badge variant="outline" className="rounded-full">Notas de equipo</Badge>
                              )}
                            </div>
                            {getPrimaryArrangement(item.song)?.sequence && (
                              <div className="rounded-xl bg-zinc-50 p-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">Secuencia</p>
                                <p className="mt-1 text-sm text-zinc-800">{getPrimaryArrangement(item.song)?.sequence}</p>
                              </div>
                            )}
                            {hasPlanningNotes(item) && (
                              <div className="grid gap-2">
                                {(Object.keys(NOTE_LABELS) as PlanningNoteKey[]).map((key) => {
                                  const note = getPlanningNotes(item)[key];
                                  if (!note?.trim()) return null;
                                  return (
                                    <div key={key} className="rounded-xl bg-zinc-50 p-3">
                                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">{NOTE_LABELS[key]}</p>
                                      <p className="mt-1 text-sm leading-5 text-zinc-600">{note}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {getYoutubeEmbedUrl(getSongYoutubeUrl(item.song)) && (
                            <div className="overflow-hidden rounded-2xl border border-red-100 bg-black shadow-sm">
                              <iframe
                                title={`YouTube - ${item.song.title}`}
                                src={getYoutubeEmbedUrl(getSongYoutubeUrl(item.song)) || undefined}
                                className="aspect-video w-full"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                referrerPolicy="strict-origin-when-cross-origin"
                                allowFullScreen
                              />
                            </div>
                          )}

                          <ChordProPreview
                            value={getSongChordPro(item.song)}
                            originalKey={getOriginalKey(item)}
                            selectedKey={getDisplayKey(item)}
                            onSelectedKeyChange={(key) => handleSaveItemKey(item, key)}
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

            <Card className="app-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Matriz de equipo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {TEAM_MATRIX_GROUPS.map((group) => (
                  <div key={group.title} className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{group.title}</p>
                    {group.positions.map((position) => {
                      const assigned = getPositionAssignments(service.assignments, position);
                      return (
                        <div key={position} className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-3 py-2">
                          <span className="text-sm font-semibold text-zinc-900">{position}</span>
                          {assigned.length ? (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {assigned.map((assignment) => (
                                <Badge key={assignment.id} variant="secondary" className="rounded-full">
                                  {getPersonName(assignment.user)} · {getAssignmentStatusLabel(assignment)}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <Badge variant="outline" className="rounded-full">Se necesita</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </CardContent>
            </Card>

            {service.assignments.length === 0 ? (
              <Card className="app-card">
                <CardContent className="p-8 text-center">
                  <Users className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">Todavía no hay miembros asignados.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {service.assignments.map((a) => {
                  const assignmentEmail = a.user?.email?.trim().toLowerCase() || null;
                  const isCurrentUserAssigned = a.userId === currentUserId || Boolean(currentUserEmail && assignmentEmail === currentUserEmail);

                  return (
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
                        {isCurrentUserAssigned && (
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
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* REHEARSE TAB */}
        {activeTab === "rehearse" && (
          <div className="space-y-3">
            <Card className="app-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Centro de ensayo</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-zinc-500">
                  Tonos, secuencias, notas y medios en un solo lugar para que el equipo pueda prepararse sin buscar mensajes.
                </p>
              </CardContent>
            </Card>

            {service.items.filter((item) => isSongItemType(item.type) && item.song).length === 0 ? (
              <Card className="app-card">
                <CardContent className="p-8 text-center">
                  <Music className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">Todavía no hay canciones para ensayar.</p>
                </CardContent>
              </Card>
            ) : (
              service.items
                .filter((item) => isSongItemType(item.type) && item.song)
                .map((item, index) => (
                  <Card key={item.id} className="app-card overflow-hidden">
                    <CardHeader className="border-b border-zinc-100 bg-gradient-to-br from-white to-zinc-50/80 pb-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-sm font-black text-primary">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <CardTitle className="truncate text-base">{item.song?.title || item.title}</CardTitle>
                          <p className="mt-0.5 truncate text-sm text-zinc-500">{item.song?.author || formatItemType(item.type)}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {getDisplayKey(item) && <Badge variant="secondary" className="rounded-full">Tono {getDisplayKey(item)}</Badge>}
                            {(getPrimaryArrangement(item.song!)?.bpm || item.song?.bpm) && (
                              <Badge variant="secondary" className="rounded-full">{getPrimaryArrangement(item.song!)?.bpm || item.song?.bpm} BPM</Badge>
                            )}
                            {(getPrimaryArrangement(item.song!)?.meter || item.song?.meter) && (
                              <Badge variant="secondary" className="rounded-full">{getPrimaryArrangement(item.song!)?.meter || item.song?.meter}</Badge>
                            )}
                            <Badge variant="outline" className="rounded-full">{getItemTimingLabel(item)}</Badge>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 p-3">
                      <div className="rounded-2xl bg-zinc-50 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Secuencia</p>
                        <p className="mt-1 text-sm text-zinc-800">{getPrimaryArrangement(item.song!)?.sequence || "Aún no hay secuencia guardada."}</p>
                      </div>

                      {hasPlanningNotes(item) && (
                        <div className="grid gap-2">
                          {(Object.keys(NOTE_LABELS) as PlanningNoteKey[]).map((key) => {
                            const note = getPlanningNotes(item)[key];
                            if (!note?.trim()) return null;
                            return (
                              <div key={key} className="rounded-2xl border border-zinc-100 bg-white p-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">{NOTE_LABELS[key]}</p>
                                <p className="mt-1 text-sm leading-5 text-zinc-600">{note}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {getYoutubeEmbedUrl(getSongYoutubeUrl(item.song!)) && (
                        <div className="overflow-hidden rounded-2xl border border-red-100 bg-black shadow-sm">
                          <iframe
                            title={`YouTube - ${item.song?.title || item.title}`}
                            src={getYoutubeEmbedUrl(getSongYoutubeUrl(item.song!)) || undefined}
                            className="aspect-video w-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            referrerPolicy="strict-origin-when-cross-origin"
                            allowFullScreen
                          />
                        </div>
                      )}

                      <ChordProPreview
                        value={getSongChordPro(item.song)}
                        originalKey={getOriginalKey(item)}
                        selectedKey={getDisplayKey(item)}
                        onSelectedKeyChange={(key) => handleSaveItemKey(item, key)}
                        title={item.song?.title || item.title}
                        artist={item.song?.author}
                        maxLines={28}
                        emptyText="Esta canción todavía no tiene acordes guardados."
                      />
                    </CardContent>
                  </Card>
                ))
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
                  </option>
                ))}
              </select>
              {selectedUserAssignments.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  Este miembro ya está asignado como {selectedUserAssignments.map((assignment) => assignment.position).join(", ")}.
                  Puedes asignarlo otra vez si también servirá en esta posición.
                </div>
              )}
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
