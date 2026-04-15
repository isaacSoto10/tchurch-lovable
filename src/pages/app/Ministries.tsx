import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Pencil, Trash2, ArrowLeft, Users, Megaphone, FolderOpen, UserPlus, X, Calendar } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
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
}

interface Announcement {
  id: string;
  title: string;
  content?: string;
  imageUrl?: string | null;
  createdAt: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function Ministries() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [selectedMinistry, setSelectedMinistry] = useState<Ministry | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMinistry, setEditingMinistry] = useState<Ministry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", color: "" });
  const [submitting, setSubmitting] = useState(false);

  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any>(null);

  const [addGroupDialogOpen, setAddGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", meetingDay: "", meetingTime: "", location: "" });

  const [announcementFormOpen, setAnnouncementFormOpen] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({ title: "", content: "" });

  useEffect(() => {
    loadData();
  }, [fetchApi]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ministriesData, myMinistriesData, groupsData] = await Promise.all([
        fetchApi("/ministries"),
        fetchApi("/my-ministries"),
        fetchApi("/groups"),
      ]);
      setMinistries(Array.isArray(ministriesData) ? ministriesData : []);
      setUserRole((myMinistriesData as any)?.role || null);
      setAllGroups(Array.isArray(groupsData) ? groupsData : []);
    } catch (e) {
      console.error("Failed to load ministries:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadMinistryDetail = async (ministryId: string) => {
    try {
      const data = await fetchApi(`/ministries/${ministryId}`);
      setSelectedMinistry(data as Ministry);

      const annData = await fetchApi(`/announcements?ministryId=${ministryId}`);
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

  const ministryGroups = allGroups.filter((g: any) => g.ministryId === selectedMinistry?.id);

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
      const data = await fetchApi(`/members?search=${encodeURIComponent(query)}`);
      const existingIds = (selectedMinistry?.members || []).map((m) => m.userId);
      const filtered = (Array.isArray(data) ? data : []).filter((m: any) => !existingIds.includes(m.id));
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
      const annData = await fetchApi(`/announcements?ministryId=${selectedMinistry.id}`);
      setAnnouncements(Array.isArray(annData) ? annData : []);
    } catch (e) {
      toast({ title: "Failed to create announcement", variant: "destructive" });
    }
  };

  const isAdmin = userRole === "ADMIN";

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
            <div className="text-center py-12">
              <FolderOpen className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Resources coming soon.</p>
            </div>
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Ministries</h1>
        <Button size="sm" onClick={openNewDialog}>
          <Plus className="w-4 h-4 mr-1" /> New Ministry
        </Button>
      </div>

      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search ministries..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="grid gap-3">
        {filtered.map((m) => (
          <Card key={m.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => selectMinistry(m)}>
            <CardContent className="p-5 flex items-start gap-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: m.color ? `${m.color}18` : "#f1f5f9" }}
              >
                {m.color ? (
                  <div className="w-5 h-5 rounded-full" style={{ backgroundColor: m.color }} />
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
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">No ministries found.</p>
        )}
      </div>
    </div>
  );
}