import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Check, ChevronRight, Clock, Loader2, RotateCw, X } from "lucide-react";
import { SectionNav } from "@/components/SectionNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import { formatServiceDate, formatServiceTime } from "@/lib/serviceDates";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";

type AssignmentStatus = "pending" | "accepted" | "declined";

type Assignment = {
  id: string;
  serviceId?: string;
  position: string;
  confirmed: boolean;
  responseStatus?: AssignmentStatus | null;
  respondedAt?: string | null;
  service: {
    id: string;
    title: string;
    date: string;
    type?: string;
    status?: string;
  } | null;
};

type AssignmentsSnapshot = { assignments: Assignment[] };
const ASSIGNMENTS_SNAPSHOT_PREFIX = "tchurch_ios_assignments_snapshot_v2";

function isAssignmentsSnapshot(value: unknown): value is AssignmentsSnapshot {
  return Boolean(value && typeof value === "object" && Array.isArray((value as AssignmentsSnapshot).assignments));
}

function assignmentStatus(assignment: Assignment): AssignmentStatus {
  if (assignment.responseStatus === "accepted" || assignment.responseStatus === "declined") return assignment.responseStatus;
  return assignment.confirmed ? "accepted" : "pending";
}

function positionLabel(value: string) {
  const labels: Record<string, string> = {
    WORSHIP_LEADER: "Líder de alabanza",
    VOCAL: "Voz",
    VOCALS: "Voces",
    GUITAR: "Guitarra",
    BASS: "Bajo",
    DRUMS: "Batería",
    KEYS: "Teclado",
    SOUND: "Audio",
    LIGHTING: "Iluminación",
    MEDIA: "Media",
    HOST: "Anfitrión",
  };
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (labels[normalized]) return labels[normalized];
  return String(value || "Asignación")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusCopy(status: AssignmentStatus) {
  if (status === "accepted") return { label: "Confirmada", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (status === "declined") return { label: "Declinada", className: "border-red-200 bg-red-50 text-red-700" };
  return { label: "Pendiente", className: "border-amber-200 bg-amber-50 text-amber-700" };
}

interface AssignmentCardProps {
  assignment: Assignment;
  responding: boolean;
  compact?: boolean;
  onOpen: () => void;
  onRespond: (action: "accept" | "decline") => void;
}

function AssignmentCard({ assignment, responding, compact = false, onOpen, onRespond }: AssignmentCardProps) {
  const status = assignmentStatus(assignment);
  const copy = statusCopy(status);
  return (
    <Card className={`app-card ${compact ? "opacity-80" : ""}`}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <button type="button" onClick={onOpen} className="group flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <CalendarDays className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold text-foreground group-hover:text-primary">{assignment.service?.title || "Servicio"}</span>
                <Badge variant="outline" className={copy.className}>{copy.label}</Badge>
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{positionLabel(assignment.position)}</span>
              {assignment.service?.date && (
                <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>{formatServiceDate(assignment.service.date, "es-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatServiceTime(assignment.service.date, "es-US")}</span>
                </span>
              )}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>

          {!compact && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                disabled={responding || status === "declined"}
                onClick={() => onRespond("decline")}
              >
                {responding ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Declinar
              </Button>
              <Button size="sm" disabled={responding || status === "accepted"} onClick={() => onRespond("accept")}>
                {responding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Aceptar
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyAssignments() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const snapshotKey = sessionSnapshotKey(ASSIGNMENTS_SNAPSHOT_PREFIX, getChurchId() || "default");

  const loadAssignments = useCallback(async (preferSnapshot = true) => {
    const snapshot = preferSnapshot
      ? readSessionSnapshot<AssignmentsSnapshot>(snapshotKey, { validate: isAssignmentsSnapshot })
      : null;
    if (snapshot) {
      setAssignments(snapshot.data.assignments);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await fetchApi<Assignment[]>("/service-assignments/mine");
      const next = Array.isArray(data) ? data : [];
      setAssignments(next);
      writeSessionSnapshot(snapshotKey, { assignments: next });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar tus asignaciones.");
    } finally {
      setLoading(false);
    }
  }, [fetchApi, snapshotKey]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const groups = useMemo(() => {
    const sorted = [...assignments].sort((left, right) => {
      const leftTime = left.service?.date ? new Date(left.service.date).getTime() : 0;
      const rightTime = right.service?.date ? new Date(right.service.date).getTime() : 0;
      return leftTime - rightTime;
    });
    const now = Date.now();
    return {
      pending: sorted.filter((assignment) => assignmentStatus(assignment) === "pending" && assignment.service && new Date(assignment.service.date).getTime() >= now),
      upcoming: sorted.filter((assignment) => assignmentStatus(assignment) === "accepted" && assignment.service && new Date(assignment.service.date).getTime() >= now),
      history: sorted.filter((assignment) => assignment.service && (
        new Date(assignment.service.date).getTime() < now || assignmentStatus(assignment) === "declined"
      )).reverse(),
    };
  }, [assignments]);

  async function respond(assignment: Assignment, action: "accept" | "decline") {
    const nextStatus: AssignmentStatus = action === "accept" ? "accepted" : "declined";
    const previous = assignment;
    setRespondingId(assignment.id);
    setAssignments((current) => current.map((item) => item.id === assignment.id
      ? { ...item, confirmed: action === "accept", responseStatus: nextStatus, respondedAt: new Date().toISOString() }
      : item));

    try {
      await fetchApi(`/service-assignments/${assignment.id}/respond`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      toast({ title: action === "accept" ? "Asignación aceptada" : "Asignación declinada" });
    } catch (responseError) {
      setAssignments((current) => current.map((item) => item.id === assignment.id ? previous : item));
      toast({
        title: "No se pudo guardar tu respuesta",
        description: responseError instanceof Error ? responseError.message : "Intenta nuevamente.",
        variant: "destructive",
      });
    } finally {
      setRespondingId(null);
    }
  }

  function openAssignment(assignment: Assignment) {
    const serviceId = assignment.service?.id || assignment.serviceId;
    navigate(serviceId ? `/app/services/${serviceId}` : "/app/services");
  }

  return (
    <div className="mobile-page mx-auto max-w-4xl space-y-5">
      <SectionNav section="agenda" label="Agenda" />

      <header>
        <p className="mobile-section-title">Agenda</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Mis asignaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">Confirma dónde servirás y revisa tus próximas fechas.</p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p className="font-semibold">No pudimos cargar tus asignaciones.</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-3 border-red-200 bg-white text-red-700" onClick={() => loadAssignments(false)}>
            <RotateCw className="h-4 w-4" /> Reintentar
          </Button>
        </div>
      )}

      {loading && assignments.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Cargando asignaciones">
          {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <Clock className="mx-auto h-9 w-9 text-primary" />
          <p className="mt-3 font-semibold text-foreground">No tienes asignaciones todavía</p>
          <p className="mt-1 text-sm text-muted-foreground">Cuando un líder te asigne a un servicio aparecerá aquí.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.pending.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-700">Pendientes de respuesta</h2>
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{groups.pending.length}</Badge>
              </div>
              {groups.pending.map((assignment) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  responding={respondingId === assignment.id}
                  onOpen={() => openAssignment(assignment)}
                  onRespond={(action) => respond(assignment, action)}
                />
              ))}
            </section>
          )}

          {groups.upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Próximas</h2>
              {groups.upcoming.map((assignment) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  responding={respondingId === assignment.id}
                  onOpen={() => openAssignment(assignment)}
                  onRespond={(action) => respond(assignment, action)}
                />
              ))}
            </section>
          )}

          {groups.history.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Historial</h2>
              {groups.history.map((assignment) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  responding={respondingId === assignment.id}
                  compact={Boolean(assignment.service && new Date(assignment.service.date).getTime() < Date.now())}
                  onOpen={() => openAssignment(assignment)}
                  onRespond={(action) => respond(assignment, action)}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
