import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Plus, Trash2, GripVertical, Check, X, Clock, Users, Music, Download } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";

type ServiceItem = {
  id: string;
  title: string;
  type: string;
  position: number;
  duration: number | null;
  song: { id: string; title: string; author: string | null } | null;
};

type Assignment = {
  id: string;
  userId: string;
  position: string;
  confirmed: boolean;
  user: { firstName: string | null; lastName: string | null; email: string } | null;
};

type Service = {
  id: string;
  title: string;
  date: string;
  type: string;
  status: string;
  notes: string | null;
  items: ServiceItem[];
  assignments: Assignment[];
};

type Tab = "flow" | "team";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

const ITEM_TYPES = ["Song", "Prayer", "Scripture", "Announcement", "Video", "Other"];

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("flow");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Add item form
  const [itemTitle, setItemTitle] = useState("");
  const [itemType, setItemType] = useState("Song");
  const [itemDuration, setItemDuration] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const [songResults, setSongResults] = useState<any[]>([]);
  const [selectedSong, setSelectedSong] = useState<any>(null);

  // Assign form
  const [assignEmail, setAssignEmail] = useState("");
  const [assignPosition, setAssignPosition] = useState("");
  const [availableSongs, setAvailableSongs] = useState<any[]>([]);

  const isAdmin = selectedChurch?.role === "ADMIN";
  const isPlanner = selectedChurch?.role === "PLANNER" || isAdmin;

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const data = await apiFetch<Service>(`/services/${id}`);
        if (data.error) { navigate("/app/services"); return; }
        // Sort items by position
        const sorted = { ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) };
        setService(sorted);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    if (itemType === "Song" && songSearch.length >= 2) {
      const timeout = setTimeout(async () => {
        try {
          const data = await apiFetch<any[]>(`/songs?search=${encodeURIComponent(songSearch)}`);
          setSongResults(Array.isArray(data) ? data.slice(0, 5) : []);
        } catch { setSongResults([]); }
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [songSearch, itemType]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemTitle.trim() || !id) return;
    setSubmitting(true);
    try {
      const item = {
        title: selectedSong ? `${selectedSong.title} (${selectedSong.author || "Unknown"})` : itemTitle,
        type: itemType,
        duration: itemDuration ? parseInt(itemDuration) : null,
        songId: selectedSong?.id || null,
      };
      await apiFetch(`/services/${id}/items`, {
        method: "POST",
        body: JSON.stringify(item),
      });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService({ ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) });
      resetItemForm();
      setShowAddItem(false);
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  }

  async function handleDeleteItem(itemId: string) {
    if (!id) return;
    try {
      await apiFetch(`/services/${id}/items/${itemId}`, { method: "DELETE" });
      setService((prev) => prev ? { ...prev, items: prev.items.filter((i) => i.id !== itemId) } : prev);
    } catch (e) { console.error(e); }
  }

  async function handleMoveUp(item: ServiceItem) {
    if (!service || !id) return;
    const idx = service.items.findIndex((i) => i.id === item.id);
    if (idx <= 0) return;
    const prev = service.items[idx - 1];
    // Swap positions
    try {
      await apiFetch(`/services/${id}/items/${item.id}`, { method: "PUT", body: JSON.stringify({ position: prev.position }) });
      await apiFetch(`/services/${id}/items/${prev.id}`, { method: "PUT", body: JSON.stringify({ position: item.position }) });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService({ ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) });
    } catch (e) { console.error(e); }
  }

  async function handleMoveDown(item: ServiceItem) {
    if (!service || !id) return;
    const idx = service.items.findIndex((i) => i.id === item.id);
    if (idx < 0 || idx >= service.items.length - 1) return;
    const next = service.items[idx + 1];
    try {
      await apiFetch(`/services/${id}/items/${item.id}`, { method: "PUT", body: JSON.stringify({ position: next.position }) });
      await apiFetch(`/services/${id}/items/${next.id}`, { method: "PUT", body: JSON.stringify({ position: item.position }) });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService({ ...data, items: [...(data.items || [])].sort((a, b) => a.position - b.position) });
    } catch (e) { console.error(e); }
  }

  async function handleAssignMember(e: React.FormEvent) {
    e.preventDefault();
    if (!assignEmail.trim() || !id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/services/${id}/assignments`, {
        method: "POST",
        body: JSON.stringify({ email: assignEmail, position: assignPosition || "Member" }),
      });
      const data = await apiFetch<Service>(`/services/${id}`);
      setService(data);
      setShowAssign(false);
      setAssignEmail("");
      setAssignPosition("");
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    if (!id) return;
    try {
      await apiFetch(`/services/${id}/assignments/${assignmentId}`, { method: "DELETE" });
      setService((prev) => prev ? { ...prev, assignments: prev.assignments.filter((a) => a.id !== assignmentId) } : prev);
    } catch (e) { console.error(e); }
  }

  async function handleConfirmAssignment(assignmentId: string, confirmed: boolean) {
    if (!id) return;
    try {
      await apiFetch(`/services/${id}/assignments/${assignmentId}`, {
        method: "PUT",
        body: JSON.stringify({ confirmed }),
      });
      setService((prev) => prev ? {
        ...prev,
        assignments: prev.assignments.map((a) => a.id === assignmentId ? { ...a, confirmed } : a),
      } : prev);
    } catch (e) { console.error(e); }
  }

  async function handleDeleteService() {
    if (!id) return;
    try {
      await apiFetch(`/services/${id}`, { method: "DELETE" });
      navigate("/app/services");
    } catch (e) { console.error(e); }
  }

  function resetItemForm() {
    setItemTitle("");
    setItemType("Song");
    setItemDuration("");
    setSongSearch("");
    setSongResults([]);
    setSelectedSong(null);
  }

  const statusColors: Record<string, string> = {
    draft: "bg-zinc-100 text-zinc-600",
    confirmed: "bg-emerald-100 text-emerald-700",
    completed: "bg-zinc-100 text-muted-foreground",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Service not found</p>
        <Button variant="ghost" onClick={() => navigate("/app/services")} className="mt-2">Back</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/app/services")} className="p-2 -ml-2 rounded-lg hover:bg-zinc-100">
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-zinc-900 truncate">{service.title}</h1>
            <p className="text-xs text-zinc-500">{formatDate(service.date)}</p>
          </div>
          <Badge className={statusColors[service.status] || statusColors.draft}>
            {service.status}
          </Badge>
          {isAdmin && (
            <Button variant="ghost" size="sm" className="text-red-500" onClick={handleDeleteService}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="px-4 pb-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
            <TabsList className="w-full grid grid-cols-2 h-9 bg-zinc-100/60 p-1 rounded-lg">
              <TabsTrigger value="flow" className="text-xs flex items-center gap-1">
                <Music className="w-3 h-3" /> Service Flow
              </TabsTrigger>
              <TabsTrigger value="team" className="text-xs flex items-center gap-1">
                <Users className="w-3 h-3" /> Team
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* SERVICE INFO */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-medium">{service.type}</span>
              {service.notes && <span>· {service.notes}</span>}
            </div>
          </CardContent>
        </Card>

        {/* FLOW TAB */}
        {activeTab === "flow" && (
          <div className="space-y-3">
            {isPlanner && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setShowAddItem(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Item
                </Button>
              </div>
            )}

            {service.items.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Music className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">No items in this service yet.</p>
                  {isPlanner && (
                    <Button size="sm" variant="outline" onClick={() => setShowAddItem(true)} className="mt-3">
                      Add First Item
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {service.items.map((item, idx) => (
                  <Card key={item.id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex flex-col gap-1 shrink-0">
                        {idx > 0 && (
                          <button onClick={() => handleMoveUp(item)} className="p-0.5 rounded hover:bg-zinc-100 text-zinc-400">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" /></svg>
                          </button>
                        )}
                        <GripVertical className="w-4 h-4 text-zinc-300" />
                        {idx < service.items.length - 1 && (
                          <button onClick={() => handleMoveDown(item)} className="p-0.5 rounded hover:bg-zinc-100 text-zinc-400">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" /></svg>
                          </button>
                        )}
                      </div>
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                        {item.type === "Song" ? <Music className="w-4 h-4 text-primary" /> : <Clock className="w-4 h-4 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-zinc-500">
                          {item.type}{item.duration ? ` · ${item.duration} min` : ""}
                          {item.song && ` · ${item.song.title}`}
                        </p>
                      </div>
                      {isPlanner && (
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TEAM TAB */}
        {activeTab === "team" && (
          <div className="space-y-3">
            {isPlanner && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setShowAssign(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Assign Member
                </Button>
              </div>
            )}

            {service.assignments.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Users className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">No team members assigned yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {service.assignments.map((a) => (
                  <Card key={a.id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(a.user?.firstName, a.user?.lastName, a.user?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {a.user?.firstName} {a.user?.lastName}
                        </p>
                        <p className="text-xs text-zinc-500">{a.position}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {a.confirmed ? (
                          <Badge variant="default" className="text-xs bg-emerald-100 text-emerald-700">Confirmed</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Pending</Badge>
                        )}
                        {isPlanner && (
                          <button
                            onClick={() => handleRemoveAssignment(a.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
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
      </div>

      {/* ADD ITEM DIALOG */}
      <Dialog open={showAddItem} onOpenChange={(open) => { setShowAddItem(open); if (!open) resetItemForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Service Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddItem} className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {itemType === "Song" ? (
              <div className="space-y-2">
                <Label>Song</Label>
                <Input
                  value={songSearch}
                  onChange={(e) => { setSongSearch(e.target.value); setSelectedSong(null); }}
                  placeholder="Search songs..."
                />
                {songResults.length > 0 && !selectedSong && (
                  <div className="border rounded-lg overflow-hidden">
                    {songResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 border-b last:border-b-0"
                        onClick={() => { setSelectedSong(s); setItemTitle(s.title); setSongSearch(s.title); setSongResults([]); }}
                      >
                        <p className="font-medium">{s.title}</p>
                        {s.author && <p className="text-xs text-zinc-500">{s.author}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="Item title" required />
              </div>
            )}
            <div className="space-y-2">
              <Label>Duration (minutes)</Label>
              <Input type="number" value={itemDuration} onChange={(e) => setItemDuration(e.target.value)} placeholder="5" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddItem(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Item"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ASSIGN MEMBER DIALOG */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Team Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAssignMember} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} placeholder="member@example.com" required />
            </div>
            <div className="space-y-2">
              <Label>Position</Label>
              <Input value={assignPosition} onChange={(e) => setAssignPosition(e.target.value)} placeholder="e.g. Vocals, Guitar, Worship Leader" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAssign(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assign"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
