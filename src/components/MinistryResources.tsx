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
      console.error("No se pudieron cargar los recursos:", error);
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
      toast({ title: "Recurso subido", description: "Los miembros fueron notificados por correo." });
      if (inputRef.current) inputRef.current.value = "";
      await loadResources();
    } catch (error) {
      console.error("No se pudo subir el recurso:", error);
      toast({ title: "No se pudo subir el recurso", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetchApi(`/ministries/${ministryId}/resources/${id}`, { method: "DELETE" });
      setResources((prev) => prev.filter((resource) => resource.id !== id));
      toast({ title: "Recurso eliminado" });
    } catch (error) {
      console.error("No se pudo eliminar el recurso:", error);
      toast({ title: "No se pudo eliminar el recurso", variant: "destructive" });
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
        <Card className="app-empty-state">
          <CardContent className="p-5 text-center">
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
            <Button onClick={() => inputRef.current?.click()} disabled={uploading} className="rounded-md">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Subiendo..." : "Subir recurso"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Agrega PDFs, imágenes, audio, documentos o archivos de planificación para este ministerio.
            </p>
          </CardContent>
        </Card>
      )}

      {resources.length === 0 ? (
        <Card className="app-empty-state">
          <CardContent className="p-8 text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Todavía no hay recursos subidos.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {resources.map((resource) => (
            <Card key={resource.id} className="app-list-card">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="app-icon-tile h-11 w-11">
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
                    <a href={resource.url} target="_blank" rel="noreferrer" aria-label="Abrir recurso">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
                    <a href={resource.url} download={resource.original_name} aria-label="Descargar recurso">
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
