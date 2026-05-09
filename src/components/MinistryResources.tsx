import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { Download, ExternalLink, FileText, Loader2, Trash2, Upload } from "lucide-react";

type Resource = {
  id: string;
  title: string;
  original_name: string;
  mime_type: string;
  size: number;
  url: string;
  created_at: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MinistryResources({ ministryId, canManage }: { ministryId: string; canManage: boolean }) {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadResources = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<Resource[]>(`/ministries/${ministryId}/resources`);
      setResources(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to load resources:", error);
      setResources([]);
    } finally {
      setLoading(false);
    }
  }, [fetchApi, ministryId]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", file.name);
        await fetchApi(`/ministries/${ministryId}/resources`, {
          method: "POST",
          body: formData,
        });
      }
      toast({ title: "Resource uploaded", description: "Members were notified by email." });
      if (inputRef.current) inputRef.current.value = "";
      await loadResources();
    } catch (error) {
      console.error("Failed to upload resource:", error);
      toast({ title: "Failed to upload resource", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetchApi(`/ministries/${ministryId}/resources/${id}`, { method: "DELETE" });
      setResources((prev) => prev.filter((resource) => resource.id !== id));
      toast({ title: "Resource deleted" });
    } catch (error) {
      console.error("Failed to delete resource:", error);
      toast({ title: "Failed to delete resource", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="border-dashed">
          <CardContent className="p-5 text-center">
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
            <Button onClick={() => inputRef.current?.click()} disabled={uploading} className="rounded-full">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading..." : "Upload resource"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Add PDFs, images, audio, documents, or planning files for this ministry.
            </p>
          </CardContent>
        </Card>
      )}

      {resources.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No resources uploaded yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {resources.map((resource) => (
            <Card key={resource.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{resource.title || resource.original_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(resource.size)} · {new Date(resource.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" asChild>
                    <a href={resource.url} target="_blank" rel="noreferrer" aria-label="Open resource">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
                    <a href={resource.url} download={resource.original_name} aria-label="Download resource">
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                  {canManage && (
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(resource.id)} disabled={deletingId === resource.id}>
                      {deletingId === resource.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
