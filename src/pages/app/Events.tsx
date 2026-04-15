import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
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

const EVENT_TYPES = ["Sunday Service", "Bible Study", "Youth", "Other"];

const emptyForm = {
  name: "",
  date: "",
  time: "",
  type: "Sunday Service",
  location: "",
  description: "",
};

export default function Events() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadEvents();
  }, [fetchApi]);

  const loadEvents = () => {
    setLoading(true);
    fetchApi("/events")
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load events:", e))
      .finally(() => setLoading(false));
  };

  const openNewDialog = () => {
    setEditingEvent(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (event: Event) => {
    setEditingEvent(event);
    setFormData({
      name: event.name || event.title || "",
      date: event.date ? event.date.split("T")[0] : "",
      time: event.time || "",
      type: event.type || "Sunday Service",
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
    if (!formData.name.trim() || !formData.date) return;
    setSubmitting(true);

    const payload = {
      ...formData,
      date: new Date(formData.date).toISOString(),
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
        <Button size="sm" onClick={openNewDialog}>
          <Plus className="w-4 h-4 mr-1" /> New Event
        </Button>
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
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
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
                    <SelectItem key={t} value={t}>
                      {t}
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
                disabled={submitting || !formData.name.trim() || !formData.date}
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
          >
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-1 h-10 rounded bg-primary" />
              <div className="flex-1">
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
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground capitalize mr-2">
                  {ev.status || ""}
                </span>
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
