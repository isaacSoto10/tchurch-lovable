import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, MapPin, Calendar, Clock, Users, Check, X, Trash2, MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";

type Attendee = {
  id: string;
  userId: string;
  status: "yes" | "no" | "maybe";
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
  notes?: string | null;
  ministryName?: string | null;
  ministryColor?: string | null;
  leaderFirstName?: string | null;
  leaderLastName?: string | null;
  leaderEmail?: string | null;
  attendees: Attendee[];
  createdAt: string;
};

type EventResponse = Event & {
  error?: string;
};

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

function whatsappEventShare(event: Event) {
  const date = new Date(event.date).toLocaleString("es-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const location = event.location ? `\nLugar: ${event.location}` : "";
  return `https://wa.me/?text=${encodeURIComponent(`${event.title}\n${date}${location}`)}`;
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [myRsvp, setMyRsvp] = useState<"yes" | "no" | "maybe" | null>(null);

  const canManage = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";

  const loadEvent = useCallback(async () => {
    if (!id) return;
    try {
      const [data, attendees] = await Promise.all([
        apiFetch<EventResponse>(`/events/${id}`),
        apiFetch<Attendee[]>(`/events/${id}/rsvps`).catch(() => []),
      ]);
      if (data.error) { navigate("/app/events"); return; }
      setEvent({ ...data, attendees: Array.isArray(attendees) ? attendees : [] });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  async function handleRSVP(response: "yes" | "no" | "maybe") {
    if (!id) return;
    setRsvpLoading(true);
    try {
      await apiFetch(`/events/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status: response }),
      });
      setMyRsvp(response);
      await loadEvent();
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
        <p className="text-muted-foreground">Evento no encontrado</p>
        <Button variant="ghost" onClick={() => navigate("/app/events")} className="mt-2">Volver</Button>
      </div>
    );
  }

  const yesCount = (event.attendees || []).filter((a) => a.status === "yes").length;
  const noCount = (event.attendees || []).filter((a) => a.status === "no").length;
  const maybeCount = (event.attendees || []).filter((a) => a.status === "maybe").length;
  const leaderName = [event.leaderFirstName, event.leaderLastName].filter(Boolean).join(" ") || event.leaderEmail || null;

  return (
    <div className="app-page space-y-4">
      {/* Header */}
      <div className="app-page-header">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate("/app/events")} className="-ml-1 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card shadow-sm hover:bg-secondary">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="app-page-kicker">Evento</p>
            <h1 className="truncate text-xl font-semibold text-foreground">{event.title}</h1>
          </div>
          {canManage && (
            <Button variant="ghost" size="sm" className="rounded-md text-red-500" onClick={() => setShowDelete(true)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* Event Info */}
        <Card className="app-list-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="rounded-md">{event.type}</Badge>
              {event.ministryName && <Badge variant="outline" className="rounded-md">{event.ministryName}</Badge>}
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Calendar className="w-4 h-4 shrink-0" />
                <span>{new Date(event.date).toLocaleDateString("es-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <Clock className="w-4 h-4 shrink-0" />
                <span>{new Date(event.date).toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" })}
                  {event.endDate && ` - ${new Date(event.endDate).toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" })}`}
                </span>
              </div>
              {event.location && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>{event.location}</span>
                </div>
              )}
              {leaderName && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Users className="w-4 h-4 shrink-0" />
                  <span>{leaderName}</span>
                </div>
              )}
            </div>

            {event.description && (
              <>
                <Separator />
                <p className="text-sm text-muted-foreground">{event.description}</p>
              </>
            )}

            {event.notes && (
              <>
                <Separator />
                <div>
                  <p className="app-section-title">Notas especiales</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{event.notes}</p>
                </div>
              </>
            )}

            <Button variant="outline" asChild className="w-full rounded-md">
              <a href={whatsappEventShare(event)} target="_blank" rel="noreferrer">
                <MessageCircle className="w-4 h-4 mr-2" /> Compartir por WhatsApp
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* RSVP */}
        <Card className="app-list-card">
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-sm">¿Vas a asistir?</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={myRsvp === "yes" ? "default" : "outline"}
                className="flex-1 rounded-md"
                onClick={() => handleRSVP("yes")}
                disabled={rsvpLoading}
              >
                <Check className="w-4 h-4 mr-1" /> Sí
              </Button>
              <Button
                size="sm"
                variant={myRsvp === "no" ? "default" : "outline"}
                className="flex-1 rounded-md"
                onClick={() => handleRSVP("no")}
                disabled={rsvpLoading}
              >
                <X className="w-4 h-4 mr-1" /> No
              </Button>
              <Button
                size="sm"
                variant={myRsvp === "maybe" ? "default" : "outline"}
                className="flex-1 rounded-md"
                onClick={() => handleRSVP("maybe")}
                disabled={rsvpLoading}
              >
                Quizás
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Attendees */}
        {(event.attendees || []).length > 0 && (
          <Card className="app-list-card">
            <CardContent className="p-4 space-y-4">
              <p className="font-medium text-sm">Asistentes</p>
              <div className="space-y-3">
                {yesCount > 0 && (
                  <div>
                    <p className="text-xs text-emerald-600 font-medium mb-2">Asisten ({yesCount})</p>
                    <div className="space-y-2">
                      {(event.attendees || []).filter((a) => a.status === "yes").map((a) => (
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
                    <p className="text-xs text-amber-600 font-medium mb-2">Quizás ({maybeCount})</p>
                    <div className="space-y-2">
                      {(event.attendees || []).filter((a) => a.status === "maybe").map((a) => (
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
                    <p className="text-xs text-muted-foreground font-medium mb-2">No asisten ({noCount})</p>
                    <div className="space-y-2">
                      {(event.attendees || []).filter((a) => a.status === "no").map((a) => (
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
          <DialogTitle>Eliminar evento</DialogTitle>
        </DialogHeader>
          <p className="text-sm text-muted-foreground">¿Seguro que quieres eliminar "{event.title}"? Esta acción no se puede deshacer.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
