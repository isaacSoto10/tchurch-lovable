import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, X, Calendar } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";

type Assignment = {
  id: string;
  position: string;
  confirmed: boolean;
  responseStatus?: "pending" | "accepted" | "declined" | null;
  respondedAt?: string | null;
  service: {
    id: string;
    title: string;
    date: string;
  };
};

export default function MyAssignments() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadAssignments = useCallback(async () => {
    try {
      const data = await fetchApi<Assignment[]>("/service-assignments/mine");
      setAssignments(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load assignments:", e);
    } finally {
      setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  async function handleRespond(assignmentId: string, action: "accept" | "decline") {
    setActionLoading(assignmentId);
    try {
      await fetchApi(`/service-assignments/${assignmentId}/respond`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      toast({
        title: action === "accept" ? "Asignación aceptada" : "Asignación declinada",
      });
      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.id === assignmentId
            ? {
                ...assignment,
                confirmed: action === "accept",
                responseStatus: action === "accept" ? "accepted" : "declined",
                respondedAt: new Date().toISOString(),
              }
            : assignment
        )
      );
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "No se pudo responder la asignación",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  }

  const pendingAssignments = assignments.filter((a) => (a.responseStatus || (a.confirmed ? "accepted" : "pending")) === "pending");
  const confirmedAssignments = assignments.filter((a) => (a.responseStatus || (a.confirmed ? "accepted" : "pending")) === "accepted");
  const declinedAssignments = assignments.filter((a) => a.responseStatus === "declined");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="app-page space-y-5">
      <div className="app-page-header p-4 sm:p-5">
        <div className="app-page-header-grid">
          <div className="min-w-0">
            <p className="app-page-kicker">Servicio personal</p>
            <h1 className="app-page-title">Mis asignaciones</h1>
            <p className="app-page-copy">Confirma dónde participas y mantén clara tu disponibilidad para el equipo.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[300px]">
            <div className="dashboard-stat">
              <span className="dashboard-metric block text-xl font-semibold">{pendingAssignments.length}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">Pendientes</span>
            </div>
            <div className="dashboard-stat">
              <span className="dashboard-metric block text-xl font-semibold">{confirmedAssignments.length}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">Confirmadas</span>
            </div>
            <div className="dashboard-stat">
              <span className="dashboard-metric block text-xl font-semibold">{declinedAssignments.length}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">Declinadas</span>
            </div>
          </div>
        </div>
      </div>

      {pendingAssignments.length > 0 && (
        <section>
          <div className="app-section-heading">
            <h2 className="app-section-title">Pendientes de respuesta</h2>
            <span className="app-count-pill">{pendingAssignments.length}</span>
          </div>
          <div className="space-y-3">
            {pendingAssignments.map((assignment) => (
              <Card key={assignment.id} className="app-list-card">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="app-icon-tile bg-amber-50 text-amber-700">
                        <Calendar className="w-5 h-5 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{assignment.service?.title || "Servicio"}</p>
                        <p className="text-sm text-muted-foreground">
                          {assignment.position} -{" "}
                          {assignment.service?.date
                            ? new Date(assignment.service.date).toLocaleDateString("es-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-md text-red-500 hover:bg-red-50 hover:text-red-600"
                        disabled={actionLoading === assignment.id}
                        onClick={() => handleRespond(assignment.id, "decline")}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Declinar
                      </Button>
                      <Button
                        size="sm"
                        className="h-9 rounded-md"
                        disabled={actionLoading === assignment.id}
                        onClick={() => handleRespond(assignment.id, "accept")}
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Aceptar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="app-section-heading">
          <h2 className="app-section-title">Próximas confirmadas</h2>
          <span className="app-count-pill">{confirmedAssignments.length}</span>
        </div>
        {confirmedAssignments.length === 0 ? (
          <div className="app-empty-state text-sm">No hay asignaciones confirmadas.</div>
        ) : (
          <div className="space-y-3">
            {confirmedAssignments.map((assignment) => (
              <Card key={assignment.id} className="app-list-card">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="app-icon-tile bg-emerald-50 text-emerald-700">
                      <Check className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{assignment.service?.title || "Servicio"}</p>
                      <p className="text-sm text-muted-foreground">
                        {assignment.position} -{" "}
                        {assignment.service?.date
                          ? new Date(assignment.service.date).toLocaleDateString("es-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {declinedAssignments.length > 0 && (
        <section>
          <div className="app-section-heading">
            <h2 className="app-section-title">Declinadas</h2>
            <span className="app-count-pill">{declinedAssignments.length}</span>
          </div>
          <div className="space-y-3">
            {declinedAssignments.map((assignment) => (
              <Card key={assignment.id} className="app-list-card opacity-75">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="app-icon-tile bg-red-50 text-red-700">
                      <X className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{assignment.service?.title || "Servicio"}</p>
                      <p className="text-sm text-muted-foreground">
                        {assignment.position} -{" "}
                        {assignment.service?.date
                          ? new Date(assignment.service.date).toLocaleDateString("es-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
