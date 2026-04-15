import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, X, Calendar } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";

type Assignment = {
  id: string;
  position: string;
  confirmed: boolean;
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

  useEffect(() => {
    loadAssignments();
  }, [fetchApi]);

  async function loadAssignments() {
    try {
      const data = await fetchApi<any[]>("/service-assignments/mine");
      setAssignments(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load assignments:", e);
    } finally {
      setLoading(false);
    }
  }

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
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to respond to assignment",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  }

  const pendingAssignments = assignments.filter((a) => !a.confirmed);
  const confirmedAssignments = assignments.filter((a) => a.confirmed);

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
    </div>
  );
}
