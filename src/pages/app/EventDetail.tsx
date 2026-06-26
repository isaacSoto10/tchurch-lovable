import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
  Pencil,
  Plus,
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
import { Checkbox } from "@/components/ui/checkbox";
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
  createEventSignupItem,
  deleteEvent,
  deleteEventSignupItem,
  deleteEventRsvp,
  fetchEvent,
  fetchEventRsvp,
  fetchEventSignupItems,
  getChurchId,
  updateEventSignupItem,
  updateEventRsvp,
} from "@/lib/api";
import { createEventRegistrationQrDataUrl } from "@/lib/eventQr";
import {
  flushQueuedEventCheckIns,
  getQueuedEventCheckInCount,
  submitEventCheckInOnlineFirst,
} from "@/lib/eventCheckInQueue";
import { useChurch } from "@/providers/ChurchProvider";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import type {
  ChurchEvent,
  EventAttendee,
  EventQuestion,
  EventRsvpAnswers,
  EventRsvpPayload,
  EventRsvpResponse,
  EventRsvpStatus,
  EventSignupItem,
  EventSignupItemPayload,
  EventSignupItemType,
} from "@/types/events";
import { getEventTypeLabel } from "@/types/events";

type TabValue = "details" | "rsvp" | "qr" | "participation" | "admin";
type RsvpFormState = {
  partySize: string;
  answers: EventRsvpAnswers;
  reminderOptIn: boolean;
};
type SignupItemFormState = {
  type: "food" | "participation";
  title: string;
  description: string;
  quantityNeeded: string;
};

const emptySignupItemForm: SignupItemFormState = {
  type: "participation",
  title: "",
  description: "",
  quantityNeeded: "1",
};

const emptyRsvpForm: RsvpFormState = {
  partySize: "1",
  answers: {},
  reminderOptIn: true,
};
const EVENT_DETAIL_SNAPSHOT_PREFIX = "tchurch_ios_event_detail_snapshot_v1";

type EventDetailSnapshot = {
  event: ChurchEvent;
  signupItems: EventSignupItem[];
  myRsvp: EventRsvpStatus | null;
  rsvpForm: RsvpFormState;
};

type EventDetailPayload = ChurchEvent & {
  myRegistration?: EventRsvpResponse | EventAttendee | null;
  registration?: EventRsvpResponse | EventAttendee | null;
  rsvp?: EventRsvpResponse | EventAttendee | null;
};

function isEventDetailSnapshot(data: unknown): data is EventDetailSnapshot {
  if (!data || typeof data !== "object") return false;
  const snapshot = data as Partial<EventDetailSnapshot>;
  return (
    Boolean(snapshot.event?.id) &&
    Array.isArray(snapshot.signupItems) &&
    (snapshot.myRsvp === null || snapshot.myRsvp === "yes" || snapshot.myRsvp === "no" || snapshot.myRsvp === "maybe") &&
    Boolean(snapshot.rsvpForm && typeof snapshot.rsvpForm === "object")
  );
}

function routeTab(pathname: string): TabValue {
  if (pathname.endsWith("/rsvp")) return "rsvp";
  if (pathname.endsWith("/my-qr") || pathname.endsWith("/qr")) return "qr";
  if (pathname.endsWith("/participation")) return "participation";
  if (pathname.endsWith("/scanner") || pathname.endsWith("/check-in") || pathname.endsWith("/admin")) return "admin";
  return "details";
}

function tabPath(eventId: string, tab: TabValue) {
  if (tab === "rsvp") return `/app/events/${eventId}/rsvp`;
  if (tab === "qr") return `/app/events/${eventId}/qr`;
  if (tab === "participation") return `/app/events/${eventId}/participation`;
  if (tab === "admin") return `/app/events/${eventId}/check-in`;
  return `/app/events/${eventId}`;
}

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
  const status = response?.status || response?.rsvp?.status || response?.registration?.status || null;
  return status === "yes" || status === "no" || status === "maybe" ? status : null;
}

function rsvpFromEventPayload(event: EventDetailPayload): EventRsvpResponse | null {
  const candidate = event.myRegistration || event.registration || event.rsvp || null;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate as EventRsvpResponse;
}

function defaultAnswerForQuestion(question: EventQuestion) {
  return question.type === "checkbox" ? false : "";
}

function normalizeRsvpAnswers(value: unknown): EventRsvpAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<EventRsvpAnswers>((answers, [key, answer]) => {
    if (typeof answer === "boolean" || typeof answer === "string") {
      answers[key] = answer;
    } else if (answer != null) {
      answers[key] = String(answer);
    }
    return answers;
  }, {});
}

function rsvpPartySizeLimit(event?: Pick<ChurchEvent, "allowGuests" | "capacity"> | null) {
  if (!event?.allowGuests) return 1;
  return Math.max(1, Math.min(50, event.capacity && event.capacity > 0 ? event.capacity : 50));
}

function normalizeRsvpPartySize(value: unknown, event?: Pick<ChurchEvent, "allowGuests" | "capacity"> | null) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 1, 1), rsvpPartySizeLimit(event));
}

function rsvpFormFromEvent(event: ChurchEvent, response: EventRsvpResponse | null): RsvpFormState {
  const details = response?.rsvp || response?.registration || response || null;
  const questions = event.registrationConfig?.questions || [];
  const existingAnswers = normalizeRsvpAnswers(details?.answers);
  const answers = questions.reduce<EventRsvpAnswers>(
    (current, question) => ({
      ...current,
      [question.id]:
        question.type === "checkbox"
          ? current[question.id] === true || current[question.id] === "true"
          : current[question.id] ?? defaultAnswerForQuestion(question),
    }),
    { ...existingAnswers }
  );
  const partySize = normalizeRsvpPartySize(details?.partySize, event);

  return {
    partySize: String(partySize),
    answers,
    reminderOptIn: Boolean(details?.reminderOptIn ?? true),
  };
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

function signupItemTitle(item: EventSignupItem) {
  return item.title || item.name || "Elemento";
}

function signupItemTypeLabel(type?: EventSignupItemType | null) {
  if (type === "food") return "Comida";
  if (type === "participation") return "Participación";
  return type || "Item";
}

function signupItemFormFromItem(item: EventSignupItem): SignupItemFormState {
  const counts = signupItemCounts(item);
  const type = item.type === "food" ? "food" : "participation";
  const fallbackQuantity = Math.max(Number(counts.needed || 0), Number(counts.claimed || 0), 1);

  return {
    type,
    title: signupItemTitle(item),
    description: item.description || "",
    quantityNeeded: String(fallbackQuantity),
  };
}

function findMyAttendee(attendees: EventAttendee[], userId?: string | null, email?: string | null) {
  const normalizedEmail = email?.toLowerCase();
  return attendees.find((attendee) => {
    const attendeeEmail = attendee.user?.email?.toLowerCase();
    return (
      (userId && (attendee.userId === userId || attendee.user?.id === userId || attendee.user?.clerkId === userId)) ||
      (normalizedEmail && attendeeEmail === normalizedEmail)
    );
  });
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
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { getToken, user } = useAppAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabValue>(() => routeTab(location.pathname));
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [myRsvp, setMyRsvp] = useState<EventRsvpStatus | null>(null);
  const [rsvpForm, setRsvpForm] = useState<RsvpFormState>(emptyRsvpForm);
  const [signupItems, setSignupItems] = useState<EventSignupItem[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrAttempted, setQrAttempted] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [queueFlushing, setQueueFlushing] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [signupClaimingId, setSignupClaimingId] = useState<string | null>(null);
  const [signupItemFormOpen, setSignupItemFormOpen] = useState(false);
  const [signupItemForm, setSignupItemForm] = useState<SignupItemFormState>(emptySignupItemForm);
  const [editingSignupItem, setEditingSignupItem] = useState<EventSignupItem | null>(null);
  const [signupItemSaving, setSignupItemSaving] = useState(false);
  const [signupItemDeleteTarget, setSignupItemDeleteTarget] = useState<EventSignupItem | null>(null);
  const [signupItemDeletingId, setSignupItemDeletingId] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);

  const canManage = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";
  const userEmail = user?.primaryEmailAddress?.emailAddress || null;
  const checkInEnabled = event?.requiresCheckIn !== false;
  const rsvpQuestions = useMemo(() => event?.registrationConfig?.questions || [], [event?.registrationConfig?.questions]);
  const reminderOptInEnabled = Boolean(event?.reminderConfig?.enabled);
  const snapshotKey = sessionSnapshotKey(EVENT_DETAIL_SNAPSHOT_PREFIX, `${selectedChurch?.id || getChurchId()}:${id || "unknown"}`);

  const applyEventSnapshot = useCallback((snapshot: EventDetailSnapshot) => {
    setEvent(snapshot.event);
    setSignupItems(snapshot.signupItems);
    setMyRsvp(snapshot.myRsvp);
    setRsvpForm(snapshot.rsvpForm);
    loadedOnceRef.current = true;
  }, []);

  const attendees = useMemo(() => event?.attendees || [], [event?.attendees]);
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

      if (showSpinner) {
        const snapshot = readSessionSnapshot<EventDetailSnapshot>(snapshotKey, { validate: isEventDetailSnapshot });
        if (snapshot) {
          applyEventSnapshot(snapshot.data);
          setLoading(false);
        } else if (!loadedOnceRef.current) {
          setLoading(true);
        }
      }

      try {
        const eventData = await fetchEvent(id) as EventDetailPayload;

        if ((eventData as { error?: string }).error) {
          navigate("/app/events");
          return;
        }

        const detailRsvp = rsvpFromEventPayload(eventData);
        const [rsvpData, attendeeData, signupData] = await Promise.all([
          detailRsvp ? Promise.resolve(detailRsvp) : fetchEventRsvp(id).catch(() => null),
          Array.isArray(eventData.attendees) || !canManage
            ? Promise.resolve([])
            : apiFetch<EventAttendee[]>(`/events/${id}/rsvps`).catch(() => []),
          Array.isArray(eventData.signupItems) ? Promise.resolve(eventData.signupItems) : fetchEventSignupItems(id).catch(() => []),
        ]);

        const normalizedAttendees = Array.isArray(eventData.attendees)
          ? eventData.attendees
          : Array.isArray(attendeeData)
            ? attendeeData
            : [];
        const ownAttendee = findMyAttendee(normalizedAttendees, user?.id, userEmail);
        const rsvpDetails = rsvpData || (ownAttendee ? ({ rsvp: ownAttendee } satisfies EventRsvpResponse) : null);
        const nextSnapshot = {
          event: { ...eventData, attendees: normalizedAttendees },
          signupItems: normalizeSignupItems(signupData),
          myRsvp: extractRsvpStatus(rsvpDetails) || ownAttendee?.status || null,
          rsvpForm: rsvpFormFromEvent(eventData, rsvpDetails),
        };
        applyEventSnapshot(nextSnapshot);
        writeSessionSnapshot(snapshotKey, nextSnapshot);
      } catch (error) {
        console.error("Failed to load event:", error);
        toast({ title: "No se pudo cargar el evento", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [applyEventSnapshot, canManage, id, navigate, snapshotKey, toast, user?.id, userEmail]
  );

  const reloadSignupItems = useCallback(async () => {
    if (!id) return;
    const updated = await fetchEventSignupItems(id).catch(() => []);
    setSignupItems(normalizeSignupItems(updated));
  }, [id]);

  const loadQr = useCallback(async () => {
    if (!event) return;
    setQrLoading(true);
    setQrAttempted(true);
    setQrError(null);

    try {
      const dataUrl = await createEventRegistrationQrDataUrl(event);
      setQrDataUrl(dataUrl);
      if (!dataUrl) setQrError("No se pudo generar el QR de registro.");
    } catch (error) {
      console.error("Failed to create registration QR:", error);
      setQrDataUrl(null);
      setQrError("No se pudo generar el QR de registro para este evento.");
    } finally {
      setQrLoading(false);
    }
  }, [event]);

  useEffect(() => {
    setQrDataUrl(null);
    setQrError(null);
    setQrAttempted(false);
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
    const nextTab = routeTab(location.pathname);
    if (event?.requiresCheckIn === false && nextTab === "admin") {
      setActiveTab("details");
      if (id) navigate(tabPath(id, "details"), { replace: true });
      return;
    }
    setActiveTab(nextTab);
  }, [event?.requiresCheckIn, id, location.pathname, navigate]);

  useEffect(() => {
    if (event && activeTab === "qr" && !qrDataUrl && !qrLoading && !qrAttempted) {
      loadQr();
    }
  }, [activeTab, event, loadQr, qrAttempted, qrDataUrl, qrLoading]);

  useEffect(() => {
    const handleOnline = () => flushQueue(true);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [flushQueue]);

  function handleTabChange(value: string) {
    const tab = value as TabValue;
    if (!id) return;
    if (!checkInEnabled && tab === "admin") {
      setActiveTab("details");
      navigate(tabPath(id, "details"), { replace: true });
      return;
    }
    setActiveTab(tab);
    navigate(tabPath(id, tab), { replace: true });
  }

  function updateRsvpAnswer(question: EventQuestion, value: string | boolean) {
    setRsvpForm((current) => ({
      ...current,
      answers: {
        ...current.answers,
        [question.id]: question.type === "checkbox" ? Boolean(value) : String(value),
      },
    }));
  }

  function buildRsvpPayload(status: EventRsvpStatus): EventRsvpPayload | null {
    if (!event) return null;

    const attending = status !== "no";
    const rawPartySize = Number(rsvpForm.partySize);
    const partySize = event.allowGuests && attending ? normalizeRsvpPartySize(rawPartySize, event) : 1;

    if (event.allowGuests && attending && (!Number.isFinite(rawPartySize) || partySize < 1)) {
      toast({ title: "Cantidad de invitados inválida", description: "Indica al menos 1 persona.", variant: "destructive" });
      return null;
    }

    for (const question of rsvpQuestions) {
      const answer = rsvpForm.answers[question.id] ?? defaultAnswerForQuestion(question);
      const missingText = typeof answer !== "boolean" && String(answer).trim().length === 0;
      const missingCheckbox = question.type === "checkbox" && answer !== true;

      if (attending && question.required && (missingText || missingCheckbox)) {
        toast({ title: "Respuesta requerida", description: question.label, variant: "destructive" });
        return null;
      }
    }

    const answers = rsvpQuestions.reduce<EventRsvpAnswers>((current, question) => {
      const answer = rsvpForm.answers[question.id] ?? defaultAnswerForQuestion(question);
      if (question.type === "checkbox") {
        current[question.id] = answer === true || answer === "true";
        return current;
      }

      const normalizedAnswer = String(answer).trim();
      if (question.type === "select" && question.options?.length && !question.options.includes(normalizedAnswer)) {
        return current;
      }

      current[question.id] = normalizedAnswer;
      return current;
    }, {});

    return {
      status,
      partySize,
      answers,
      reminderOptIn: reminderOptInEnabled ? rsvpForm.reminderOptIn : false,
    };
  }

  async function handleRSVP(status: EventRsvpStatus) {
    if (!id) return;
    const payload = buildRsvpPayload(status);
    if (!payload) return;

    setRsvpLoading(true);
    try {
      await updateEventRsvp(id, payload);
      setMyRsvp(status);
      toast({ title: "RSVP actualizado" });
      await loadEvent(false);
      setRsvpForm((current) => ({
        ...current,
        partySize: String(payload.partySize),
        answers: payload.answers,
        reminderOptIn: payload.reminderOptIn,
      }));
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
      setQrDataUrl(null);
      setQrAttempted(false);
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
      handleTabChange("rsvp");
      return;
    }

    setSignupClaimingId(item.id);
    try {
      await claimEventSignupItem(id, item.id);
      toast({ title: "Te anotaste", description: item.title || item.name || "Participación actualizada." });
      await reloadSignupItems();
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

  function openSignupItemCreate(type: SignupItemFormState["type"] = "participation") {
    setEditingSignupItem(null);
    setSignupItemForm({ ...emptySignupItemForm, type });
    setSignupItemFormOpen(true);
  }

  function openSignupItemEdit(item: EventSignupItem) {
    setEditingSignupItem(item);
    setSignupItemForm(signupItemFormFromItem(item));
    setSignupItemFormOpen(true);
  }

  function closeSignupItemForm(force = false) {
    if (signupItemSaving && !force) return;
    setSignupItemFormOpen(false);
    setEditingSignupItem(null);
    setSignupItemForm(emptySignupItemForm);
  }

  async function handleSaveSignupItem(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!id || !canManage) return;

    const title = signupItemForm.title.trim();
    const description = signupItemForm.description.trim();
    const rawQuantity = Number(signupItemForm.quantityNeeded);
    const quantityNeeded = Math.floor(rawQuantity);
    const claimedQuantity = editingSignupItem ? Number(signupItemCounts(editingSignupItem).claimed || 0) : 0;

    if (!title) {
      toast({ title: "Agrega un nombre para el item", variant: "destructive" });
      return;
    }

    if (!Number.isFinite(rawQuantity) || quantityNeeded < 1) {
      toast({ title: "Cantidad inválida", description: "La cantidad debe ser al menos 1.", variant: "destructive" });
      return;
    }

    if (quantityNeeded < claimedQuantity) {
      toast({
        title: "Cantidad menor a los anotados",
        description: `Ya hay ${claimedQuantity} lugar(es) cubiertos. Sube la cantidad para guardar.`,
        variant: "destructive",
      });
      return;
    }

    const payload: EventSignupItemPayload = {
      type: signupItemForm.type,
      title,
      description: description || null,
      quantityNeeded,
    };

    setSignupItemSaving(true);
    try {
      if (editingSignupItem) {
        await updateEventSignupItem(id, editingSignupItem.id, payload);
        toast({ title: "Item actualizado" });
      } else {
        await createEventSignupItem(id, payload);
        toast({ title: "Item creado" });
      }

      closeSignupItemForm(true);
      await reloadSignupItems();
    } catch (error) {
      console.error("Failed to save signup item:", error);
      toast({
        title: "No se pudo guardar el item",
        description: error instanceof Error ? error.message : "Intenta otra vez.",
        variant: "destructive",
      });
    } finally {
      setSignupItemSaving(false);
    }
  }

  function requestDeleteSignupItem(item: EventSignupItem) {
    const claimedQuantity = Number(signupItemCounts(item).claimed || 0);
    if (claimedQuantity > 0) {
      toast({
        title: "No se puede borrar",
        description: "Este item ya tiene personas anotadas.",
        variant: "destructive",
      });
      return;
    }
    setSignupItemDeleteTarget(item);
  }

  async function handleDeleteSignupItem() {
    if (!id || !signupItemDeleteTarget || !canManage) return;

    const claimedQuantity = Number(signupItemCounts(signupItemDeleteTarget).claimed || 0);
    if (claimedQuantity > 0) {
      setSignupItemDeleteTarget(null);
      toast({
        title: "No se puede borrar",
        description: "Este item ya tiene personas anotadas.",
        variant: "destructive",
      });
      return;
    }

    setSignupItemDeletingId(signupItemDeleteTarget.id);
    try {
      await deleteEventSignupItem(id, signupItemDeleteTarget.id);
      toast({ title: "Item eliminado" });
      setSignupItemDeleteTarget(null);
      await reloadSignupItems();
    } catch (error) {
      console.error("Failed to delete signup item:", error);
      toast({
        title: "No se pudo eliminar el item",
        description: error instanceof Error ? error.message : "Intenta otra vez.",
        variant: "destructive",
      });
    } finally {
      setSignupItemDeletingId(null);
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
          notes: note || undefined,
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
      await deleteEvent(id);
      navigate("/app/events");
    } catch (error) {
      console.error("Failed to delete event:", error);
      toast({ title: "No se pudo eliminar el evento", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  }

  function renderRsvpQuestion(question: EventQuestion) {
    const answer = rsvpForm.answers[question.id] ?? defaultAnswerForQuestion(question);
    const label = (
      <>
        {question.label}
        {question.required && <span className="text-red-500"> *</span>}
      </>
    );

    if (question.type === "textarea") {
      return (
        <div key={question.id} className="space-y-2">
          <Label htmlFor={`rsvp-${question.id}`} className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {label}
          </Label>
          <Textarea
            id={`rsvp-${question.id}`}
            value={typeof answer === "boolean" ? "" : answer}
            onChange={(event) => updateRsvpAnswer(question, event.target.value)}
            disabled={rsvpLoading}
            rows={3}
            className="resize-none bg-white"
          />
        </div>
      );
    }

    if (question.type === "select") {
      return (
        <div key={question.id} className="space-y-2">
          <Label htmlFor={`rsvp-${question.id}`} className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {label}
          </Label>
          <select
            id={`rsvp-${question.id}`}
            value={typeof answer === "boolean" ? "" : answer}
            onChange={(event) => updateRsvpAnswer(question, event.target.value)}
            disabled={rsvpLoading}
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Selecciona una opción</option>
            {(question.options || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (question.type === "checkbox") {
      return (
        <label key={question.id} className="flex min-h-11 items-center gap-3 rounded-xl border bg-white px-3 py-2 text-sm">
          <Checkbox
            checked={answer === true}
            onCheckedChange={(checked) => updateRsvpAnswer(question, checked === true)}
            disabled={rsvpLoading}
          />
          <span className="font-medium text-zinc-700">{label}</span>
        </label>
      );
    }

    return (
      <div key={question.id} className="space-y-2">
        <Label htmlFor={`rsvp-${question.id}`} className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </Label>
        <Input
          id={`rsvp-${question.id}`}
          value={typeof answer === "boolean" ? "" : answer}
          onChange={(event) => updateRsvpAnswer(question, event.target.value)}
          disabled={rsvpLoading}
          className="bg-white"
        />
      </div>
    );
  }

  function renderSignupItemsSection({
    includeClaimButton,
    showAdminTools,
    emptyText,
  }: {
    includeClaimButton: boolean;
    showAdminTools: boolean;
    emptyText: string;
  }) {
    const canEditSignupItems = canManage && showAdminTools;

    return (
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Signup items</p>
            <Badge variant="outline">{signupItems.length}</Badge>
          </div>
          {canEditSignupItems && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button type="button" size="sm" variant="outline" onClick={() => openSignupItemCreate("food")}>
                <Plus className="h-4 w-4" />
                Comida
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => openSignupItemCreate("participation")}>
                <Plus className="h-4 w-4" />
                Participación
              </Button>
            </div>
          )}
        </div>

        {signupItems.length === 0 ? (
          <EmptyState text={emptyText} />
        ) : (
          <div className="space-y-2">
            {signupItems.map((item) => {
              const counts = signupItemCounts(item);
              const isFull = counts.remaining === 0;
              const isMine = Boolean(item.mySignup || item.signedUp);
              const isClaiming = signupClaimingId === item.id;
              const claimedQuantity = Number(counts.claimed || 0);
              const canDeleteItem = claimedQuantity === 0;
              const isDeleting = signupItemDeletingId === item.id;

              return (
                <div key={item.id} className="rounded-lg border bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 break-words text-sm font-semibold">{signupItemTitle(item)}</p>
                        <Badge variant="secondary">{signupItemTypeLabel(item.type)}</Badge>
                      </div>
                      {item.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>}
                    </div>

                    {canEditSignupItems && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={`Editar ${signupItemTitle(item)}`}
                          onClick={() => openSignupItemEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          aria-label={`Borrar ${signupItemTitle(item)}`}
                          title={canDeleteItem ? "Borrar item" : "No se puede borrar con personas anotadas"}
                          disabled={!canDeleteItem || isDeleting}
                          onClick={() => requestDeleteSignupItem(item)}
                        >
                          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {claimedQuantity}
                      {typeof counts.needed === "number" ? ` / ${counts.needed} cubiertos` : " cubiertos"}
                    </span>
                    {typeof counts.remaining === "number" && <Badge variant="outline">{counts.remaining} disponibles</Badge>}
                    {canEditSignupItems && !canDeleteItem && <span>No se puede borrar con personas anotadas.</span>}
                  </div>

                  {includeClaimButton && (
                    <Button
                      className="mt-3 h-10 w-full"
                      variant={isMine ? "secondary" : "outline"}
                      onClick={() => handleClaimSignupItem(item)}
                      disabled={isClaiming || isFull}
                    >
                      {isClaiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {isFull ? "Completo" : isMine ? "Actualizar mi lugar" : "Anotarme"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
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
  const signupItemFormClaimedQuantity = editingSignupItem ? Number(signupItemCounts(editingSignupItem).claimed || 0) : 0;
  const signupItemFormMinQuantity = Math.max(signupItemFormClaimedQuantity, 1);

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
        {checkInEnabled && pendingCount > 0 && (
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

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className={`grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-zinc-200/70 p-1 ${checkInEnabled ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
            <TabsTrigger value="details" className="h-10 whitespace-normal text-xs">Detalles</TabsTrigger>
            <TabsTrigger value="rsvp" className="h-10 whitespace-normal text-xs">RSVP</TabsTrigger>
            <TabsTrigger value="qr" className="h-10 whitespace-normal text-xs">QR registro</TabsTrigger>
            <TabsTrigger value="participation" className="h-10 whitespace-normal text-xs">Participación</TabsTrigger>
            {checkInEnabled && <TabsTrigger value="admin" className="h-10 whitespace-normal text-xs">Check-in/Admin</TabsTrigger>}
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

                {(event.allowGuests || rsvpQuestions.length > 0 || reminderOptInEnabled) && (
                  <div className="space-y-3 rounded-lg border bg-zinc-50/70 p-3">
                    {event.allowGuests && (
                      <div className="space-y-2">
                        <Label htmlFor="rsvp-party-size" className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Personas en tu grupo
                        </Label>
                        <Input
                          id="rsvp-party-size"
                          type="number"
                          min={1}
                          max={rsvpPartySizeLimit(event)}
                          inputMode="numeric"
                          value={rsvpForm.partySize}
                          onChange={(event) => setRsvpForm((current) => ({ ...current, partySize: event.target.value }))}
                          onBlur={(inputEvent) =>
                            setRsvpForm((current) => ({
                              ...current,
                              partySize: String(normalizeRsvpPartySize(inputEvent.target.value, event)),
                            }))
                          }
                          disabled={rsvpLoading}
                          className="bg-white"
                        />
                      </div>
                    )}

                    {rsvpQuestions.length > 0 && <div className="space-y-3">{rsvpQuestions.map((question) => renderRsvpQuestion(question))}</div>}

                    {reminderOptInEnabled && (
                      <label className="flex min-h-11 items-center gap-3 rounded-xl border bg-white px-3 py-2 text-sm">
                        <Checkbox
                          checked={rsvpForm.reminderOptIn}
                          onCheckedChange={(checked) => setRsvpForm((current) => ({ ...current, reminderOptIn: checked === true }))}
                          disabled={rsvpLoading}
                        />
                        <span className="font-medium text-zinc-700">Recibir recordatorios de este evento</span>
                      </label>
                    )}
                  </div>
                )}

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
                  QR de registro
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
                    <img src={qrDataUrl} alt="QR para registrarse al evento" className="h-full w-full object-contain" />
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
                    Abrir QR de registro
                  </Button>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  Este QR abre la página de RSVP/registro del evento.
                </p>
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

                {renderSignupItemsSection({
                  includeClaimButton: true,
                  showAdminTools: true,
                  emptyText: "No hay elementos para apuntarse todavía.",
                })}
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

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="h-4 w-4" />
                      Comida y participación
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderSignupItemsSection({
                      includeClaimButton: false,
                      showAdminTools: true,
                      emptyText: "Crea items de comida o participación para este evento.",
                    })}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={signupItemFormOpen} onOpenChange={(open) => { if (!open) closeSignupItemForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSignupItem ? "Editar item" : "Nuevo item"}</DialogTitle>
            <DialogDescription>
              Gestiona los lugares de comida o participación disponibles para este evento.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveSignupItem} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="signup-item-type">Tipo</Label>
                <select
                  id="signup-item-type"
                  value={signupItemForm.type}
                  onChange={(inputEvent) =>
                    setSignupItemForm((current) => ({
                      ...current,
                      type: inputEvent.target.value === "food" ? "food" : "participation",
                    }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  disabled={signupItemSaving}
                >
                  <option value="participation">Participación</option>
                  <option value="food">Comida</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-item-quantity">Cantidad necesaria</Label>
                <Input
                  id="signup-item-quantity"
                  type="number"
                  min={signupItemFormMinQuantity}
                  step={1}
                  value={signupItemForm.quantityNeeded}
                  onChange={(inputEvent) =>
                    setSignupItemForm((current) => ({ ...current, quantityNeeded: inputEvent.target.value }))
                  }
                  disabled={signupItemSaving}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-item-title">Nombre</Label>
              <Input
                id="signup-item-title"
                value={signupItemForm.title}
                onChange={(inputEvent) =>
                  setSignupItemForm((current) => ({ ...current, title: inputEvent.target.value }))
                }
                placeholder="Ej. Bebidas, ujieres, postres"
                disabled={signupItemSaving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-item-description">Descripción</Label>
              <Textarea
                id="signup-item-description"
                value={signupItemForm.description}
                onChange={(inputEvent) =>
                  setSignupItemForm((current) => ({ ...current, description: inputEvent.target.value }))
                }
                placeholder="Opcional"
                rows={3}
                disabled={signupItemSaving}
              />
            </div>

            {signupItemFormClaimedQuantity > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{signupItemFormClaimedQuantity} lugar(es) cubiertos</AlertTitle>
                <AlertDescription>
                  La cantidad necesaria no puede bajar por debajo de los lugares ya reclamados.
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => closeSignupItemForm()} disabled={signupItemSaving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={signupItemSaving}>
                {signupItemSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(signupItemDeleteTarget)} onOpenChange={(open) => { if (!open) setSignupItemDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar item</DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ¿Seguro que quieres eliminar "{signupItemDeleteTarget ? signupItemTitle(signupItemDeleteTarget) : "este item"}"?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignupItemDeleteTarget(null)} disabled={Boolean(signupItemDeletingId)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteSignupItem} disabled={Boolean(signupItemDeletingId)}>
              {signupItemDeletingId && <Loader2 className="h-4 w-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
