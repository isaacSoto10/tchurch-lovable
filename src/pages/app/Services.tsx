import { useEffect, useRef, useState, useCallback, type PointerEvent, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, Music, FileText, Bell, X, Check, Clock, Users, ExternalLink, PlayCircle, GripVertical, FileDown } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";
import { ChordProPreview } from "@/components/ChordProPreview";
import {
  getPrimaryArrangement,
  getSongDisplayKey,
  getSongChordPro,
  getSongPlainNotes,
  getSongYoutubeUrl,
  isSongItemType,
  type SongLike,
} from "@/lib/songDisplay";
import { normalizeKey, transposeChordPro } from "@/lib/musicUtils";
import { getYoutubeEmbedUrl } from "@/lib/youtube";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Service {
  id: string;
  title: string;
  date: string;
  type: string;
  status: string;
  notes?: string;
}

interface ServiceItem {
  id: string;
  serviceId: string;
  songId?: string;
  title: string;
  type: "song" | "header" | "item" | "announcement";
  position: number;
  duration?: number;
  details?: Record<string, unknown>;
  song?: SongLike | null;
}

interface ServiceAssignment {
  id: string;
  serviceId: string;
  userId: string;
  position: string;
  confirmed: boolean;
  user?: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

interface MyAssignment {
  id: string;
  serviceId: string;
  responseStatus?: "pending" | "accepted" | "declined" | null;
  service?: {
    id: string;
    date?: string;
  };
}

interface Member {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
}

const SERVICE_TYPES = [
  { label: "Servicio dominical", value: "Sunday Service" },
  { label: "Estudio bíblico", value: "Wednesday Bible Study" },
  { label: "Evento especial", value: "Special Event" },
  { label: "Ensayo", value: "Rehearsal" },
];

const ITEM_TYPES = [
  { label: "Canción", value: "song", icon: Music },
  { label: "Encabezado", value: "header", icon: FileText },
  { label: "Elemento", value: "item", icon: FileText },
  { label: "Anuncio", value: "announcement", icon: Bell },
];

const POSITIONS = [
  "Vocals",
  "Lead Vocal",
  "Backing Vocal",
  "Acoustic Guitar",
  "Electric Guitar",
  "Bass",
  "Keys",
  "Drums",
  "Percussion",
  "Strings",
  "Sound Tech",
  "Visuals Tech",
  "Camera",
  "Director",
  "Other",
];

const TEMPLATE_ITEMS = [
  { title: "Bienvenida", type: "header" },
  { title: "Llamado a la adoración", type: "header" },
  { title: "Alabanza y adoración", type: "header" },
  { title: "Ofrenda", type: "header" },
  { title: "Oración", type: "header" },
  { title: "Mensaje", type: "header" },
  { title: "Llamado al altar", type: "header" },
  { title: "Bendición final", type: "header" },
  { title: "Santa cena", type: "header" },
  { title: "Lectura bíblica", type: "item" },
  { title: "Testimonio", type: "item" },
  { title: "Música especial", type: "item" },
  { title: "Momento de niños", type: "item" },
  { title: "Lectura congregacional", type: "item" },
  { title: "Convivio", type: "item" },
  { title: "Anuncio general", type: "announcement" },
  { title: "Próximos eventos", type: "announcement" },
  { title: "Cumpleaños", type: "announcement" },
];

export default function Services() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [myAssignments, setMyAssignments] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    date: "",
    type: "Sunday Service",
    status: "confirmed",
    notes: "",
  });

  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [expandedSongItems, setExpandedSongItems] = useState<Record<string, boolean>>({});
  const [serviceItems, setServiceItems] = useState<Record<string, ServiceItem[]>>({});
  const [serviceAssignments, setServiceAssignments] = useState<Record<string, ServiceAssignment[]>>({});
  const [itemsLoading, setItemsLoading] = useState<Record<string, boolean>>({});
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [dragServiceId, setDragServiceId] = useState<string | null>(null);
  const suppressNextCardClickRef = useRef(false);

  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [newItemType, setNewItemType] = useState<"song" | "template">("template");
  const [songSearch, setSongSearch] = useState("");
  const [songs, setSongs] = useState<SongLike[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof TEMPLATE_ITEMS[0] | null>(null);
  const [selectedSong, setSelectedSong] = useState<typeof songs[0] | null>(null);
  const [itemType, setItemType] = useState<ServiceItem["type"]>("song");
  const [itemTitle, setItemTitle] = useState("");

  const [memberSearch, setMemberSearch] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedPosition, setSelectedPosition] = useState("Vocals");

  const loadServices = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchApi("/services"),
      fetchApi<MyAssignment[]>("/service-assignments/mine").catch(() => []),
    ])
      .then(([data, assignments]) => {
        setServices(Array.isArray(data) ? data : []);
        setMyAssignments(Array.isArray(assignments) ? assignments : []);
      })
      .catch((e) => console.error("No se pudieron cargar los servicios:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const loadServiceDetails = useCallback(async (serviceId: string) => {
    if (serviceItems[serviceId] || itemsLoading[serviceId]) return;

    setItemsLoading((prev) => ({ ...prev, [serviceId]: true }));
    try {
      const serviceRes = await fetchApi(`/services/${serviceId}`);
      if (serviceRes && typeof serviceRes === 'object') {
        const items = (serviceRes as Record<string, unknown>).items || [];
        const assignments = (serviceRes as Record<string, unknown>).assignments || [];
        setServiceItems((prev) => ({ ...prev, [serviceId]: Array.isArray(items) ? items as ServiceItem[] : [] }));
        setServiceAssignments((prev) => ({ ...prev, [serviceId]: Array.isArray(assignments) ? assignments as ServiceAssignment[] : [] }));
      }
    } catch (e) {
      console.error("No se pudieron cargar los detalles del servicio:", e);
    } finally {
      setItemsLoading((prev) => ({ ...prev, [serviceId]: false }));
    }
  }, [fetchApi, serviceItems, itemsLoading]);

  const toggleExpand = async (serviceId: string) => {
    if (expandedService === serviceId) {
      setExpandedService(null);
    } else {
      setExpandedService(serviceId);
      await loadServiceDetails(serviceId);
    }
  };

  const toggleSongItem = (itemId: string) => {
    setExpandedSongItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const stopInteractiveTap = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const getItemOriginalKey = (item: ServiceItem) => item.song ? getSongDisplayKey(item.song) : null;

  const getItemSavedKey = (item: ServiceItem) => {
    const details = item.details || {};
    const key =
      typeof details.serviceKey === "string" ? details.serviceKey :
      typeof details.selectedKey === "string" ? details.selectedKey :
      typeof details.key === "string" ? details.key :
      null;

    return normalizeKey(key);
  };

  const getItemDisplayKey = (item: ServiceItem) => getItemSavedKey(item) || getItemOriginalKey(item);

  const getItemDisplayChordPro = (item: ServiceItem) => {
    if (!item.song) return null;
    const chordPro = getSongChordPro(item.song);
    if (!chordPro) return null;

    const originalKey = getItemOriginalKey(item);
    const displayKey = getItemDisplayKey(item);
    if (!originalKey || !displayKey || originalKey === displayKey) return chordPro;

    return transposeChordPro(chordPro, originalKey, displayKey);
  };

  async function handleSaveItemKey(serviceId: string, item: ServiceItem, key: string) {
    const nextDetails = { ...(item.details || {}), serviceKey: key };
    setServiceItems((prev) => ({
      ...prev,
      [serviceId]: (prev[serviceId] || []).map((serviceItem) =>
        serviceItem.id === item.id ? { ...serviceItem, details: nextDetails } : serviceItem
      ),
    }));

    try {
      await fetchApi(`/service-items/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ details: nextDetails }),
      });
    } catch (error) {
      console.error("No se pudo guardar el tono:", error);
      toast({ title: "No se pudo guardar el tono", variant: "destructive" });
    }
  }

  async function handleGenerateServicePdf(service: Service) {
    const items = (serviceItems[service.id] || [])
      .filter((item) => isSongItemType(item.type) && item.song && getItemDisplayChordPro(item))
      .map((item) => ({
        title: item.song?.title || item.title,
        artist: item.song?.author || null,
        key: getItemDisplayKey(item),
        chordPro: getItemDisplayChordPro(item) || "",
      }));

    if (items.length === 0) {
      toast({ title: "Este servicio no tiene canciones con acordes todavía.", variant: "destructive" });
      return;
    }

    try {
      const { generateServiceChordChartsPdf } = await import("@/lib/chordChartPdf");
      await generateServiceChordChartsPdf({
        serviceTitle: service.title,
        serviceDate: service.date,
        items,
      });
    } catch (error) {
      console.error("No se pudo crear el PDF del servicio:", error);
      toast({ title: "No se pudo crear el PDF del servicio", variant: "destructive" });
    }
  }

  const isPlanner = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";
  const visibleServiceIds = new Set(
    myAssignments
      .filter((assignment) => assignment.responseStatus !== "declined")
      .map((assignment) => assignment.serviceId || assignment.service?.id)
      .filter(Boolean)
  );

  const filteredServices = services.filter((s) => {
    if (!isPlanner && visibleServiceIds.size > 0 && !visibleServiceIds.has(s.id)) return false;
    if (!isPlanner && visibleServiceIds.size === 0) return false;
    const matchesSearch = s.title.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === "all" || s.type === filterType;
    return matchesSearch && matchesType;
  });

  const openNewDialog = () => {
    setEditingService(null);
    setFormData({ title: "", date: "", type: "Sunday Service", status: "confirmed", notes: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (service: Service) => {
    setEditingService(service);
    setFormData({
      title: service.title,
      date: service.date ? service.date.slice(0, 16) : "",
      type: service.type,
      status: service.status,
      notes: service.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim() || !formData.date) return;

    setSubmitting(true);
    try {
      const payload = {
        title: formData.title,
        date: new Date(formData.date).toISOString(),
        type: formData.type,
        status: formData.status,
        notes: formData.notes || null,
      };

      if (editingService) {
        await fetchApi(`/services/${editingService.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "Servicio actualizado" });
      } else {
        await fetchApi("/services", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Servicio creado" });
      }
      setDialogOpen(false);
      loadServices();
    } catch (e) {
      toast({ title: "No se pudo guardar el servicio", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await fetchApi(`/services/${deleteId}`, { method: "DELETE" });
      toast({ title: "Servicio eliminado" });
      setDeleteId(null);
      loadServices();
    } catch (e) {
      toast({ title: "No se pudo eliminar el servicio", variant: "destructive" });
    }
  };

  const openAddItemDialog = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setNewItemType("template");
    setSongSearch("");
    setSongs([]);
    setSelectedTemplate(null);
    setSelectedSong(null);
    setItemType("song");
    setItemTitle("");
    setAddItemDialogOpen(true);
  };

  const searchSongs = async (query: string) => {
    if (!query.trim()) {
      setSongs([]);
      return;
    }
    try {
      const data = await fetchApi(`/songs?q=${encodeURIComponent(query)}&limit=20`);
      setSongs(Array.isArray(data) ? data.slice(0, 10) : []);
    } catch (e) {
      console.error("No se pudieron buscar canciones:", e);
    }
  };

  const handleAddItem = async () => {
    if (!selectedServiceId) return;

    let title = itemTitle;
    let songId: string | undefined;
    let type = itemType;

    if (newItemType === "song" && selectedSong) {
      title = selectedSong.title;
      songId = selectedSong.id;
      type = "song";
    } else if (newItemType === "template" && selectedTemplate) {
      title = selectedTemplate.title;
      type = selectedTemplate.type as ServiceItem["type"];
    }

    if (!title.trim()) {
      toast({ title: "Selecciona o escribe un título", variant: "destructive" });
      return;
    }

    const existingItems = serviceItems[selectedServiceId] || [];
    const position = existingItems.length;

    try {
      await fetchApi("/service-items", {
        method: "POST",
        body: JSON.stringify({
          serviceId: selectedServiceId,
          title,
          songId,
          type,
          position,
          duration: null,
          details: {},
        }),
      });
      toast({ title: "Elemento agregado" });
      setAddItemDialogOpen(false);

      const serviceRes = await fetchApi(`/services/${selectedServiceId}`);
      if (serviceRes && typeof serviceRes === 'object') {
        const items = (serviceRes as Record<string, unknown>).items || [];
        setServiceItems((prev) => ({ ...prev, [selectedServiceId]: Array.isArray(items) ? items as ServiceItem[] : [] }));
      }
    } catch (e) {
      toast({ title: "No se pudo agregar el elemento", variant: "destructive" });
    }
  };

  const handleDeleteItem = async (serviceId: string, itemId: string) => {
    try {
      await fetchApi(`/service-items/${itemId}`, { method: "DELETE" });
      setServiceItems((prev) => ({
        ...prev,
        [serviceId]: (prev[serviceId] || []).filter((i) => i.id !== itemId),
      }));
      toast({ title: "Elemento eliminado" });
    } catch (e) {
      toast({ title: "No se pudo eliminar el elemento", variant: "destructive" });
    }
  };

  const handleDragStart = (e: React.DragEvent, serviceId: string, itemId: string) => {
    e.dataTransfer.effectAllowed = "move";
    suppressNextCardClickRef.current = true;
    setDraggingItemId(itemId);
    setDragServiceId(serviceId);
  };

  const handleDragOver = (e: React.DragEvent, itemId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverItemId !== itemId) {
      setDragOverItemId(itemId);
    }
  };

  const persistItemOrder = async (targetServiceId: string, newItems: ServiceItem[], previousItems: ServiceItem[]) => {
    setServiceItems((prev) => ({ ...prev, [targetServiceId]: newItems }));

    const updates = newItems.map((item, idx) => ({
      id: item.id,
      position: idx,
    }));

    try {
      await fetchApi("/service-items/reorder", {
        method: "PATCH",
        body: JSON.stringify({ items: updates }),
      });
    } catch (e) {
      toast({ title: "No se pudo reordenar", variant: "destructive" });
      setServiceItems((prev) => ({ ...prev, [targetServiceId]: previousItems }));
    }
  };

  const reorderItem = async (targetServiceId: string, draggedItemId: string, targetItemId: string) => {
    if (draggedItemId === targetItemId) return;

    const items = serviceItems[targetServiceId] || [];
    const draggingIndex = items.findIndex((i) => i.id === draggedItemId);
    const targetIndex = items.findIndex((i) => i.id === targetItemId);

    if (draggingIndex === -1 || targetIndex === -1) return;

    const newItems = [...items];
    const [draggedItem] = newItems.splice(draggingIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);
    await persistItemOrder(targetServiceId, newItems, items);
  };

  const handleDrop = async (e: React.DragEvent, targetServiceId: string, targetItemId: string) => {
    e.preventDefault();
    if (!draggingItemId || !dragServiceId || draggingItemId === targetItemId) {
      setDraggingItemId(null);
      setDragOverItemId(null);
      setDragServiceId(null);
      return;
    }

    await reorderItem(targetServiceId, draggingItemId, targetItemId);

    setDraggingItemId(null);
    setDragOverItemId(null);
    setDragServiceId(null);
  };

  const handleDragEnd = () => {
    setDraggingItemId(null);
    setDragOverItemId(null);
    setDragServiceId(null);
    window.setTimeout(() => {
      suppressNextCardClickRef.current = false;
    }, 0);
  };

  const handleMoveItem = async (serviceId: string, itemId: string, direction: "up" | "down") => {
    const items = serviceItems[serviceId] || [];
    const itemIndex = items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) return;

    const newIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;
    if (newIndex < 0 || newIndex >= items.length) return;

    const newItems = [...items];
    [newItems[itemIndex], newItems[newIndex]] = [newItems[newIndex], newItems[itemIndex]];

    await persistItemOrder(serviceId, newItems, items);
  };

  const handlePointerMove = (event: PointerEvent<Element>) => {
    if (!draggingItemId || !dragServiceId) return;
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-service-item-id]");
    const targetItemId = target?.dataset.serviceItemId;
    if (targetItemId && target.dataset.serviceId === dragServiceId) {
      setDragOverItemId(targetItemId);
    }
  };

  const handlePointerUp = async (event: PointerEvent<Element>) => {
    event.preventDefault();
    event.stopPropagation();
    suppressNextCardClickRef.current = true;
    if (draggingItemId && dragOverItemId && dragServiceId) {
      await reorderItem(dragServiceId, draggingItemId, dragOverItemId);
    }
    setDraggingItemId(null);
    setDragOverItemId(null);
    setDragServiceId(null);
    window.setTimeout(() => {
      suppressNextCardClickRef.current = false;
    }, 0);
  };

  const openAssignDialog = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setMemberSearch("");
    setMembers([]);
    setSelectedMember(null);
    setSelectedPosition("Vocals");
    setAssignDialogOpen(true);
  };

  const searchMembers = async (query: string) => {
    if (!query.trim()) {
      setMembers([]);
      return;
    }
    try {
      const data = await fetchApi(`/members?search=${encodeURIComponent(query)}`);
      setMembers(Array.isArray(data) ? data.slice(0, 10) : []);
    } catch (e) {
      console.error("No se pudieron buscar miembros:", e);
    }
  };

  const handleAssignMember = async () => {
    if (!selectedServiceId || !selectedMember) {
      toast({ title: "Selecciona un miembro", variant: "destructive" });
      return;
    }

    try {
      await fetchApi("/service-assignments", {
        method: "POST",
        body: JSON.stringify({
          serviceId: selectedServiceId,
          userId: selectedMember.id,
          position: selectedPosition,
        }),
      });
      toast({ title: "Miembro asignado" });
      setAssignDialogOpen(false);

      const serviceRes = await fetchApi(`/services/${selectedServiceId}`);
      if (serviceRes && typeof serviceRes === 'object') {
        const assignments = (serviceRes as Record<string, unknown>).assignments || [];
        setServiceAssignments((prev) => ({ ...prev, [selectedServiceId]: Array.isArray(assignments) ? assignments as ServiceAssignment[] : [] }));
      }
    } catch (e: unknown) {
      const error = e as { blocked?: boolean; message?: string };
      if (error?.blocked) {
        toast({ title: "El miembro no está disponible en esa fecha", variant: "destructive" });
      } else {
        toast({ title: error?.message || "No se pudo asignar el miembro", variant: "destructive" });
      }
    }
  };

  const handleToggleAssignment = async (serviceId: string, assignment: ServiceAssignment) => {
    try {
      await fetchApi(`/service-assignments/${assignment.id}`, {
        method: "PUT",
        body: JSON.stringify({ confirmed: !assignment.confirmed }),
      });
      setServiceAssignments((prev) => ({
        ...prev,
        [serviceId]: (prev[serviceId] || []).map((a) =>
          a.id === assignment.id ? { ...a, confirmed: !a.confirmed } : a
        ),
      }));
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "No se pudo actualizar la asignación", variant: "destructive" });
    }
  };

  const handleRemoveAssignment = async (serviceId: string, assignmentId: string) => {
    try {
      await fetchApi(`/service-assignments/${assignmentId}`, { method: "DELETE" });
      setServiceAssignments((prev) => ({
        ...prev,
        [serviceId]: (prev[serviceId] || []).filter((a) => a.id !== assignmentId),
      }));
      toast({ title: "Asignación eliminada" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "No se pudo eliminar la asignación", variant: "destructive" });
    }
  };

  const getItemIcon = (type: string) => {
    const itemType = ITEM_TYPES.find((t) => t.value === type);
    const Icon = itemType?.icon || FileText;
    return <Icon className="w-4 h-4" />;
  };

  return (
    <div className="mobile-page space-y-5">
      <div className="app-card-soft p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mobile-section-title">Planificación</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">Servicios</h1>
            <p className="mt-1 text-sm text-muted-foreground">Organiza el flujo, canciones y equipo de cada reunión.</p>
          </div>
          {isPlanner && <Button size="sm" onClick={openNewDialog} className="h-11 shrink-0 rounded-2xl px-4 shadow-sm">
          <Plus className="w-4 h-4 mr-1" /> Nuevo
        </Button>}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="min-w-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar servicios..."
              className="h-12 rounded-2xl border-zinc-200 bg-white pl-9 shadow-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-12 rounded-2xl border-zinc-200 bg-white shadow-sm">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {SERVICE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingService ? "Editar servicio" : "Nuevo servicio"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Input
                placeholder="Título del servicio"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
              />
            </div>
            <div>
              <Input
                type="datetime-local"
                value={formData.date}
                onChange={(e) =>
                  setFormData({ ...formData, date: e.target.value })
                }
              />
            </div>
            <div>
              <Select
                value={formData.type}
                onValueChange={(v) =>
                  setFormData({ ...formData, type: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona el tipo" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Textarea
                placeholder="Notas (opcional)"
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Guardando..." : editingService ? "Actualizar" : "Crear"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar servicio</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que quieres eliminar este servicio? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addItemDialogOpen} onOpenChange={setAddItemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar elemento al servicio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={newItemType === "template" ? "default" : "outline"}
                size="sm"
                onClick={() => setNewItemType("template")}
              >
                Plantilla
              </Button>
              <Button
                variant={newItemType === "song" ? "default" : "outline"}
                size="sm"
                onClick={() => setNewItemType("song")}
              >
                Canción
              </Button>
            </div>

            {newItemType === "template" ? (
              <div className="space-y-2">
                <Select
                  value={itemType}
                  onValueChange={(v) => setItemType(v as ServiceItem["type"])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo de elemento" />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                  {TEMPLATE_ITEMS.filter((t) => t.type === itemType || itemType === "song").map((t) => (
                    <Button
                      key={t.title}
                      variant={selectedTemplate?.title === t.title ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setSelectedTemplate(t);
                        setItemTitle(t.title);
                        setItemType(t.type as ServiceItem["type"]);
                      }}
                      className="justify-start"
                    >
                      {getItemIcon(t.type)} <span className="ml-2">{t.title}</span>
                    </Button>
                  ))}
                </div>
                {itemType !== "song" && !TEMPLATE_ITEMS.find((t) => t.title === itemTitle) && (
                  <Input
                    placeholder="O escribe un título personalizado"
                    value={itemTitle}
                    onChange={(e) => setItemTitle(e.target.value)}
                  />
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar canciones..."
                    className="pl-9"
                    value={songSearch}
                    onChange={(e) => {
                      setSongSearch(e.target.value);
                      searchSongs(e.target.value);
                    }}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {songs.map((song) => (
                    <Button
                      key={song.id}
                      variant={selectedSong?.id === song.id ? "default" : "ghost"}
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setSelectedSong(song);
                        setItemTitle(song.title);
                      }}
                    >
                      <Music className="w-4 h-4 mr-2" />
                      <span>{song.title}</span>
                      {song.author && <span className="ml-2 text-xs text-muted-foreground">por {song.author}</span>}
                      {song.key && <span className="ml-2 text-xs text-muted-foreground">Tono: {song.key}</span>}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAddItemDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddItem} disabled={!itemTitle.trim()}>
                Agregar elemento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar miembro del equipo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar miembros..."
                className="pl-9"
                value={memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value);
                  searchMembers(e.target.value);
                }}
              />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {members.map((member) => (
                <Button
                  key={member.id}
                  variant={selectedMember?.id === member.id ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setSelectedMember(member)}
                >
                  <Users className="w-4 h-4 mr-2" />
                  <span>{member.firstName} {member.lastName}</span>
                  {member.role && <span className="ml-2 text-xs text-muted-foreground">({member.role})</span>}
                </Button>
              ))}
            </div>
            <Select value={selectedPosition} onValueChange={setSelectedPosition}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una posición" />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAssignMember} disabled={!selectedMember}>
                Asignar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {!loading && filteredServices.length === 0 && (
          <div className="app-card p-8 text-center">
            <Music className="mx-auto mb-3 h-9 w-9 text-zinc-300" />
            <p className="text-sm text-muted-foreground">No se encontraron servicios.</p>
          </div>
        )}
        {!loading &&
          filteredServices.map((svc) => (
            <Card
              key={svc.id}
              className="app-card cursor-pointer border-zinc-200/80 transition-all hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => {
                if (suppressNextCardClickRef.current) return;
                toggleExpand(svc.id);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleExpand(svc.id);
                }
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-1.5 rounded-full bg-primary shadow-sm shadow-primary/30" />
                  <div className="flex-1">
                    <button
                      type="button"
                      className="text-left text-lg font-bold leading-tight text-zinc-950 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/app/services/${svc.id}`);
                      }}
                    >
                      {svc.title}
                    </button>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {svc.date
                        ? new Date(svc.date).toLocaleDateString("es-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                      {svc.date
                        ? ` · ${new Date(svc.date).toLocaleTimeString("es-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 w-10 rounded-xl text-lg font-bold"
                      onClick={() => toggleExpand(svc.id)}
                      aria-label={expandedService === svc.id ? "Contraer detalles del servicio" : "Expandir detalles del servicio"}
                    >
                      {expandedService === svc.id ? "−" : "+"}
                    </Button>
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10 w-10 rounded-xl"
                          onClick={() => openEditDialog(svc)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10 w-10 rounded-xl"
                          onClick={() => setDeleteId(svc.id)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {expandedService === svc.id && (
                  <div className="mt-4 space-y-5 border-t border-zinc-100 pt-4" onClick={stopInteractiveTap}>
                    {svc.notes && (
                      <p className="text-sm text-muted-foreground">{svc.notes}</p>
                    )}

                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-bold text-zinc-950">Flujo del servicio</h4>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-10 rounded-xl"
                            onClick={() => handleGenerateServicePdf(svc)}
                          >
                            <FileDown className="w-3 h-3 mr-1" /> PDF
                          </Button>
                          {isPlanner && <Button size="sm" variant="outline" className="h-10 rounded-xl" onClick={() => openAddItemDialog(svc.id)}>
                            <Plus className="w-3 h-3 mr-1" /> Agregar
                          </Button>}
                        </div>
                      </div>
                      {itemsLoading[svc.id] ? (
                        <div className="flex items-center justify-center py-4">
                          <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(serviceItems[svc.id] || []).map((item, idx) => {
                            const isSong = isSongItemType(item.type) && item.song;
                            const youtubeUrl = isSong ? getSongYoutubeUrl(item.song) : null;
                            const youtubeEmbedUrl = getYoutubeEmbedUrl(youtubeUrl);
                            const plainNotes = isSong ? getSongPlainNotes(item.song) : null;
                            const arrangement = isSong ? getPrimaryArrangement(item.song) : null;
                            const displayKey = isSong ? getItemDisplayKey(item) : null;
                            const chordPro = isSong ? getSongChordPro(item.song) : null;

                            return (
                              <div
                                key={item.id}
                                className={`overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-50/80 transition-all ${
                                  draggingItemId === item.id ? "opacity-50" : ""
                                } ${dragOverItemId === item.id && draggingItemId !== item.id ? "ring-2 ring-primary ring-offset-2" : ""}`}
                              >
                                <div
                                  data-service-item-id={item.id}
                                  data-service-id={svc.id}
                                  className="flex items-center gap-2 p-3"
                                  onClick={() => {
                                    if (isSong) toggleSongItem(item.id);
                                  }}
                                >
                                  <GripVertical
                                    className="h-4 w-4 shrink-0 cursor-grab touch-none text-muted-foreground/60 active:cursor-grabbing"
                                    onClick={stopInteractiveTap}
                                    onPointerDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      event.currentTarget.setPointerCapture(event.pointerId);
                                      suppressNextCardClickRef.current = true;
                                      setDraggingItemId(item.id);
                                      setDragOverItemId(item.id);
                                      setDragServiceId(svc.id);
                                    }}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerUp}
                                    aria-label="Arrastrar para reordenar"
                                  />
                                  <span className="text-xs text-muted-foreground w-4">{idx + 1}</span>
                                  {getItemIcon(item.type)}
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{item.song?.title || item.title}</p>
                                    {item.song?.author && (
                                      <p className="truncate text-xs text-muted-foreground">{item.song.author}</p>
                                    )}
                                  </div>
                                  {displayKey && (
                                    <Badge variant="secondary" className="shrink-0 rounded-full text-xs">Tono {displayKey}</Badge>
                                  )}
                                  {item.duration && (
                                    <span className="text-xs text-muted-foreground flex items-center">
                                      <Clock className="w-3 h-3 mr-1" />
                                      {item.duration}m
                                    </span>
                                  )}
                                  {isSong && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 rounded-xl"
                                      aria-label={expandedSongItems[item.id] ? "Contraer detalles de la canción" : "Expandir detalles de la canción"}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleSongItem(item.id);
                                      }}
                                    >
                                      {expandedSongItems[item.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </Button>
                                  )}
                                  {isPlanner && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 rounded-xl"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleDeleteItem(svc.id, item.id);
                                      }}
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>

                                {isSong && expandedSongItems[item.id] && (
                                  <div className="space-y-3 border-t border-zinc-100 bg-white p-3" onClick={stopInteractiveTap} onPointerDown={stopInteractiveTap} onTouchStart={stopInteractiveTap}>
                                    <div className="flex flex-wrap gap-2">
                                      {displayKey && (
                                        <Badge variant="secondary" className="rounded-full">Tono {displayKey}</Badge>
                                      )}
                                      {(arrangement?.bpm || item.song?.bpm) && (
                                        <Badge variant="secondary" className="rounded-full">{arrangement?.bpm || item.song?.bpm} BPM</Badge>
                                      )}
                                      {(arrangement?.meter || item.song?.meter) && (
                                        <Badge variant="secondary" className="rounded-full">{arrangement?.meter || item.song?.meter}</Badge>
                                      )}
                                      {item.song?.arrangements?.length ? (
                                        <Badge variant="outline" className="rounded-full">{item.song.arrangements.length} arreglo{item.song.arrangements.length === 1 ? "" : "s"}</Badge>
                                      ) : null}
                                    </div>

                                    {plainNotes && <p className="text-xs leading-5 text-muted-foreground">{plainNotes}</p>}

                                    <div className="flex flex-wrap gap-2">
                                      {youtubeUrl && (
                                        <Button asChild variant="outline" size="sm" className="rounded-xl">
                                          <a href={youtubeUrl} target="_blank" rel="noreferrer">
                                            <PlayCircle className="w-3 h-3" />
                                            YouTube
                                          </a>
                                        </Button>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="rounded-xl"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          navigate(`/app/songs/${item.song?.id}`);
                                        }}
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        Ver acordes
                                      </Button>
                                    </div>

                                    {youtubeEmbedUrl && (
                                      <div className="overflow-hidden rounded-2xl border border-red-100 bg-black shadow-sm">
                                        <iframe
                                          title={`YouTube - ${item.song?.title || item.title}`}
                                          src={youtubeEmbedUrl}
                                          className="aspect-video w-full"
                                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                          referrerPolicy="strict-origin-when-cross-origin"
                                          allowFullScreen
                                        />
                                      </div>
                                    )}

                                    <ChordProPreview
                                      value={chordPro}
                                      originalKey={getItemOriginalKey(item)}
                                      selectedKey={displayKey}
                                      onSelectedKeyChange={(key) => handleSaveItemKey(svc.id, item, key)}
                                      title={item.song?.title || item.title}
                                      artist={item.song?.author}
                                      maxLines={24}
                                      emptyText="Esta canción todavía no tiene acordes guardados."
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {(serviceItems[svc.id] || []).length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-2">Todavía no hay elementos</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-bold text-zinc-950">Equipo</h4>
                        {isPlanner && <Button size="sm" variant="outline" className="h-10 rounded-xl" onClick={() => openAssignDialog(svc.id)}>
                          <Plus className="w-3 h-3 mr-1" /> Asignar
                        </Button>}
                      </div>
                      <div className="space-y-2">
                        {(serviceAssignments[svc.id] || []).map((assignment) => (
                          <div key={assignment.id} className="flex items-center gap-2 rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3">
                            <button
                              onClick={() => handleToggleAssignment(svc.id, assignment)}
                              className={`w-5 h-5 rounded border flex items-center justify-center ${
                                assignment.confirmed ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground"
                              }`}
                            >
                              {assignment.confirmed && <Check className="w-3 h-3" />}
                            </button>
                            <span className="flex-1 text-sm">
                              {assignment.user?.firstName} {assignment.user?.lastName}
                            </span>
                            <span className="text-xs text-muted-foreground">{assignment.position}</span>
                            {isPlanner && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-6 h-6"
                                onClick={() => handleRemoveAssignment(svc.id, assignment.id)}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                        {(serviceAssignments[svc.id] || []).length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-2">No hay miembros asignados</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
