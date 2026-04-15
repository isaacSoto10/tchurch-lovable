import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, Music, FileText, Bell, X, Check, Clock, Users } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface Service {
  id: string;
  title: string;
  date: string;
  type: string;
  status: string;
  notes?: string;
}

interface ServiceItem {
  id: string;
  serviceId: string;
  songId?: string;
  title: string;
  type: "song" | "header" | "item" | "announcement";
  position: number;
  duration?: number;
  details?: Record<string, unknown>;
  song?: {
    id: string;
    title: string;
    author?: string;
    key?: string;
  };
}

interface ServiceAssignment {
  id: string;
  serviceId: string;
  userId: string;
  position: string;
  confirmed: boolean;
  user?: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

interface Member {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
}

const SERVICE_TYPES = [
  { label: "Sunday Service", value: "Sunday Service" },
  { label: "Wednesday Bible Study", value: "Wednesday Bible Study" },
  { label: "Special Event", value: "Special Event" },
  { label: "Rehearsal", value: "Rehearsal" },
];

const SERVICE_STATUSES = [
  { label: "Draft", value: "draft" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Completed", value: "completed" },
];

const ITEM_TYPES = [
  { label: "Song", value: "song", icon: Music },
  { label: "Header", value: "header", icon: FileText },
  { label: "Item", value: "item", icon: FileText },
  { label: "Announcement", value: "announcement", icon: Bell },
];

const POSITIONS = [
  "Vocals",
  "Lead Vocal",
  "Backing Vocal",
  "Acoustic Guitar",
  "Electric Guitar",
  "Bass",
  "Keys",
  "Drums",
  "Percussion",
  "Strings",
  "Sound Tech",
  "Visuals Tech",
  "Camera",
  "Director",
  "Other",
];

const TEMPLATE_ITEMS = [
  { title: "Welcome", type: "header" },
  { title: "Call to Worship", type: "header" },
  { title: "Praise & Worship", type: "header" },
  { title: "Offering", type: "header" },
  { title: "Prayer", type: "header" },
  { title: "Sermon Title", type: "header" },
  { title: "Altar Call", type: "header" },
  { title: "Benediction", type: "header" },
  { title: "Communion", type: "header" },
  { title: "Scripture Reading", type: "item" },
  { title: "Testimony", type: "item" },
  { title: "Special Music", type: "item" },
  { title: "Children's Moment", type: "item" },
  { title: "Congregational Reading", type: "item" },
  { title: "Fellowship", type: "item" },
  { title: "General Announcement", type: "announcement" },
  { title: "Upcoming Events", type: "announcement" },
  { title: "Birthday Celebrations", type: "announcement" },
];

export default function Services() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    date: "",
    type: "Sunday Service",
    status: "draft",
    notes: "",
  });

  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [serviceItems, setServiceItems] = useState<Record<string, ServiceItem[]>>({});
  const [serviceAssignments, setServiceAssignments] = useState<Record<string, ServiceAssignment[]>>({});
  const [itemsLoading, setItemsLoading] = useState<Record<string, boolean>>({});

  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [newItemType, setNewItemType] = useState<"song" | "template">("template");
  const [songSearch, setSongSearch] = useState("");
  const [songs, setSongs] = useState<Array<{ id: string; title: string; author?: string; key?: string }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof TEMPLATE_ITEMS[0] | null>(null);
  const [selectedSong, setSelectedSong] = useState<typeof songs[0] | null>(null);
  const [itemType, setItemType] = useState<ServiceItem["type"]>("song");
  const [itemTitle, setItemTitle] = useState("");

  const [memberSearch, setMemberSearch] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedPosition, setSelectedPosition] = useState("Vocals");

  useEffect(() => {
    loadServices();
  }, [fetchApi]);

  const loadServices = () => {
    setLoading(true);
    fetchApi("/services")
      .then((data) => setServices(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load services:", e))
      .finally(() => setLoading(false));
  };

  const loadServiceDetails = useCallback(async (serviceId: string) => {
    if (serviceItems[serviceId] || itemsLoading[serviceId]) return;

    setItemsLoading((prev) => ({ ...prev, [serviceId]: true }));
    try {
      const serviceRes = await fetchApi(`/services/${serviceId}`);
      if (serviceRes && typeof serviceRes === 'object') {
        const items = (serviceRes as Record<string, unknown>).items || [];
        const assignments = (serviceRes as Record<string, unknown>).assignments || [];
        setServiceItems((prev) => ({ ...prev, [serviceId]: Array.isArray(items) ? items as ServiceItem[] : [] }));
        setServiceAssignments((prev) => ({ ...prev, [serviceId]: Array.isArray(assignments) ? assignments as ServiceAssignment[] : [] }));
      }
    } catch (e) {
      console.error("Failed to load service details:", e);
    } finally {
      setItemsLoading((prev) => ({ ...prev, [serviceId]: false }));
    }
  }, [fetchApi, serviceItems, itemsLoading]);

  const toggleExpand = async (serviceId: string) => {
    if (expandedService === serviceId) {
      setExpandedService(null);
    } else {
      setExpandedService(serviceId);
      await loadServiceDetails(serviceId);
    }
  };

  const filteredServices = services.filter((s) => {
    const matchesSearch = s.title.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === "all" || s.type === filterType;
    const matchesStatus = filterStatus === "all" || s.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const openNewDialog = () => {
    setEditingService(null);
    setFormData({ title: "", date: "", type: "Sunday Service", status: "draft", notes: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (service: Service) => {
    setEditingService(service);
    setFormData({
      title: service.title,
      date: service.date ? service.date.slice(0, 16) : "",
      type: service.type,
      status: service.status,
      notes: service.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim() || !formData.date) return;

    setSubmitting(true);
    try {
      const payload = {
        title: formData.title,
        date: new Date(formData.date).toISOString(),
        type: formData.type,
        status: formData.status,
        notes: formData.notes || null,
      };

      if (editingService) {
        await fetchApi(`/services/${editingService.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "Service updated successfully" });
      } else {
        await fetchApi("/services", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Service created successfully" });
      }
      setDialogOpen(false);
      loadServices();
    } catch (e) {
      toast({ title: "Failed to save service", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusToggle = async (service: Service) => {
    const statusOrder = ["draft", "confirmed", "completed"];
    const currentIndex = statusOrder.indexOf(service.status);
    if (currentIndex === -1 || currentIndex >= statusOrder.length - 1) return;

    const newStatus = statusOrder[currentIndex + 1];
    try {
      await fetchApi(`/services/${service.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...service, status: newStatus }),
      });
      toast({ title: `Status updated to ${newStatus}` });
      loadServices();
    } catch (e) {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await fetchApi(`/services/${deleteId}`, { method: "DELETE" });
      toast({ title: "Service deleted successfully" });
      setDeleteId(null);
      loadServices();
    } catch (e) {
      toast({ title: "Failed to delete service", variant: "destructive" });
    }
  };

  const openAddItemDialog = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setNewItemType("template");
    setSongSearch("");
    setSongs([]);
    setSelectedTemplate(null);
    setSelectedSong(null);
    setItemType("song");
    setItemTitle("");
    setAddItemDialogOpen(true);
  };

  const searchSongs = async (query: string) => {
    if (!query.trim()) {
      setSongs([]);
      return;
    }
    try {
      const data = await fetchApi(`/songs?q=${encodeURIComponent(query)}`);
      setSongs(Array.isArray(data) ? data.slice(0, 10) : []);
    } catch (e) {
      console.error("Failed to search songs:", e);
    }
  };

  const handleAddItem = async () => {
    if (!selectedServiceId) return;

    let title = itemTitle;
    let songId: string | undefined;
    let type = itemType;

    if (newItemType === "song" && selectedSong) {
      title = selectedSong.title;
      songId = selectedSong.id;
      type = "song";
    } else if (newItemType === "template" && selectedTemplate) {
      title = selectedTemplate.title;
      type = selectedTemplate.type as ServiceItem["type"];
    }

    if (!title.trim()) {
      toast({ title: "Please select or enter a title", variant: "destructive" });
      return;
    }

    const existingItems = serviceItems[selectedServiceId] || [];
    const position = existingItems.length;

    try {
      await fetchApi("/service-items", {
        method: "POST",
        body: JSON.stringify({
          serviceId: selectedServiceId,
          title,
          songId,
          type,
          position,
          duration: null,
          details: {},
        }),
      });
      toast({ title: "Item added" });
      setAddItemDialogOpen(false);

      const itemsRes = await fetchApi(`/service-items?serviceId=${selectedServiceId}`);
      setServiceItems((prev) => ({ ...prev, [selectedServiceId]: Array.isArray(itemsRes) ? itemsRes : [] }));
    } catch (e) {
      toast({ title: "Failed to add item", variant: "destructive" });
    }
  };

  const handleDeleteItem = async (serviceId: string, itemId: string) => {
    try {
      await fetchApi(`/service-items/${itemId}`, { method: "DELETE" });
      setServiceItems((prev) => ({
        ...prev,
        [serviceId]: (prev[serviceId] || []).filter((i) => i.id !== itemId),
      }));
      toast({ title: "Item deleted" });
    } catch (e) {
      toast({ title: "Failed to delete item", variant: "destructive" });
    }
  };

  const handleMoveItem = async (serviceId: string, itemId: string, direction: "up" | "down") => {
    const items = serviceItems[serviceId] || [];
    const itemIndex = items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) return;

    const newIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;
    if (newIndex < 0 || newIndex >= items.length) return;

    const newItems = [...items];
    [newItems[itemIndex], newItems[newIndex]] = [newItems[newIndex], newItems[itemIndex]];

    const updates = newItems.map((item, idx) => ({
      id: item.id,
      position: idx,
    }));

    setServiceItems((prev) => ({ ...prev, [serviceId]: newItems }));

    try {
      await fetchApi("/service-items/reorder", {
        method: "PATCH",
        body: JSON.stringify({ items: updates }),
      });
    } catch (e) {
      toast({ title: "Failed to reorder items", variant: "destructive" });
      setServiceItems((prev) => ({ ...prev, [serviceId]: items }));
    }
  };

  const openAssignDialog = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setMemberSearch("");
    setMembers([]);
    setSelectedMember(null);
    setSelectedPosition("Vocals");
    setAssignDialogOpen(true);
  };

  const searchMembers = async (query: string) => {
    if (!query.trim()) {
      setMembers([]);
      return;
    }
    try {
      const data = await fetchApi(`/members?search=${encodeURIComponent(query)}`);
      setMembers(Array.isArray(data) ? data.slice(0, 10) : []);
    } catch (e) {
      console.error("Failed to search members:", e);
    }
  };

  const handleAssignMember = async () => {
    if (!selectedServiceId || !selectedMember) {
      toast({ title: "Please select a member", variant: "destructive" });
      return;
    }

    try {
      await fetchApi("/service-assignments", {
        method: "POST",
        body: JSON.stringify({
          serviceId: selectedServiceId,
          userId: selectedMember.id,
          position: selectedPosition,
        }),
      });
      toast({ title: "Member assigned" });
      setAssignDialogOpen(false);

      const serviceRes = await fetchApi(`/services/${selectedServiceId}`);
      if (serviceRes && typeof serviceRes === 'object') {
        const assignments = (serviceRes as Record<string, unknown>).assignments || [];
        setServiceAssignments((prev) => ({ ...prev, [selectedServiceId]: Array.isArray(assignments) ? assignments as ServiceAssignment[] : [] }));
      }
    } catch (e: unknown) {
      const error = e as { blocked?: boolean };
      if (error?.blocked) {
        toast({ title: "Member has a blockout on this date", variant: "destructive" });
      } else {
        toast({ title: "Failed to assign member", variant: "destructive" });
      }
    }
  };

  const handleToggleAssignment = async (serviceId: string, assignment: ServiceAssignment) => {
    try {
      await fetchApi(`/service-assignments/${assignment.id}`, {
        method: "PUT",
        body: JSON.stringify({ confirmed: !assignment.confirmed }),
      });
      setServiceAssignments((prev) => ({
        ...prev,
        [serviceId]: (prev[serviceId] || []).map((a) =>
          a.id === assignment.id ? { ...a, confirmed: !a.confirmed } : a
        ),
      }));
    } catch (e) {
      toast({ title: "Failed to update assignment", variant: "destructive" });
    }
  };

  const handleRemoveAssignment = async (serviceId: string, assignmentId: string) => {
    try {
      await fetchApi(`/service-assignments/${assignmentId}`, { method: "DELETE" });
      setServiceAssignments((prev) => ({
        ...prev,
        [serviceId]: (prev[serviceId] || []).filter((a) => a.id !== assignmentId),
      }));
      toast({ title: "Assignment removed" });
    } catch (e) {
      toast({ title: "Failed to remove assignment", variant: "destructive" });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed":
        return "bg-green-100 text-green-800";
      case "completed":
        return "bg-indigo-100 text-indigo-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getItemIcon = (type: string) => {
    const itemType = ITEM_TYPES.find((t) => t.value === type);
    const Icon = itemType?.icon || FileText;
    return <Icon className="w-4 h-4" />;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Services</h1>
        <Button size="sm" onClick={openNewDialog}>
          <Plus className="w-4 h-4 mr-1" /> New Service
        </Button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search services..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {SERVICE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {SERVICE_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingService ? "Edit Service" : "New Service"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Input
                placeholder="Service title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
              />
            </div>
            <div>
              <Input
                type="datetime-local"
                value={formData.date}
                onChange={(e) =>
                  setFormData({ ...formData, date: e.target.value })
                }
              />
            </div>
            <div>
              <Select
                value={formData.type}
                onValueChange={(v) =>
                  setFormData({ ...formData, type: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select
                value={formData.status}
                onValueChange={(v) =>
                  setFormData({ ...formData, status: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Textarea
                placeholder="Notes (optional)"
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Saving..." : editingService ? "Update" : "Create"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this service? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addItemDialogOpen} onOpenChange={setAddItemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Service Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={newItemType === "template" ? "default" : "outline"}
                size="sm"
                onClick={() => setNewItemType("template")}
              >
                Template
              </Button>
              <Button
                variant={newItemType === "song" ? "default" : "outline"}
                size="sm"
                onClick={() => setNewItemType("song")}
              >
                Song
              </Button>
            </div>

            {newItemType === "template" ? (
              <div className="space-y-2">
                <Select
                  value={itemType}
                  onValueChange={(v) => setItemType(v as ServiceItem["type"])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Item type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                  {TEMPLATE_ITEMS.filter((t) => t.type === itemType || itemType === "song").map((t) => (
                    <Button
                      key={t.title}
                      variant={selectedTemplate?.title === t.title ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setSelectedTemplate(t);
                        setItemTitle(t.title);
                        setItemType(t.type as ServiceItem["type"]);
                      }}
                      className="justify-start"
                    >
                      {getItemIcon(t.type)} <span className="ml-2">{t.title}</span>
                    </Button>
                  ))}
                </div>
                {itemType !== "song" && !TEMPLATE_ITEMS.find((t) => t.title === itemTitle) && (
                  <Input
                    placeholder="Or enter custom title"
                    value={itemTitle}
                    onChange={(e) => setItemTitle(e.target.value)}
                  />
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search songs..."
                    className="pl-9"
                    value={songSearch}
                    onChange={(e) => {
                      setSongSearch(e.target.value);
                      searchSongs(e.target.value);
                    }}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {songs.map((song) => (
                    <Button
                      key={song.id}
                      variant={selectedSong?.id === song.id ? "default" : "ghost"}
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setSelectedSong(song);
                        setItemTitle(song.title);
                      }}
                    >
                      <Music className="w-4 h-4 mr-2" />
                      <span>{song.title}</span>
                      {song.author && <span className="ml-2 text-xs text-muted-foreground">by {song.author}</span>}
                      {song.key && <span className="ml-2 text-xs text-muted-foreground">Key: {song.key}</span>}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAddItemDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddItem} disabled={!itemTitle.trim()}>
                Add Item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                className="pl-9"
                value={memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value);
                  searchMembers(e.target.value);
                }}
              />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {members.map((member) => (
                <Button
                  key={member.id}
                  variant={selectedMember?.id === member.id ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setSelectedMember(member)}
                >
                  <Users className="w-4 h-4 mr-2" />
                  <span>{member.firstName} {member.lastName}</span>
                  {member.role && <span className="ml-2 text-xs text-muted-foreground">({member.role})</span>}
                </Button>
              ))}
            </div>
            <Select value={selectedPosition} onValueChange={setSelectedPosition}>
              <SelectTrigger>
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAssignMember} disabled={!selectedMember}>
                Assign
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
        {!loading && filteredServices.length === 0 && (
          <p className="text-sm text-muted-foreground">No services found.</p>
        )}
        {!loading &&
          filteredServices.map((svc) => (
            <Card key={svc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-1 h-10 rounded bg-primary" />
                  <div className="flex-1">
                    <p className="font-medium">{svc.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {svc.date
                        ? new Date(svc.date).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                      {svc.date
                        ? ` · ${new Date(svc.date).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}`
                        : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => handleStatusToggle(svc)}
                    className={`text-xs px-2 py-1 rounded cursor-pointer ${getStatusColor(svc.status)}`}
                    disabled={svc.status === "completed"}
                  >
                    {svc.status}
                  </button>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpand(svc.id)}
                    >
                      {expandedService === svc.id ? "−" : "+"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(svc)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(svc.id)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {expandedService === svc.id && (
                  <div className="mt-4 pt-4 border-t space-y-4">
                    {svc.notes && (
                      <p className="text-sm text-muted-foreground">{svc.notes}</p>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium">Service Flow</h4>
                        <Button size="sm" variant="outline" onClick={() => openAddItemDialog(svc.id)}>
                          <Plus className="w-3 h-3 mr-1" /> Add Item
                        </Button>
                      </div>
                      {itemsLoading[svc.id] ? (
                        <div className="flex items-center justify-center py-4">
                          <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {(serviceItems[svc.id] || []).map((item, idx) => (
                            <div key={item.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                              <span className="text-xs text-muted-foreground w-4">{idx + 1}</span>
                              {getItemIcon(item.type)}
                              <span className="flex-1 text-sm">{item.title}</span>
                              {item.duration && (
                                <span className="text-xs text-muted-foreground flex items-center">
                                  <Clock className="w-3 h-3 mr-1" />
                                  {item.duration}m
                                </span>
                              )}
                              <div className="flex gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="w-6 h-6"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveItem(svc.id, item.id, "up")}
                                >
                                  <ChevronUp className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="w-6 h-6"
                                  disabled={idx === (serviceItems[svc.id] || []).length - 1}
                                  onClick={() => handleMoveItem(svc.id, item.id, "down")}
                                >
                                  <ChevronDown className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="w-6 h-6"
                                  onClick={() => handleDeleteItem(svc.id, item.id)}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                          {(serviceItems[svc.id] || []).length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-2">No items yet</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium">Team</h4>
                        <Button size="sm" variant="outline" onClick={() => openAssignDialog(svc.id)}>
                          <Plus className="w-3 h-3 mr-1" /> Assign
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {(serviceAssignments[svc.id] || []).map((assignment) => (
                          <div key={assignment.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                            <button
                              onClick={() => handleToggleAssignment(svc.id, assignment)}
                              className={`w-5 h-5 rounded border flex items-center justify-center ${
                                assignment.confirmed ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground"
                              }`}
                            >
                              {assignment.confirmed && <Check className="w-3 h-3" />}
                            </button>
                            <span className="flex-1 text-sm">
                              {assignment.user?.firstName} {assignment.user?.lastName}
                            </span>
                            <span className="text-xs text-muted-foreground">{assignment.position}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-6 h-6"
                              onClick={() => handleRemoveAssignment(svc.id, assignment.id)}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        {(serviceAssignments[svc.id] || []).length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-2">No team members assigned</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}