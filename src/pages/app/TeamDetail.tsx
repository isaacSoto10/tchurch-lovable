import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Plus, RotateCw, Trash2, UserMinus, Users } from "lucide-react";
import { SectionNav } from "@/components/SectionNav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import { useChurch } from "@/providers/ChurchProvider";

type TeamUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

type TeamMember = {
  id: string;
  userId: string;
  role: string;
  position?: string | null;
  user: TeamUser | null;
};

type Team = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  members: TeamMember[];
  createdAt?: string;
};

type TeamDetailSnapshot = { team: Team };
const TEAM_DETAIL_SNAPSHOT_PREFIX = "tchurch_ios_team_detail_snapshot_v2";

function isTeamDetailSnapshot(value: unknown): value is TeamDetailSnapshot {
  return Boolean(value && typeof value === "object" && (value as TeamDetailSnapshot).team?.id);
}

function displayName(user?: TeamUser | null) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Miembro";
}

function initials(user?: TeamUser | null) {
  const value = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}`.trim();
  return (value || user?.email?.[0] || "?").toUpperCase();
}

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const canWrite = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";
  const canDelete = selectedChurch?.role === "ADMIN";
  const [team, setTeam] = useState<Team | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTeamOpen, setDeleteTeamOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [position, setPosition] = useState("");
  const [editForm, setEditForm] = useState({ name: "", description: "", color: "#5B4FD8" });
  const [submitting, setSubmitting] = useState(false);
  const snapshotKey = sessionSnapshotKey(TEAM_DETAIL_SNAPSHOT_PREFIX, `${selectedChurch?.id || getChurchId() || "default"}:${id || "unknown"}`);

  const applyTeam = useCallback((nextTeam: Team) => {
    setTeam({ ...nextTeam, members: Array.isArray(nextTeam.members) ? nextTeam.members : [] });
    setEditForm({ name: nextTeam.name || "", description: nextTeam.description || "", color: nextTeam.color || "#5B4FD8" });
  }, []);

  const loadTeam = useCallback(async (preferSnapshot = true) => {
    if (!id) return;
    const snapshot = preferSnapshot
      ? readSessionSnapshot<TeamDetailSnapshot>(snapshotKey, { validate: isTeamDetailSnapshot })
      : null;
    if (snapshot) {
      applyTeam(snapshot.data.team);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchApi<Team>(`/teams/${id}`);
      applyTeam(data);
      writeSessionSnapshot(snapshotKey, { team: data });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar el equipo.");
      if (!snapshot) setTeam(null);
    } finally {
      setLoading(false);
    }
  }, [applyTeam, fetchApi, id, snapshotKey]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    if (!addOpen || users.length > 0) return;
    void fetchApi<TeamUser[]>("/users")
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((loadError) => toast({ title: "No se pudo cargar la lista de miembros", variant: "destructive" }));
  }, [addOpen, fetchApi, toast, users.length]);

  const availableUsers = useMemo(() => {
    const existing = new Set((team?.members || []).map((member) => member.userId));
    return users.filter((user) => !existing.has(user.id));
  }, [team?.members, users]);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!id || !selectedUserId) return;
    setSubmitting(true);
    try {
      await fetchApi("/team-members", {
        method: "POST",
        body: JSON.stringify({ teamId: id, userId: selectedUserId, position: position.trim() || null, role: "MUSICIAN" }),
      });
      setAddOpen(false);
      setSelectedUserId("");
      setPosition("");
      toast({ title: "Integrante agregado" });
      await loadTeam(false);
    } catch (addError) {
      toast({ title: "No se pudo agregar el integrante", description: addError instanceof Error ? addError.message : undefined, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMember() {
    if (!removeTarget) return;
    setSubmitting(true);
    try {
      await fetchApi(`/team-members/${removeTarget.id}`, { method: "DELETE" });
      setTeam((current) => current ? { ...current, members: current.members.filter((member) => member.id !== removeTarget.id) } : current);
      setRemoveTarget(null);
      toast({ title: "Integrante removido" });
    } catch (removeError) {
      toast({ title: "No se pudo remover el integrante", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function updateTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!id || !editForm.name.trim()) return;
    setSubmitting(true);
    try {
      await fetchApi(`/teams/${id}`, { method: "PUT", body: JSON.stringify(editForm) });
      setEditOpen(false);
      toast({ title: "Equipo actualizado" });
      await loadTeam(false);
    } catch (updateError) {
      toast({ title: "No se pudo actualizar el equipo", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteTeam() {
    if (!id) return;
    setSubmitting(true);
    try {
      await fetchApi(`/teams/${id}`, { method: "DELETE" });
      navigate("/app/teams");
    } catch (deleteError) {
      toast({ title: "No se pudo eliminar el equipo", variant: "destructive" });
      setSubmitting(false);
    }
  }

  if (loading && !team) {
    return <div className="mobile-page flex min-h-[50svh] items-center justify-center" role="status" aria-label="Cargando equipo"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!team) {
    return (
      <div className="mobile-page mx-auto max-w-3xl space-y-5">
        <SectionNav section="people" label="Personas" isAdmin={canDelete} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700" role="alert">
          <p className="font-semibold">No pudimos abrir este equipo.</p>
          <p className="mt-1 text-sm">{error || "El equipo no existe o ya no está disponible."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/app/teams")}><ArrowLeft className="h-4 w-4" /> Volver</Button>
            <Button onClick={() => loadTeam(false)}><RotateCw className="h-4 w-4" /> Reintentar</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-page mx-auto max-w-5xl space-y-5">
      <SectionNav section="people" label="Personas" isAdmin={canDelete} />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate("/app/teams")} aria-label="Volver a equipos"><ArrowLeft className="h-4 w-4" /></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: team.color || "#5B4FD8" }} />
              <p className="mobile-section-title">Equipo</p>
            </div>
            <h1 className="mt-1 break-words text-3xl font-bold tracking-tight text-foreground">{team.name}</h1>
            {team.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{team.description}</p>}
          </div>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Editar</Button>
            {canDelete && <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteTeamOpen(true)}><Trash2 className="h-4 w-4" /> Eliminar</Button>}
          </div>
        )}
      </header>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Mostramos una copia guardada. {error}</div>}

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Integrantes</h2>
            <p className="text-sm text-muted-foreground">{team.members.length} persona{team.members.length === 1 ? "" : "s"} en este equipo.</p>
          </div>
          {canWrite && <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Agregar integrante</Button>}
        </div>

        {team.members.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
            <Users className="mx-auto h-9 w-9 text-primary" />
            <p className="mt-3 font-semibold text-foreground">Este equipo aún no tiene integrantes</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {team.members.map((member) => (
              <Card key={member.id} className="app-card">
                <CardContent className="flex min-h-20 items-center gap-3 p-3">
                  <Avatar className="h-11 w-11 shrink-0"><AvatarFallback className="bg-secondary font-semibold text-primary">{initials(member.user)}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{displayName(member.user)}</p>
                    <p className="truncate text-xs text-muted-foreground">{member.user?.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {member.position && <Badge variant="secondary">{member.position}</Badge>}
                      {!member.position && member.role && <Badge variant="outline">{member.role.toLowerCase()}</Badge>}
                    </div>
                  </div>
                  {canWrite && <Button variant="ghost" size="icon" className="shrink-0 text-red-600 hover:bg-red-50" onClick={() => setRemoveTarget(member)} aria-label={`Remover a ${displayName(member.user)}`}><UserMinus className="h-4 w-4" /></Button>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agregar integrante</DialogTitle><DialogDescription>Selecciona un miembro de la iglesia y su posición.</DialogDescription></DialogHeader>
          <form onSubmit={addMember} className="space-y-4">
            <div className="space-y-2">
              <Label>Miembro</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Seleccionar miembro" /></SelectTrigger>
                <SelectContent>{availableUsers.map((user) => <SelectItem key={user.id} value={user.id}>{displayName(user)} · {user.email}</SelectItem>)}</SelectContent>
              </Select>
              {availableUsers.length === 0 && <p className="text-xs text-muted-foreground">No hay más miembros disponibles.</p>}
            </div>
            <div className="space-y-2"><Label htmlFor="team-position">Posición</Label><Input id="team-position" value={position} onChange={(event) => setPosition(event.target.value)} placeholder="Voz, guitarra, audio..." className="h-11 rounded-xl" /></div>
            <DialogFooter className="gap-2 sm:gap-0"><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button><Button type="submit" disabled={submitting || !selectedUserId}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />}Agregar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar equipo</DialogTitle><DialogDescription>Actualiza la información visible del equipo.</DialogDescription></DialogHeader>
          <form onSubmit={updateTeam} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="edit-team-name">Nombre</Label><Input id="edit-team-name" value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} className="h-11 rounded-xl" required /></div>
            <div className="space-y-2"><Label htmlFor="edit-team-description">Descripción</Label><Textarea id="edit-team-description" value={editForm.description} onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))} className="resize-none rounded-xl" rows={3} /></div>
            <DialogFooter className="gap-2 sm:gap-0"><Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button><Button type="submit" disabled={submitting || !editForm.name.trim()}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />}Guardar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remover integrante</AlertDialogTitle><AlertDialogDescription>{removeTarget ? `${displayName(removeTarget.user)} dejará de pertenecer a este equipo.` : ""}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={removeMember}>Remover</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTeamOpen} onOpenChange={setDeleteTeamOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Eliminar equipo</AlertDialogTitle><AlertDialogDescription>Se eliminará “{team.name}” y sus membresías. Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={deleteTeam} disabled={submitting}>Eliminar</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
