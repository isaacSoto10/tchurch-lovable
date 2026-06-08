import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  ClipboardCheck,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  QrCode,
  RefreshCw,
  ScanLine,
  Trash2,
  UserRound,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useAppAuth } from "@/hooks/useAppAuth";
import {
  apiFetch,
  claimEventSignupItem,
  deleteEventRsvp,
  fetchEvent,
  fetchEventRsvp,
  fetchEventSignupItems,
  fetchMyEventQr,
  updateEventRsvp,
} from "@/lib/api";
import { createEventQrDataUrl } from "@/lib/eventQr";
import {
  flushQueuedEventCheckIns,
  getQueuedEventCheckInCount,
  submitEventCheckInOnlineFirst,
} from "@/lib/eventCheckInQueue";
import { useChurch } from "@/providers/ChurchProvider";
import type {
  ChurchEvent,
  EventAttendee,
  EventQrResponse,
  EventRsvpResponse,
  EventRsvpStatus,
  EventSignupItem,
} from "@/types/events";
import { getEventTypeLabel } from "@/types/events";

type TabValue = "details" | "rsvp" | "qr" | "participation" | "admin";

function getInitials(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

function attendeeName(attendee: EventAttendee) {
  return (
    [attendee.user?.firstName, attendee.user?.lastName].filter(Boolean).join(" ").trim() ||
    attendee.user?.email ||
    "Invitado"
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" });
}

function leaderName(event: ChurchEvent) {
  return [event.leaderFirstName, event.leaderLastName].filter(Boolean).join(" ") || event.leaderEmail || null;
}

function whatsappEventShare(event: ChurchEvent) {
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

function extractRsvpStatus(response: EventRsvpResponse | null): EventRsvpStatus | null {
  const status = response?.status || response?.rsvp?.status || null;
  return status === "yes" || status === "no" || status === "maybe" ? status : null;
}

function normalizeSignupItems(data: unknown): EventSignupItem[] {
  if (Array.isArray(data)) return data as EventSignupItem[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown[] }).items)) {
    return (data as { items: EventSignupItem[] }).items;
  }
  return [];
}

function signupItemCounts(item: EventSignupItem) {
  const claimedFromList = item.claims?.reduce((total, claim) => total + Number(claim.quantity || 1), 0) || 0;
  const needed = item.quantityNeeded ?? item.needed ?? item.quantity ?? null;
  const claimed = item.claimedQuantity ?? item.claimed ?? item.filled ?? claimedFromList;
  const remaining = item.remaining ?? (needed == null ? null : Math.max(needed - claimed, 0));

  return { needed, claimed, remaining };
}

function findMyRsvp(attendees: EventAttendee[], userId?: string | null, email?: string | null) {
  const normalizedEmail = email?.toLowerCase();
  const match = attendees.find((attendee) => {
    const attendeeEmail = attendee.user?.email?.toLowerCase();
    return (
      (userId && (attendee.userId === userId || attendee.user?.id === userId || attendee.user?.clerkId === userId)) ||
      (normalizedEmail && attendeeEmail === normalizedEmail)
    );
  });
  return match?.status || null;
}

function statusLabel(status: EventRsvpStatus) {
  if (status === "yes") return "Asiste";
  if (status === "maybe") return "Tal vez";
  return "No asiste";
}

function StatusBadge({ status }: { status: EventRsvpStatus }) {
  const className =
    status === "yes"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "maybe"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-500";

  return (
    <Badge variant="outline" className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { getToken, user } = useAppAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabValue>("details");
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [myRsvp, setMyRsvp] = useState<EventRsvpStatus | null>(null);
  const [signupItems, setSignupItems] = useState<EventSignupItem[]>([]);
  const [myQr, setMyQr] = useState<EventQrResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [queueFlushing, setQueueFlushing] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [signupClaimingId, setSignupClaimingId] = useState<string | null>(null);

  const canManage = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";
  const userEmail = user?.primaryEmailAddress?.emailAddress || null;

  const attendees = event?.attendees || [];
  const counts = useMemo(() => {
    const summary = event?.rsvpSummary;
    if (summary) return summary;
    return attendees.reduce(
      (acc, attendee) => {
        acc[attendee.status] += 1;
        return acc;
      },
      { yes: 0, no: 0, maybe: 0 } as Record<EventRsvpStatus, number>
    );
  }, [attendees, event?.rsvpSummary]);

  const loadQueueCount = useCallback(async () => {
    if (!id) return;
    try {
      setPendingCount(await getQueuedEventCheckInCount(id));
    } catch (error) {
      console.warn("Could not read check-in queue:", error);
    }
  }, [id]);

  const loadEvent = useCallback(
    async (showSpinner = true) => {
      if (!id) return;
      if (showSpinner) setLoading(true);

      try {
        const [eventData, rsvpData, attendeeData, signupData] = await Promise.all([
          fetchEvent(id),
          fetchEventRsvp(id).catch(() => null),
          apiFetch<EventAttendee[]>(`/events/${id}/rsvps`).catch(() => []),
          fetchEventSignupItems(id).catch(() => []),
        ]);

        if ((eventData as { error?: string }).error) {
          navigate("/app/events");
          return;
        }

        const normalizedAttendees = Array.isArray(eventData.attendees)
          ? eventData.attendees
          : Array.isArray(attendeeData)
            ? attendeeData
            : [];
        setEvent({ ...eventData, attendees: normalizedAttendees });
        setSignupItems(normalizeSignupItems(signupData));
        setMyRsvp(extractRsvpStatus(rsvpData) || findMyRsvp(normalizedAttendees, user?.id, userEmail));
      } catch (error) {
        console.error("Failed to load event:", error);
        toast({ title: "No se pudo cargar el evento", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [id, navigate, toast, user?.id, userEmail]
  );

  const loadQr = useCallback(async () => {
    if (!id) return;
    setQrLoading(true);
    setQrError(null);

    try {
      const data = await fetchMyEventQr(id);
      const dataUrl = await createEventQrDataUrl(data, id);
      setMyQr(data);
      setQrDataUrl(dataUrl);
      if (!dataUrl) setQrError("El servidor no regresó un valor válido para generar el QR.");
    } catch (error) {
      console.error("Failed to load personal QR:", error);
      setMyQr(null);
      setQrDataUrl(null);
      setQrError("El QR personal todavía no está disponible para este evento.");
    } finally {
      setQrLoading(false);
    }
  }, [id]);

  const flushQueue = useCallback(
    async (notify = false) => {
      if (!id || queueFlushing) return;
      setQueueFlushing(true);
      try {
        const token = await getToken();
        const result = await flushQueuedEventCheckIns(token, id);
        setPendingCount(result.pending);
        if (result.sent > 0) {
          await loadEvent(false);
          if (notify) {
            toast({ title: "Check-ins sincronizados", description: `${result.sent} check-in(s) enviados.` });
          }
        } else if (notify && result.pending > 0) {
          toast({ title: "Sincronización pendiente", description: "Hay check-ins esperando conexión estable." });
        }
      } catch (error) {
        console.error("Failed to flush check-in queue:", error);
        if (notify) toast({ title: "No se pudo sincronizar la cola", variant: "destructive" });
      } finally {
        setQueueFlushing(false);
      }
    },
    [getToken, id, loadEvent, queueFlushing, toast]
  );

  useEffect(() => {
    loadEvent();
    loadQueueCount();
  }, [loadEvent, loadQueueCount]);

  useEffect(() => {
    if (activeTab === "qr" && !qrDataUrl && !qrLoading) {
      loadQr();
    }
  }, [activeTab, loadQr, qrDataUrl, qrLoading]);

  useEffect(() => {
    const handleOnline = () => flushQueue(true);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [flushQueue]);

  async function handleRSVP(status: EventRsvpStatus) {
    if (!id) return;
    setRsvpLoading(true);
    try {
      await updateEventRsvp(id, status);
      setMyRsvp(status);
      toast({ title: "RSVP actualizado" });
      await loadEvent(false);
      if (status === "yes") loadQr();
    } catch (error) {
      console.error("Failed to update RSVP:", error);
      toast({ title: "No se pudo guardar tu RSVP", variant: "destructive" });
    } finally {
      setRsvpLoading(false);
    }
  }

  async function handleCancelRSVP() {
    if (!id) return;
    setRsvpLoading(true);
    try {
      await deleteEventRsvp(id);
      setMyRsvp(null);
      setMyQr(null);
      setQrDataUrl(null);
      toast({ title: "RSVP eliminado" });
      await loadEvent(false);
    } catch (error) {
      console.error("Failed to delete RSVP:", error);
      toast({ title: "No se pudo eliminar tu RSVP", variant: "destructive" });
    } finally {
      setRsvpLoading(false);
    }
  }

  async function handleClaimSignupItem(item: EventSignupItem) {
    if (!id) return;
    if (!myRsvp || myRsvp === "no") {
      toast({
        title: "Confirma tu RSVP primero",
        description: "Marca Sí o Tal vez antes de anotarte en comida o participación.",
      });
      setActiveTab("rsvp");
      return;
    }

    setSignupClaimingId(item.id);
    try {
      await claimEventSignupItem(id, item.id);
      toast({ title: "Te anotaste", description: item.title || item.name || "Participación actualizada." });
      const updated = await fetchEventSignupItems(id).catch(() => []);
      setSignupItems(normalizeSignupItems(updated));
    } catch (error) {
      console.error("Failed to claim signup item:", error);
      toast({
        title: "No se pudo anotar",
        description: error instanceof Error ? error.message : "Intenta otra vez.",
        variant: "destructive",
      });
    } finally {
      setSignupClaimingId(null);
    }
  }

  async function handleManualCheckIn(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!id) return;
    const name = manualName.trim();
    const email = manualEmail.trim();
    const note = manualNote.trim();

    if (!name && !email) {
      toast({ title: "Agrega nombre o correo", variant: "destructive" });
      return;
    }

    setManualSubmitting(true);
    try {
      const token = await getToken();
      const result = await submitEventCheckInOnlineFirst(
        id,
        "manual",
        {
          name: name || undefined,
          email: email || undefined,
          note: note || undefined,
          checkedInAt: new Date().toISOString(),
        },
        token
      );

      if (result.queued) {
        toast({ title: "Check-in guardado offline", description: "Se enviará automáticamente al volver la conexión." });
      } else {
        toast({ title: "Check-in registrado" });
        await loadEvent(false);
      }

      setManualName("");
      setManualEmail("");
      setManualNote("");
      await loadQueueCount();
    } catch (error) {
      console.error("Manual check-in failed:", error);
      toast({ title: "No se pudo registrar el check-in", variant: "destructive" });
    } finally {
      setManualSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await apiFetch(`/events/${id}`, { method: "DELETE" });
      navigate("/app/events");
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

  if (!event) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Evento no encontrado</p>
        <Button variant="ghost" onClick={() => navigate("/app/events")} className="mt-2">
          Volver
        </Button>
      </div>
    );
  }

  const eventLeader = leaderName(event);

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/app/events")} className="-ml-2 rounded-lg p-2 hover:bg-zinc-100">
            <ArrowLeft className="h-5 w-5 text-zinc-600" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-zinc-900">{event.title}</h1>
            <p className="truncate text-xs text-zinc-500">{formatDate(event.date)}</p>
          </div>
          {canManage && (
            <Button variant="ghost" size="icon" className="text-red-500" onClick={() => setShowDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {pendingCount > 0 && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <WifiOff className="h-4 w-4" />
            <AlertTitle>Check-ins pendientes</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{pendingCount} check-in(s) esperando sincronización.</span>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => flushQueue(true)} disabled={queueFlushing}>
                  {queueFlushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sincronizar
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-zinc-200/70 p-1 sm:grid-cols-5">
            <TabsTrigger value="details" className="h-10 whitespace-normal text-xs">Detalles</TabsTrigger>
            <TabsTrigger value="rsvp" className="h-10 whitespace-normal text-xs">RSVP</TabsTrigger>
            <TabsTrigger value="qr" className="h-10 whitespace-normal text-xs">Mi QR</TabsTrigger>
            <TabsTrigger value="participation" className="h-10 whitespace-normal text-xs">Participación</TabsTrigger>
            <TabsTrigger value="admin" className="h-10 whitespace-normal text-xs">Check-in/Admin</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{getEventTypeLabel(event.type)}</Badge>
                  {event.ministryName && (
                    <Badge variant="outline" className="gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: event.ministryColor || "#6366f1" }} />
                      {event.ministryName}
                    </Badge>
                  )}
                  {myRsvp && <StatusBadge status={myRsvp} />}
                </div>

                <div className="space-y-3 text-sm">
                  <InfoRow icon={<Calendar className="h-4 w-4" />} text={formatDate(event.date)} />
                  <InfoRow
                    icon={<Clock className="h-4 w-4" />}
                    text={`${formatTime(event.date)}${event.endDate ? ` - ${formatTime(event.endDate)}` : ""}`}
                  />
                  {event.location && <InfoRow icon={<MapPin className="h-4 w-4" />} text={event.location} />}
                  {eventLeader && <InfoRow icon={<UserRound className="h-4 w-4" />} text={eventLeader} />}
                </div>

                {event.description && (
                  <>
                    <Separator />
                    <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-600">{event.description}</p>
                  </>
                )}

                {event.notes && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Notas</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-600">{event.notes}</p>
                    </div>
                  </>
                )}

                <Button variant="outline" asChild className="w-full">
                  <a href={whatsappEventShare(event)} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Compartir por WhatsApp
                  </a>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rsvp" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tu respuesta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Asisten" value={counts.yes} />
                  <Stat label="Tal vez" value={counts.maybe} />
                  <Stat label="No" value={counts.no} />
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    variant={myRsvp === "yes" ? "default" : "outline"}
                    onClick={() => handleRSVP("yes")}
                    disabled={rsvpLoading}
                  >
                    <Check className="h-4 w-4" />
                    Asistiré
                  </Button>
                  <Button
                    variant={myRsvp === "maybe" ? "default" : "outline"}
                    onClick={() => handleRSVP("maybe")}
                    disabled={rsvpLoading}
                  >
                    Tal vez
                  </Button>
                  <Button
                    variant={myRsvp === "no" ? "default" : "outline"}
                    onClick={() => handleRSVP("no")}
                    disabled={rsvpLoading}
                  >
                    <X className="h-4 w-4" />
                    No podré
                  </Button>
                </div>

                {myRsvp && (
                  <Button variant="ghost" className="w-full text-muted-foreground" onClick={handleCancelRSVP} disabled={rsvpLoading}>
                    Quitar RSVP
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="qr" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <QrCode className="h-4 w-4" />
                  QR personal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {qrError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>QR no disponible</AlertTitle>
                    <AlertDescription>{qrError}</AlertDescription>
                  </Alert>
                )}

                <div className="mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center rounded-lg border bg-white p-4">
                  {qrLoading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  ) : qrDataUrl ? (
                    <img src={qrDataUrl} alt="QR personal para check-in del evento" className="h-full w-full object-contain" />
                  ) : (
                    <QrCode className="h-16 w-16 text-muted-foreground" />
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button onClick={loadQr} disabled={qrLoading}>
                    {qrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Actualizar QR
                  </Button>
                  <Button variant="outline" onClick={() => navigate(`/app/events/${event.id}/qr`)}>
                    <QrCode className="h-4 w-4" />
                    Abrir pantalla QR
                  </Button>
                </div>

                {myQr?.expiresAt && (
                  <p className="text-center text-xs text-muted-foreground">
                    Expira {new Date(myQr.expiresAt).toLocaleString("es-US")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="participation" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  Participación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Asistentes</p>
                    <Badge variant="outline">{attendees.length}</Badge>
                  </div>
                  {attendees.length === 0 ? (
                    <EmptyState text="Aún no hay respuestas visibles." />
                  ) : (
                    <div className="space-y-2">
                      {attendees.map((attendee) => (
                        <AttendeeRow key={attendee.id} attendee={attendee} />
                      ))}
                    </div>
                  )}
                </section>

                <Separator />

                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Signup items</p>
                    <Badge variant="outline">{signupItems.length}</Badge>
                  </div>
                  {signupItems.length === 0 ? (
                    <EmptyState text="No hay elementos para apuntarse todavía." />
                  ) : (
                    <div className="space-y-2">
                      {signupItems.map((item) => (
                        <div key={item.id} className="rounded-lg border bg-white p-3">
                          {(() => {
                            const counts = signupItemCounts(item);
                            const isFull = counts.remaining === 0;
                            const isMine = Boolean(item.mySignup || item.signedUp);
                            const isClaiming = signupClaimingId === item.id;

                            return (
                              <>
                          <p className="text-sm font-semibold">{item.title || item.name || "Elemento"}</p>
                          {item.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {counts.claimed}
                            {typeof counts.needed === "number"
                              ? ` / ${counts.needed} cubiertos`
                              : " cubiertos"}
                          </p>
                          <Button
                            className="mt-3 h-10 w-full"
                            variant={isMine ? "secondary" : "outline"}
                            onClick={() => handleClaimSignupItem(item)}
                            disabled={isClaiming || isFull}
                          >
                            {isClaiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {isFull ? "Completo" : isMine ? "Actualizar mi lugar" : "Anotarme"}
                          </Button>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="admin" className="space-y-4">
            {!canManage ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Solo equipo autorizado</AlertTitle>
                <AlertDescription>El check-in y el scanner están disponibles para administradores o planners.</AlertDescription>
              </Alert>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ClipboardCheck className="h-4 w-4" />
                      Check-in
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Registrados" value={event.checkInSummary?.checkedIn ?? attendees.filter((a) => a.checkedInAt).length} />
                      <Stat label="RSVP sí" value={counts.yes} />
                      <Stat label="Offline" value={pendingCount} />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button onClick={() => navigate(`/app/events/${event.id}/scanner`)}>
                        <ScanLine className="h-4 w-4" />
                        Escanear QR
                      </Button>
                      <Button variant="outline" onClick={() => flushQueue(true)} disabled={queueFlushing || pendingCount === 0}>
                        {queueFlushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Sincronizar cola
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Check-in manual</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleManualCheckIn} className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="manual-name">Nombre</Label>
                          <Input
                            id="manual-name"
                            value={manualName}
                            onChange={(inputEvent) => setManualName(inputEvent.target.value)}
                            placeholder="Nombre de la persona"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="manual-email">Correo</Label>
                          <Input
                            id="manual-email"
                            type="email"
                            value={manualEmail}
                            onChange={(inputEvent) => setManualEmail(inputEvent.target.value)}
                            placeholder="correo@ejemplo.com"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="manual-note">Nota</Label>
                        <Textarea
                          id="manual-note"
                          value={manualNote}
                          onChange={(inputEvent) => setManualNote(inputEvent.target.value)}
                          placeholder="Opcional"
                          rows={3}
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={manualSubmitting}>
                        {manualSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        Registrar check-in
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar evento</DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">¿Seguro que quieres eliminar "{event.title}"?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 text-zinc-600">
      <span className="shrink-0 text-zinc-400">{icon}</span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-white p-3 text-center">
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border bg-zinc-50 p-4 text-center text-sm text-muted-foreground">{text}</div>;
}

function AttendeeRow({ attendee }: { attendee: EventAttendee }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="bg-zinc-100 text-xs font-semibold text-zinc-700">
          {getInitials(attendee.user?.firstName, attendee.user?.lastName, attendee.user?.email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{attendeeName(attendee)}</p>
        {attendee.checkedInAt && (
          <p className="truncate text-xs text-emerald-600">Check-in {new Date(attendee.checkedInAt).toLocaleString("es-US")}</p>
        )}
      </div>
      <StatusBadge status={attendee.status} />
    </div>
  );
}
