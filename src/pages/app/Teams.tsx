import { useEffect, useState } from "react";
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

  useEffect(() => {
    loadTeams();
  }, [fetchApi]);

  const loadTeams = () => {
    setLoading(true);
    fetchApi("/teams")
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch((e) => {
        console.error("Failed to load teams:", e);
        toast({ title: "Failed to load teams", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  };

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
      toast({ title: "Name is required", variant: "destructive" });
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
        toast({ title: "Team updated successfully" });
      } else {
        await fetchApi("/teams", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Team created successfully" });
      }
      setDialogOpen(false);
      loadTeams();
    } catch (e) {
      console.error("Failed to save team:", e);
      toast({ title: "Failed to save team", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await fetchApi(`/teams/${deleteId}`, { method: "DELETE" });
      toast({ title: "Team deleted successfully" });
      setDeleteId(null);
      loadTeams();
    } catch (e) {
      console.error("Failed to delete team:", e);
      toast({ title: "Failed to delete team", variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Teams</h1>
        {isAdmin && <Button size="sm" onClick={openNewDialog}>
          <Plus className="w-4 h-4 mr-1" /> New Team
        </Button>}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTeam ? "Edit Team" : "New Team"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="Team name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Team description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Color (optional)</label>
              <Input
                placeholder="#3b82f6"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Saving..." : editingTeam ? "Update" : "Create"}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
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
          <p className="text-sm text-muted-foreground text-center py-8">No teams yet.</p>
        )}
        {!loading && teams.map((t) => (
          <Card key={t.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/app/teams/${t.id}`)}>
            <CardContent className="p-5 flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: t.color || "hsl(var(--accent))" }}
              >
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">{t.name || t.title}</h3>
                <p className="text-sm text-muted-foreground">{t.description || t.desc || ""}</p>
              </div>
              {t.memberCount != null && (
                <span className="text-sm text-muted-foreground">{t.memberCount} members</span>
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
                          <AlertDialogTitle>Delete Team</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{t.name || t.title}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
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