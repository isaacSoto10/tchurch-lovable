import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Calendar, User, AlertCircle, Loader2, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useChurch } from "@/providers/ChurchProvider";
import { getChurchId } from "@/lib/api";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatServiceDate as formatCalendarDate, parseServiceDate as parseCalendarDate } from "@/lib/serviceDates";

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

type CurrentUserResponse = Partial<User> & { id: string };

type BlockoutsSnapshot = {
  blockouts: Blockout[];
  users: User[];
  currentUserId: string | null;
};

const BLOCKOUTS_SNAPSHOT_PREFIX = "tchurch_ios_blockouts_snapshot_v1";

function isBlockoutsSnapshot(data: unknown): data is BlockoutsSnapshot {
  if (!data || typeof data !== "object") return false;
  const snapshot = data as Partial<BlockoutsSnapshot>;
  return Array.isArray(snapshot.blockouts) && Array.isArray(snapshot.users);
}

export default function Blockouts() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const { user: authUser, userId: authUserId } = useAppAuth();
  const { selectedChurch } = useChurch();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);
  const snapshotKey = sessionSnapshotKey(BLOCKOUTS_SNAPSHOT_PREFIX, selectedChurch?.id || getChurchId());

  const applyBlockoutsSnapshot = useCallback((snapshot: BlockoutsSnapshot) => {
    setBlockouts(snapshot.blockouts);
    setUsers(snapshot.users);
    setCurrentUserId(snapshot.currentUserId);
    loadedOnceRef.current = true;
  }, []);

  const loadData = useCallback(async () => {
    const snapshot = readSessionSnapshot<BlockoutsSnapshot>(snapshotKey, { validate: isBlockoutsSnapshot });
    if (snapshot) {
      applyBlockoutsSnapshot(snapshot.data);
      setLoading(false);
    } else if (!loadedOnceRef.current) {
      setLoading(true);
    }

    try {
      const currentUser = await fetchApi<CurrentUserResponse>("/users/me").catch((e) => {
          console.error("Failed to load current user:", e);
          return null;
        });
      setCurrentUserId(currentUser?.id || null);

      const authEmail = authUser?.primaryEmailAddress?.emailAddress || "";
      const currentUserOption: User | null = currentUser?.id
        ? {
            id: currentUser.id,
            firstName: currentUser.firstName ?? authUser?.firstName ?? null,
            lastName: currentUser.lastName ?? authUser?.lastName ?? null,
            email: currentUser.email ?? authEmail,
          }
        : authUserId
          ? {
              id: authUserId,
              firstName: authUser?.firstName ?? null,
              lastName: authUser?.lastName ?? null,
              email: authEmail,
            }
          : null;
      const usersList = isAdmin
        ? await fetchApi<User[]>("/users")
        : currentUserOption
          ? [currentUserOption]
          : [];
      setUsers(usersList);
      if (!isAdmin && currentUserOption) setSelectedUser(currentUserOption);

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
      
      allBlockouts.sort((a, b) => {
        const aTime = parseCalendarDate(a.startDate)?.getTime() || 0;
        const bTime = parseCalendarDate(b.startDate)?.getTime() || 0;
        return aTime - bTime;
      });
      const nextSnapshot = {
        blockouts: allBlockouts,
        users: usersList,
        currentUserId: currentUser?.id || authUserId || null,
      };
      applyBlockoutsSnapshot(nextSnapshot);
      writeSessionSnapshot(snapshotKey, nextSnapshot);
    } catch (e) {
      console.error("Failed to load blockouts:", e);
    } finally {
      setLoading(false);
    }
  }, [applyBlockoutsSnapshot, authUser?.firstName, authUser?.lastName, authUser?.primaryEmailAddress?.emailAddress, authUserId, fetchApi, isAdmin, snapshotKey]);

  useEffect(() => {
    setCurrentUserId(null);
    loadData();
  }, [authUserId, loadData]);

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
          startDate,
          endDate,
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

  const canDeleteBlockout = (blockout: Blockout) => {
    return isAdmin || (!!currentUserId && blockout.userId === currentUserId);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    setDeletingId(deleteId);
    try {
      await fetchApi(`/blockouts/${deleteId}`, { method: "DELETE" });
      setBlockouts((current) => {
        const nextBlockouts = current.filter((blockout) => blockout.id !== deleteId);
        writeSessionSnapshot(snapshotKey, { blockouts: nextBlockouts, users, currentUserId });
        return nextBlockouts;
      });
      toast({ title: "Blockout date deleted" });
      setDeleteId(null);
    } catch (e) {
      console.error("Failed to delete blockout date:", e);
      toast({ title: "Failed to delete blockout date", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return formatCalendarDate(dateStr, "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const isPastBlockout = (endDateStr: string) => {
    const end = parseCalendarDate(endDateStr);
    if (!end) return false;
    end.setHours(23, 59, 59, 999);
    return end < new Date();
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
        {loading && blockouts.length === 0 && (
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
        {blockouts.map((blockout) => {
            const isPast = isPastBlockout(blockout.endDate);
            const canDelete = canDeleteBlockout(blockout);

            return (
              <Card key={blockout.id} className={isPast ? "opacity-60" : ""}>
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
                  <div className="flex shrink-0 items-start gap-1">
                    {isPast && (
                      <span className="flex min-h-11 items-center gap-1 text-xs text-muted-foreground">
                        <AlertCircle className="w-3 h-3" /> Past
                      </span>
                    )}
                    {canDelete && (
                      <AlertDialog open={deleteId === blockout.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0 rounded-xl"
                            aria-label="Delete blockout date"
                            title="Delete blockout date"
                            disabled={deletingId === blockout.id}
                            onClick={() => setDeleteId(blockout.id)}
                          >
                            {deletingId === blockout.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4 text-destructive" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete blockout date</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this blockout date? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleDelete}
                              disabled={deletingId === blockout.id}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {deletingId === blockout.id ? "Deleting..." : "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
