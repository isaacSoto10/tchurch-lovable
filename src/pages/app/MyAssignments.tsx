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
        title: action === "accept" ? "Assignment accepted" : "Assignment declined",
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
        title: e instanceof Error ? e.message : "Failed to respond to assignment",
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
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Assignments</h1>
        <p className="text-sm text-muted-foreground">Manage your service assignments</p>
      </div>

      {pendingAssignments.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Pending Response
          </h2>
          <div className="space-y-3">
            {pendingAssignments.map((assignment) => (
              <Card key={assignment.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="font-medium">{assignment.service?.title || "Service"}</p>
                        <p className="text-sm text-muted-foreground">
                          {assignment.position} ·{" "}
                          {assignment.service?.date
                            ? new Date(assignment.service.date).toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        disabled={actionLoading === assignment.id}
                        onClick={() => handleRespond(assignment.id, "decline")}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        disabled={actionLoading === assignment.id}
                        onClick={() => handleRespond(assignment.id, "accept")}
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Accept
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Upcoming Confirmed
        </h2>
        {confirmedAssignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No confirmed assignments.</p>
        ) : (
          <div className="space-y-3">
            {confirmedAssignments.map((assignment) => (
              <Card key={assignment.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <Check className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium">{assignment.service?.title || "Service"}</p>
                      <p className="text-sm text-muted-foreground">
                        {assignment.position} ·{" "}
                        {assignment.service?.date
                          ? new Date(assignment.service.date).toLocaleDateString("en-US", {
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
      </div>

      {declinedAssignments.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Declined
          </h2>
          <div className="space-y-3">
            {declinedAssignments.map((assignment) => (
              <Card key={assignment.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 opacity-75">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                      <X className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <p className="font-medium">{assignment.service?.title || "Service"}</p>
                      <p className="text-sm text-muted-foreground">
                        {assignment.position} ·{" "}
                        {assignment.service?.date
                          ? new Date(assignment.service.date).toLocaleDateString("en-US", {
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
        </div>
      )}
    </div>
  );
}
