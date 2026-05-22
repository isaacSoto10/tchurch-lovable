import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users, Pencil, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Team {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  desc?: string;
  memberCount?: number;
  color?: string;
}

export default function Teams() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", color: "" });
  const [submitting, setSubmitting] = useState(false);

  const loadTeams = useCallback(() => {
    setLoading(true);
    fetchApi("/teams")
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch((e) => {
        console.error("Failed to load teams:", e);
        toast({ title: "No se pudieron cargar los equipos", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, [fetchApi, toast]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const openNewDialog = () => {
    setEditingTeam(null);
    setFormData({ name: "", description: "", color: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (team: Team) => {
    setEditingTeam(team);
    setFormData({
      name: team.name || team.title || "",
      description: team.description || team.desc || "",
      color: team.color || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast({ title: "El nombre es requerido", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        ...(formData.color.trim() && { color: formData.color.trim() }),
      };

      if (editingTeam) {
        await fetchApi(`/teams/${editingTeam.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "Equipo actualizado" });
      } else {
        await fetchApi("/teams", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Equipo creado" });
      }
      setDialogOpen(false);
      loadTeams();
    } catch (e) {
      console.error("Failed to save team:", e);
      toast({ title: "No se pudo guardar el equipo", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await fetchApi(`/teams/${deleteId}`, { method: "DELETE" });
      toast({ title: "Equipo eliminado" });
      setDeleteId(null);
      loadTeams();
    } catch (e) {
      console.error("Failed to delete team:", e);
      toast({ title: "No se pudo eliminar el equipo", variant: "destructive" });
    }
  };

  return (
    <div className="app-page space-y-5">
      <div className="app-page-header p-4 sm:p-5">
        <div className="app-page-header-grid">
          <div className="min-w-0">
            <p className="app-page-kicker">Equipos</p>
            <h1 className="app-page-title">Equipos</h1>
            <p className="app-page-copy">Agrupa voluntarios por responsabilidad y mantén visible quién sirve dónde.</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={openNewDialog} className="h-10 rounded-md">
              <Plus className="w-4 h-4 mr-1" /> Nuevo equipo
            </Button>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTeam ? "Editar equipo" : "Nuevo equipo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nombre</label>
              <Input
                placeholder="Nombre del equipo"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="app-control"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descripción</label>
              <Textarea
                placeholder="Descripción del equipo"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="rounded-md"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Color (opcional)</label>
              <Input
                placeholder="#5c3f9b"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="app-control"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="rounded-md" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Guardando..." : editingTeam ? "Actualizar" : "Crear"}
              </Button>
              <Button variant="outline" className="rounded-md" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {!loading && teams.length === 0 && (
          <div className="app-empty-state text-sm">Todavía no hay equipos.</div>
        )}
        {!loading && teams.map((t) => (
          <Card key={t.id} className="app-list-card cursor-pointer" onClick={() => navigate(`/app/teams/${t.id}`)}>
            <CardContent className="flex items-center gap-4 p-4">
              <div
                className="app-icon-tile"
                style={{ backgroundColor: t.color || "hsl(var(--accent))" }}
              >
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold">{t.name || t.title}</h3>
                <p className="truncate text-sm text-muted-foreground">{t.description || t.desc || ""}</p>
              </div>
              {t.memberCount != null && (
                <span className="app-count-pill">{t.memberCount} miembros</span>
              )}
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {isAdmin && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(t)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <AlertDialog open={deleteId === t.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteId(t.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Eliminar equipo</AlertDialogTitle>
                          <AlertDialogDescription>
                            ¿Seguro que quieres eliminar "{t.name || t.title}"? Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
