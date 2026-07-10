import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Loader2, Pencil, Plus, RotateCw, Trash2, Users } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import { useChurch } from "@/providers/ChurchProvider";

interface Team {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  desc?: string;
  memberCount?: number;
  color?: string;
}

type TeamsSnapshot = { teams: Team[] };
const TEAMS_SNAPSHOT_PREFIX = "tchurch_ios_teams_snapshot_v2";
const TEAM_COLORS = ["#5B4FD8", "#2563EB", "#0F766E", "#B45309", "#BE185D", "#475569"];

function isTeamsSnapshot(value: unknown): value is TeamsSnapshot {
  return Boolean(value && typeof value === "object" && Array.isArray((value as TeamsSnapshot).teams));
}

function teamName(team: Team) {
  return team.name || team.title || "Equipo sin nombre";
}

function teamDescription(team: Team) {
  return team.description || team.desc || "Sin descripción";
}

export default function Teams() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const canWrite = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";
  const canDelete = selectedChurch?.role === "ADMIN";
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", color: TEAM_COLORS[0] });
  const [submitting, setSubmitting] = useState(false);
  const snapshotKey = sessionSnapshotKey(TEAMS_SNAPSHOT_PREFIX, selectedChurch?.id || getChurchId() || "default");

  const loadTeams = useCallback(async (preferSnapshot = true) => {
    const snapshot = preferSnapshot
      ? readSessionSnapshot<TeamsSnapshot>(snapshotKey, { validate: isTeamsSnapshot })
      : null;
    if (snapshot) {
      setTeams(snapshot.data.teams);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchApi<Team[]>("/teams");
      const next = Array.isArray(data) ? data : [];
      setTeams(next);
      writeSessionSnapshot(snapshotKey, { teams: next });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar los equipos.");
    } finally {
      setLoading(false);
    }
  }, [fetchApi, snapshotKey]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  function openNewDialog() {
    setEditingTeam(null);
    setFormData({ name: "", description: "", color: TEAM_COLORS[0] });
    setDialogOpen(true);
  }

  function openEditDialog(team: Team) {
    setEditingTeam(team);
    setFormData({ name: teamName(team), description: team.description || team.desc || "", color: team.color || TEAM_COLORS[0] });
    setDialogOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!formData.name.trim()) return;
    setSubmitting(true);
    try {
      const path = editingTeam ? `/teams/${editingTeam.id}` : "/teams";
      await fetchApi(path, {
        method: editingTeam ? "PUT" : "POST",
        body: JSON.stringify({ name: formData.name.trim(), description: formData.description.trim(), color: formData.color }),
      });
      toast({ title: editingTeam ? "Equipo actualizado" : "Equipo creado" });
      setDialogOpen(false);
      await loadTeams(false);
    } catch (saveError) {
      toast({ title: "No se pudo guardar el equipo", description: saveError instanceof Error ? saveError.message : undefined, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await fetchApi(`/teams/${deleteTarget.id}`, { method: "DELETE" });
      toast({ title: "Equipo eliminado" });
      setDeleteTarget(null);
      await loadTeams(false);
    } catch (deleteError) {
      toast({ title: "No se pudo eliminar el equipo", variant: "destructive" });
    }
  }

  return (
    <div className="mobile-page mx-auto max-w-5xl space-y-5">
      <SectionNav section="people" label="Personas" isAdmin={canDelete} />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mobile-section-title">Personas</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Equipos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Organiza a las personas que sirven juntas.</p>
        </div>
        {canWrite && <Button onClick={openNewDialog}><Plus className="h-4 w-4" /> Nuevo equipo</Button>}
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p className="font-semibold">No pudimos cargar los equipos.</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-3 border-red-200 bg-white text-red-700" onClick={() => loadTeams(false)}><RotateCw className="h-4 w-4" /> Reintentar</Button>
        </div>
      )}

      {loading && teams.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2" role="status" aria-label="Cargando equipos">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <Users className="mx-auto h-9 w-9 text-primary" />
          <p className="mt-3 font-semibold text-foreground">Todavía no hay equipos</p>
          <p className="mt-1 text-sm text-muted-foreground">Crea un equipo para organizar integrantes y responsabilidades.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {teams.map((team) => {
            const href = `/app/teams/${team.id}`;
            return (
              <Card key={team.id} className="app-card">
                <CardContent className="flex min-h-28 items-center gap-3 p-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: team.color || TEAM_COLORS[0] }}>
                    <Users className="h-5 w-5" />
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate(href)}
                    onFocus={() => preloadAppRoute(href)}
                    onPointerEnter={() => preloadAppRoute(href)}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block truncate font-semibold text-foreground">{teamName(team)}</span>
                    <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{teamDescription(team)}</span>
                    <span className="mt-2 block text-xs font-medium text-primary">{team.memberCount || 0} integrante{team.memberCount === 1 ? "" : "s"}</span>
                  </button>
                  {canWrite && (
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(team)} aria-label={`Editar ${teamName(team)}`}><Pencil className="h-4 w-4" /></Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="icon" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteTarget(team)} aria-label={`Eliminar ${teamName(team)}`}><Trash2 className="h-4 w-4" /></Button>
                  )}
                  {!canWrite && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTeam ? "Editar equipo" : "Nuevo equipo"}</DialogTitle>
            <DialogDescription>Define un nombre, propósito y color para reconocerlo.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="team-name" className="text-sm font-semibold text-foreground">Nombre</label>
              <Input id="team-name" value={formData.name} onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))} className="mt-2 h-11 rounded-xl" required />
            </div>
            <div>
              <label htmlFor="team-description" className="text-sm font-semibold text-foreground">Descripción</label>
              <Textarea id="team-description" value={formData.description} onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))} className="mt-2 resize-none rounded-xl" rows={3} />
            </div>
            <fieldset>
              <legend className="text-sm font-semibold text-foreground">Color</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {TEAM_COLORS.map((color) => (
                  <button key={color} type="button" aria-label={`Usar color ${color}`} aria-pressed={formData.color === color} onClick={() => setFormData((current) => ({ ...current, color }))} className={`h-11 w-11 rounded-xl border-2 ${formData.color === color ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: color }} />
                ))}
              </div>
            </fieldset>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting || !formData.name.trim()}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{editingTeam ? "Guardar" : "Crear"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar equipo</AlertDialogTitle>
            <AlertDialogDescription>Se eliminará “{deleteTarget ? teamName(deleteTarget) : ""}”. Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
