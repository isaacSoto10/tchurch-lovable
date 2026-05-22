import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Pencil, Trash2, ArrowLeft, Users, Megaphone, FolderOpen, UserPlus, X, Calendar } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";
import { MinistryResources } from "@/components/MinistryResources";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  color?: string;
  members?: MinistryMember[];
  groups?: Group[];
}

interface MinistryMember {
  id: string;
  userId: string;
  role: string;
  user?: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

interface Group {
  id: string;
  name: string;
  description?: string;
  meetingDay?: string;
  meetingTime?: string;
  location?: string;
  ministryId?: string;
}

interface Announcement {
  id: string;
  title: string;
  content?: string;
  imageUrl?: string | null;
  createdAt: string;
}

interface MemberSearchResult {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export default function Ministries() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [selectedMinistry, setSelectedMinistry] = useState<Ministry | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMinistry, setEditingMinistry] = useState<Ministry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", color: "" });
  const [submitting, setSubmitting] = useState(false);

  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [members, setMembers] = useState<MemberSearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);

  const [addGroupDialogOpen, setAddGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", meetingDay: "", meetingTime: "", location: "" });

  const [announcementFormOpen, setAnnouncementFormOpen] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({ title: "", content: "" });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ministriesData, myMinistriesData, groupsData] = await Promise.allSettled([
        fetchApi<Ministry[]>("/ministries"),
        fetchApi<unknown>("/my-ministries"),
        fetchApi<Group[]>("/groups"),
      ]);
      
      if (ministriesData.status === "fulfilled") {
        setMinistries(Array.isArray(ministriesData.value) ? ministriesData.value : []);
      }
      if (myMinistriesData.status === "fulfilled") {
        // role is now available via useChurch() instead
      }
      if (groupsData.status === "fulfilled") {
        setAllGroups(Array.isArray(groupsData.value) ? groupsData.value : []);
      }
    } catch (e) {
      console.error("Failed to load ministries:", e);
    } finally {
      setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    fetchApi<{ id: string }>("/users/me")
      .then((user) => setCurrentUserId(user.id))
      .catch(() => setCurrentUserId(null));
  }, [fetchApi]);

  const loadMinistryDetail = async (ministryId: string) => {
    try {
      const data = await fetchApi<Ministry>(`/ministries/${ministryId}`);
      setSelectedMinistry(data);

      const annData = await fetchApi<Announcement[]>(`/announcements?ministryId=${ministryId}`);
      setAnnouncements(Array.isArray(annData) ? annData : []);
    } catch (e) {
      console.error("Failed to load ministry detail:", e);
    }
  };

  const selectMinistry = async (ministry: Ministry) => {
    setSelectedMinistry(ministry);
    await loadMinistryDetail(ministry.id);
  };

  const goBack = () => {
    setSelectedMinistry(null);
    setAnnouncements([]);
  };

  const filtered = ministries.filter((m) =>
    (m.name || "").toLowerCase().includes(search.toLowerCase())
  );

  const ministryGroups = allGroups.filter((g) => g.ministryId === selectedMinistry?.id);
  const canManageSelectedMinistry =
    isAdmin ||
    Boolean(
      selectedMinistry?.members?.some(
        (member) => member.userId === currentUserId && member.role?.toUpperCase() === "LEADER"
      )
    );

  const openNewDialog = () => {
    setEditingMinistry(null);
    setFormData({ name: "", description: "", color: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (ministry: Ministry) => {
    setEditingMinistry(ministry);
    setFormData({
      name: ministry.name || "",
      description: ministry.description || "",
      color: ministry.color || "",
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
      toast({ title: "Ministerio actualizado" });
      } else {
        await fetchApi("/ministries", {
          method: "POST",
          body: JSON.stringify(formData),
        });
      toast({ title: "Ministerio creado" });
      }
      setDialogOpen(false);
      loadData();
    } catch (e) {
      toast({ title: "No se pudo guardar el ministerio", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetchApi(`/ministries/${id}`, { method: "DELETE" });
      setMinistries((prev) => prev.filter((m) => m.id !== id));
      toast({ title: "Ministerio eliminado" });
    } catch (e) {
      toast({ title: "No se pudo eliminar el ministerio", variant: "destructive" });
    }
    setDeleteId(null);
  };

  const searchMembers = async (query: string) => {
    if (!query.trim()) {
      setMembers([]);
      return;
    }
    try {
      const data = await fetchApi<MemberSearchResult[]>(`/members?search=${encodeURIComponent(query)}`);
      const existingIds = (selectedMinistry?.members || []).map((m) => m.userId);
      const filtered = (Array.isArray(data) ? data : []).filter((m) => !existingIds.includes(m.id));
      setMembers(filtered);
    } catch (e) {
      console.error("Failed to search members:", e);
    }
  };

  const handleAddMember = async () => {
    if (!selectedMember || !selectedMinistry) return;
    try {
      await fetchApi(`/ministries/${selectedMinistry.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: selectedMember.id, role: "MEMBER" }),
      });
      toast({ title: "Member added" });
      setAddMemberDialogOpen(false);
      setMemberSearch("");
      setMembers([]);
      setSelectedMember(null);
      await loadMinistryDetail(selectedMinistry.id);
    } catch (e) {
      toast({ title: "No se pudo agregar el miembro", variant: "destructive" });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!selectedMinistry) return;
    try {
      await fetchApi(`/ministries/${selectedMinistry.id}/members/${memberId}`, { method: "DELETE" });
      toast({ title: "Member removed" });
      await loadMinistryDetail(selectedMinistry.id);
    } catch (e) {
      toast({ title: "No se pudo quitar el miembro", variant: "destructive" });
    }
  };

  const handleCreateGroup = async () => {
    if (!groupForm.name.trim() || !selectedMinistry) return;
    try {
      await fetchApi("/groups", {
        method: "POST",
        body: JSON.stringify({
          ...groupForm,
          ministryId: selectedMinistry.id,
        }),
      });
      toast({ title: "Grupo creado" });
      setAddGroupDialogOpen(false);
      setGroupForm({ name: "", description: "", meetingDay: "", meetingTime: "", location: "" });
      loadData();
      await loadMinistryDetail(selectedMinistry.id);
    } catch (e) {
      toast({ title: "No se pudo crear el grupo", variant: "destructive" });
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await fetchApi(`/groups/${groupId}`, { method: "DELETE" });
      toast({ title: "Grupo eliminado" });
      loadData();
      await loadMinistryDetail(selectedMinistry!.id);
    } catch (e) {
      toast({ title: "No se pudo eliminar el grupo", variant: "destructive" });
    }
  };

  const handleCreateAnnouncement = async () => {
    if (!announcementForm.title.trim() || !announcementForm.content.trim() || !selectedMinistry) return;
    try {
      await fetchApi("/announcements", {
        method: "POST",
        body: JSON.stringify({
          ...announcementForm,
          ministryId: selectedMinistry.id,
        }),
      });
      toast({ title: "Anuncio creado" });
      setAnnouncementFormOpen(false);
      setAnnouncementForm({ title: "", content: "" });
      const annData = await fetchApi<Announcement[]>(`/announcements?ministryId=${selectedMinistry.id}`);
      setAnnouncements(Array.isArray(annData) ? annData : []);
    } catch (e) {
      toast({ title: "No se pudo crear el anuncio", variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (selectedMinistry) {
    return (
      <div className="app-page space-y-5">
        <div className="app-page-header p-4 sm:p-5">
          <div className="app-page-header-grid">
            <div className="flex min-w-0 items-start gap-3">
              <Button variant="ghost" size="sm" className="mt-1 rounded-md" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Volver
              </Button>
              <div className="min-w-0 flex-1">
                <p className="app-page-kicker">Ministerio</p>
                <h1 className="app-page-title">{selectedMinistry.name}</h1>
                {selectedMinistry.description && (
                  <p className="app-page-copy">{selectedMinistry.description}</p>
                )}
              </div>
            </div>
            {isAdmin && (
              <Button variant="ghost" size="sm" className="rounded-md" onClick={() => openEditDialog(selectedMinistry)}>
                <Pencil className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="members" className="w-full">
          <TabsList className="mb-4 flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-md bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="members" className="shrink-0 gap-2 rounded-sm">
              <Users className="w-4 h-4" /> Miembros ({(selectedMinistry.members || []).length})
            </TabsTrigger>
            <TabsTrigger value="announcements" className="shrink-0 gap-2 rounded-sm">
              <Megaphone className="w-4 h-4" /> Anuncios
            </TabsTrigger>
            <TabsTrigger value="resources" className="shrink-0 gap-2 rounded-sm">
              <FolderOpen className="w-4 h-4" /> Recursos
            </TabsTrigger>
            <TabsTrigger value="groups" className="shrink-0 gap-2 rounded-sm">
              <Users className="w-4 h-4" /> Grupos ({(selectedMinistry.groups || []).length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            <div className="app-section-heading">
              <h2 className="app-section-title">Miembros</h2>
              {isAdmin && (
                <Button size="sm" className="rounded-md" onClick={() => setAddMemberDialogOpen(true)}>
                  <UserPlus className="w-4 h-4 mr-1" /> Agregar
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {(!selectedMinistry.members || selectedMinistry.members.length === 0) && (
                <div className="app-empty-state text-sm">Todavía no hay miembros.</div>
              )}
              {selectedMinistry.members?.map((member) => (
                <Card key={member.id} className="app-list-card">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="app-icon-tile h-9 w-9 text-xs font-semibold">
                        {member.user?.firstName?.[0] || ""}{member.user?.lastName?.[0] || ""}
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {member.user?.firstName} {member.user?.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{member.user?.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-xs capitalize text-secondary-foreground">
                        {member.role?.toLowerCase()}
                      </span>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => handleRemoveMember(member.userId)}>
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="announcements">
            <div className="app-section-heading">
              <h2 className="app-section-title">Anuncios</h2>
              {isAdmin && !announcementFormOpen && (
                <Button size="sm" className="rounded-md" onClick={() => setAnnouncementFormOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Nuevo
                </Button>
              )}
            </div>
            {announcementFormOpen && (
              <Card className="app-list-card mb-4">
                <CardContent className="p-4 space-y-3">
                  <Input
                    placeholder="Título del anuncio"
                    value={announcementForm.title}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                    className="app-control"
                  />
                  <Textarea
                    placeholder="Contenido del anuncio"
                    value={announcementForm.content}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
                    rows={3}
                    className="rounded-md"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="rounded-md" onClick={handleCreateAnnouncement}>Publicar</Button>
                    <Button variant="outline" size="sm" className="rounded-md" onClick={() => setAnnouncementFormOpen(false)}>Cancelar</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="space-y-3">
              {announcements.length === 0 && (
                <div className="app-empty-state text-sm">No hay anuncios.</div>
              )}
              {announcements.map((ann) => (
                <Card key={ann.id} className="app-list-card overflow-hidden">
                  {ann.imageUrl && (
                    <div className="h-32 w-full overflow-hidden">
                      <img src={ann.imageUrl!} alt={ann.title} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <CardContent className="p-4">
                    <h3 className="font-medium">{ann.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{ann.content}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(ann.createdAt).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="resources">
            <MinistryResources ministryId={selectedMinistry.id} canManage={canManageSelectedMinistry} />
          </TabsContent>

          <TabsContent value="groups">
            <div className="app-section-heading">
              <h2 className="app-section-title">Grupos</h2>
              {isAdmin && (
                <Button size="sm" className="rounded-md" onClick={() => setAddGroupDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Agregar grupo
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {ministryGroups.length === 0 && (
                <div className="app-empty-state col-span-2 text-sm">Todavía no hay grupos.</div>
              )}
              {ministryGroups.map((group) => (
                <Card key={group.id} className="app-list-card">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium">{group.name}</h3>
                        {group.description && (
                          <p className="text-sm text-muted-foreground mt-1">{group.description}</p>
                        )}
                      </div>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => handleDeleteGroup(group.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    {(group.meetingDay || group.meetingTime || group.location) && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {group.meetingDay && (
                          <span className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                            <Calendar className="w-3 h-3" /> {group.meetingDay}
                          </span>
                        )}
                        {group.meetingTime && (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{group.meetingTime}</span>
                        )}
                        {group.location && (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{group.location}</span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={addMemberDialogOpen} onOpenChange={setAddMemberDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Agregar miembro</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Buscar miembros..."
                value={memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value);
                  searchMembers(e.target.value);
                }}
                className="app-control"
              />
              <div className="max-h-40 overflow-y-auto space-y-1">
                {members.map((member) => (
                  <Button
                    key={member.id}
                    variant={selectedMember?.id === member.id ? "default" : "ghost"}
                    className="w-full justify-start rounded-md"
                    onClick={() => setSelectedMember(member)}
                  >
                    {member.firstName} {member.lastName} ({member.email})
                  </Button>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setAddMemberDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleAddMember} disabled={!selectedMember}>Agregar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={addGroupDialogOpen} onOpenChange={setAddGroupDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Agregar grupo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Nombre del grupo"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                className="app-control"
              />
              <Textarea
                placeholder="Descripción (opcional)"
                value={groupForm.description}
                onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                rows={2}
                className="rounded-md"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Día</label>
                  <select
                    className="app-control w-full px-2 py-1.5 text-sm"
                    value={groupForm.meetingDay}
                    onChange={(e) => setGroupForm({ ...groupForm, meetingDay: e.target.value })}
                  >
                    <option value="">Selecciona día</option>
                    {DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Hora</label>
                  <Input
                    placeholder="Ej. 7:00 PM"
                    value={groupForm.meetingTime}
                    onChange={(e) => setGroupForm({ ...groupForm, meetingTime: e.target.value })}
                    className="app-control"
                  />
                </div>
              </div>
              <Input
                placeholder="Lugar (opcional)"
                value={groupForm.location}
                onChange={(e) => setGroupForm({ ...groupForm, location: e.target.value })}
                className="app-control"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setAddGroupDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreateGroup} disabled={!groupForm.name.trim()}>Crear</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingMinistry ? "Editar ministerio" : "Nuevo ministerio"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Nombre del ministerio"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="app-control"
              />
              <Textarea
                placeholder="Descripción"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="rounded-md"
              />
              <div className="flex gap-2 items-center">
                <label className="text-sm">Color:</label>
                <input
                  type="color"
                  value={formData.color || "#5c3f9b"}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="h-8 w-8 rounded-md border-0"
                />
                <Input
                  placeholder="#hex"
                  value={formData.color || ""}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="app-control w-24"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Guardando..." : "Guardar"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="app-page space-y-5">
      <div className="app-page-header p-4 sm:p-5">
        <div className="app-page-header-grid">
          <div className="min-w-0">
            <p className="app-page-kicker">Ministerios</p>
            <h1 className="app-page-title">Ministerios</h1>
            <p className="app-page-copy">Organiza equipos, grupos, recursos y comunicación por área de servicio.</p>
          </div>
          {isAdmin && (
            <Button size="sm" className="h-10 rounded-md" onClick={openNewDialog}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo ministerio
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Buscar ministerios..." className="app-control pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="grid gap-3">
        {filtered.map((m) => (
          <Card key={m.id} className="app-list-card cursor-pointer" onClick={() => navigate(`/app/ministries/${m.id}`)}>
            <CardContent className="p-5 flex items-start gap-4">
              <div
                className="app-icon-tile"
                style={{ backgroundColor: m.color ? `${m.color}18` : "hsl(var(--secondary))" }}
              >
                {m.color ? (
                  <div className="w-5 h-5 rounded-sm" style={{ backgroundColor: m.color }} />
                ) : (
                  <Users className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold">{m.name}</h3>
                <p className="text-sm text-muted-foreground line-clamp-2">{m.description}</p>
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {isAdmin && (
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog(m)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
                {isAdmin && (
                  <AlertDialog open={deleteId === m.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(m.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Eliminar ministerio</AlertDialogTitle>
                        <AlertDialogDescription>
                          ¿Seguro que quieres eliminar "{m.name}"? Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(m.id)}>Eliminar</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="app-empty-state text-sm">No se encontraron ministerios.</div>
        )}
      </div>
    </div>
  );
}
