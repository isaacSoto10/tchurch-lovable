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
  }, [id, navigate]);

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
        <p className="text-muted-foreground">Equipo no encontrado</p>
        <Button variant="ghost" onClick={() => navigate("/app/teams")} className="mt-2">Volver</Button>
      </div>
    );
  }

  const colorDot = team.color || "#3b82f6";

  return (
    <div className="app-page space-y-4">
      {/* Header */}
      <div className="app-page-header">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate("/app/teams")} className="-ml-1 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card shadow-sm hover:bg-secondary">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="h-8 w-2 rounded-sm shrink-0" style={{ backgroundColor: colorDot }} />
            <div className="min-w-0">
              <p className="app-page-kicker">Equipo</p>
              <h1 className="truncate text-xl font-semibold text-foreground">{team.name}</h1>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="rounded-md" onClick={() => setShowEditTeam(true)}>Editar</Button>
              <Button variant="ghost" size="sm" className="rounded-md text-red-500" onClick={handleDeleteTeam}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* Team Info */}
        {team.description && (
          <Card className="app-list-card">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{team.description}</p>
            </CardContent>
          </Card>
        )}

        {/* Members */}
        <div className="app-section-heading">
          <h2 className="app-section-title">
            Miembros ({team.members?.length || 0})
          </h2>
          {isAdmin && (
            <Button size="sm" className="rounded-md" onClick={() => setShowAddMember(true)}>
              <Plus className="w-4 h-4 mr-1" /> Agregar
            </Button>
          )}
        </div>

        {(team.members || []).length === 0 ? (
          <Card className="app-empty-state">
            <CardContent className="p-8 text-center">
              <Users className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">Todavía no hay miembros.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(team.members || []).map((member) => (
              <Card key={member.id} className="app-list-card">
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
                    <p className="text-xs text-muted-foreground truncate">{member.user?.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={member.role === "LEADER" ? "default" : "secondary"} className="rounded-md text-xs">
                      {member.role}
                    </Badge>
                    {isAdmin && (
                      <button
                        onClick={() => handleRemoveMember(member.userId)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
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
            <DialogTitle>Agregar miembro</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="member@example.com" required />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Miembro</SelectItem>
                  <SelectItem value="LEADER">Líder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Agregar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT TEAM DIALOG */}
      <Dialog open={showEditTeam} onOpenChange={setShowEditTeam}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar equipo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateTeam} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                <Input value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} placeholder="#3b82f6" className="font-mono" />
                {editForm.color && (
                  <div className="w-10 h-10 rounded-md border border-border shrink-0" style={{ backgroundColor: editForm.color }} />
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditTeam(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
