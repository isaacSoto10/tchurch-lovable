import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
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

interface Ministry {
  id: string;
  name: string;
  description?: string;
  title?: string;
  desc?: string;
}

export default function Ministries() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMinistry, setEditingMinistry] = useState<Ministry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadMinistries();
  }, [fetchApi]);

  const loadMinistries = () => {
    setLoading(true);
    fetchApi("/ministries")
      .then((data) => setMinistries(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load ministries:", e))
      .finally(() => setLoading(false));
  };

  const filtered = ministries.filter((m) =>
    (m.name || m.title || "").toLowerCase().includes(search.toLowerCase())
  );

  const openNewDialog = () => {
    setEditingMinistry(null);
    setFormData({ name: "", description: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (ministry: Ministry) => {
    setEditingMinistry(ministry);
    setFormData({
      name: ministry.name || ministry.title || "",
      description: ministry.description || ministry.desc || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) return;

    setSubmitting(true);
    try {
      if (editingMinistry) {
        await fetchApi(`/ministries/${editingMinistry.id}`, {
          method: "PUT",
          body: JSON.stringify(formData),
        });
        toast({ title: "Ministry updated successfully" });
      } else {
        await fetchApi("/ministries", {
          method: "POST",
          body: JSON.stringify(formData),
        });
        toast({ title: "Ministry created successfully" });
      }
      setDialogOpen(false);
      loadMinistries();
    } catch (e) {
      toast({ title: "Failed to save ministry", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetchApi(`/ministries/${id}`, { method: "DELETE" });
      setMinistries((prev) => prev.filter((m) => m.id !== id));
      toast({ title: "Ministry deleted successfully" });
    } catch (e) {
      toast({ title: "Failed to delete ministry", variant: "destructive" });
    }
    setDeleteId(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Ministries</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNewDialog}>
              <Plus className="w-4 h-4 mr-1" /> New Ministry
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingMinistry ? "Edit Ministry" : "New Ministry"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Input
                  placeholder="Ministry name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                />
              </div>
              <div>
                <Textarea
                  placeholder="Description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search ministries..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="grid gap-3">
        {filtered.map((m: Ministry) => (
          <Card key={m.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">{m.name || m.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {m.description || m.desc || ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditDialog(m)}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <AlertDialog open={deleteId === m.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(m.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Ministry</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{m.name || m.title}"? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(m.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No ministries found.</p>
        )}
      </div>
    </div>
  );
}
