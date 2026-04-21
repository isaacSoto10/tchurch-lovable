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
import { useT } from "@/hooks/useLocale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Attendee = {
  id: string;
  userId: string;
  response: "yes" | "no" | "maybe";
  user: { firstName: string | null; lastName: string | null; email: string } | null;
};

type Ministry = {
  id: string;
  name: string;
};

type User = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
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
  ministryId?: string;
  leaderId?: string;
  ministry?: {
    id: string;
    name: string;
  };
  leader?: {
    id: string;
    firstName?: string;
    lastName?: string;
  };
};

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const t = useT();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    date: "",
    endDate: "",
    type: "",
    location: "",
    ministryId: "",
    leaderId: "",
  });

  const isAdmin = selectedChurch?.role === "ADMIN";

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const data = await apiFetch<Event>(`/events/${id}`);
        if (data.error) { navigate("/app/events"); return; }
        setEvent(data);
        setFormData({
          title: data.title || "",
          description: data.description || "",
          date: data.date ? data.date.slice(0, 16) : "",
          endDate: data.endDate ? data.endDate.slice(0, 16) : "",
          type: data.type || "",
          location: data.location || "",
          ministryId: (data as any).ministryId || "",
          leaderId: (data as any).leaderId || "",
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    async function loadDependencies() {
      try {
        const [ministriesData, usersData] = await Promise.all([
          apiFetch<Ministry[]>("/ministries"),
          apiFetch<User[]>("/members"),
        ]);
        setMinistries(Array.isArray(ministriesData) ? ministriesData : []);
        setUsers(Array.isArray(usersData) ? usersData : []);
      } catch (e) {
        console.error(e);
      }
    }
    if (isAdmin) {
      loadDependencies();
    }
  }, [isAdmin]);

  async function handleRSVP(response: "yes" | "no" | "maybe") {
    if (!id) return;
    setRsvpLoading(true);
    try {
      await apiFetch(`/events/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ response }),
      });
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

  async function handleUpdate() {
    if (!id || !event) return;
    try {
      const payload = {
        title: formData.title,
        description: formData.description || null,
        date: new Date(formData.date).toISOString(),
        endDate: formData.endDate ? new Date(formData.endDate).toISOString() : null,
        type: formData.type,
        location: formData.location || null,
        ministryId: formData.ministryId || null,
        leaderId: formData.leaderId || null,
      };
      await apiFetch(`/events/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setEditMode(false);
      const data = await apiFetch<Event>(`/events/${id}`);
      setEvent(data);
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
        <p className="text-muted-foreground">{t("events.notFound")}</p>
        <Button variant="ghost" onClick={() => navigate("/app/events")} className="mt-2">{t("common.back")}</Button>
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
          {isAdmin && !editMode && (
            <Button variant="ghost" size="sm" onClick={() => setEditMode(true)}>
              {t("common.edit")}
            </Button>
          )}
          {isAdmin && editMode && (
            <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>
              {t("common.cancel")}
            </Button>
          )}
          {isAdmin && (
            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setShowDelete(true)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">

        {editMode ? (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div>
                <Label>{t("common.title")}</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("events.startDate")}</Label>
                  <Input
                    type="datetime-local"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("events.endDate")}</Label>
                  <Input
                    type="datetime-local"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>{t("common.type")}</Label>
                <Input
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("common.location")}</Label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("events.ministry")}</Label>
                <Select
                  value={formData.ministryId}
                  onValueChange={(v) => setFormData({ ...formData, ministryId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("events.selectMinistry")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t("common.none")}</SelectItem>
                    {ministries.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("events.leader")}</Label>
                <Select
                  value={formData.leaderId}
                  onValueChange={(v) => setFormData({ ...formData, leaderId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("events.selectLeader")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t("common.none")}</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("common.description")}</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleUpdate}>{t("common.save")}</Button>
                <Button variant="outline" onClick={() => setEditMode(false)}>{t("common.cancel")}</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
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
                  {event.ministry && (
                    <div className="flex items-center gap-3 text-zinc-600">
                      <Users className="w-4 h-4 shrink-0" />
                      <span>{event.ministry.name}</span>
                    </div>
                  )}
                  {event.leader && (
                    <div className="flex items-center gap-3 text-zinc-600">
                      <Users className="w-4 h-4 shrink-0" />
                      <span>{t("events.leader")}: {event.leader.firstName} {event.leader.lastName}</span>
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
                    <span>{yesCount} / {event.maxAttendees} {t("common.spotsFilled")}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* RSVP */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="font-medium text-sm">{t("common.willAttend")}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={myRsvp?.response === "yes" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => handleRSVP("yes")}
                    disabled={rsvpLoading}
                  >
                    <Check className="w-4 h-4 mr-1" /> {t("common.yes")}
                  </Button>
                  <Button
                    size="sm"
                    variant={myRsvp?.response === "no" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => handleRSVP("no")}
                    disabled={rsvpLoading}
                  >
                    <X className="w-4 h-4 mr-1" /> {t("common.no")}
                  </Button>
                  <Button
                    size="sm"
                    variant={myRsvp?.response === "maybe" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => handleRSVP("maybe")}
                    disabled={rsvpLoading}
                  >
                    {t("common.maybe")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Attendees */}
            {(event.attendees || []).length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-4">
                  <p className="font-medium text-sm">{t("common.attendees")}</p>
                  <div className="space-y-3">
                    {yesCount > 0 && (
                      <div>
                        <p className="text-xs text-emerald-600 font-medium mb-2">{t("events.going")} ({yesCount})</p>
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
                        <p className="text-xs text-amber-600 font-medium mb-2">{t("common.maybe")} ({maybeCount})</p>
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
                        <p className="text-xs text-zinc-400 font-medium mb-2">{t("events.notGoing")} ({noCount})</p>
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
          </>
        )}
      </div>

      {/* Delete Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("events.deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("events.deleteConfirm")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}