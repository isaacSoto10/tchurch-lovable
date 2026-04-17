import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowLeft, Plus, UserMinus, Trash2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";

type TeamMember = {
  id: string;
  userId: string;
  role: string;
  user: { firstName: string | null; lastName: string | null; email: string } | null;
};

type Team = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  members: TeamMember[];
  createdAt: string;
};

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("MEMBER");
  const [editForm, setEditForm] = useState({ name: "", description: "", color: "" });
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = selectedChurch?.role === "ADMIN";

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const data = await apiFetch<Team>(`/teams/${id}`);
        if (data.error) { navigate("/app/teams"); return; }
        setTeam(data);
        setEditForm({
          name: data.name || "",
          description: data.description || "",
          color: data.color || "",
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmail.trim() || !id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/teams/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: addEmail.trim(), role: addRole }),
      });
      setShowAddMember(false);
      setAddEmail("");
      setAddRole("MEMBER");
      const data = await apiFetch<Team>(`/teams/${id}`);
      setTeam(data);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!id) return;
    try {
      await apiFetch(`/teams/${id}/members/${userId}`, { method: "DELETE" });
      setTeam((prev) => prev ? {
        ...prev,
        members: (prev.members || []).filter((m) => m.userId !== userId),
      } : prev);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUpdateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/teams/${id}`, {
        method: "PUT",
        body: JSON.stringify(editForm),
      });
      setShowEditTeam(false);
      const data = await apiFetch<Team>(`/teams/${id}`);
      setTeam(data);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteTeam() {
    if (!id) return;
    try {
      await apiFetch(`/teams/${id}`, { method: "DELETE" });
      navigate("/app/teams");
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

  if (!team) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Team not found</p>
        <Button variant="ghost" onClick={() => navigate("/app/teams")} className="mt-2">Back</Button>
      </div>
    );
  }

  const colorDot = team.color || "#3b82f6";

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/app/teams")} className="p-2 -ml-2 rounded-lg hover:bg-zinc-100">
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colorDot }} />
            <h1 className="font-semibold text-zinc-900 truncate">{team.name}</h1>
          </div>
          {isAdmin && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setShowEditTeam(true)}>Edit</Button>
              <Button variant="ghost" size="sm" className="text-red-500" onClick={handleDeleteTeam}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* Team Info */}
        {team.description && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-zinc-600">{team.description}</p>
            </CardContent>
          </Card>
        )}

        {/* Members */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">
            Members ({team.members?.length || 0})
          </h2>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowAddMember(true)}>
              <Plus className="w-4 h-4 mr-1" /> Add Member
            </Button>
          )}
        </div>

        {(team.members || []).length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Users className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
              <p className="text-sm text-muted-foreground">No members yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(team.members || []).map((member) => (
              <Card key={member.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                      {getInitials(member.user?.firstName, member.user?.lastName, member.user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {member.user?.firstName} {member.user?.lastName}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">{member.user?.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={member.role === "LEADER" ? "default" : "secondary"} className="text-xs">
                      {member.role}
                    </Badge>
                    {isAdmin && (
                      <button
                        onClick={() => handleRemoveMember(member.userId)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ADD MEMBER DIALOG */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="member@example.com" required />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="LEADER">Leader</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT TEAM DIALOG */}
      <Dialog open={showEditTeam} onOpenChange={setShowEditTeam}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateTeam} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                <Input value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} placeholder="#3b82f6" className="font-mono" />
                {editForm.color && (
                  <div className="w-10 h-10 rounded-lg border border-zinc-200 shrink-0" style={{ backgroundColor: editForm.color }} />
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditTeam(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
