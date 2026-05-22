import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useToast } from "@/components/ui/use-toast";
import { CalendarDays, Clock, Loader2, MapPin, Plus, Trash2, UserRound } from "lucide-react";

type EventType = "service" | "bible_study" | "fellowship" | "youth" | "children" | "special_event";

interface EventItem {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  endDate?: string | null;
  location?: string | null;
  type?: EventType | string | null;
  notes?: string | null;
  ministryId?: string | null;
  leaderId?: string | null;
  ministryName?: string | null;
  ministryColor?: string | null;
  leaderFirstName?: string | null;
  leaderLastName?: string | null;
  leaderEmail?: string | null;
}

interface Ministry {
  id: string;
  name: string;
  color?: string | null;
}

interface UserOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

const TYPE_LABELS: Record<EventType, string> = {
  service: "Service",
  bible_study: "Bible Study",
  fellowship: "Fellowship",
  youth: "Youth",
  children: "Children",
  special_event: "Special Event",
};

const EVENT_TYPES: Array<{ value: EventType; title: string; description: string }> = [
  { value: "service", title: "Special Service", description: "A service for worship, prayer, and church-wide connection." },
  { value: "bible_study", title: "Bible Study", description: "A focused time to study Scripture and grow together." },
  { value: "fellowship", title: "Fellowship Gathering", description: "A warm gathering for food, connection, and community." },
  { value: "youth", title: "Youth Night", description: "A night for students to worship and build friendships." },
  { value: "children", title: "Children's Event", description: "A safe and joyful event for children and families." },
  { value: "special_event", title: "Special Event", description: "A church event with clear details for everyone attending." },
];

const DURATION_OPTIONS = [60, 90, 120, 180];

const emptyForm = {
  title: "",
  description: "",
  start: "",
  end: "",
  location: "",
  type: "special_event" as EventType,
  ministryId: "",
  leaderId: "",
  notes: "",
  duration: 90,
};

function toLocalInputValue(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 16);
}

function addMinutes(value: string, minutes: number) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + minutes);
  return toLocalInputValue(date);
}

function defaultStart() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(19, 0, 0, 0);
  return toLocalInputValue(date);
}

function displayName(user: UserOption) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

function leaderName(event: EventItem) {
  return [event.leaderFirstName, event.leaderLastName].filter(Boolean).join(" ") || event.leaderEmail || null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" });
}

function typeLabel(type?: string | null) {
  return type && TYPE_LABELS[type as EventType] ? TYPE_LABELS[type as EventType] : type || "Evento";
}

export default function Events() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [form, setForm] = useState(() => {
    const start = defaultStart();
    return { ...emptyForm, start, end: addMinutes(start, emptyForm.duration) };
  });

  const canManage = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";
  const now = Date.now();
  const filteredEvents = typeFilter ? events.filter((event) => event.type === typeFilter) : events;
  const upcoming = filteredEvents
    .filter((event) => new Date(event.endDate || event.date).getTime() >= now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const past = filteredEvents
    .filter((event) => new Date(event.endDate || event.date).getTime() < now)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const leaderOptions = useMemo(() => [...users].sort((a, b) => displayName(a).localeCompare(displayName(b))), [users]);
  const selectedMinistry = ministries.find((ministry) => ministry.id === form.ministryId);
  const selectedLeader = users.find((user) => user.id === form.leaderId);

  const loadPage = useCallback(async () => {
    setLoading(true);
    try {
      const [eventData, ministryData, userData] = await Promise.all([
        fetchApi<EventItem[]>("/events?limit=200"),
        fetchApi<Ministry[]>("/ministries"),
        fetchApi<UserOption[]>("/users"),
      ]);
      setEvents(Array.isArray(eventData) ? eventData : []);
      setMinistries(Array.isArray(ministryData) ? ministryData : []);
      setUsers(Array.isArray(userData) ? userData : []);
    } catch (error) {
      console.error("Failed to load events:", error);
      toast({ title: "No se pudieron cargar los eventos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchApi, toast]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  function resetForm() {
    const start = defaultStart();
    setForm({ ...emptyForm, start, end: addMinutes(start, emptyForm.duration) });
  }

  function openNewDialog() {
    setEditingEvent(null);
    resetForm();
    setDialogOpen(true);
  }

  function openEditDialog(event: EventItem) {
    const start = toLocalInputValue(new Date(event.date));
    const end = event.endDate ? toLocalInputValue(new Date(event.endDate)) : addMinutes(start, emptyForm.duration);
    setEditingEvent(event);
    setForm({
      title: event.title || "",
      description: event.description || "",
      start,
      end,
      location: event.location || "",
      type: (event.type as EventType) || "special_event",
      ministryId: event.ministryId || "",
      leaderId: event.leaderId || "",
      notes: event.notes || "",
      duration: emptyForm.duration,
    });
    setDialogOpen(true);
  }

  function applyTemplate(type: EventType) {
    const template = EVENT_TYPES.find((item) => item.value === type);
    setForm((prev) => ({
      ...prev,
      type,
      title: prev.title || template?.title || "",
      description: prev.description || template?.description || "",
    }));
  }

  function updateStart(value: string) {
    setForm((prev) => ({ ...prev, start: value, end: addMinutes(value, prev.duration) }));
  }

  function updateDuration(duration: number) {
    setForm((prev) => ({ ...prev, duration, end: addMinutes(prev.start, duration) }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || !form.start) return;
    if (!form.ministryId && !form.leaderId) {
      toast({ title: "Choose a ministry or event leader", variant: "destructive" });
      return;
    }
    if (form.end && new Date(form.end).getTime() < new Date(form.start).getTime()) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: form.title,
        description: form.description,
        date: form.start,
        endDate: form.end || null,
        location: form.location || null,
        type: form.type,
        ministryId: form.ministryId || null,
        leaderId: form.leaderId || null,
        notes: form.notes || null,
      };

      if (editingEvent) {
        await fetchApi(`/events/${editingEvent.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "Event updated" });
      } else {
        await fetchApi("/events", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Event created" });
      }
      setDialogOpen(false);
      resetForm();
      await loadPage();
    } catch (error) {
      console.error("Failed to save event:", error);
      toast({ title: "No se pudo guardar el evento", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await fetchApi(`/events/${deleteId}`, { method: "DELETE" });
      toast({ title: "Event deleted" });
      setDeleteId(null);
      await loadPage();
    } catch (error) {
      console.error("Failed to delete event:", error);
      toast({ title: "No se pudo eliminar el evento", variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="app-page space-y-6">
      <Card className="app-page-header overflow-hidden">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="secondary" className="w-fit gap-1 rounded-md">
              <CalendarDays className="h-3.5 w-3.5" />
              Calendario
            </Badge>
            {canManage && (
              <Button size="sm" onClick={openNewDialog} className="h-10 rounded-md">
                <Plus className="h-4 w-4" />
                Crear evento
              </Button>
            )}
          </div>
          <div>
            <CardTitle className="app-page-title">Eventos claros para toda la iglesia.</CardTitle>
            <p className="app-page-copy">
              Mantén visible cuándo sucede, dónde sucede y quién lo coordina.
            </p>
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="app-control px-4 text-sm font-medium outline-none"
          >
            <option value="">Todos los tipos</option>
            {EVENT_TYPES.map((eventType) => (
              <option key={eventType.value} value={eventType.value}>{TYPE_LABELS[eventType.value]}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Próximos" value={upcoming.length} />
            <Stat label="Ministerios" value={events.filter((event) => event.ministryId).length} />
            <Stat label="Con lugar" value={events.filter((event) => event.location).length} />
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="app-section-title">Próximos eventos</h2>
          <Badge variant="outline">{upcoming.length}</Badge>
        </div>
        {upcoming.length === 0 ? (
          <EmptyState text="Todavía no hay eventos próximos." />
        ) : (
          upcoming.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              canManage={canManage}
              onOpen={() => navigate(`/app/events/${event.id}`)}
              onEdit={() => openEditDialog(event)}
              onDelete={() => setDeleteId(event.id)}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="app-section-title">Eventos pasados</h2>
          <Badge variant="outline">{past.length}</Badge>
        </div>
        {past.length === 0 ? (
          <EmptyState text="Los eventos pasados aparecerán aquí." />
        ) : (
          past.slice(0, 10).map((event) => (
            <EventCard
              key={event.id}
              event={event}
              compact
              canManage={canManage}
              onOpen={() => navigate(`/app/events/${event.id}`)}
              onEdit={() => openEditDialog(event)}
              onDelete={() => setDeleteId(event.id)}
            />
          ))
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingEvent ? "Editar evento" : "Crear evento"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {EVENT_TYPES.map((eventType) => (
                <button
                  key={eventType.value}
                  type="button"
                  onClick={() => applyTemplate(eventType.value)}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    form.type === eventType.value ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"
                  }`}
                >
                  <p className="text-sm font-semibold">{TYPE_LABELS[eventType.value]}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{eventType.description}</p>
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <Input
                required
                placeholder="Título del evento"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                className="rounded-md"
              />
              <Textarea
                rows={3}
                placeholder="Descripción corta"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="resize-none rounded-md"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="datetime-local"
                required
                value={form.start}
                onChange={(event) => updateStart(event.target.value)}
                className="rounded-md"
              />
              <Input
                type="datetime-local"
                value={form.end}
                onChange={(event) => setForm((prev) => ({ ...prev, end: event.target.value }))}
                className="rounded-md"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={form.duration === option ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateDuration(option)}
                  className="rounded-md"
                >
                  {option % 60 === 0 ? `${option / 60}h` : `${option}m`}
                </Button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Ministerio organizador</span>
                <select
                  value={form.ministryId}
                  onChange={(event) => setForm((prev) => ({ ...prev, ministryId: event.target.value }))}
                  className="app-control w-full px-3 text-sm outline-none"
                >
                  <option value="">Sin ministerio / toda la iglesia</option>
                  {ministries.map((ministry) => (
                    <option key={ministry.id} value={ministry.id}>{ministry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Líder del evento</span>
                <select
                  value={form.leaderId}
                  onChange={(event) => setForm((prev) => ({ ...prev, leaderId: event.target.value }))}
                  className="app-control w-full px-3 text-sm outline-none"
                >
                  <option value="">Selecciona un líder</option>
                  {leaderOptions.map((user) => (
                    <option key={user.id} value={user.id}>{displayName(user)}</option>
                  ))}
                </select>
              </label>
            </div>

            <Input
              placeholder="Lugar"
              value={form.location}
              onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
              className="rounded-md"
            />
            <Textarea
              rows={3}
              placeholder="Notas especiales: montaje, estacionamiento, cuidado de niños, qué traer..."
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              className="resize-none rounded-md"
            />

            <div className="rounded-md border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">{form.title || "Vista previa del evento"}</p>
              <p className="mt-1 text-muted-foreground">{form.start ? `${formatDate(form.start)} - ${formatTime(form.start)}` : "Elige una hora"}</p>
              <p className="mt-1 text-muted-foreground">
                {selectedMinistry?.name || selectedLeader ? [selectedMinistry?.name, selectedLeader ? displayName(selectedLeader) : ""].filter(Boolean).join(" - ") : "Elige un ministerio o líder"}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting || !form.title.trim() || !form.start || (!form.ministryId && !form.leaderId)}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? "Guardando..." : editingEvent ? "Actualizar" : "Crear"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar evento</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="dashboard-stat text-center">
      <p className="dashboard-metric text-2xl font-semibold">{value}</p>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="app-list-card border-dashed">
      <CardContent className="p-8 text-center text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function EventCard({
  event,
  canManage,
  compact = false,
  onOpen,
  onEdit,
  onDelete,
}: {
  event: EventItem;
  canManage: boolean;
  compact?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const leader = leaderName(event);

  return (
    <Card className="app-list-card cursor-pointer" onClick={onOpen}>
      <CardContent className={compact ? "p-4" : "p-5"}>
        <div className="flex items-start gap-3">
          <div className="h-12 w-2 shrink-0 rounded-sm bg-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{typeLabel(event.type)}</Badge>
              {event.ministryName && (
                <Badge variant="outline" className="gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: event.ministryColor || "hsl(var(--primary))" }} />
                  {event.ministryName}
                </Badge>
              )}
            </div>
            <h3 className="mt-2 font-semibold leading-tight">{event.title}</h3>
            {event.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.description}</p>}
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {formatDate(event.date)} · {formatTime(event.date)}
              </span>
              {event.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {event.location}
                </span>
              )}
              {leader && (
                <span className="flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5" />
                  {leader}
                </span>
              )}
            </div>
          </div>
          {canManage && (
            <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="sm" className="rounded-md" onClick={onEdit}>Editar</Button>
              <Button variant="ghost" size="icon" onClick={onDelete}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
