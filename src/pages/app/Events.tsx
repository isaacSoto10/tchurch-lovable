import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Check } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Event {
  id: string;
  name?: string;
  title?: string;
  date?: string;
  time?: string;
  location?: string;
  type?: string;
  description?: string;
  status?: string;
}

const EVENT_TYPES = [
  { label: "Sunday Service", value: "sunday_service" },
  { label: "Wednesday Service", value: "wednesday_service" },
  { label: "Bible Study", value: "bible_study" },
  { label: "Youth", value: "youth" },
  { label: "Special", value: "special" },
  { label: "Other", value: "other" },
];

const emptyForm = {
  title: "",
  date: "",
  time: "",
  type: "sunday_service",
  location: "",
  description: "",
};

export default function Events() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [rsvps, setRsvps] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadEvents();
  }, [fetchApi]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const data = await fetchApi("/events");
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load events:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleRsvp = async (eventId: string, status: string) => {
    try {
      await fetchApi(`/events/${eventId}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setRsvps((prev) => ({ ...prev, [eventId]: status }));
      toast({ title: `RSVP: ${status}` });
    } catch (e) {
      toast({ title: "Failed to update RSVP", variant: "destructive" });
    }
  };

  const handleRemoveRsvp = async (eventId: string) => {
    try {
      await fetchApi(`/events/${eventId}/rsvp`, { method: "DELETE" });
      setRsvps((prev) => {
        const newRsvps = { ...prev };
        delete newRsvps[eventId];
        return newRsvps;
      });
      toast({ title: "RSVP removed" });
    } catch (e) {
      toast({ title: "Failed to remove RSVP", variant: "destructive" });
    }
  };

  const openNewDialog = () => {
    setEditingEvent(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (event: Event) => {
    setEditingEvent(event);
    setFormData({
      title: event.title || event.name || "",
      date: event.date ? event.date.split("T")[0] : "",
      time: event.time || "",
      type: event.type || "sunday_service",
      location: event.location || "",
      description: event.description || "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingEvent(null);
    setFormData(emptyForm);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim() || !formData.date) return;
    setSubmitting(true);

    const payload = {
      title: formData.title,
      date: new Date(formData.date).toISOString(),
      type: formData.type,
      location: formData.location || null,
      description: formData.description || null,
    };

    try {
      if (editingEvent) {
        await fetchApi(`/events/${editingEvent.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "Event updated successfully" });
      } else {
        await fetchApi("/events", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Event created successfully" });
      }
      closeDialog();
      loadEvents();
    } catch (e) {
      toast({ title: "Failed to save event", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await fetchApi(`/events/${deleteId}`, { method: "DELETE" });
      toast({ title: "Event deleted successfully" });
      setDeleteId(null);
      loadEvents();
    } catch (e) {
      toast({ title: "Failed to delete event", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Events</h1>
        {isAdmin && <Button size="sm" onClick={openNewDialog}>
          <Plus className="w-4 h-4 mr-1" /> New Event
        </Button>}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingEvent ? "Edit Event" : "New Event"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Input
                placeholder="Event title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Input
                  type="date"
                  value={formData.date}
                  onChange={(e) =>
                    setFormData({ ...formData, date: e.target.value })
                  }
                />
              </div>
              <div>
                <Input
                  type="time"
                  placeholder="Time (optional)"
                  value={formData.time}
                  onChange={(e) =>
                    setFormData({ ...formData, time: e.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <Select
                value={formData.type}
                onValueChange={(v) => setFormData({ ...formData, type: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Input
                placeholder="Location"
                value={formData.location}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
              />
            </div>
            <div>
              <Textarea
                placeholder="Description (optional)"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !formData.title.trim() || !formData.date}
              >
                {submitting ? "Saving..." : editingEvent ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-3">
        {events.length === 0 && (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        )}
        {events.map((ev) => (
          <Card
            key={ev.id}
            className="hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => navigate(`/app/events/${ev.id}`)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-1 h-10 rounded bg-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{ev.name || ev.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {ev.date
                      ? new Date(ev.date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })
                      : ""}
                    {ev.time ? ` · ${ev.time}` : ""}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </p>
                  {ev.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ev.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-muted-foreground capitalize mr-2">
                    {ev.status || ""}
                  </span>
                  {isAdmin && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(ev)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(ev.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3 ml-4">
                {(["yes", "no", "maybe"] as const).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={rsvps[ev.id] === status ? "default" : "outline"}
                    onClick={(e) => { e.stopPropagation(); rsvps[ev.id] === status ? handleRemoveRsvp(ev.id) : handleRsvp(ev.id, status); }}
                    className="capitalize"
                  >
                    {status === "yes" && <Check className="w-3 h-3 mr-1" />}
                    {status}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
