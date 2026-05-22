import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, Calendar, User, AlertCircle } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Blockout {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  userId: string;
  user?: {
    firstName: string | null;
    lastName: string | null;
  };
}

interface User {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export default function Blockouts() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, [fetchApi]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData] = await Promise.all([fetchApi("/users")]);
      const usersList = Array.isArray(usersData) ? usersData : [];
      setUsers(usersList);

      const blockoutPromises = usersList.map((user: User) =>
        fetchApi(`/blockouts?userId=${user.id}`).catch(() => [])
      );
      const blockoutResults = await Promise.all(blockoutPromises);
      
      const allBlockouts: Blockout[] = [];
      usersList.forEach((user: User, idx) => {
        const userBlockouts = Array.isArray(blockoutResults[idx]) ? blockoutResults[idx] : [];
        userBlockouts.forEach((b: Blockout) => {
          allBlockouts.push({
            ...b,
            user: {
              firstName: user.firstName,
              lastName: user.lastName,
            },
          });
        });
      });
      
      allBlockouts.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      setBlockouts(allBlockouts);
    } catch (e) {
      console.error("Failed to load blockouts:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedUser || !startDate || !endDate) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      await fetchApi("/blockouts", {
        method: "POST",
        body: JSON.stringify({
          userId: selectedUser.id,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          reason: reason || null,
        }),
      });
      toast({ title: "Blockout date added" });
      setDialogOpen(false);
      resetForm();
      loadData();
    } catch (e) {
      toast({ title: "Failed to add blockout date", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedUser(null);
    setStartDate("");
    setEndDate("");
    setReason("");
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const isPastBlockout = (endDateStr: string) => {
    return new Date(endDateStr) < new Date();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Blockout Dates</h1>
          <p className="text-sm text-muted-foreground">Manage unavailable dates for team members</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" /> Add Blockout
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Blockout Date</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Member *</label>
                <Select
                  value={selectedUser?.id || ""}
                  onValueChange={(v) => {
                    const user = users.find((u) => u.id === v);
                    setSelectedUser(user || null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.firstName} {user.lastName} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Start Date *</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">End Date *</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Reason (optional)</label>
                <Textarea
                  placeholder="Vacation, out of town, etc."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Adding..." : "Add Blockout"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {!loading && blockouts.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <Calendar className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No blockout dates yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Team members can add dates when they are unavailable
              </p>
            </CardContent>
          </Card>
        )}
        {!loading &&
          blockouts.map((blockout) => (
            <Card key={blockout.id} className={isPastBlockout(blockout.endDate) ? "opacity-60" : ""}>
              <CardContent className="p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">
                    {blockout.user?.firstName} {blockout.user?.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(blockout.startDate)} — {formatDate(blockout.endDate)}
                  </p>
                  {blockout.reason && (
                    <p className="text-xs text-muted-foreground mt-1">{blockout.reason}</p>
                  )}
                </div>
                {isPastBlockout(blockout.endDate) && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Past
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}