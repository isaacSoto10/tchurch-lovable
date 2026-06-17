import { useCallback, useMemo, useRef, useState, useEffect, type DragEvent, type PointerEvent, type SyntheticEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Plus, Trash2, GripVertical, Check, X, Clock, Users, Music, ChevronDown, ChevronUp, FileDown, Maximize2, PlayCircle, Pencil, Search, Link2 } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";
import { useToast } from "@/components/ui/use-toast";
import { ChordProPreview } from "@/components/ChordProPreview";
import { ServiceSongPicker } from "@/components/ServiceSongPicker";
import {
  filterExistingSongRecommendations,
  getExistingServiceSongIds,
  normalizeSongRecommendationResponse,
} from "@/lib/songRecommendations";
import {
  getSongDisplayKey,
  getSongChordPro,
  getSongYoutubeUrl,
  getPrimaryArrangement,
  isSongItemType,
  type SongArrangement,
  type SongLike,
} from "@/lib/songDisplay";
import { normalizeKey, transposeChordPro } from "@/lib/musicUtils";
import { canUseServicePresentation } from "@/lib/servicePresentation";
import { formatServiceDate } from "@/lib/serviceDates";
import { sortSongsByLastUsedDesc } from "@/lib/songUsage";
import {
  buildSongNotesWithYoutubeUrl,
  getSongYoutubeDraft,
  normalizeYouTubeUrlInput,
  updateSongYoutubeUrlInServiceItems,
} from "@/lib/songYoutube";
import {
  assignmentNeedsResponse,
  DEFAULT_SERVICE_POSITION_GROUPS,
  getAssignmentPositionOptions,
  getAssignmentResponseStatus,
  getCustomAssignmentPositions,
  servicePositionsMatch,
} from "@/lib/serviceAssignments";

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
  lastUsedAt?: string | null;
  arrangements?: SongArrangement[] | null;
};

type LacuerdaCandidate = {
  id: string;
  title: string;
  artist: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  score?: number | null;
  ref: unknown;
};

type LacuerdaArrangementResponse = {
  arrangement?: SongArrangement | null;
  candidates?: LacuerdaCandidate[];
  error?: string;
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

function getVocalNote(item: ServiceItem) {
  return getPlanningNotes(item).vocals?.trim() || "";
}

function hasPlanningNotes(item: ServiceItem) {
  const notes = getPlanningNotes(item);
  return (Object.keys(NOTE_LABELS) as PlanningNoteKey[]).some((key) => Boolean(notes[key]?.trim()));
}

function getPlanningNoteEntries(item: ServiceItem) {
  const notes = getPlanningNotes(item);
  return (Object.keys(NOTE_LABELS) as PlanningNoteKey[])
    .map((key) => ({ key, label: NOTE_LABELS[key], note: notes[key]?.trim() || "" }))
    .filter((entry) => entry.note);
}

function getPersonName(user: Assignment["user"]) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Sin nombre";
}

function getPositionAssignments(assignments: Assignment[], position: string) {
  return assignments.filter((assignment) => servicePositionsMatch(assignment.position, position));
}

function getAssignmentStatusLabel(assignment: Assignment) {
  const status = getAssignmentResponseStatus(assignment);
  if (status === "accepted") return "Aceptada";
  if (status === "declined") return "Declinada";
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
  const [chartItemId, setChartItemId] = useState<string | null>(null);
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
  const chartItem = service?.items.find((item) => item.id === chartItemId) || null;
  const [youtubeEditingItemId, setYoutubeEditingItemId] = useState<string | null>(null);
  const [youtubeDraft, setYoutubeDraft] = useState("");
  const [savingYoutube, setSavingYoutube] = useState(false);
  const youtubeEditingItem = service?.items.find((item) => item.id === youtubeEditingItemId) || null;

  // Add item form
  const [itemTitle, setItemTitle] = useState("");
  const [itemType, setItemType] = useState("song");
  const [itemDuration, setItemDuration] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const [songResults, setSongResults] = useState<SongOption[]>([]);
  const [selectedSongs, setSelectedSongs] = useState<SongOption[]>([]);
  const [quickLookupOnCreate, setQuickLookupOnCreate] = useState(false);
  const [quickLookupSong, setQuickLookupSong] = useState<SongOption | null>(null);
  const [quickLookupCandidates, setQuickLookupCandidates] = useState<LacuerdaCandidate[]>([]);
  const [quickLookupError, setQuickLookupError] = useState("");
  const [quickSelectingId, setQuickSelectingId] = useState<string | null>(null);

  // Admin chord tools
  const [lookupCandidates, setLookupCandidates] = useState<LacuerdaCandidate[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupSelectingId, setLookupSelectingId] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [editingChords, setEditingChords] = useState(false);
  const [chordDraft, setChordDraft] = useState("");
  const [savingChordEdit, setSavingChordEdit] = useState(false);

  // Assign form
  const [assignUserId, setAssignUserId] = useState("");
  const [assignPosition, setAssignPosition] = useState("");
  const [addingCustomPosition, setAddingCustomPosition] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<UserOption[]>([]);

  const isAdmin = selectedChurch?.role === "ADMIN";
  const isPlanner = selectedChurch?.role === "PLANNER" || isAdmin;
  const chartSong = chartItem?.song || null;
  const chartActiveArrangement = getPrimaryArrangement(chartSong);
  const chartHasChords = Boolean(getSongChordPro(chartSong));
  const selectedUserAssignments = assignUserId && service
    ? service.assignments.filter((assignment) => assignment.userId === assignUserId)
    : [];
  const assignmentPositionOptions = useMemo(
    () => getAssignmentPositionOptions(service?.assignments),
    [service?.assignments],
  );
  const customAssignmentPositions = useMemo(
    () => getCustomAssignmentPositions(service?.assignments),
    [service?.assignments],
  );

  function resetAssignForm() {
    setAssignUserId("");
    setAssignPosition("");
    setAddingCustomPosition(false);
  }

  function openAssignDialog() {
    resetAssignForm();
    setShowAssign(true);
  }

  function handleAssignDialogOpenChange(open: boolean) {
    setShowAssign(open);
    if (!open) resetAssignForm();
  }

  function selectAssignPosition(position: string) {
    setAssignPosition(position);
    setAddingCustomPosition(false);
  }

  function startCustomPosition() {
    setAssignPosition("");
    setAddingCustomPosition(true);
  }

  const loadService = useCallback(async (options: { showLoading?: boolean } = {}) => {
    if (!id) return;
    if (options.showLoading) setLoading(true);
    try {
      const data = await apiFetch<ServiceResponse>(`/services/${id}?fresh=${Date.now()}`, { cache: "no-store" });
      if (data.error) { navigate("/app/services"); return; }
      const sorted = { ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) };
      setService(sorted);
    } catch (e) {
      console.error(e);
    } finally {
      if (options.showLoading) setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    void loadService({ showLoading: true });
  }, [loadService]);

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
    if (showAddItem && isSongItemType(itemType) && id) {
      const timeout = setTimeout(async () => {
        try {
          const trimmedSearch = songSearch.trim();
          const existingSongIds = getExistingServiceSongIds(service?.items);

          if (trimmedSearch.length < 2) {
            try {
              const recommended = await apiFetch(
                `/songs/recommendations?serviceId=${encodeURIComponent(id)}&limit=12`,
              );
              setSongResults(
                filterExistingSongRecommendations(
                  normalizeSongRecommendationResponse<SongOption>(recommended),
                  existingSongIds,
                ).slice(0, 12),
              );
              return;
            } catch (error) {
              console.warn("No se pudieron cargar recomendaciones de canciones:", error);
            }
          }

          const params = new URLSearchParams({
            limit: trimmedSearch.length >= 2 ? "30" : "20",
            sort: "lastUsed",
          });
          if (trimmedSearch.length >= 2) params.set("q", trimmedSearch);
          const data = await apiFetch(`/songs?${params.toString()}`);
          const candidates = normalizeSongRecommendationResponse<SongOption>(data);
          setSongResults(filterExistingSongRecommendations(sortSongsByLastUsedDesc(candidates), existingSongIds).slice(0, 12));
        } catch { setSongResults([]); }
      }, songSearch.trim().length >= 2 ? 300 : 0);
      return () => clearTimeout(timeout);
    }
    setSongResults([]);
  }, [showAddItem, songSearch, itemType, id, service?.items]);

  async function addSongsToService(songs: SongOption[], options: { keepDialogOpen?: boolean } = {}) {
    if (!id || songs.length === 0) return;
    const startPosition = service?.items.length || 0;
    const duration = itemDuration ? parseInt(itemDuration) : null;

    await Promise.all(songs.map((song, index) =>
      apiFetch(`/service-items`, {
        method: "POST",
        body: JSON.stringify({
          serviceId: id,
          title: song.title,
          type: "song",
          duration,
          songId: song.id,
          position: startPosition + index,
          details: {},
        }),
      })
    ));

    await loadService();
    toast({
      title: `${songs.length} canción${songs.length === 1 ? "" : "es"} agregada${songs.length === 1 ? "" : "s"}`,
    });

    if (!options.keepDialogOpen) {
      resetItemForm();
      setShowAddItem(false);
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (isSongItemType(itemType) && selectedSongs.length === 0) return;
    if (!isSongItemType(itemType) && !itemTitle.trim()) return;

    setSubmitting(true);
    try {
      const duration = itemDuration ? parseInt(itemDuration) : null;

      if (isSongItemType(itemType)) {
        await addSongsToService(selectedSongs);
      } else {
        await apiFetch(`/service-items`, {
          method: "POST",
          body: JSON.stringify({
            serviceId: id,
            title: itemTitle,
            type: itemType.toLowerCase(),
            duration,
            songId: null,
            position: service?.items.length || 0,
            details: {},
          }),
        });
        await loadService();
        toast({ title: "Elemento agregado" });
        resetItemForm();
        setShowAddItem(false);
      }
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  }

  function clearChordLookupState() {
    setLookupCandidates([]);
    setLookupError("");
    setLookupSelectingId(null);
  }

  async function searchLacuerdaCandidates(song: SongLike | SongOption | null | undefined) {
    if (!isAdmin || !song?.id) return;
    setLookupLoading(true);
    setLookupError("");
    setLookupCandidates([]);
    setEditingChords(false);
    try {
      const data = await apiFetch<LacuerdaArrangementResponse>(`/songs/${song.id}/lacuerda`, {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ action: "search" }),
      });
      const candidates = Array.isArray(data.candidates) ? data.candidates.slice(0, 5) : [];
      setLookupCandidates(candidates);
      if (candidates.length === 0) {
        setLookupError("No encontramos versiones en La Cuerda para esta canción.");
      }
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No se pudieron buscar acordes en La Cuerda.");
    } finally {
      setLookupLoading(false);
    }
  }

  function handleOpenChordLookup(item: ServiceItem) {
    if (!item.song) return;
    setChartItemId(item.id);
    void searchLacuerdaCandidates(item.song);
  }

  async function handleSelectChordCandidate(candidate: LacuerdaCandidate) {
    if (!isAdmin || !chartSong || lookupSelectingId) return;
    setLookupSelectingId(candidate.id);
    setLookupError("");
    try {
      const data = await apiFetch<LacuerdaArrangementResponse>(`/songs/${chartSong.id}/lacuerda`, {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({
          candidate,
          arrangementId: chartActiveArrangement?.id || null,
        }),
      });
      if (!data.arrangement) {
        throw new Error(data.error || "No se pudo importar la versión seleccionada.");
      }
      await loadService();
      setEditingChords(false);
      setChordDraft("");
      clearChordLookupState();
      toast({ title: "Acordes importados desde La Cuerda" });
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No se pudo importar la versión seleccionada.");
    } finally {
      setLookupSelectingId(null);
    }
  }

  async function ensureEditableArrangement() {
    if (!chartSong) return null;
    if (chartActiveArrangement?.id) return chartActiveArrangement;

    const created = await apiFetch<SongArrangement>(`/arrangements`, {
      method: "POST",
      body: JSON.stringify({
        songId: chartSong.id,
        name: "Principal",
        key: chartSong.key || null,
        bpm: chartSong.bpm || null,
        meter: chartSong.meter || null,
        lyrics: chartSong.lyrics || null,
        sequence: [],
      }),
    });
    return created;
  }

  function handleEditChords() {
    if (!isAdmin || !chartSong) return;
    clearChordLookupState();
    setChordDraft(chartActiveArrangement?.lyrics || chartSong.lyrics || "");
    setEditingChords(true);
  }

  async function handleSaveChordEdit() {
    if (!isAdmin || !chartSong) return;
    setSavingChordEdit(true);
    setLookupError("");
    try {
      const arrangement = await ensureEditableArrangement();
      if (!arrangement?.id) throw new Error("No se pudo preparar el arreglo para editar.");
      const data = await apiFetch<LacuerdaArrangementResponse>(`/songs/${chartSong.id}/lacuerda`, {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({
          action: "saveArrangement",
          arrangementId: arrangement.id,
          lyrics: chordDraft,
        }),
      });
      if (!data.arrangement) {
        throw new Error(data.error || "No se pudieron guardar los acordes.");
      }
      await loadService();
      setEditingChords(false);
      setChordDraft("");
      toast({ title: "Acordes guardados" });
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No se pudieron guardar los acordes.");
    } finally {
      setSavingChordEdit(false);
    }
  }

  async function handleCreateQuickSong() {
    if (!id) return;
    const title = songSearch.trim();
    if (!title) return;
    setSubmitting(true);
    setQuickLookupError("");
    setQuickLookupCandidates([]);
    setQuickLookupSong(null);
    try {
      let createdSong: SongOption | null = null;
      try {
        createdSong = await apiFetch<SongOption>(`/songs`, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
      } catch (error) {
        const body = error instanceof ApiError && error.body && typeof error.body === "object"
          ? error.body as { existingId?: unknown; id?: unknown; title?: unknown; author?: unknown }
          : null;
        const existingId = typeof body?.existingId === "string" ? body.existingId : typeof body?.id === "string" ? body.id : "";
        if (!existingId) throw error;
        createdSong = {
          id: existingId,
          title: typeof body?.title === "string" ? body.title : title,
          author: typeof body?.author === "string" ? body.author : null,
        };
      }

      if (!createdSong?.id) throw new Error("No se pudo crear la canción.");

      if (isAdmin && quickLookupOnCreate) {
        try {
          const lookup = await apiFetch<LacuerdaArrangementResponse>(`/songs/${createdSong.id}/lacuerda`, {
            method: "POST",
            cache: "no-store",
            body: JSON.stringify({ action: "search" }),
          });
          const candidates = Array.isArray(lookup.candidates) ? lookup.candidates.slice(0, 5) : [];
          if (candidates.length > 0) {
            setQuickLookupSong(createdSong);
            setQuickLookupCandidates(candidates);
            return;
          }
          setQuickLookupError("No encontramos acordes; la canción se agregará sin acordes.");
        } catch (error) {
          setQuickLookupError(error instanceof Error ? error.message : "No se pudieron buscar acordes; puedes agregar sin acordes.");
        }
      }

      await addSongsToService([createdSong]);
    } catch (error) {
      console.error(error);
      toast({ title: error instanceof Error ? error.message : "No se pudo crear la canción", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectQuickCandidate(candidate: LacuerdaCandidate) {
    if (!quickLookupSong || quickSelectingId) return;
    setQuickSelectingId(candidate.id);
    setQuickLookupError("");
    try {
      const data = await apiFetch<LacuerdaArrangementResponse>(`/songs/${quickLookupSong.id}/lacuerda`, {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ candidate }),
      });
      const arrangement = data.arrangement;
      if (!arrangement) {
        throw new Error(data.error || "No se pudo importar la versión seleccionada.");
      }
      const updatedSong: SongOption = {
        ...quickLookupSong,
        key: arrangement.key || quickLookupSong.key || null,
        bpm: arrangement.bpm || quickLookupSong.bpm || null,
        meter: arrangement.meter || quickLookupSong.meter || null,
        lyrics: arrangement.lyrics || quickLookupSong.lyrics || null,
        arrangements: [arrangement],
      };
      await addSongsToService([updatedSong]);
    } catch (error) {
      setQuickLookupError(error instanceof Error ? error.message : "No se pudo importar la versión seleccionada.");
    } finally {
      setQuickSelectingId(null);
    }
  }

  async function handleAddQuickSongWithoutChords() {
    if (!quickLookupSong) return;
    setSubmitting(true);
    try {
      await addSongsToService([quickLookupSong]);
    } finally {
      setSubmitting(false);
    }
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
    const position = assignPosition.trim();
    if (!assignUserId || !id || !position) {
      toast({ title: "Selecciona o agrega una posición", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/service-assignments`, {
        method: "POST",
        body: JSON.stringify({ userId: assignUserId, serviceId: id, position }),
      });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService(data);
      setShowAssign(false);
      resetAssignForm();
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
        assignments: prev.assignments.map((a) => a.id === assignmentId
          ? { ...a, confirmed, responseStatus: confirmed ? "accepted" : "pending", respondedAt: confirmed ? new Date().toISOString() : null }
          : a),
      } : prev);
    } catch (e) { console.error(e); }
  }

  async function handleAssignmentResponse(assignmentId: string, action: "accept" | "decline") {
    setRespondingId(assignmentId);
    try {
      const result = await apiFetch<{ confirmed?: boolean; responseStatus?: "pending" | "accepted" | "declined"; respondedAt?: string }>(`/service-assignments/${assignmentId}/respond`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      const responseStatus = result.responseStatus || (action === "accept" ? "accepted" : "declined");
      const confirmed = typeof result.confirmed === "boolean" ? result.confirmed : responseStatus === "accepted";
      setService((prev) => prev ? {
        ...prev,
        assignments: prev.assignments.map((assignment) =>
          assignment.id === assignmentId
            ? { ...assignment, confirmed, responseStatus, respondedAt: result.respondedAt || new Date().toISOString() }
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
    setSelectedSongs([]);
    setQuickLookupOnCreate(false);
    setQuickLookupSong(null);
    setQuickLookupCandidates([]);
    setQuickLookupError("");
    setQuickSelectingId(null);
  }

  function toggleSelectedSong(song: SongOption) {
    setSelectedSongs((current) =>
      current.some((selected) => selected.id === song.id)
        ? current.filter((selected) => selected.id !== song.id)
        : [...current, song]
    );
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

  function openYoutubeEditor(item: ServiceItem) {
    if (!item.song) return;
    setYoutubeEditingItemId(item.id);
    setYoutubeDraft(getSongYoutubeDraft(item.song));
  }

  function handleYoutubeDialogOpenChange(open: boolean) {
    if (!open) {
      setYoutubeEditingItemId(null);
      setYoutubeDraft("");
    }
  }

  async function handleSaveSongYoutube(event?: React.FormEvent) {
    event?.preventDefault();
    if (!youtubeEditingItem?.song) return;

    const normalized = normalizeYouTubeUrlInput(youtubeDraft);
    if (normalized.error) {
      toast({ title: normalized.error, variant: "destructive" });
      return;
    }

    const songId = youtubeEditingItem.song.id;
    const notes = buildSongNotesWithYoutubeUrl(youtubeEditingItem.song, normalized.url);

    setSavingYoutube(true);
    try {
      await apiFetch(`/songs/${songId}`, {
        method: "PUT",
        body: JSON.stringify({ notes }),
      });

      setService((prev) => prev ? {
        ...prev,
        items: updateSongYoutubeUrlInServiceItems(prev.items, songId, normalized.url),
      } : prev);
      setYoutubeEditingItemId(null);
      setYoutubeDraft("");
      toast({ title: normalized.url ? "Link de YouTube guardado" : "Link de YouTube quitado" });
    } catch (error) {
      console.error("No se pudo guardar el link de YouTube:", error);
      toast({ title: "No se pudo guardar el link de YouTube", variant: "destructive" });
    } finally {
      setSavingYoutube(false);
    }
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
  const trimmedSongSearch = songSearch.trim();
  const hasExactSongMatch = songResults.some((song) => song.title.trim().toLowerCase() === trimmedSongSearch.toLowerCase());
  const canQuickCreateSong = isAdmin && isSongItemType(itemType) && trimmedSongSearch.length >= 2 && !hasExactSongMatch;

  return (
    <div className="mobile-page space-y-4">
      {/* Header */}
      <div className="app-card-soft overflow-hidden">
        <div className="px-4 py-4">
          <div className="flex items-start gap-3">
            <button onClick={() => navigate("/app/services")} className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-zinc-50">
              <ArrowLeft className="w-5 h-5 text-zinc-600" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="line-clamp-2 text-2xl font-black leading-tight tracking-tight text-zinc-950">{service.title}</h1>
              <p className="mt-0.5 truncate text-sm text-zinc-500">{formatServiceDate(service.date)}</p>
            </div>
            {isAdmin && (
              <Button variant="ghost" size="sm" className="h-10 w-10 shrink-0 rounded-2xl text-red-500" onClick={handleDeleteService}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            {canPresentService && (
              <Button
                variant="default"
                size="sm"
                className="h-10 flex-1 rounded-2xl px-3"
                onClick={() => navigate(`/app/services/${service.id}/presentation`)}
              >
                <PlayCircle className="w-4 h-4" />
                Presentar
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-10 flex-1 rounded-2xl px-3" onClick={handleGenerateServicePdf}>
              <FileDown className="w-4 h-4" />
              PDF
            </Button>
          </div>
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
                      <div className="p-2.5 sm:p-3">
                        <div className="flex items-start gap-2 sm:gap-3">
                          <div className="flex w-4 shrink-0 flex-col items-center gap-1 pt-1 sm:w-auto">
                          {idx > 0 && (
                            <button onClick={(event) => { event.stopPropagation(); handleMoveUp(item); }} className="hidden p-0.5 rounded text-zinc-400 hover:bg-zinc-100 sm:block">
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
                            <button onClick={(event) => { event.stopPropagation(); handleMoveDown(item); }} className="hidden p-0.5 rounded text-zinc-400 hover:bg-zinc-100 sm:block">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" /></svg>
                            </button>
                          )}
                          </div>
                          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-primary/10 sm:h-9 sm:w-9">
                            {isSongItemType(item.type) ? <Music className="w-4 h-4 text-primary" /> : <Clock className="w-4 h-4 text-primary" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 break-words text-[15px] font-bold leading-tight text-zinc-950 sm:text-base">
                                  {item.song?.title || item.title}
                                </p>
                                {item.song ? (
                                  (item.song.author || getDisplayKey(item)) && (
                                    <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-zinc-500 sm:leading-5">
                                      {[item.song.author, getDisplayKey(item) ? `Tono ${getDisplayKey(item)}` : null].filter(Boolean).join(" · ")}
                                    </p>
                                  )
                                ) : (
                                  <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-zinc-500 sm:leading-5">
                                    {formatItemType(item.type)}{item.duration ? ` · ${item.duration} min` : ""}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center justify-end gap-1">
                                {item.song && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 shrink-0 rounded-xl bg-primary/5 text-primary"
                                    aria-expanded={Boolean(expandedSongItems[item.id])}
                                    aria-label={expandedSongItems[item.id] ? "Contraer detalles de canción" : "Expandir detalles de canción"}
                                    onClick={(event) => { event.stopPropagation(); toggleSongItem(item.id); }}
                                  >
                                    {expandedSongItems[item.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </Button>
                                )}
                              </div>
                            </div>

                            {item.song && getVocalNote(item) && (
                              <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-primary sm:text-sm">
                                Canta: {getVocalNote(item)}
                              </p>
                            )}

                            {!item.song && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
                                <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[11px] sm:text-xs">
                                  {getItemTimingLabel(item)}
                                </Badge>
                              </div>
                            )}

                            {!item.song && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
                                {isPlanner && (
                                  <Button
                                    type="button"
                                    variant={detailsEditingId === item.id ? "default" : "outline"}
                                    size="sm"
                                    className="h-8 rounded-xl px-2 text-xs sm:h-9 sm:px-3"
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
                                    className="ml-auto rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 sm:p-2"
                                    aria-label="Eliminar elemento"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            )}
                          {!item.song && hasPlanningNotes(item) && (
                            <div className="mt-2 grid gap-1.5">
                              {getPlanningNoteEntries(item).slice(0, 2).map((entry) => (
                                <p key={entry.key} className="line-clamp-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-zinc-600 ring-1 ring-zinc-200">
                                  <span className="font-bold text-primary">{entry.label}: </span>
                                  {entry.note}
                                </p>
                              ))}
                              {getPlanningNoteEntries(item).length > 2 && (
                                <p className="text-[11px] font-semibold text-zinc-500">
                                  +{getPlanningNoteEntries(item).length - 2} detalle(s) más
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        </div>
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
                        <div
                          className="space-y-3 border-t border-zinc-100 bg-gradient-to-br from-white to-zinc-50/80 p-3"
                          onClick={stopInteractiveTap}
                          onPointerDown={stopInteractiveTap}
                          onTouchStart={stopInteractiveTap}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {getSongYoutubeUrl(item.song) && (
                              <Button asChild type="button" variant="outline" size="sm" className="rounded-xl">
                                <a
                                  href={getSongYoutubeUrl(item.song) || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={stopInteractiveTap}
                                  onPointerDown={stopInteractiveTap}
                                  onTouchStart={stopInteractiveTap}
                                >
                                  <PlayCircle className="w-3 h-3" />
                                  YouTube
                                </a>
                              </Button>
                            )}
                            {isPlanner && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openYoutubeEditor(item);
                                }}
                              >
                                <Link2 className="w-3 h-3" />
                                {getSongYoutubeUrl(item.song) ? "Editar YouTube" : "Agregar YouTube"}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-xl"
                              onClick={(event) => {
                                event.stopPropagation();
                                setChartItemId(item.id);
                              }}
                            >
                              <Maximize2 className="w-3 h-3" />
                              Ver acordes
                            </Button>
                            {isAdmin && !getSongChordPro(item.song) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl border-primary/20 bg-primary/5 text-primary"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenChordLookup(item);
                                }}
                              >
                                <Search className="w-3 h-3" />
                                Buscar acordes en La Cuerda
                              </Button>
                            )}
                            {isPlanner && (
                              <Button
                                type="button"
                                variant={detailsEditingId === item.id ? "default" : "outline"}
                                size="sm"
                                className="rounded-xl"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startItemDetails(item);
                                }}
                              >
                                <Pencil className="w-3 h-3" />
                                Detalles
                              </Button>
                            )}
                            {isPlanner && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="ml-auto h-9 w-9 rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-500"
                                aria-label="Eliminar canción del servicio"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteItem(item.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

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
                <Button size="sm" className="h-10 rounded-2xl" onClick={openAssignDialog}>
                  <Plus className="w-4 h-4 mr-1" /> Asignar
                </Button>
              </div>
            )}

            <Card className="app-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Matriz de equipo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {DEFAULT_SERVICE_POSITION_GROUPS.map((group) => (
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
                {customAssignmentPositions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Otras posiciones</p>
                    {customAssignmentPositions.map((position) => {
                      const assigned = getPositionAssignments(service.assignments, position);
                      return (
                        <div key={position} className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-3 py-2">
                          <span className="text-sm font-semibold text-zinc-900">{position}</span>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {assigned.map((assignment) => (
                              <Badge key={assignment.id} variant="secondary" className="rounded-full">
                                {getPersonName(assignment.user)} · {getAssignmentStatusLabel(assignment)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                  const responseStatus = getAssignmentResponseStatus(a);
                  const canRespond = isCurrentUserAssigned && assignmentNeedsResponse(a);

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
                        {responseStatus === "accepted" ? (
                          <Badge variant="default" className="text-xs bg-emerald-100 text-emerald-700">Confirmado</Badge>
                        ) : responseStatus === "declined" ? (
                          <Badge variant="secondary" className="text-xs bg-red-50 text-red-700">Declinado</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Pendiente</Badge>
                        )}
                        {canRespond && (
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
                  Títulos, tonos, voces y recursos bajo demanda para que el equipo pueda prepararse sin buscar mensajes.
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
                .map((item, index) => {
                  const displayKey = getDisplayKey(item);
                  const vocalNote = getVocalNote(item);
                  const youtubeUrl = getSongYoutubeUrl(item.song);
                  const isExpanded = Boolean(expandedSongItems[item.id]);

                  return (
                    <Card
                      key={item.id}
                      className="app-card overflow-hidden"
                      onClick={() => toggleSongItem(item.id)}
                    >
                      <CardContent className="p-0">
                        <div className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-sm font-black text-primary">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 break-words text-base font-bold leading-tight text-zinc-950">
                                {item.song?.title || item.title}
                              </p>
                              {(item.song?.author || displayKey) && (
                                <p className="mt-0.5 line-clamp-1 text-sm text-zinc-500">
                                  {[item.song?.author, displayKey ? `Tono ${displayKey}` : null].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 rounded-xl bg-primary/5 text-primary"
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? "Contraer recursos de canción" : "Expandir recursos de canción"}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleSongItem(item.id);
                              }}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </Button>
                          </div>

                          {vocalNote && (
                            <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-primary">
                              Canta: {vocalNote}
                            </p>
                          )}
                        </div>

                        {isExpanded && (
                          <div
                            className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-gradient-to-br from-white to-zinc-50/80 p-3"
                            onClick={stopInteractiveTap}
                            onPointerDown={stopInteractiveTap}
                            onTouchStart={stopInteractiveTap}
                          >
                            {youtubeUrl && (
                              <Button asChild type="button" variant="outline" size="sm" className="rounded-xl">
                                <a
                                  href={youtubeUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={stopInteractiveTap}
                                  onPointerDown={stopInteractiveTap}
                                  onTouchStart={stopInteractiveTap}
                                >
                                  <PlayCircle className="w-3 h-3" />
                                  YouTube
                                </a>
                              </Button>
                            )}
                            {isPlanner && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openYoutubeEditor(item);
                                }}
                              >
                                <Link2 className="w-3 h-3" />
                                {youtubeUrl ? "Editar YouTube" : "Agregar YouTube"}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-xl"
                              onClick={(event) => {
                                event.stopPropagation();
                                setChartItemId(item.id);
                              }}
                            >
                              <Maximize2 className="w-3 h-3" />
                              Ver acordes
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
            )}
          </div>
        )}
      </div>

      <Dialog open={Boolean(chartItem)} onOpenChange={(open) => {
        if (!open) {
          setChartItemId(null);
          setEditingChords(false);
          setChordDraft("");
          clearChordLookupState();
        }
      }}>
        <DialogContent className="flex max-h-[88svh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-[1.5rem] border bg-white p-0 sm:max-h-[90vh] sm:rounded-[2rem]">
          {chartItem?.song && (
            <>
              <DialogHeader className="border-b border-zinc-100 px-3 py-2 text-left sm:px-4 sm:py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="line-clamp-1 text-base font-black leading-tight text-zinc-950 sm:text-lg">
                      {chartItem.song.title}
                    </DialogTitle>
                    <div className="flex flex-wrap gap-1 pt-0.5 text-[11px] text-zinc-500 sm:gap-1.5 sm:text-xs">
                      {chartItem.song.author && <span>{chartItem.song.author}</span>}
                      {chartItem.song.author && getDisplayKey(chartItem) && <span aria-hidden="true">·</span>}
                      {getDisplayKey(chartItem) && <span>Tono {getDisplayKey(chartItem)}</span>}
                    </div>
                  </div>
                  <DialogClose asChild>
                    <Button type="button" variant="outline" size="sm" className="h-10 shrink-0 rounded-2xl px-3">
                      <X className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Cerrar</span>
                    </Button>
                  </DialogClose>
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-2 sm:p-4">
                {getVocalNote(chartItem) && (
                  <div className="mb-2 rounded-2xl border border-primary/10 bg-white p-3 shadow-sm">
                    <p className="text-sm font-semibold leading-5 text-primary">Canta: {getVocalNote(chartItem)}</p>
                  </div>
                )}
                {isAdmin && (
                  <div className="mb-2 space-y-2 rounded-2xl border border-primary/10 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => searchLacuerdaCandidates(chartItem.song)}
                        disabled={lookupLoading}
                      >
                        {lookupLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                        {chartHasChords ? "Cambiar versión" : "Buscar acordes en La Cuerda"}
                      </Button>
                      <Button
                        type="button"
                        variant={editingChords ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl"
                        onClick={handleEditChords}
                      >
                        <Pencil className="h-3 w-3" />
                        Editar acordes
                      </Button>
                    </div>

                    {lookupCandidates.length > 0 && (
                      <div className="space-y-1 rounded-2xl bg-zinc-50 p-2">
                        <p className="px-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Elige una versión</p>
                        {lookupCandidates.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white"
                            disabled={Boolean(lookupSelectingId)}
                            onClick={() => handleSelectChordCandidate(candidate)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-zinc-950">{candidate.title}</span>
                              <span className="block truncate text-xs text-zinc-500">{candidate.artist || "Autor desconocido"}</span>
                            </span>
                            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                              {lookupSelectingId === candidate.id ? "Importando..." : "Usar"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {lookupError && <p className="text-xs font-medium leading-5 text-red-600">{lookupError}</p>}
                  </div>
                )}

                {editingChords ? (
                  <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                    <Textarea
                      value={chordDraft}
                      onChange={(event) => setChordDraft(event.target.value)}
                      spellCheck={false}
                      className="min-h-[50svh] resize-y rounded-2xl font-mono text-sm leading-6"
                      placeholder="Pega o escribe los acordes en formato ChordPro..."
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" className="rounded-xl" onClick={() => setEditingChords(false)} disabled={savingChordEdit}>
                        Cancelar
                      </Button>
                      <Button type="button" className="rounded-xl" onClick={handleSaveChordEdit} disabled={savingChordEdit}>
                        {savingChordEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar acordes"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ChordProPreview
                    value={getSongChordPro(chartItem.song)}
                    originalKey={getOriginalKey(chartItem)}
                    selectedKey={getDisplayKey(chartItem)}
                    onSelectedKeyChange={(key) => handleSaveItemKey(chartItem, key)}
                    title={chartItem.song.title}
                    artist={chartItem.song.author}
                    maxLines={500}
                    emptyText="Esta canción todavía no tiene acordes guardados."
                    fullHeight
                  />
                )}
              </div>
              <div className="shrink-0 border-t border-zinc-100 bg-white/95 p-3 backdrop-blur">
                <DialogClose asChild>
                  <Button type="button" className="h-11 w-full rounded-2xl sm:ml-auto sm:w-auto">
                    Cerrar acordes
                  </Button>
                </DialogClose>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(youtubeEditingItem)} onOpenChange={handleYoutubeDialogOpenChange}>
        <DialogContent className="top-auto bottom-0 max-w-none translate-y-0 gap-0 rounded-t-3xl p-0 sm:bottom-auto sm:top-[50%] sm:max-w-md sm:translate-y-[-50%] sm:rounded-2xl">
          {youtubeEditingItem?.song && (
            <>
              <DialogHeader className="border-b border-zinc-100 px-5 pb-4 pt-5 text-left">
                <DialogTitle>{getSongYoutubeUrl(youtubeEditingItem.song) ? "Editar YouTube" : "Agregar YouTube"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSaveSongYoutube} className="space-y-4 p-4 sm:p-5">
                <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                  <p className="line-clamp-1 text-sm font-bold text-zinc-950">{youtubeEditingItem.song.title}</p>
                  {youtubeEditingItem.song.author && (
                    <p className="line-clamp-1 text-xs text-zinc-500">{youtubeEditingItem.song.author}</p>
                  )}
                </div>

                {getSongYoutubeUrl(youtubeEditingItem.song) && (
                  <Button asChild type="button" variant="outline" className="h-11 w-full rounded-2xl">
                    <a href={getSongYoutubeUrl(youtubeEditingItem.song) || "#"} target="_blank" rel="noreferrer">
                      <PlayCircle className="h-4 w-4" />
                      Abrir link actual
                    </a>
                  </Button>
                )}

                <div className="space-y-2">
                  <Label htmlFor="service-song-youtube-url">Link de YouTube</Label>
                  <Input
                    id="service-song-youtube-url"
                    type="url"
                    inputMode="url"
                    autoFocus
                    value={youtubeDraft}
                    onChange={(event) => setYoutubeDraft(event.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                    className="h-11 rounded-2xl"
                    disabled={savingYoutube}
                  />
                  <p className="text-xs leading-5 text-zinc-500">Déjalo vacío para quitar el link guardado.</p>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-2xl"
                    onClick={() => handleYoutubeDialogOpenChange(false)}
                    disabled={savingYoutube}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" className="h-11 rounded-2xl" disabled={savingYoutube}>
                    {savingYoutube ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ADD ITEM DIALOG */}
      <Dialog open={showAddItem} onOpenChange={(open) => { setShowAddItem(open); if (!open) resetItemForm(); }}>
        <DialogContent className="top-auto bottom-0 max-w-none translate-y-0 gap-0 rounded-t-3xl p-0 sm:bottom-auto sm:top-[50%] sm:max-w-2xl sm:translate-y-[-50%] sm:rounded-2xl">
          <DialogHeader className="border-b border-zinc-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>Agregar elemento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddItem} className="space-y-4 p-4 sm:p-5">
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
              <ServiceSongPicker
                search={songSearch}
                songs={songResults}
                selectedSongs={selectedSongs}
                onSearchChange={setSongSearch}
                onToggleSong={toggleSelectedSong}
                disabled={submitting}
                footer={(canQuickCreateSong || (quickLookupCandidates.length > 0 && quickLookupSong) || quickLookupError) ? (
                  <>
                    {canQuickCreateSong && (
                      <div className="space-y-3 rounded-2xl border border-dashed border-primary/25 bg-primary/5 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-bold text-zinc-950">Crear "{trimmedSongSearch}"</p>
                            <p className="mt-0.5 text-xs leading-5 text-zinc-500">No hay una canción exacta con ese título.</p>
                          </div>
                          <Button type="button" size="sm" className="shrink-0 rounded-xl" onClick={handleCreateQuickSong} disabled={submitting}>
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear"}
                          </Button>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 text-primary"
                            checked={quickLookupOnCreate}
                            onChange={(event) => setQuickLookupOnCreate(event.target.checked)}
                          />
                          Buscar acordes en La Cuerda al crear
                        </label>
                      </div>
                    )}
                    {quickLookupCandidates.length > 0 && quickLookupSong && (
                      <div className="mt-3 space-y-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                        <div>
                          <p className="text-sm font-bold text-zinc-950">Elige una versión para "{quickLookupSong.title}"</p>
                          <p className="text-xs text-zinc-500">Si ninguna es correcta, puedes agregarla sin acordes.</p>
                        </div>
                        <div className="space-y-1">
                          {quickLookupCandidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2 text-left transition hover:bg-primary/5"
                              disabled={Boolean(quickSelectingId)}
                              onClick={() => handleSelectQuickCandidate(candidate)}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-bold text-zinc-950">{candidate.title}</span>
                                <span className="block truncate text-xs text-zinc-500">{candidate.artist || "Autor desconocido"}</span>
                              </span>
                              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                                {quickSelectingId === candidate.id ? "Importando..." : "Usar"}
                              </span>
                            </button>
                          ))}
                        </div>
                        <Button type="button" variant="outline" className="w-full rounded-xl" onClick={handleAddQuickSongWithoutChords} disabled={submitting}>
                          Agregar sin acordes
                        </Button>
                      </div>
                    )}
                    {quickLookupError && <p className="mt-3 text-xs font-medium leading-5 text-red-600">{quickLookupError}</p>}
                  </>
                ) : null}
              />
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
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setShowAddItem(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting || (isSongItemType(itemType) ? selectedSongs.length === 0 : !itemTitle.trim())}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : isSongItemType(itemType) && selectedSongs.length > 1 ? `Agregar ${selectedSongs.length} canciones` : "Agregar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ASSIGN MEMBER DIALOG */}
      <Dialog open={showAssign} onOpenChange={handleAssignDialogOpenChange}>
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
              <div className="grid grid-cols-2 gap-2">
                {assignmentPositionOptions.map((position) => (
                  <button
                    key={position}
                    type="button"
                    onClick={() => selectAssignPosition(position)}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                      !addingCustomPosition && assignPosition === position
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-primary/40 hover:bg-primary/5"
                    }`}
                  >
                    {position}
                  </button>
                ))}
                <Button
                  type="button"
                  variant={addingCustomPosition ? "default" : "outline"}
                  className="min-h-11 rounded-xl"
                  onClick={startCustomPosition}
                  aria-label="Agregar una posición personalizada"
                  title="Agregar una posición personalizada"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {addingCustomPosition && (
                <Input
                  value={assignPosition}
                  onChange={(e) => setAssignPosition(e.target.value)}
                  placeholder="Nombre de la posición"
                  autoFocus
                />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleAssignDialogOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting || !assignUserId || !assignPosition.trim()}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Asignar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
