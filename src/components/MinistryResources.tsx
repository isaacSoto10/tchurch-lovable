import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import {
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";

type Resource = {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
  folderId: string | null;
};

type ResourceFolder = {
  id: string;
  name: string;
};

type ResourceState = {
  folders: ResourceFolder[];
  resources: Resource[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function readNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function readArray(source: Record<string, unknown>, keys: string[]): unknown[] {
  const values: unknown[] = [];
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) values.push(...value);
  }
  return values;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return date.toLocaleDateString();
}

function normalizeFolder(raw: unknown): ResourceFolder | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw, ["id", "folderId", "resourceFolderId", "resource_folder_id"]);
  if (!id) return null;

  return {
    id,
    name: readString(raw, ["name", "title", "label"]) || "Carpeta",
  };
}

function normalizeResource(raw: unknown, fallbackFolderId?: string | null): Resource | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw, ["id", "resourceId", "resource_id"]);
  if (!id) return null;

  const folderId =
    fallbackFolderId ??
    readString(raw, ["folderId", "folder_id", "resourceFolderId", "resource_folder_id"]) ??
    null;
  const title =
    readString(raw, ["title", "name", "original_name", "originalName", "fileName", "filename"]) ||
    "Recurso sin título";

  return {
    id,
    title,
    originalName:
      readString(raw, ["original_name", "originalName", "filename", "fileName", "name", "title"]) || title,
    mimeType: readString(raw, ["mime_type", "mimeType", "contentType", "type"]) || "",
    size: readNumber(raw, ["size", "bytes", "fileSize"]),
    url: readString(raw, ["url", "fileUrl", "downloadUrl", "publicUrl", "signedUrl"]) || "",
    createdAt: readString(raw, ["created_at", "createdAt", "uploadedAt", "created"]) || "",
    folderId,
  };
}

function normalizeResourcesPayload(payload: unknown): ResourceState {
  const resourcesById = new Map<string, Resource>();
  const foldersById = new Map<string, ResourceFolder>();

  const addResource = (raw: unknown, fallbackFolderId?: string | null) => {
    const resource = normalizeResource(raw, fallbackFolderId);
    if (!resource) return;

    const existing = resourcesById.get(resource.id);
    resourcesById.set(resource.id, {
      ...existing,
      ...resource,
      folderId: resource.folderId ?? existing?.folderId ?? null,
    });
  };

  if (Array.isArray(payload)) {
    payload.forEach((resource) => addResource(resource));
    return { folders: [], resources: Array.from(resourcesById.values()) };
  }

  if (!isRecord(payload)) {
    return { folders: [], resources: [] };
  }

  const rawFolders = readArray(payload, ["folders"]);
  rawFolders.forEach((rawFolder) => {
    const folder = normalizeFolder(rawFolder);
    if (!folder) return;

    foldersById.set(folder.id, folder);
    if (isRecord(rawFolder)) {
      readArray(rawFolder, ["files", "resources"]).forEach((resource) => addResource(resource, folder.id));
    }
  });

  readArray(payload, ["files", "resources"]).forEach((resource) => addResource(resource));

  return {
    folders: Array.from(foldersById.values()),
    resources: Array.from(resourcesById.values()),
  };
}

export function MinistryResources({ ministryId, canManage }: { ministryId: string; canManage: boolean }) {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<ResourceFolder | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingFolderId, setEditingFolderId] = useState("");
  const [updatingResourceId, setUpdatingResourceId] = useState<string | null>(null);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) || null,
    [folders, selectedFolderId]
  );

  const visibleResources = useMemo(
    () => resources.filter((resource) => (selectedFolderId ? resource.folderId === selectedFolderId : !resource.folderId)),
    [resources, selectedFolderId]
  );

  const resourceCountByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    resources.forEach((resource) => {
      if (!resource.folderId) return;
      counts.set(resource.folderId, (counts.get(resource.folderId) || 0) + 1);
    });
    return counts;
  }, [resources]);

  const rootResourceCount = useMemo(
    () => resources.filter((resource) => !resource.folderId).length,
    [resources]
  );

  const loadResources = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<unknown>(`/ministries/${ministryId}/resources`);
      const normalized = normalizeResourcesPayload(data);
      setFolders(normalized.folders);
      setResources(normalized.resources);
      setSelectedFolderId((current) =>
        current && normalized.folders.some((folder) => folder.id === current) ? current : null
      );
    } catch (error) {
      console.error("No se pudieron cargar los recursos:", error);
      setFolders([]);
      setResources([]);
      setSelectedFolderId(null);
    } finally {
      setLoading(false);
    }
  }, [fetchApi, ministryId]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;

    setCreatingFolder(true);
    try {
      const created = await fetchApi<unknown>(`/ministries/${ministryId}/resource-folders`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const folder =
        normalizeFolder(created) ||
        (isRecord(created) ? normalizeFolder(created.folder) || normalizeFolder(created.resourceFolder) : null);
      setNewFolderName("");
      if (folder) setSelectedFolderId(folder.id);
      toast({ title: "Carpeta creada" });
      await loadResources();
    } catch (error) {
      console.error("No se pudo crear la carpeta:", error);
      toast({ title: "No se pudo crear la carpeta", variant: "destructive" });
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", file.name);
        if (selectedFolderId) {
          formData.append("folderId", selectedFolderId);
        }
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
      setResourceToDelete(null);
    }
  }

  async function handleDeleteFolder() {
    if (!folderToDelete) return;

    setDeletingFolderId(folderToDelete.id);
    try {
      await fetchApi(`/ministries/${ministryId}/resource-folders/${folderToDelete.id}`, { method: "DELETE" });
      toast({ title: "Carpeta eliminada" });
      setFolderToDelete(null);
      setSelectedFolderId(null);
      await loadResources();
    } catch (error) {
      console.error("No se pudo eliminar la carpeta:", error);
      toast({ title: "No se pudo eliminar la carpeta", variant: "destructive" });
    } finally {
      setDeletingFolderId(null);
    }
  }

  async function handleRenameFolder(folder: ResourceFolder) {
    const currentName = folder.name || "Carpeta";
    const name = window.prompt("Nuevo nombre de carpeta", currentName)?.trim();
    if (!name || name === currentName) return;

    setRenamingFolderId(folder.id);
    try {
      await fetchApi(`/ministries/${ministryId}/resource-folders/${folder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await loadResources();
      toast({ title: "Carpeta actualizada" });
    } catch (error) {
      console.error("No se pudo renombrar la carpeta:", error);
      toast({ title: "No se pudo renombrar la carpeta", variant: "destructive" });
    } finally {
      setRenamingFolderId(null);
    }
  }

  function startEditingResource(resource: Resource) {
    setEditingResource(resource);
    setEditingTitle(resource.title || resource.originalName || "");
    setEditingFolderId(resource.folderId || "");
  }

  function cancelEditingResource() {
    setEditingResource(null);
    setEditingTitle("");
    setEditingFolderId("");
  }

  async function handleUpdateResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingResource) return;

    const title = editingTitle.trim();
    if (!title) return;

    setUpdatingResourceId(editingResource.id);
    try {
      await fetchApi(`/ministries/${ministryId}/resources/${editingResource.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          folderId: editingFolderId || null,
        }),
      });
      cancelEditingResource();
      await loadResources();
      toast({ title: "Recurso actualizado" });
    } catch (error) {
      console.error("No se pudo actualizar el recurso:", error);
      toast({ title: "No se pudo actualizar el recurso", variant: "destructive" });
    } finally {
      setUpdatingResourceId(null);
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
          <CardContent className="space-y-4 p-4">
            <form onSubmit={handleCreateFolder} className="flex gap-2">
              <Input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="Nombre de la carpeta"
                aria-label="Nombre de la carpeta"
              />
              <Button type="submit" disabled={creatingFolder || !newFolderName.trim()} className="shrink-0 rounded-full">
                {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                Crear
              </Button>
            </form>

            <div className="rounded-2xl bg-muted/40 p-3 text-center">
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
              />
              <p className="mb-2 text-xs text-muted-foreground">
                Se subirá en: <span className="font-semibold text-foreground">{selectedFolder?.name || "General"}</span>
              </p>
              <Button onClick={() => inputRef.current?.click()} disabled={uploading} className="w-full rounded-full sm:w-auto">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Subiendo..." : "Subir recurso"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Agrega PDFs, imágenes, audio, documentos o archivos de planificación para este ministerio.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {(folders.length > 0 || resources.length > 0) && (
        <Card>
          <CardContent className="space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carpetas</p>
                <p className="truncate text-sm font-semibold">{selectedFolder?.name || "General"}</p>
              </div>
              {canManage && selectedFolder && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    onClick={() => handleRenameFolder(selectedFolder)}
                    disabled={renamingFolderId === selectedFolder.id}
                  >
                    {renamingFolderId === selectedFolder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                    Renombrar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setFolderToDelete(selectedFolder)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar
                  </Button>
                </div>
              )}
            </div>

            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <Button
                type="button"
                variant={!selectedFolderId ? "default" : "outline"}
                className="h-auto min-w-[8rem] shrink-0 justify-start gap-2 rounded-2xl px-3 py-2"
                onClick={() => setSelectedFolderId(null)}
              >
                {!selectedFolderId ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm">General</span>
                  <span className="block text-xs opacity-75">{rootResourceCount} archivos</span>
                </span>
              </Button>

              {folders.map((folder) => {
                const isSelected = selectedFolderId === folder.id;
                const fileCount = resourceCountByFolder.get(folder.id) || 0;

                return (
                  <Button
                    key={folder.id}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    className="h-auto min-w-[8rem] shrink-0 justify-start gap-2 rounded-2xl px-3 py-2"
                    onClick={() => setSelectedFolderId(folder.id)}
                  >
                    {isSelected ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm">{folder.name}</span>
                      <span className="block text-xs opacity-75">{fileCount} archivos</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {resources.length === 0 && folders.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Todavía no hay recursos subidos.</p>
          </CardContent>
        </Card>
      ) : visibleResources.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FolderOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No hay recursos en {selectedFolder?.name || "General"} todavía.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleResources.map((resource) => (
            <Card key={resource.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{resource.title || resource.originalName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(resource.size)} · {formatDate(resource.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {resource.url ? (
                    <>
                      <Button variant="ghost" size="icon" asChild>
                        <a href={resource.url} target="_blank" rel="noreferrer" aria-label="Abrir recurso">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <a href={resource.url} download={resource.originalName} aria-label="Descargar recurso">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" disabled>
                      Sin enlace
                    </Button>
                  )}
                  {canManage && (
                    <>
                      <Button variant="ghost" size="icon" onClick={() => startEditingResource(resource)} aria-label="Editar recurso">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setResourceToDelete(resource)} disabled={deletingId === resource.id}>
                        {deletingId === resource.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={Boolean(folderToDelete)} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar carpeta</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que deseas eliminar "{folderToDelete?.name}"? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingFolderId)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDeleteFolder();
              }}
              disabled={Boolean(deletingFolderId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingFolderId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar carpeta"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(resourceToDelete)} onOpenChange={(open) => !open && setResourceToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar recurso</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que deseas eliminar "{resourceToDelete?.title || resourceToDelete?.originalName}"? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (resourceToDelete) handleDelete(resourceToDelete.id);
              }}
              disabled={Boolean(deletingId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar recurso"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(editingResource)} onOpenChange={(open) => !open && cancelEditingResource()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar recurso</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateResource} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ministry-resource-title">Nombre</Label>
              <Input
                id="ministry-resource-title"
                value={editingTitle}
                onChange={(event) => setEditingTitle(event.target.value)}
                placeholder="Nombre del recurso"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ministry-resource-folder">Carpeta</Label>
              <select
                id="ministry-resource-folder"
                value={editingFolderId}
                onChange={(event) => setEditingFolderId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">General</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cancelEditingResource}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!editingTitle.trim() || updatingResourceId === editingResource?.id}>
                {updatingResourceId === editingResource?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
