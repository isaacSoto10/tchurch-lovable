import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";

interface Announcement {
  id: string;
  title: string;
  content?: string;
  description?: string;
  imageUrl?: string;
  publishAt?: string;
  createdAt: string;
}

interface AnnouncementFormData {
  title: string;
  content: string;
  imageUrl: string;
  publishAt: string;
}

export default function Announcements() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<AnnouncementFormData>({
    title: "",
    content: "",
    imageUrl: "",
    publishAt: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadAnnouncements();
  }, [fetchApi]);

  const loadAnnouncements = () => {
    setLoading(true);
    fetchApi("/announcements")
      .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load announcements:", e))
      .finally(() => setLoading(false));
  };

  const openNewDialog = () => {
    setEditingAnnouncement(null);
    setFormData({ title: "", content: "", imageUrl: "", publishAt: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setFormData({
      title: announcement.title || "",
      content: announcement.content || announcement.description || "",
      imageUrl: announcement.imageUrl || "",
      publishAt: announcement.publishAt ? announcement.publishAt.slice(0, 16) : "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, string> = {
        title: formData.title,
        content: formData.content,
      };
      if (formData.imageUrl) payload.imageUrl = formData.imageUrl;
      if (formData.publishAt) payload.publishAt = formData.publishAt;

      if (editingAnnouncement) {
        await fetchApi(`/announcements/${editingAnnouncement.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "Announcement updated successfully" });
      } else {
        await fetchApi("/announcements", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Announcement created successfully" });
      }

      setDialogOpen(false);
      loadAnnouncements();
    } catch (e) {
      console.error("Failed to save announcement:", e);
      toast({ title: "Failed to save announcement", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await fetchApi(`/announcements/${deleteId}`, { method: "DELETE" });
      toast({ title: "Announcement deleted successfully" });
      setDeleteId(null);
      loadAnnouncements();
    } catch (e) {
      console.error("Failed to delete announcement:", e);
      toast({ title: "Failed to delete announcement", variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Announcements</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNewDialog}>
              <Plus className="w-4 h-4 mr-1" /> New
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingAnnouncement ? "Edit Announcement" : "New Announcement"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Input
                  placeholder="Title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div>
                <Textarea
                  placeholder="Content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={4}
                />
              </div>
              <div>
                <Input
                  placeholder="Image URL (optional)"
                  value={formData.imageUrl}
                  onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                />
              </div>
              <div>
                <Input
                  type="datetime-local"
                  placeholder="Publish at (optional)"
                  value={formData.publishAt}
                  onChange={(e) => setFormData({ ...formData, publishAt: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Saving..." : editingAnnouncement ? "Update" : "Create"}
                </Button>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {!loading && announcements.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No announcements yet.
          </p>
        )}
        {!loading && announcements.map((a) => (
          <Card key={a.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">{a.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {a.description || a.content || a.desc}
                  </p>
                  {a.publishAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Publishes: {new Date(a.publishAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog(a)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <AlertDialog open={deleteId === a.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(a.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{a.title}"? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}