import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Plus, Check, X, UserMinus, Users, Clock, MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";
import { MinistryResources } from "@/components/MinistryResources";
import { useToast } from "@/components/ui/use-toast";

type Tab = "members" | "join-requests" | "announcements" | "resources";

type UserSummary = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
};

type MinistryMember = {
  id: string;
  userId: string;
  role: string;
  user?: UserSummary | null;
};

type Ministry = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  whatsappGroupUrl?: string | null;
  members?: MinistryMember[];
};

type MyMinistriesResponse = {
  role?: string | null;
  myMinistryIds?: string[];
  pendingMinistryIds?: string[];
  ministryRoles?: Record<string, string>;
};

type JoinRequest = {
  id: string;
  user?: UserSummary | null;
};

type JoinRequestsResponse = {
  requests?: JoinRequest[];
};

type Announcement = {
  id: string;
  title: string;
  content?: string | null;
  imageUrl?: string | null;
  createdAt: string;
};

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

export default function MinistryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();

  const [ministry, setMinistry] = useState<Ministry | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get("tab") as Tab) || "members");
  const [canManage, setCanManage] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);

  // Join requests
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  // Announcements
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  // Dialogs
  const [showAddMember, setShowAddMember] = useState(false);
  const [showEditMinistry, setShowEditMinistry] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", description: "", color: "", whatsappGroupUrl: "" });

  // Fetch ministry
  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const data = await apiFetch<Ministry>(`/ministries/${id}`);
        setMinistry(data);
        setEditForm({
          name: data.name || "",
          description: data.description || "",
          color: data.color || "",
          whatsappGroupUrl: data.whatsappGroupUrl || "",
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // Fetch my ministries status
  useEffect(() => {
    async function loadMyMinistries() {
      try {
        const data = await apiFetch<MyMinistriesResponse>("/my-ministries");
        const isAdmin = data.role === "ADMIN" || selectedChurch?.role === "ADMIN";
        const myIds: string[] = data.myMinistryIds || [];
        const pendingIds: string[] = data.pendingMinistryIds || [];
        const ministryRoles: Record<string, string> = data.ministryRoles || {};
        const isLeader = ministryRoles[id || ""] === "LEADER";
        setCanManage(isAdmin || isLeader);
        setIsMember(myIds.includes(id || "") || isAdmin);
        setIsPending(pendingIds.includes(id || ""));
        setMyRole(isAdmin ? "ADMIN" : (isLeader ? "LEADER" : (myIds.includes(id || "") ? "MEMBER" : null)));
      } catch (e) {
        console.error(e);
      }
    }
    loadMyMinistries();
  }, [id, selectedChurch?.role]);

  // Fetch join requests when tab is active
  useEffect(() => {
    if (activeTab === "join-requests" && canManage && id) {
      setRequestsLoading(true);
      apiFetch<JoinRequestsResponse>(`/ministries/${id}/join-requests`)
        .then((data) => setJoinRequests(data.requests || []))
        .catch(() => setJoinRequests([]))
        .finally(() => setRequestsLoading(false));
    }
  }, [activeTab, canManage, id]);

  // Fetch announcements when tab is active
  useEffect(() => {
    if (activeTab === "announcements" && id) {
      apiFetch<Announcement[]>(`/announcements?ministryId=${id}`)
        .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
        .catch(() => setAnnouncements([]));
    }
  }, [activeTab, id]);

  async function handleJoinRequest() {
    if (!id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/ministries/${id}/join-request`, { method: "POST" });
      setIsPending(true);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(requestId: string) {
    if (!id) return;
    try {
      await apiFetch(`/ministries/${id}/join-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve" }),
      });
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      console.error(e);
      toast({ title: e instanceof Error ? e.message : "No se pudo aprobar la solicitud", variant: "destructive" });
    }
  }

  async function handleDeny(requestId: string) {
    if (!id) return;
    try {
      await apiFetch(`/ministries/${id}/join-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "deny" }),
      });
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      console.error(e);
      toast({ title: e instanceof Error ? e.message : "No se pudo rechazar la solicitud", variant: "destructive" });
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmail.trim() || !id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/ministries/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: addEmail.trim(), role: addRole }),
      });
      setShowAddMember(false);
      setAddEmail("");
      setAddRole("MEMBER");
      // Refresh ministry
      const data = await apiFetch<Ministry>(`/ministries/${id}`);
      setMinistry(data);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!id) return;
    try {
      await apiFetch(`/ministries/${id}/members/${userId}`, { method: "DELETE" });
      setMinistry((prev) => prev ? ({
        ...prev,
        members: (prev.members || []).filter((m) => m.userId !== userId),
      }) : prev);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUpdateMinistry(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/ministries/${id}`, {
        method: "PUT",
        body: JSON.stringify(editForm),
      });
      setShowEditMinistry(false);
      const data = await apiFetch<Ministry>(`/ministries/${id}`);
      setMinistry(data);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ministry) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Ministerio no encontrado</p>
        <Button variant="ghost" onClick={() => navigate("/app/ministries")} className="mt-2">
          Volver a ministerios
        </Button>
      </div>
    );
  }

  const colorBg = ministry.color ? `${ministry.color}15` : "#f6f5f4";
  const colorDot = ministry.color || "#a39e98";

  return (
    <div className="app-page space-y-4">
      {/* Header */}
      <div className="app-page-header overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate("/app/ministries")} className="-ml-1 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card shadow-sm hover:bg-secondary">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-10 rounded-md flex items-center justify-center shrink-0 border border-border" style={{ backgroundColor: colorBg }}>
              <div className="w-2 h-6 rounded-sm" style={{ backgroundColor: colorDot }} />
            </div>
            <div className="min-w-0">
              <p className="app-page-kicker">Ministerio</p>
              <h1 className="truncate text-xl font-semibold text-foreground">{ministry.name}</h1>
              {ministry.description && (
                <p className="text-xs text-muted-foreground truncate">{ministry.description}</p>
              )}
            </div>
          </div>
          {canManage && (
            <Button variant="ghost" size="sm" className="rounded-md" onClick={() => setShowEditMinistry(true)}>
              Editar
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="px-4 pb-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)} className="w-full">
            <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-md bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsTrigger value="members" className="shrink-0 rounded-sm text-xs">Miembros</TabsTrigger>
              {canManage && (
                <TabsTrigger value="join-requests" className="relative shrink-0 rounded-sm text-xs">
                  Solicitudes
                  {joinRequests.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                      {joinRequests.length}
                    </span>
                  )}
                </TabsTrigger>
              )}
              <TabsTrigger value="announcements" className="shrink-0 rounded-sm text-xs">Anuncios</TabsTrigger>
              <TabsTrigger value="resources" className="shrink-0 rounded-sm text-xs">Recursos</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="space-y-4">

        {/* MEMBERS TAB */}
        {activeTab === "members" && (
          <div className="space-y-3">
            {canManage && (
              <div className="flex justify-end gap-2">
                {ministry.whatsappGroupUrl && (
                  <Button size="sm" variant="outline" className="rounded-md" asChild>
                    <a href={ministry.whatsappGroupUrl} target="_blank" rel="noreferrer">
                      <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                    </a>
                  </Button>
                )}
                <Button size="sm" className="rounded-md" onClick={() => setShowAddMember(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Agregar
                </Button>
              </div>
            )}
            {!canManage && ministry.whatsappGroupUrl && (
              <Card className="app-list-card border-emerald-100 bg-emerald-50/60">
                <CardContent className="p-4">
                  <Button asChild className="w-full rounded-md bg-emerald-600 hover:bg-emerald-700">
                    <a href={ministry.whatsappGroupUrl} target="_blank" rel="noreferrer">
                      <MessageCircle className="w-4 h-4 mr-2" /> Abrir grupo de WhatsApp
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {!isMember && !isPending && (
              <Card className="app-list-card border-primary/30 bg-primary/5">
                <CardContent className="p-4 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">Todavía no eres miembro de este ministerio.</p>
                  <Button size="sm" className="rounded-md" onClick={handleJoinRequest} disabled={submitting}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Solicitar acceso"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {isPending && (
              <Card className="app-list-card border-amber-200 bg-amber-50">
                <CardContent className="p-4 flex items-center gap-3">
                  <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="font-medium text-amber-800 text-sm">Solicitud pendiente</p>
                    <p className="text-xs text-amber-600">Esperando aprobación de un líder.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {isMember && (
              <Card className="app-list-card">
                <CardContent className="p-3">
                  <Badge variant="secondary" className="rounded-md text-xs">
                    {myRole === "LEADER" ? "Líder" : "Miembro"}
                  </Badge>
                </CardContent>
              </Card>
            )}

            {(ministry.members || []).length === 0 ? (
              <Card className="app-empty-state">
                <CardContent className="p-8 text-center">
                  <Users className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Todavía no hay miembros.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {(ministry.members || []).map((member) => (
                  <Card key={member.id} className="app-list-card">
                    <CardContent className="p-3 flex items-center gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                          {getInitials(member.user?.firstName, member.user?.lastName, member.user?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {member.user?.firstName} {member.user?.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{member.user?.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={member.role === "ADMIN" || member.role === "LEADER" ? "default" : "secondary"}
                          className="rounded-md text-xs"
                        >
                          {member.role}
                        </Badge>
                        {canManage && member.role !== "ADMIN" && (
                          <button
                            onClick={() => handleRemoveMember(member.userId)}
                            className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                          >
                            <UserMinus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* JOIN REQUESTS TAB */}
        {activeTab === "join-requests" && canManage && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Aprueba o rechaza solicitudes para unirse a este ministerio.</p>

            {requestsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : joinRequests.length === 0 ? (
              <Card className="app-empty-state">
                <CardContent className="p-8 text-center">
                  <Check className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No hay solicitudes pendientes.</p>
                </CardContent>
              </Card>
            ) : (
              joinRequests.map((req) => (
                <Card key={req.id} className="app-list-card">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                          {getInitials(req.user?.firstName, req.user?.lastName, req.user?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {req.user?.firstName} {req.user?.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{req.user?.email}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 rounded-md bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleApprove(req.id)}
                      >
                        <Check className="w-4 h-4 mr-1" /> Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-md text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDeny(req.id)}
                      >
                        <X className="w-4 h-4 mr-1" /> Rechazar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {/* ANNOUNCEMENTS TAB */}
        {activeTab === "announcements" && (
          <div className="space-y-3">
            {announcements.length === 0 ? (
              <Card className="app-empty-state">
                <CardContent className="p-8 text-center">
                  <p className="text-sm text-muted-foreground">Todavía no hay anuncios.</p>
                </CardContent>
              </Card>
            ) : (
              announcements.map((ann) => (
                <Card key={ann.id} className="app-list-card">
                  <CardContent className="p-4">
                    {ann.imageUrl && (
                      <img src={ann.imageUrl} alt={ann.title} className="w-full h-40 object-cover rounded-md mb-3" />
                    )}
                    <h3 className="font-semibold text-foreground">{ann.title}</h3>
                    {ann.content && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{ann.content}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(ann.createdAt).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {/* RESOURCES TAB */}
        {activeTab === "resources" && (
          <MinistryResources ministryId={id!} canManage={canManage} />
        )}
      </div>

      {/* ADD MEMBER DIALOG */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar miembro</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="member@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Miembro</SelectItem>
                  <SelectItem value="LEADER">Líder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Agregar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT MINISTRY DIALOG */}
      <Dialog open={showEditMinistry} onOpenChange={setShowEditMinistry}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar ministerio</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateMinistry} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                <Input
                  value={editForm.color}
                  onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                  placeholder="#3b82f6"
                  className="font-mono"
                />
                {editForm.color && (
                  <div
                    className="w-10 h-10 rounded-md border border-border shrink-0"
                    style={{ backgroundColor: editForm.color }}
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Link del grupo de WhatsApp</Label>
              <Input
                value={editForm.whatsappGroupUrl}
                onChange={(e) => setEditForm({ ...editForm, whatsappGroupUrl: e.target.value })}
                placeholder="https://chat.whatsapp.com/..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditMinistry(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
