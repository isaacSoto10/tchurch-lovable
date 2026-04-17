import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, MapPin, Calendar, Clock, Users, Check, X, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";

type Attendee = {
  id: string;
  userId: string;
  response: "yes" | "no" | "maybe";
  user: { firstName: string | null; lastName: string | null; email: string } | null;
};

type Event = {
  id: string;
  title: string;
  description: string | null;
  date: string;
  endDate: string | null;
  type: string;
  location: string | null;
  rsvpDeadline: string | null;
  maxAttendees: number | null;
  attendees: Attendee[];
  createdAt: string;
};

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  const isAdmin = selectedChurch?.role === "ADMIN";

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const data = await apiFetch<Event>(`/events/${id}`);
        if (data.error) { navigate("/app/events"); return; }
        setEvent(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleRSVP(response: "yes" | "no" | "maybe") {
    if (!id) return;
    setRsvpLoading(true);
    try {
      await apiFetch(`/events/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ response }),
      });
      // Refresh event
      const data = await apiFetch<Event>(`/events/${id}`);
      setEvent(data);
    } catch (e) {
      console.error(e);
    } finally {
      setRsvpLoading(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await apiFetch(`/events/${id}`, { method: "DELETE" });
      navigate("/app/events");
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Event not found</p>
        <Button variant="ghost" onClick={() => navigate("/app/events")} className="mt-2">Back</Button>
      </div>
    );
  }

  const yesCount = (event.attendees || []).filter((a) => a.response === "yes").length;
  const noCount = (event.attendees || []).filter((a) => a.response === "no").length;
  const maybeCount = (event.attendees || []).filter((a) => a.response === "maybe").length;
  const myRsvp = (event.attendees || []).find((a) => a.user?.email);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/app/events")} className="p-2 -ml-2 rounded-lg hover:bg-zinc-100">
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-zinc-900 truncate">{event.title}</h1>
          </div>
          {isAdmin && (
            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setShowDelete(true)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* Event Info */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{event.type}</Badge>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3 text-zinc-600">
                <Calendar className="w-4 h-4 shrink-0" />
                <span>{new Date(event.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-600">
                <Clock className="w-4 h-4 shrink-0" />
                <span>{new Date(event.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  {event.endDate && ` - ${new Date(event.endDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
                </span>
              </div>
              {event.location && (
                <div className="flex items-center gap-3 text-zinc-600">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>{event.location}</span>
                </div>
              )}
            </div>

            {event.description && (
              <>
                <Separator />
                <p className="text-sm text-zinc-600">{event.description}</p>
              </>
            )}

            {event.maxAttendees && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Users className="w-4 h-4" />
                <span>{yesCount} / {event.maxAttendees} spots filled</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RSVP */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-sm">Will you attend?</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={myRsvp?.response === "yes" ? "default" : "outline"}
                className="flex-1"
                onClick={() => handleRSVP("yes")}
                disabled={rsvpLoading}
              >
                <Check className="w-4 h-4 mr-1" /> Yes
              </Button>
              <Button
                size="sm"
                variant={myRsvp?.response === "no" ? "default" : "outline"}
                className="flex-1"
                onClick={() => handleRSVP("no")}
                disabled={rsvpLoading}
              >
                <X className="w-4 h-4 mr-1" /> No
              </Button>
              <Button
                size="sm"
                variant={myRsvp?.response === "maybe" ? "default" : "outline"}
                className="flex-1"
                onClick={() => handleRSVP("maybe")}
                disabled={rsvpLoading}
              >
                Maybe
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Attendees */}
        {(event.attendees || []).length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <p className="font-medium text-sm">Attendees</p>
              <div className="space-y-3">
                {yesCount > 0 && (
                  <div>
                    <p className="text-xs text-emerald-600 font-medium mb-2">Going ({yesCount})</p>
                    <div className="space-y-2">
                      {(event.attendees || []).filter((a) => a.response === "yes").map((a) => (
                        <div key={a.id} className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="bg-emerald-50 text-emerald-600 text-xs font-semibold">
                              {getInitials(a.user?.firstName, a.user?.lastName, a.user?.email)}
                            </AvatarFallback>
                          </Avatar>
                          <p className="text-sm font-medium truncate">
                            {a.user?.firstName} {a.user?.lastName}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {maybeCount > 0 && (
                  <div>
                    <p className="text-xs text-amber-600 font-medium mb-2">Maybe ({maybeCount})</p>
                    <div className="space-y-2">
                      {(event.attendees || []).filter((a) => a.response === "maybe").map((a) => (
                        <div key={a.id} className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="bg-amber-50 text-amber-600 text-xs font-semibold">
                              {getInitials(a.user?.firstName, a.user?.lastName, a.user?.email)}
                            </AvatarFallback>
                          </Avatar>
                          <p className="text-sm font-medium truncate">
                            {a.user?.firstName} {a.user?.lastName}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {noCount > 0 && (
                  <div>
                    <p className="text-xs text-zinc-400 font-medium mb-2">Not Going ({noCount})</p>
                    <div className="space-y-2">
                      {(event.attendees || []).filter((a) => a.response === "no").map((a) => (
                        <div key={a.id} className="flex items-center gap-3 opacity-50">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="bg-zinc-50 text-zinc-500 text-xs font-semibold">
                              {getInitials(a.user?.firstName, a.user?.lastName, a.user?.email)}
                            </AvatarFallback>
                          </Avatar>
                          <p className="text-sm font-medium truncate">
                            {a.user?.firstName} {a.user?.lastName}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Delete Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete "{event.title}"? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
