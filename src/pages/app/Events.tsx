import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CalendarDays, Clock, Loader2, MapPin, Plus, Trash2, UserRound } from "lucide-react";
import { eventCollectionPath, eventCrudRequest, getChurchId } from "@/lib/api";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import type { ChurchEvent, KnownEventType } from "@/types/events";
import { EVENT_TYPE_OPTIONS as EVENT_TYPES, getEventTypeLabel } from "@/types/events";

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
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function advancedQuestions(form: typeof emptyForm) {
  return [
    form.askPhone ? { id: "phone", label: "Phone number", type: "text", required: false } : null,
    form.askFoodNotes ? { id: "food-notes", label: "Food allergies or preferences", type: "textarea", required: false } : null,
    form.askParticipation ? { id: "participation-interest", label: "Where would you like to participate?", type: "textarea", required: false } : null,
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

    try {
      const [eventData, ministryData, userData] = await Promise.all([
        fetchApi<EventItem[]>(eventCollectionPath("limit=120")),
        fetchApi<Ministry[]>("/ministries"),
        fetchApi<UserOption[]>("/users"),
      ]);
      const nextSnapshot = {
        events: Array.isArray(eventData) ? eventData : [],
        ministries: Array.isArray(ministryData) ? ministryData : [],
        users: Array.isArray(userData) ? userData : [],
      };
      applyPageData(nextSnapshot);
      writeSessionSnapshot(snapshotKey, nextSnapshot);
    } catch (error) {
      console.error("Failed to load events:", error);
      toast({ title: "Failed to load events", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [applyPageData, fetchApi, snapshotKey, toast]);

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
            label: "Food",
          },
          participation: {
            enabled: form.participationEnabled,
            label: "Participation",
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
        toast({ title: "Event updated" });
      } else {
        const request = eventCrudRequest("create", payload);
        await fetchApi(request.path, request.options);
        toast({ title: "Event created" });
      }
      setDialogOpen(false);
      resetForm();
      await loadPage();
    } catch (error) {
      console.error("Failed to save event:", error);
      toast({ title: "Failed to save event", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const request = eventCrudRequest("delete", deleteId);
      await fetchApi(request.path, request.options);
      toast({ title: "Event deleted" });
      setDeleteId(null);
      await loadPage();
    } catch (error) {
      console.error("Failed to delete event:", error);
      toast({ title: "Failed to delete event", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
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
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/10 bg-gradient-to-br from-white via-slate-50 to-sky-50">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="secondary" className="w-fit gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              Church calendar
            </Badge>
            {canManage && (
              <Button size="sm" onClick={openNewDialog} className="rounded-full">
                <Plus className="h-4 w-4" />
                Create event
              </Button>
            )}
          </div>
          <div>
            <CardTitle className="text-2xl leading-tight">Events that are easy to understand.</CardTitle>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Keep the essentials visible: when it happens, where it happens, and who owns it.
            </p>
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="min-h-11 rounded-2xl border bg-white px-4 text-sm font-medium outline-none"
          >
            <option value="">All types</option>
            {EVENT_TYPES.map((eventType) => (
              <option key={eventType.value} value={eventType.value}>{getEventTypeLabel(eventType.value)}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Upcoming" value={upcoming.length} />
            <Stat label="Ministry-led" value={events.filter((event) => event.ministryId).length} />
            <Stat label="With location" value={events.filter((event) => event.location).length} />
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Upcoming events</h2>
          <Badge variant="outline">{upcoming.length}</Badge>
        </div>
        {upcoming.length === 0 ? (
          <EmptyState text="No upcoming events yet." />
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
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Past events</h2>
          <Badge variant="outline">{past.length}</Badge>
        </div>
        {past.length === 0 ? (
          <EmptyState text="Past events will appear here." />
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
            <DialogTitle>{editingEvent ? "Edit event" : "Create event"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {EVENT_TYPES.map((eventType) => (
                <button
                  key={eventType.value}
                  type="button"
                  onClick={() => applyTemplate(eventType.value)}
                  className={`rounded-2xl border p-3 text-left transition-colors ${
                    form.type === eventType.value ? "border-primary bg-primary/5" : "bg-white hover:bg-muted/40"
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
                placeholder="Event title"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                className="rounded-2xl"
              />
              <Textarea
                rows={3}
                placeholder="Short description"
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
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Organizing ministry</span>
                <select
                  value={form.ministryId}
                  onChange={(event) => setForm((prev) => ({ ...prev, ministryId: event.target.value }))}
                  className="w-full min-h-10 rounded-2xl border bg-white px-3 text-sm outline-none"
                >
                  <option value="">No ministry / church-wide</option>
                  {ministries.map((ministry) => (
                    <option key={ministry.id} value={ministry.id}>{ministry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Event leader</span>
                <select
                  value={form.leaderId}
                  onChange={(event) => setForm((prev) => ({ ...prev, leaderId: event.target.value }))}
                  className="w-full min-h-10 rounded-2xl border bg-white px-3 text-sm outline-none"
                >
                  <option value="">Select a leader</option>
                  {leaderOptions.map((user) => (
                    <option key={user.id} value={user.id}>{displayName(user)}</option>
                  ))}
                </select>
              </label>
            </div>

            <Input
              placeholder="Location"
              value={form.location}
              onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
              className="rounded-2xl"
            />
            <Textarea
              rows={3}
              placeholder="Special notes: setup, parking, childcare, what to bring..."
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              className="resize-none rounded-2xl"
            />

            <AdvancedSection title="Registration and visibility">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Visibility</span>
                  <select
                    value={form.visibility}
                    onChange={(event) => setForm((prev) => ({ ...prev, visibility: event.target.value as "private" | "public" }))}
                    className="w-full min-h-10 rounded-2xl border bg-white px-3 text-sm outline-none"
                  >
                    <option value="private">Private app event</option>
                    <option value="public">Publish on website</option>
                  </select>
                </label>
                <Input
                  type="number"
                  min={1}
                  placeholder="Capacity, optional"
                  value={form.capacity}
                  onChange={(event) => setForm((prev) => ({ ...prev, capacity: event.target.value }))}
                  className="rounded-2xl self-end"
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <ToggleRow label="Registration open" checked={form.registrationEnabled} onChange={(value) => setForm((prev) => ({ ...prev, registrationEnabled: value }))} />
                <ToggleRow label="Allow guests" checked={form.allowGuests} onChange={(value) => setForm((prev) => ({ ...prev, allowGuests: value }))} />
                <ToggleRow label="QR check-in" checked={form.requiresCheckIn} onChange={(value) => setForm((prev) => ({ ...prev, requiresCheckIn: value }))} />
              </div>
            </AdvancedSection>

            <AdvancedSection title="Registration form">
              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleRow label="Ask phone" checked={form.askPhone} onChange={(value) => setForm((prev) => ({ ...prev, askPhone: value }))} />
                <ToggleRow label="Food notes" checked={form.askFoodNotes} onChange={(value) => setForm((prev) => ({ ...prev, askFoodNotes: value }))} />
                <ToggleRow label="Participation area" checked={form.askParticipation} onChange={(value) => setForm((prev) => ({ ...prev, askParticipation: value }))} />
              </div>
            </AdvancedSection>

            <AdvancedSection title="Food and participation">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border bg-white p-3">
                  <ToggleRow label="Food sign-up" checked={form.foodEnabled} onChange={(value) => setForm((prev) => ({ ...prev, foodEnabled: value }))} />
                  {form.foodEnabled && !editingEvent && (
                    <div className="mt-3 grid gap-2">
                      <Input
                        placeholder="Food item, e.g. Drinks"
                        value={form.foodTitle}
                        onChange={(event) => setForm((prev) => ({ ...prev, foodTitle: event.target.value }))}
                        className="rounded-2xl"
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="Needed"
                        value={form.foodQuantity}
                        onChange={(event) => setForm((prev) => ({ ...prev, foodQuantity: event.target.value }))}
                        className="rounded-2xl"
                      />
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border bg-white p-3">
                  <ToggleRow label="Participation sign-up" checked={form.participationEnabled} onChange={(value) => setForm((prev) => ({ ...prev, participationEnabled: value }))} />
                  {form.participationEnabled && !editingEvent && (
                    <div className="mt-3 grid gap-2">
                      <Input
                        placeholder="Role, e.g. Greeters"
                        value={form.participationTitle}
                        onChange={(event) => setForm((prev) => ({ ...prev, participationTitle: event.target.value }))}
                        className="rounded-2xl"
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="Needed"
                        value={form.participationQuantity}
                        onChange={(event) => setForm((prev) => ({ ...prev, participationQuantity: event.target.value }))}
                        className="rounded-2xl"
                      />
                    </div>
                  )}
                </div>
              </div>
            </AdvancedSection>

            <AdvancedSection title="Reminders">
              <div className="grid gap-2 sm:grid-cols-2">
                <ToggleRow label="24h + 2h reminders" checked={form.remindersEnabled} onChange={(value) => setForm((prev) => ({ ...prev, remindersEnabled: value }))} />
                <ToggleRow label="Add 30m reminder" checked={form.reminder30} onChange={(value) => setForm((prev) => ({ ...prev, reminder30: value }))} />
              </div>
            </AdvancedSection>

            <div className="rounded-2xl border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">{form.title || "Event preview"}</p>
              <p className="mt-1 text-muted-foreground">{form.start ? `${formatDate(form.start)} · ${formatTime(form.start)}` : "Pick a time"}</p>
              <p className="mt-1 text-muted-foreground">
                {selectedMinistry?.name || selectedLeader ? [selectedMinistry?.name, selectedLeader ? displayName(selectedLeader) : ""].filter(Boolean).join(" · ") : "Choose a ministry or leader"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {form.visibility === "public" ? "Public website" : "Private app event"} · {form.registrationEnabled ? "RSVP + QR ready" : "RSVP closed"}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting || !form.title.trim() || !form.start || (!form.ministryId && !form.leaderId)}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? "Saving..." : editingEvent ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AdvancedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-muted/30 p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border bg-white px-3 py-2 text-sm font-semibold">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/80 p-3 text-center shadow-sm">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
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
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onOpen}
      onFocus={onPreload}
      onPointerEnter={onPreload}
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
              <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
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
