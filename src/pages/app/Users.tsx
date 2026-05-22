import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Mail, User, Plus, Loader2, UserCheck, Clock } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useToast } from "@/components/ui/use-toast";

interface Member {
  id: string;
  userId: string;
  email: string;
  role: string;
  status?: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  user?: {
    firstName: string | null;
    lastName: string | null;
    email: string;
    imageUrl: string | null;
  };
}

const ROLE_OPTIONS = [
  { value: "MEMBER", label: "Member" },
  { value: "PLANNER", label: "Planner" },
  { value: "MUSICIAN", label: "Musician" },
  { value: "TECH", label: "Tech" },
  { value: "ADMIN", label: "Admin" },
];

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

export default function Users() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [showAddMember, setShowAddMember] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  const isAdmin = selectedChurch?.role === "ADMIN";

  useEffect(() => {
    loadMembers();
  }, [fetchApi, selectedChurch]);

  async function loadMembers() {
    if (!selectedChurch) return;
    setLoading(true);
    try {
      const data = await fetchApi<any>(`/churches/${selectedChurch.id}/members`);
      const memberList = Array.isArray(data) ? data : (data.members || []);
      setMembers(memberList);
    } catch (e) {
      console.error("Failed to load members:", e);
      // Fallback to users API
      try {
        const data = await fetchApi("/users");
        setMembers(Array.isArray(data) ? data : []);
      } catch (e2) {
        console.error("Fallback also failed:", e2);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmail.trim() || !selectedChurch) return;
    setSubmitting(true);
    try {
      await fetchApi(`/churches/${selectedChurch.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: addEmail.trim(), role: addRole }),
      });
      toast({ title: "Member added successfully" });
      setShowAddMember(false);
      setAddEmail("");
      setAddRole("MEMBER");
      loadMembers();
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to add member", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateRole(userId: string, newRole: string) {
    if (!selectedChurch) return;
    setUpdatingRole(userId);
    try {
      await fetchApi(`/users/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });
      toast({ title: "Role updated" });
      setMembers((prev) => prev.map((m) => m.userId === userId || m.id === userId ? { ...m, role: newRole } : m));
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to update role", variant: "destructive" });
    } finally {
      setUpdatingRole(null);
    }
  }

  async function handleApproveMember(userId: string) {
    if (!selectedChurch) return;
    try {
      await fetchApi(`/churches/${selectedChurch.id}/members/${userId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: "Member approved" });
      loadMembers();
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to approve member", variant: "destructive" });
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!selectedChurch) return;
    try {
      await fetchApi(`/churches/${selectedChurch.id}/members/${userId}`, { method: "DELETE" });
      toast({ title: "Member removed" });
      setMembers((prev) => prev.filter((m) => m.userId !== userId && m.id !== userId));
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to remove member", variant: "destructive" });
    }
  }

  const filteredMembers = members.filter((m) => {
    const searchLower = search.toLowerCase();
    const firstName = m.user?.firstName || m.firstName || "";
    const lastName = m.user?.lastName || m.lastName || "";
    const email = m.user?.email || m.email || "";
    const fullName = `${firstName} ${lastName}`.toLowerCase();

    const matchesSearch = fullName.includes(searchLower) || email.toLowerCase().includes(searchLower);

    if (filter === "pending") {
      return matchesSearch && (m.status === "PENDING" || !m.status);
    }
    return matchesSearch;
  });

  const pendingCount = members.filter((m) => m.status === "PENDING" || !m.status).length;

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      ADMIN: "bg-purple-100 text-purple-800",
      LEADER: "bg-blue-100 text-blue-800",
      PLANNER: "bg-cyan-100 text-cyan-800",
      MUSICIAN: "bg-green-100 text-green-800",
      TECH: "bg-orange-100 text-orange-800",
      MEMBER: "bg-zinc-100 text-zinc-700",
    };
    return (
      <Badge className={`${colors[role] || colors.MEMBER} text-xs`}>
        {role}
      </Badge>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Members</h1>
          {pendingCount > 0 && isAdmin && (
            <Badge variant="destructive" className="text-xs">{pendingCount} pending</Badge>
          )}
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowAddMember(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add Member
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        <Button
          size="sm"
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          All ({members.length})
        </Button>
        {isAdmin && (
          <Button
            size="sm"
            variant={filter === "pending" ? "default" : "outline"}
            onClick={() => setFilter("pending")}
          >
            <Clock className="w-3 h-3 mr-1" /> Pending ({pendingCount})
          </Button>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search members..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && filteredMembers.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <User className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
              <p className="text-sm text-muted-foreground">
                {filter === "pending" ? "No pending members" : "No members found."}
              </p>
            </CardContent>
          </Card>
        )}
        {!loading && filteredMembers.map((member) => (
          <Card key={member.id || member.userId}>
            <CardContent className="p-4 flex items-center gap-3">
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                  {getInitials(member.user?.firstName, member.user?.lastName, member.user?.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {member.user?.firstName} {member.user?.lastName}
                </p>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  <Mail className="w-3 h-3 shrink-0" />
                  {member.user?.email || member.email}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(member.status === "PENDING" || !member.status) ? (
                  // Pending member
                  isAdmin ? (
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                        Pending
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        onClick={() => handleApproveMember(member.userId || member.id)}
                      >
                        <UserCheck className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleRemoveMember(member.userId || member.id)}
                      >
                        ×
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                      Pending
                    </Badge>
                  )
                ) : (
                  // Active member
                  <>
                    {isAdmin ? (
                      <Select
                        value={member.role}
                        onValueChange={(v) => handleUpdateRole(member.userId || member.id, v)}
                        disabled={updatingRole === (member.userId || member.id)}
                      >
                        <SelectTrigger className="h-7 w-auto min-w-[90px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      getRoleBadge(member.role)
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ADD MEMBER DIALOG */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Church Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="member@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
