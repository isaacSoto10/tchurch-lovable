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
import { useT } from "@/lib/locale";

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

type User = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

type Arrangement = {
  id: string;
  name: string;
  songId: string;
  key: string | null;
  bpm: number | null;
  meter: string | null;
  sequence: unknown[];
  lyrics: string | null;
  notes: string | null;
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
  preachingUserId: string | null;
  worshipLeaderId: string | null;
  preachingUser: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  worshipLeader: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
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
  const t = useT();

  const [service, setService] = useState<Service | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("flow");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingLeader, setSavingLeader] = useState(false);
  const [arrangementModal, setArrangementModal] = useState<{ songId: string; songTitle: string } | null>(null);

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
    async function loadUsers() {
      try {
        const data = await apiFetch<User[]>("/users");
        setUsers(Array.isArray(data) ? data : []);
      } catch { setUsers([]); }
    }
    loadUsers();
  }, []);

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

  async function saveLeader(field: "preachingUserId" | "worshipLeaderId", userId: string) {
    if (!service) return;
    setSavingLeader(true);
    const optimistic = {
      ...service,
      [field]: userId || null,
      [`${field === "preachingUserId" ? "preachingUser" : "worshipLeader"}`]: userId
        ? users.find((u) => u.id === userId) ?? null
        : null,
    };
    setService(optimistic as Service);
    try {
      await apiFetch(`/services/${id}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: userId || null }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSavingLeader(false);
    }
  }

  function handleSongClick(songId: string, songTitle: string) {
    setArrangementModal({ songId, songTitle });
  }

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
        <p className="text-muted-foreground">{t("services.notFound")}</p>
        <Button variant="ghost" onClick={() => navigate("/app/services")} className="mt-2">{t("common.back")}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Arrangement Modal */}
      {arrangementModal && (
        <SongArrangementModalMobile
          songId={arrangementModal.songId}
          songTitle={arrangementModal.songTitle}
          onClose={() => setArrangementModal(null)}
        />
      )}

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
            {t(`status.${service.status}` as any) || service.status}
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
                <Music className="w-3 h-3" /> {t("services.serviceFlow")}
              </TabsTrigger>
              <TabsTrigger value="team" className="text-xs flex items-center gap-1">
                <Users className="w-3 h-3" /> {t("services.teamAssignments")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* Leadership row */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{t("services.preacher")}</label>
                <select
                  value={service.preachingUserId || ""}
                  onChange={(e) => saveLeader("preachingUserId", e.target.value)}
                  disabled={savingLeader}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50"
                >
                  <option value="">{t("services.selectPreacher")}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{t("services.serviceDirector")}</label>
                <select
                  value={service.worshipLeaderId || ""}
                  onChange={(e) => saveLeader("worshipLeaderId", e.target.value)}
                  disabled={savingLeader}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50"
                >
                  <option value="">{t("services.selectDirector")}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

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
                  <Plus className="w-4 h-4 mr-1" /> {t("flow.addItem")}
                </Button>
              </div>
            )}

            {service.items.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Music className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">{t("flow.noItems")}</p>
                  {isPlanner && (
                    <Button size="sm" variant="outline" onClick={() => setShowAddItem(true)} className="mt-3">
                      {t("flow.addItemTitle")}
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
                        {item.type === "Song" && item.song ? (
                          <button
                            onClick={() => handleSongClick(item.song!.id, item.song!.title)}
                            className="font-medium text-sm text-primary hover:underline text-left"
                          >
                            {item.title}
                          </button>
                        ) : (
                          <p className="font-medium text-sm">{item.title}</p>
                        )}
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
                  <Plus className="w-4 h-4 mr-1" /> {t("services.assignMember")}
                </Button>
              </div>
            )}

            {service.assignments.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Users className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">{t("services.noAssignments")}</p>
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
                          <Badge variant="default" className="text-xs bg-emerald-100 text-emerald-700">{t("status.confirmed")}</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">{t("status.draft")}</Badge>
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
            <DialogTitle>{t("flow.addItemTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddItem} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("common.type")}</Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t_item) => <SelectItem key={t_item} value={t_item}>{t_item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {itemType === "Song" ? (
              <div className="space-y-2">
                <Label>{t("songs.title")}</Label>
                <Input
                  value={songSearch}
                  onChange={(e) => { setSongSearch(e.target.value); setSelectedSong(null); }}
                  placeholder={t("songs.search")}
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
                <Label>{t("common.title")}</Label>
                <Input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder={t("flow.titlePlaceholder")} required />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("flow.durationMin")}</Label>
              <Input type="number" value={itemDuration} onChange={(e) => setItemDuration(e.target.value)} placeholder="5" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddItem(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.add")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ASSIGN MEMBER DIALOG */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("services.assignTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAssignMember} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("common.email")}</Label>
              <Input type="email" value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} placeholder="member@example.com" required />
            </div>
            <div className="space-y-2">
              <Label>{t("services.positionRole")}</Label>
              <Input value={assignPosition} onChange={(e) => setAssignPosition(e.target.value)} placeholder={t("services.choosePosition")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAssign(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.add")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Mobile song arrangement modal
function SongArrangementModalMobile({
  songId,
  songTitle,
  onClose,
}: {
  songId: string;
  songTitle: string;
  onClose: () => void;
}) {
  const t = useT();
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [activeArrangement, setActiveArrangement] = useState<Arrangement | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState<"chords" | "slides">("chords");

  useEffect(() => {
    fetch(`/api/songs/${songId}/arrangements`)
      .then((r) => r.json())
      .then((data) => {
        const arrs = Array.isArray(data) ? data : [];
        setArrangements(arrs);
        if (arrs.length > 0) setActiveArrangement(arrs[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [songId]);

  function renderChordChart(lyrics: string | null) {
    if (!lyrics) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-2xl mb-2">🎶</p>
          <p className="text-sm text-muted">{t("songs.noArrangements")}</p>
        </div>
      );
    }
    return (
      <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
        {lyrics}
      </pre>
    );
  }

  function renderSlides(lyrics: string | null) {
    if (!lyrics) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm text-muted">{t("songs.noArrangements")}</p>
        </div>
      );
    }
    const sections = lyrics.split(/\n\n+/);
    return (
      <div className="space-y-4">
        {sections.map((section, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-surface p-4 text-center">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{section.trim()}</p>
          </div>
        ))}
      </div>
    );
  }

  const previewContent =
    previewMode === "chords"
      ? renderChordChart(activeArrangement?.lyrics ?? null)
      : renderSlides(activeArrangement?.lyrics ?? null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg max-h-[90vh] bg-surface border border-border/50 rounded-2xl shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">{songTitle}</h2>
            <p className="text-xs text-muted">{t("songs.arrangements")}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 ml-3 rounded-lg p-2 text-muted hover:text-foreground hover:bg-surface-overlay transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted" />
            </div>
          ) : arrangements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <p className="text-2xl mb-2">🎶</p>
              <p className="text-sm text-muted">{t("songs.noArrangements")}</p>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-4 pt-3 pb-2 border-b border-border/30">
                <div className="flex flex-wrap gap-2">
                  {arrangements.map((arr) => (
                    <button
                      key={arr.id}
                      onClick={() => setActiveArrangement(arr)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                        activeArrangement?.id === arr.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-surface text-muted hover:text-foreground"
                      }`}
                    >
                      {arr.name || t("songs.default")}
                    </button>
                  ))}
                </div>
              </div>

              {activeArrangement && (
                <div className="px-4 py-2 border-b border-border/30 flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-muted uppercase tracking-wide">{t("common.key")}</span>
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-semibold">
                      {activeArrangement.key || "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-muted uppercase tracking-wide">{t("common.bpm")}</span>
                    <span className="text-xs font-medium">{activeArrangement.bpm || "—"}</span>
                  </div>
                  {activeArrangement.meter && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-muted uppercase tracking-wide">Meter</span>
                      <span className="text-xs">{activeArrangement.meter}</span>
                    </div>
                  )}
                </div>
              )}

              {activeArrangement && (
                <div className="px-4 py-2 border-b border-border/30 flex items-center justify-between shrink-0">
                  <span className="text-xs font-medium text-muted uppercase tracking-wide">Preview</span>
                  <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-surface-overlay p-0.5">
                    <button
                      onClick={() => setPreviewMode("chords")}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                        previewMode === "chords"
                          ? "bg-primary text-white shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      Chord Chart
                    </button>
                    <button
                      onClick={() => setPreviewMode("slides")}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                        previewMode === "slides"
                          ? "bg-primary text-white shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      Slides
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-4 py-3">
                {previewContent}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
