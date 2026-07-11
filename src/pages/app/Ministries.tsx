import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, ArrowLeft, Users, Megaphone, FolderOpen, UserPlus, X, Calendar, Clock, ShieldCheck, MessageCircle, ChevronRight } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";
import { MinistryResources } from "@/components/MinistryResources";
import { getChurchId } from "@/lib/api";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import { openChatDock } from "@/lib/chatDock";
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
  memberCount?: number;
  leaderCount?: number;
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

type MyMinistriesResponse = {
  role?: string | null;
  myMinistryIds?: string[];
  pendingMinistryIds?: string[];
  ministryRoles?: Record<string, string>;
};

type MinistriesSnapshot = {
  ministries: Ministry[];
  groups: Group[];
  myMinistryIds: string[];
  pendingMinistryIds: string[];
  ministryRoles: Record<string, string>;
};

const MINISTRIES_SNAPSHOT_PREFIX = "tchurch_ios_ministries_snapshot_v1";

function isMinistriesSnapshot(data: unknown): data is MinistriesSnapshot {
  if (!data || typeof data !== "object") return false;
  const snapshot = data as Partial<MinistriesSnapshot>;
  return (
    Array.isArray(snapshot.ministries) &&
    Array.isArray(snapshot.groups) &&
    Array.isArray(snapshot.myMinistryIds) &&
    Array.isArray(snapshot.pendingMinistryIds) &&
    Boolean(snapshot.ministryRoles)
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function normalizeRole(role?: string | null) {
  return String(role || "").toUpperCase();
}

function formatRole(role?: string | null) {
  const normalized = normalizeRole(role);
  if (normalized === "ADMIN") return "Admin";
  if (normalized === "LEADER") return "Leader";
  if (normalized === "CO_LEADER") return "Co-leader";
  return "Member";
}

export default function Ministries() {
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const isAdmin = selectedChurch?.role === "ADMIN";
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [myMinistryIds, setMyMinistryIds] = useState<string[]>([]);
  const [pendingMinistryIds, setPendingMinistryIds] = useState<string[]>([]);
  const [ministryRoles, setMinistryRoles] = useState<Record<string, string>>({});
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
  const loadedOnceRef = useRef(false);

  const snapshotKey = sessionSnapshotKey(MINISTRIES_SNAPSHOT_PREFIX, selectedChurch?.id || getChurchId());

  const applyMinistriesSnapshot = useCallback((snapshot: MinistriesSnapshot) => {
    setMinistries(snapshot.ministries);
    setAllGroups(snapshot.groups);
    setMyMinistryIds(snapshot.myMinistryIds);
    setPendingMinistryIds(snapshot.pendingMinistryIds);
    setMinistryRoles(snapshot.ministryRoles);
    loadedOnceRef.current = true;
  }, []);

  const loadData = useCallback(async () => {
    const snapshot = readSessionSnapshot<MinistriesSnapshot>(snapshotKey, { validate: isMinistriesSnapshot });
    if (snapshot) {
      applyMinistriesSnapshot(snapshot.data);
      setLoading(false);
    } else if (!loadedOnceRef.current) {
      setLoading(true);
    }

    try {
      const [ministriesData, myMinistriesData] = await Promise.allSettled([
        fetchApi<Ministry[]>("/ministries"),
        fetchApi<MyMinistriesResponse>("/my-ministries"),
      ]);
      
      const myMinistries: MyMinistriesResponse = myMinistriesData.status === "fulfilled" ? myMinistriesData.value || {} : {};
      const nextSnapshot = {
        ministries: ministriesData.status === "fulfilled"
          ? Array.isArray(ministriesData.value) ? ministriesData.value : []
          : snapshot?.data.ministries || [],
        groups: snapshot?.data.groups || [],
        myMinistryIds: Array.isArray(myMinistries.myMinistryIds)
          ? myMinistries.myMinistryIds
          : snapshot?.data.myMinistryIds || [],
        pendingMinistryIds: Array.isArray(myMinistries.pendingMinistryIds)
          ? myMinistries.pendingMinistryIds
          : snapshot?.data.pendingMinistryIds || [],
        ministryRoles: myMinistries.ministryRoles || snapshot?.data.ministryRoles || {},
      };
      applyMinistriesSnapshot(nextSnapshot);
      writeSessionSnapshot(snapshotKey, nextSnapshot);
    } catch (e) {
      console.error("Failed to load ministries:", e);
    } finally {
      setLoading(false);
    }
  }, [applyMinistriesSnapshot, fetchApi, snapshotKey]);

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
      const [data, annData, groupsData] = await Promise.all([
        fetchApi<Ministry>(`/ministries/${ministryId}`),
        fetchApi<Announcement[]>(`/announcements?ministryId=${encodeURIComponent(ministryId)}&limit=20`),
        fetchApi<Group[]>("/groups").catch(() => []),
      ]);
      setSelectedMinistry(data);
      setAnnouncements(Array.isArray(annData) ? annData : []);
      if (Array.isArray(groupsData)) setAllGroups(groupsData);
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

  const query = search.trim().toLowerCase();
  const filtered = ministries.filter((m) => {
    if (!query) return true;
    return [m.name, m.description].some((value) => (value || "").toLowerCase().includes(query));
  });
  const myMinistries = filtered.filter((m) => myMinistryIds.includes(m.id));
  const exploreMinistries = filtered.filter((m) => !myMinistryIds.includes(m.id));
  const totalMembers = ministries.reduce((sum, ministry) => sum + (ministry.memberCount ?? ministry.members?.length ?? 0), 0);
  const totalLeaders = ministries.reduce((sum, ministry) => sum + (ministry.leaderCount ?? 0), 0);

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
        toast({ title: "Ministry updated" });
      } else {
        await fetchApi("/ministries", {
          method: "POST",
          body: JSON.stringify(formData),
        });
        toast({ title: "Ministry created" });
      }
      setDialogOpen(false);
      loadData();
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
      toast({ title: "Ministry deleted" });
    } catch (e) {
      toast({ title: "Failed to delete ministry", variant: "destructive" });
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
      toast({ title: "Failed to add member", variant: "destructive" });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!selectedMinistry) return;
    try {
      await fetchApi(`/ministries/${selectedMinistry.id}/members/${memberId}`, { method: "DELETE" });
      toast({ title: "Member removed" });
      await loadMinistryDetail(selectedMinistry.id);
    } catch (e) {
      toast({ title: "Failed to remove member", variant: "destructive" });
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
      toast({ title: "Group created" });
      setAddGroupDialogOpen(false);
      setGroupForm({ name: "", description: "", meetingDay: "", meetingTime: "", location: "" });
      loadData();
      await loadMinistryDetail(selectedMinistry.id);
    } catch (e) {
      toast({ title: "Failed to create group", variant: "destructive" });
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await fetchApi(`/groups/${groupId}`, { method: "DELETE" });
      toast({ title: "Group deleted" });
      loadData();
      await loadMinistryDetail(selectedMinistry!.id);
    } catch (e) {
      toast({ title: "Failed to delete group", variant: "destructive" });
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
      toast({ title: "Announcement created" });
      setAnnouncementFormOpen(false);
      setAnnouncementForm({ title: "", content: "" });
      const annData = await fetchApi<Announcement[]>(`/announcements?ministryId=${selectedMinistry.id}`);
      setAnnouncements(Array.isArray(annData) ? annData : []);
    } catch (e) {
      toast({ title: "Failed to create announcement", variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (selectedMinistry) {
    return (
      <div>
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{selectedMinistry.name}</h1>
            {selectedMinistry.description && (
              <p className="text-sm text-muted-foreground">{selectedMinistry.description}</p>
            )}
          </div>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => openEditDialog(selectedMinistry)}>
              <Pencil className="w-4 h-4" />
            </Button>
          )}
        </div>

        <Tabs defaultValue="members" className="w-full">
          <TabsList className="w-full justify-start mb-4">
            <TabsTrigger value="members" className="gap-2">
              <Users className="w-4 h-4" /> Members ({(selectedMinistry.members || []).length})
            </TabsTrigger>
            <TabsTrigger value="announcements" className="gap-2">
              <Megaphone className="w-4 h-4" /> Announcements
            </TabsTrigger>
            <TabsTrigger value="resources" className="gap-2">
              <FolderOpen className="w-4 h-4" /> Resources
            </TabsTrigger>
            <TabsTrigger value="groups" className="gap-2">
              <Users className="w-4 h-4" /> Groups ({(selectedMinistry.groups || []).length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Members</h2>
              {isAdmin && (
                <Button size="sm" onClick={() => setAddMemberDialogOpen(true)}>
                  <UserPlus className="w-4 h-4 mr-1" /> Add Member
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {(!selectedMinistry.members || selectedMinistry.members.length === 0) && (
                <p className="text-sm text-muted-foreground py-4 text-center">No members yet.</p>
              )}
              {selectedMinistry.members?.map((member) => (
                <Card key={member.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
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
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded capitalize">
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Announcements</h2>
              {isAdmin && !announcementFormOpen && (
                <Button size="sm" onClick={() => setAnnouncementFormOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> New
                </Button>
              )}
            </div>
            {announcementFormOpen && (
              <Card className="mb-4">
                <CardContent className="p-4 space-y-3">
                  <Input
                    placeholder="Announcement title"
                    value={announcementForm.title}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                  />
                  <Textarea
                    placeholder="Announcement content"
                    value={announcementForm.content}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleCreateAnnouncement}>Publish</Button>
                    <Button variant="outline" size="sm" onClick={() => setAnnouncementFormOpen(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="space-y-3">
              {announcements.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No announcements.</p>
              )}
              {announcements.map((ann) => (
                <Card key={ann.id}>
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Groups</h2>
              {isAdmin && (
                <Button size="sm" onClick={() => setAddGroupDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Group
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {ministryGroups.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-2 py-4 text-center">No groups yet.</p>
              )}
              {ministryGroups.map((group) => (
                <Card key={group.id}>
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
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {group.meetingDay}
                          </span>
                        )}
                        {group.meetingTime && (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded">{group.meetingTime}</span>
                        )}
                        {group.location && (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded">{group.location}</span>
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
              <DialogTitle>Add Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Search members..."
                value={memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value);
                  searchMembers(e.target.value);
                }}
              />
              <div className="max-h-40 overflow-y-auto space-y-1">
                {members.map((member) => (
                  <Button
                    key={member.id}
                    variant={selectedMember?.id === member.id ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => setSelectedMember(member)}
                  >
                    {member.firstName} {member.lastName} ({member.email})
                  </Button>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setAddMemberDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAddMember} disabled={!selectedMember}>Add</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={addGroupDialogOpen} onOpenChange={setAddGroupDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Group</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Group name"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              />
              <Textarea
                placeholder="Description (optional)"
                value={groupForm.description}
                onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                rows={2}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Meeting Day</label>
                  <select
                    className="w-full border rounded px-2 py-1.5 text-sm"
                    value={groupForm.meetingDay}
                    onChange={(e) => setGroupForm({ ...groupForm, meetingDay: e.target.value })}
                  >
                    <option value="">Select day</option>
                    {DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Meeting Time</label>
                  <Input
                    placeholder="e.g. 7:00 PM"
                    value={groupForm.meetingTime}
                    onChange={(e) => setGroupForm({ ...groupForm, meetingTime: e.target.value })}
                  />
                </div>
              </div>
              <Input
                placeholder="Location (optional)"
                value={groupForm.location}
                onChange={(e) => setGroupForm({ ...groupForm, location: e.target.value })}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setAddGroupDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateGroup} disabled={!groupForm.name.trim()}>Create</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingMinistry ? "Edit Ministry" : "New Ministry"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Ministry name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <Textarea
                placeholder="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
              <div className="flex gap-2 items-center">
                <label className="text-sm">Color:</label>
                <input
                  type="color"
                  value={formData.color || "#6366f1"}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-8 h-8 rounded border-0"
                />
                <Input
                  placeholder="#hex"
                  value={formData.color || ""}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-24"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  function renderMinistryCard(m: Ministry) {
    const memberCount = m.memberCount ?? m.members?.length ?? 0;
    const leaderCount = m.leaderCount ?? 0;
    const isMine = myMinistryIds.includes(m.id);
    const isPending = pendingMinistryIds.includes(m.id);
    const role = formatRole(ministryRoles[m.id]);

    return (
      <Card
        key={m.id}
        role="link"
        tabIndex={0}
        aria-label={`Abrir ministerio ${m.name}`}
        className="group relative cursor-pointer overflow-hidden border-zinc-200 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition hover:border-primary/30 hover:shadow-[0_10px_28px_rgba(24,24,27,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        onClick={() => navigate(`/app/ministries/${m.id}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(`/app/ministries/${m.id}`);
          }
        }}
        onFocus={() => preloadAppRoute(`/app/ministries/${m.id}`)}
        onPointerEnter={() => preloadAppRoute(`/app/ministries/${m.id}`)}
      >
        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: m.color || "hsl(var(--primary))" }} aria-hidden="true" />
        <CardContent className="flex items-start gap-3 p-4 pl-5 sm:gap-4 sm:p-5 sm:pl-6">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: m.color ? `${m.color}18` : "#f1f5f9" }}
          >
            {m.color ? (
              <div className="h-5 w-5 rounded-full" style={{ backgroundColor: m.color }} />
            ) : (
              <Users className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold leading-tight text-zinc-950">{m.name}</h3>
              {isMine && <Badge variant="secondary">{role}</Badge>}
              {isPending && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Pending</Badge>}
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
              {m.description || "Open this ministry to see members, announcements, resources, and how to join."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1">
                <Users className="h-3.5 w-3.5" />
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                {leaderCount} {leaderCount === 1 ? "leader" : "leaders"}
              </span>
              {isPending && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                  <Clock className="h-3.5 w-3.5" />
                  Waiting approval
                </span>
              )}
            </div>
            {isMine && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openChatDock({ ministryId: m.id });
                }}
                className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 text-xs font-semibold text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <MessageCircle className="h-4 w-4" /> Abrir chat del equipo
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {isAdmin && (
              <Button variant="ghost" size="sm" aria-label={`Edit ${m.name}`} onClick={() => openEditDialog(m)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {!isAdmin && <ChevronRight className="h-5 w-5 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />}
            {isAdmin && (
              <AlertDialog open={deleteId === m.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${m.name}`} onClick={() => setDeleteId(m.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Ministry</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{m.name}"? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(m.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mobile-page">
      <div className="mb-6 space-y-4">
        <div className="rounded-2xl border border-primary/15 bg-primary/[0.045] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Comunidad</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950">Ministerios</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Encuentra tu equipo, coordina el servicio y mantén la conversación cerca.
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={openNewDialog} className="shrink-0">
              <Plus className="h-4 w-4" /> Nuevo
            </Button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-white/80 bg-white px-2 py-3 shadow-sm">
            <p className="text-lg font-semibold text-zinc-950">{ministries.length}</p>
            <p className="text-[0.7rem] font-medium text-muted-foreground">Ministerios</p>
          </div>
          <div className="rounded-xl border border-white/80 bg-white px-2 py-3 shadow-sm">
            <p className="text-lg font-semibold text-zinc-950">{totalMembers}</p>
            <p className="text-[0.7rem] font-medium text-muted-foreground">Personas</p>
          </div>
          <div className="rounded-xl border border-white/80 bg-white px-2 py-3 shadow-sm">
            <p className="text-lg font-semibold text-zinc-950">{myMinistries.length}</p>
            <p className="text-[0.7rem] font-medium text-muted-foreground">Mis equipos</p>
          </div>
        </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar ministerios…"
            className="h-11 pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-6">
        {myMinistries.length > 0 && (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">My ministries</h2>
              <p className="text-xs text-muted-foreground">Teams where you are a member or leader.</p>
            </div>
            <div className="grid gap-3">
              {myMinistries.map(renderMinistryCard)}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Explore ministries</h2>
            <p className="text-xs text-muted-foreground">Open a ministry to learn more or send a join request.</p>
          </div>
          <div className="grid gap-3">
            {exploreMinistries.map(renderMinistryCard)}
            {filtered.length === 0 && (
              <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-6 text-center text-sm text-muted-foreground">
                No ministries found.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
