import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Clock, Loader2, MapPin, Plus, Trash2, UserRound } from "lucide-react";
import { eventCollectionPath, eventCrudRequest, getChurchId } from "@/lib/api";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import type { ChurchEvent, KnownEventType } from "@/types/events";
import { EVENT_TYPE_OPTIONS as EVENT_TYPES, getEventTypeLabel } from "@/types/events";
import { SectionNav } from "@/components/SectionNav";

type EventType = KnownEventType;
type EventItem = ChurchEvent;

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

const DURATION_OPTIONS = [60, 90, 120, 180];
const EVENTS_SNAPSHOT_PREFIX = "tchurch_ios_events_snapshot_v1";

type EventsSnapshot = {
  events: EventItem[];
  ministries: Ministry[];
  users: UserOption[];
};

function isEventsSnapshot(data: unknown): data is EventsSnapshot {
  if (!data || typeof data !== "object") return false;
  const snapshot = data as Partial<EventsSnapshot>;
  return Array.isArray(snapshot.events) && Array.isArray(snapshot.ministries) && Array.isArray(snapshot.users);
}

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
  visibility: "private" as "private" | "public",
  registrationEnabled: true,
  allowGuests: false,
  requiresCheckIn: true,
  capacity: "",
  askPhone: false,
  askFoodNotes: false,
  askParticipation: false,
  foodEnabled: false,
  foodTitle: "",
  foodQuantity: "8",
  participationEnabled: false,
  participationTitle: "",
  participationQuantity: "4",
  remindersEnabled: true,
  reminder30: false,
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

function advancedQuestions(form: typeof emptyForm) {
  return [
    form.askPhone ? { id: "phone", label: "Número de teléfono", type: "text", required: false } : null,
    form.askFoodNotes ? { id: "food-notes", label: "Alergias o preferencias alimentarias", type: "textarea", required: false } : null,
    form.askParticipation ? { id: "participation-interest", label: "¿En qué área te gustaría participar?", type: "textarea", required: false } : null,
  ].filter(Boolean);
}

function initialSignupItems(form: typeof emptyForm) {
  const items = [];
  const foodQuantity = Math.max(1, Number(form.foodQuantity) || 1);
  const participationQuantity = Math.max(1, Number(form.participationQuantity) || 1);

  if (form.foodEnabled && form.foodTitle.trim()) {
    items.push({
      type: "food",
      title: form.foodTitle.trim(),
      quantityNeeded: foodQuantity,
      metadata: { createdFrom: "mobile_event_create" },
    });
  }
  if (form.participationEnabled && form.participationTitle.trim()) {
    items.push({
      type: "participation",
      title: form.participationTitle.trim(),
      quantityNeeded: participationQuantity,
      metadata: { createdFrom: "mobile_event_create" },
    });
  }
  return items;
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
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const loadedOnceRef = useRef(false);
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
  const snapshotKey = sessionSnapshotKey(EVENTS_SNAPSHOT_PREFIX, selectedChurch?.id || getChurchId());

  const applyPageData = useCallback((snapshot: EventsSnapshot) => {
    setEvents(snapshot.events);
    setMinistries(snapshot.ministries);
    setUsers(snapshot.users);
    loadedOnceRef.current = true;
  }, []);

  const loadPage = useCallback(async (options?: { preferSnapshot?: boolean }) => {
    const snapshot = options?.preferSnapshot !== false
      ? readSessionSnapshot<EventsSnapshot>(snapshotKey, { validate: isEventsSnapshot })
      : null;

    if (snapshot) {
      applyPageData(snapshot.data);
      setLoading(false);
    } else if (!loadedOnceRef.current) {
      setLoading(true);
    }

    setError(null);
    try {
      const eventData = await fetchApi<EventItem[]>(eventCollectionPath("limit=120"));
      const [ministryResult, userResult] = canManage
        ? await Promise.allSettled([
            fetchApi<Ministry[]>("/ministries"),
            fetchApi<UserOption[]>("/users"),
          ])
        : [
            { status: "fulfilled", value: snapshot?.data.ministries || [] } as PromiseFulfilledResult<Ministry[]>,
            { status: "fulfilled", value: snapshot?.data.users || [] } as PromiseFulfilledResult<UserOption[]>,
          ];
      const nextSnapshot = {
        events: Array.isArray(eventData) ? eventData : [],
        ministries: ministryResult.status === "fulfilled" && Array.isArray(ministryResult.value)
          ? ministryResult.value
          : snapshot?.data.ministries || [],
        users: userResult.status === "fulfilled" && Array.isArray(userResult.value)
          ? userResult.value
          : snapshot?.data.users || [],
      };
      applyPageData(nextSnapshot);
      writeSessionSnapshot(snapshotKey, nextSnapshot);
    } catch (error) {
      console.error("No se pudieron cargar los eventos:", error);
      setError(error instanceof Error ? error.message : "No pudimos cargar los eventos.");
      if (!snapshot) toast({ title: "No pudimos cargar los eventos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [applyPageData, canManage, fetchApi, snapshotKey, toast]);

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
      visibility: event.visibility === "public" ? "public" : "private",
      registrationEnabled: event.registrationEnabled ?? true,
      allowGuests: event.allowGuests ?? false,
      requiresCheckIn: event.requiresCheckIn ?? true,
      capacity: event.capacity ? String(event.capacity) : "",
      askPhone: Boolean(event.registrationConfig?.questions?.some((question) => question.id === "phone")),
      askFoodNotes: Boolean(event.registrationConfig?.questions?.some((question) => question.id === "food-notes" || question.id === "dietary")),
      askParticipation: Boolean(event.registrationConfig?.questions?.some((question) => question.id === "participation-interest")),
      foodEnabled: Boolean(event.registrationConfig?.food?.enabled),
      foodTitle: "",
      foodQuantity: "8",
      participationEnabled: Boolean(event.registrationConfig?.participation?.enabled),
      participationTitle: "",
      participationQuantity: "4",
      remindersEnabled: event.reminderConfig?.enabled ?? true,
      reminder30: Boolean(event.reminderConfig?.offsets?.includes(30)),
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
      toast({ title: "Elige un ministerio o líder del evento", variant: "destructive" });
      return;
    }
    if (form.end && new Date(form.end).getTime() < new Date(form.start).getTime()) {
      toast({ title: "La hora de finalización debe ser posterior a la hora de inicio", variant: "destructive" });
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
        advanced: true,
        visibility: form.visibility,
        registrationEnabled: form.registrationEnabled,
        allowGuests: form.allowGuests,
        requiresCheckIn: form.requiresCheckIn,
        capacity: form.capacity || null,
        registrationConfig: {
          questions: advancedQuestions(form),
          food: {
            enabled: form.foodEnabled,
            label: "Comida",
          },
          participation: {
            enabled: form.participationEnabled,
            label: "Participación",
          },
        },
        reminderConfig: {
          enabled: form.remindersEnabled,
          offsets: form.reminder30 ? [1440, 120, 30] : [1440, 120],
          channels: ["in_app", "push", "whatsapp", "email"],
        },
        initialSignupItems: editingEvent ? [] : initialSignupItems(form),
      };

      if (editingEvent) {
        const request = eventCrudRequest("update", editingEvent.id, payload);
        await fetchApi(request.path, request.options);
        toast({ title: "Evento actualizado" });
      } else {
        const request = eventCrudRequest("create", payload);
        await fetchApi(request.path, request.options);
        toast({ title: "Evento creado" });
      }
      setDialogOpen(false);
      resetForm();
      await loadPage();
    } catch (error) {
      console.error("No se pudo guardar el evento:", error);
      toast({ title: "No se pudo guardar el evento", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const request = eventCrudRequest("delete", deleteId);
      await fetchApi(request.path, request.options);
      toast({ title: "Evento eliminado" });
      setDeleteId(null);
      await loadPage();
    } catch (error) {
      console.error("No se pudo eliminar el evento:", error);
      toast({ title: "No se pudo eliminar el evento", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
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
    <div className="mobile-page mx-auto max-w-5xl space-y-6">
      <SectionNav section="agenda" label="Agenda" />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mobile-section-title">Agenda</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Eventos</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Encuentra la fecha, el lugar y cómo participar.</p>
        </div>
        {canManage && (
          <Button onClick={openNewDialog}>
            <Plus className="h-4 w-4" /> Crear evento
          </Button>
        )}
      </header>

      <label className="block max-w-sm space-y-1.5">
        <span className="text-sm font-semibold text-foreground">Tipo de evento</span>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los tipos</option>
          {EVENT_TYPES.map((eventType) => (
            <option key={eventType.value} value={eventType.value}>{getEventTypeLabel(eventType.value)}</option>
          ))}
        </select>
      </label>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p className="font-semibold">No pudimos cargar los eventos.</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-3 border-red-200 bg-white text-red-700" onClick={() => loadPage({ preferSnapshot: false })}>
            Intentar de nuevo
          </Button>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Próximos eventos</h2>
          <Badge variant="outline">{upcoming.length}</Badge>
        </div>
        {upcoming.length === 0 ? (
          <EmptyState text="No hay próximos eventos." />
        ) : (
          upcoming.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              canManage={canManage}
              onOpen={() => navigate(`/app/events/${event.id}`)}
              onPreload={() => preloadAppRoute(`/app/events/${event.id}`)}
              onEdit={() => openEditDialog(event)}
              onDelete={() => setDeleteId(event.id)}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Eventos anteriores</h2>
          <Badge variant="outline">{past.length}</Badge>
        </div>
        {past.length === 0 ? (
          <EmptyState text="Los eventos anteriores aparecerán aquí." />
        ) : (
          past.slice(0, 10).map((event) => (
            <EventCard
              key={event.id}
              event={event}
              compact
              canManage={canManage}
              onOpen={() => navigate(`/app/events/${event.id}`)}
              onPreload={() => preloadAppRoute(`/app/events/${event.id}`)}
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
                  className={`rounded-2xl border p-3 text-left transition-colors ${
                    form.type === eventType.value ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"
                  }`}
                >
                  <p className="text-sm font-semibold">{getEventTypeLabel(eventType.value)}</p>
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
                className="rounded-2xl"
              />
              <Textarea
                rows={3}
                placeholder="Descripción breve"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="resize-none rounded-2xl"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="datetime-local"
                required
                value={form.start}
                onChange={(event) => updateStart(event.target.value)}
                className="rounded-2xl"
              />
              <Input
                type="datetime-local"
                value={form.end}
                onChange={(event) => setForm((prev) => ({ ...prev, end: event.target.value }))}
                className="rounded-2xl"
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
                  className="rounded-full"
                >
                  {option % 60 === 0 ? `${option / 60}h` : `${option}m`}
                </Button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ministerio organizador</span>
                <select
                  value={form.ministryId}
                  onChange={(event) => setForm((prev) => ({ ...prev, ministryId: event.target.value }))}
                  className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Toda la iglesia</option>
                  {ministries.map((ministry) => (
                    <option key={ministry.id} value={ministry.id}>{ministry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Líder del evento</span>
                <select
                  value={form.leaderId}
                  onChange={(event) => setForm((prev) => ({ ...prev, leaderId: event.target.value }))}
                  className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Seleccionar líder</option>
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
              className="rounded-2xl"
            />
            <Textarea
              rows={3}
              placeholder="Notas: montaje, estacionamiento, cuidado de niños..."
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              className="resize-none rounded-2xl"
            />

            <AdvancedSection title="Registro y visibilidad">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Visibilidad</span>
                  <select
                    value={form.visibility}
                    onChange={(event) => setForm((prev) => ({ ...prev, visibility: event.target.value as "private" | "public" }))}
                    className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="private">Solo en la app</option>
                    <option value="public">Publicar en el sitio web</option>
                  </select>
                </label>
                <Input
                  type="number"
                  min={1}
                  placeholder="Capacidad opcional"
                  value={form.capacity}
                  onChange={(event) => setForm((prev) => ({ ...prev, capacity: event.target.value }))}
                  className="rounded-2xl self-end"
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <ToggleRow label="Registro abierto" checked={form.registrationEnabled} onChange={(value) => setForm((prev) => ({ ...prev, registrationEnabled: value }))} />
                <ToggleRow label="Permitir invitados" checked={form.allowGuests} onChange={(value) => setForm((prev) => ({ ...prev, allowGuests: value }))} />
                <ToggleRow label="Check-in con QR" checked={form.requiresCheckIn} onChange={(value) => setForm((prev) => ({ ...prev, requiresCheckIn: value }))} />
              </div>
            </AdvancedSection>

            <AdvancedSection title="Formulario de registro">
              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleRow label="Pedir teléfono" checked={form.askPhone} onChange={(value) => setForm((prev) => ({ ...prev, askPhone: value }))} />
                <ToggleRow label="Notas de comida" checked={form.askFoodNotes} onChange={(value) => setForm((prev) => ({ ...prev, askFoodNotes: value }))} />
                <ToggleRow label="Área de participación" checked={form.askParticipation} onChange={(value) => setForm((prev) => ({ ...prev, askParticipation: value }))} />
              </div>
            </AdvancedSection>

            <AdvancedSection title="Comida y participación">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-3">
                  <ToggleRow label="Registro para llevar comida" checked={form.foodEnabled} onChange={(value) => setForm((prev) => ({ ...prev, foodEnabled: value }))} />
                  {form.foodEnabled && !editingEvent && (
                    <div className="mt-3 grid gap-2">
                      <Input
                        placeholder="Artículo, por ejemplo: bebidas"
                        value={form.foodTitle}
                        onChange={(event) => setForm((prev) => ({ ...prev, foodTitle: event.target.value }))}
                        className="rounded-2xl"
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="Cantidad necesaria"
                        value={form.foodQuantity}
                        onChange={(event) => setForm((prev) => ({ ...prev, foodQuantity: event.target.value }))}
                        className="rounded-2xl"
                      />
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-border bg-card p-3">
                  <ToggleRow label="Registro para participar" checked={form.participationEnabled} onChange={(value) => setForm((prev) => ({ ...prev, participationEnabled: value }))} />
                  {form.participationEnabled && !editingEvent && (
                    <div className="mt-3 grid gap-2">
                      <Input
                        placeholder="Función, por ejemplo: anfitriones"
                        value={form.participationTitle}
                        onChange={(event) => setForm((prev) => ({ ...prev, participationTitle: event.target.value }))}
                        className="rounded-2xl"
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="Cantidad necesaria"
                        value={form.participationQuantity}
                        onChange={(event) => setForm((prev) => ({ ...prev, participationQuantity: event.target.value }))}
                        className="rounded-2xl"
                      />
                    </div>
                  )}
                </div>
              </div>
            </AdvancedSection>

            <AdvancedSection title="Recordatorios">
              <div className="grid gap-2 sm:grid-cols-2">
                <ToggleRow label="Recordatorios 24 h + 2 h" checked={form.remindersEnabled} onChange={(value) => setForm((prev) => ({ ...prev, remindersEnabled: value }))} />
                <ToggleRow label="Agregar recordatorio 30 min" checked={form.reminder30} onChange={(value) => setForm((prev) => ({ ...prev, reminder30: value }))} />
              </div>
            </AdvancedSection>

            <div className="rounded-2xl border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">{form.title || "Vista previa del evento"}</p>
              <p className="mt-1 text-muted-foreground">{form.start ? `${formatDate(form.start)} · ${formatTime(form.start)}` : "Elige una hora"}</p>
              <p className="mt-1 text-muted-foreground">
                {selectedMinistry?.name || selectedLeader ? [selectedMinistry?.name, selectedLeader ? displayName(selectedLeader) : ""].filter(Boolean).join(" · ") : "Elige un ministerio o líder"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {form.visibility === "public" ? "Visible en el sitio web" : "Evento privado en la app"} · {form.registrationEnabled ? "Registro y QR disponibles" : "Registro cerrado"}
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

function AdvancedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-muted/30 p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-2 text-sm font-semibold">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="app-card">
      <CardContent className="p-8 text-center text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function EventCard({
  event,
  canManage,
  compact = false,
  onOpen,
  onPreload,
  onEdit,
  onDelete,
}: {
  event: EventItem;
  canManage: boolean;
  compact?: boolean;
  onOpen: () => void;
  onPreload?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const leader = leaderName(event);

  return (
    <Card
      className="app-card cursor-pointer transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="link"
      tabIndex={0}
      aria-label={`Abrir ${event.title}`}
      onClick={onOpen}
      onFocus={onPreload}
      onPointerEnter={onPreload}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.target !== keyboardEvent.currentTarget) return;
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className={compact ? "p-4" : "p-5"}>
        <div className="flex items-start gap-3">
          <div className="h-12 w-1 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{getEventTypeLabel(event.type)}</Badge>
              {event.ministryName && (
                <Badge variant="outline" className="gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: event.ministryColor || "#6366f1" }} />
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
              <Button variant="ghost" size="sm" onClick={onEdit}>Editar</Button>
              <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Eliminar ${event.title}`}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
