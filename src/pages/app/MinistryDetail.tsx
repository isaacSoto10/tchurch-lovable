import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Plus, Check, X, UserMinus, Users, Clock, MessageCircle, FileText, UserPlus, ShieldCheck } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api";
import { useChurch } from "@/providers/ChurchProvider";
import { MinistryFinance } from "@/components/MinistryFinance";
import { MinistryResources } from "@/components/MinistryResources";
import { useToast } from "@/components/ui/use-toast";

type Tab = "members" | "join-requests" | "announcements" | "resources" | "finance";

type UserSummary = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
};

type MinistryMember = {
  id: string;
  userId: string;
  role: string;
  status?: string | null;
  user?: UserSummary | null;
};

type MinistryStats = {
  memberCount?: number;
  pendingCount?: number;
  leaderCount?: number;
  resourceCount?: number;
  folderCount?: number;
};

type Ministry = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  whatsappGroupUrl?: string | null;
  members?: MinistryMember[];
  canManage?: boolean;
  isMember?: boolean;
  isPending?: boolean;
  memberRole?: string | null;
  stats?: MinistryStats;
  meeting?: {
    dayOfWeek?: string | null;
    time?: string | null;
    location?: string | null;
  } | null;
  type?: string | null;
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

function normalizeRole(role?: string | null): string {
  return String(role || "").toUpperCase();
}

const JOIN_REQUEST_TIMEOUT_MS = 15000;

function isActiveMember(member: MinistryMember) {
  const status = normalizeRole(member.status);
  return !status || status === "ACTIVE";
}

function formatRole(role?: string | null) {
  const normalized = normalizeRole(role);
  if (normalized === "ADMIN") return "Admin";
  if (normalized === "LEADER") return "Leader";
  if (normalized === "CO_LEADER") return "Co-leader";
  return "Member";
}

function getDisplayName(user?: UserSummary | null) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Member";
}

function getJoinRequestErrorMessage(error: unknown, timedOut: boolean) {
  if (timedOut) {
    return "The request took too long. Check your connection and try again.";
  }

  if (error instanceof ApiError && error.status === 401) {
    return "Your session could not send this request. Try signing in again; if it still fails, ask a leader to add you from the members list.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The request could not be sent. Please try again.";
}

export default function MinistryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();

  const [ministry, setMinistry] = useState<Ministry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get("tab") as Tab) || "members");
  const [canManage, setCanManage] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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

  function applyMinistryData(data: Ministry) {
    setMinistry(data);
    setEditForm({
      name: data.name || "",
      description: data.description || "",
      color: data.color || "",
      whatsappGroupUrl: data.whatsappGroupUrl || "",
    });

    if (typeof data.canManage === "boolean") setCanManage(data.canManage);
    if (typeof data.isMember === "boolean") setIsMember(data.isMember);
    if (typeof data.isPending === "boolean") setIsPending(data.isPending);
    if ("memberRole" in data) setMyRole(data.memberRole ? normalizeRole(data.memberRole) : null);
  }

  // Fetch ministry
  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await apiFetch<Ministry>(`/ministries/${id}`);
        if (!data?.id) throw new Error("Respuesta inválida del ministerio.");
        applyMinistryData(data);
      } catch (e) {
        console.error(e);
        const message = e instanceof Error ? e.message : "No se pudo cargar este ministerio.";

        try {
          const ministries = await apiFetch<Ministry[]>("/ministries");
          const fallback = Array.isArray(ministries)
            ? ministries.find((item) => item.id === id)
            : null;

          if (fallback) {
            applyMinistryData(fallback);
            return;
          }
        } catch (fallbackError) {
          console.error("Failed to load ministry fallback list:", fallbackError);
        }

        setMinistry(null);
        setLoadError(message);
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
        const isAdmin = normalizeRole(data.role) === "ADMIN" || normalizeRole(selectedChurch?.role) === "ADMIN";
        const myIds: string[] = data.myMinistryIds || [];
        const pendingIds: string[] = data.pendingMinistryIds || [];
        const ministryRoles: Record<string, string> = data.ministryRoles || {};
        const roleForMinistry = normalizeRole(ministryRoles[id || ""]);
        const isLeader = roleForMinistry === "LEADER" || roleForMinistry === "CO_LEADER";
        setCanManage(isAdmin || isLeader);
        setIsMember(myIds.includes(id || "") || isAdmin);
        setIsPending(pendingIds.includes(id || ""));
        setMyRole(isAdmin ? "ADMIN" : (isLeader ? roleForMinistry : (myIds.includes(id || "") ? "MEMBER" : null)));
      } catch (e) {
        console.error(e);
      }
    }
    loadMyMinistries();
  }, [id, selectedChurch?.role]);

  // Fetch join requests as soon as the user can manage so the badge is accurate.
  useEffect(() => {
    if (canManage && id) {
      setRequestsLoading(true);
      apiFetch<JoinRequestsResponse>(`/ministries/${id}/join-requests`)
        .then((data) => setJoinRequests(data.requests || []))
        .catch(() => setJoinRequests([]))
        .finally(() => setRequestsLoading(false));
    }
  }, [canManage, id]);

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
    setJoinSubmitting(true);
    setJoinError(null);
    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, JOIN_REQUEST_TIMEOUT_MS);

    try {
      const response = await apiFetch<{ message?: string; status?: string }>(
        `/ministries/${id}/join-request`,
        { method: "POST", signal: controller.signal },
      );
      setIsPending(true);
      setMinistry((current) => current ? ({
        ...current,
        stats: {
          ...current.stats,
          pendingCount: Math.max(current.stats?.pendingCount || 0, 1),
        },
      }) : current);
      toast({
        title: "Request sent",
        description: response?.message || "A ministry leader can approve it from Requests.",
      });
    } catch (e) {
      console.error(e);
      if (e instanceof ApiError && e.message.toLowerCase().includes("already a member")) {
        setIsMember(true);
        toast({ title: "You're already a member", description: "This ministry is available in your member list." });
        return;
      }

      const message = getJoinRequestErrorMessage(e, timedOut);
      setJoinError(message);
      toast({ title: "Request not sent", description: message, variant: "destructive" });
    } finally {
      window.clearTimeout(timeoutId);
      setJoinSubmitting(false);
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
      toast({ title: e instanceof Error ? e.message : "Failed to approve request", variant: "destructive" });
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
      toast({ title: e instanceof Error ? e.message : "Failed to deny request", variant: "destructive" });
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
      applyMinistryData(data);
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
      applyMinistryData(data);
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
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-4 p-6 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <div>
              <p className="font-semibold text-zinc-900">No se pudo abrir este ministerio</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {loadError || "Verifica tu acceso o intenta de nuevo."}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => window.location.reload()}>Intentar de nuevo</Button>
              <Button variant="ghost" onClick={() => navigate("/app/ministries")}>
                Volver a Ministerios
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const colorBg = ministry.color ? `${ministry.color}15` : "#f6f5f4";
  const colorDot = ministry.color || "#a39e98";
  const ministryMembers = ministry.members || [];
  const activeMembers = ministryMembers.filter(isActiveMember);
  const pendingMembers = ministryMembers.filter((member) => normalizeRole(member.status) === "PENDING");
  const memberCount = ministry.stats?.memberCount ?? activeMembers.length;
  const pendingCount = ministry.stats?.pendingCount ?? pendingMembers.length;
  const leaderCount =
    ministry.stats?.leaderCount ??
    activeMembers.filter((member) => ["ADMIN", "LEADER", "CO_LEADER"].includes(normalizeRole(member.role))).length;
  const resourceCount = ministry.stats?.resourceCount ?? 0;
  const requestBadgeCount = joinRequests.length || pendingCount;
  const tabTriggerClass =
    "group min-h-[4.25rem] w-full justify-start whitespace-normal rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left shadow-sm transition data-[state=active]:border-primary/70 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-md";
  const tabIconClass = "mt-0.5 h-4 w-4 shrink-0 text-zinc-500 group-data-[state=active]:text-primary";
  const tabMetaClass = "mt-1 block text-[11px] font-medium leading-tight text-zinc-500";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as Tab)}
      className="mobile-page min-h-full bg-zinc-50"
    >
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            aria-label="Back to ministries"
            onClick={() => navigate("/app/ministries")}
            className="p-2 -ml-2 rounded-lg hover:bg-zinc-100"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: colorBg }}>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorDot }} />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-zinc-900 truncate">{ministry.name}</h1>
              {ministry.description && (
                <p className="text-xs text-zinc-500 truncate">{ministry.description}</p>
              )}
            </div>
          </div>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setShowEditMinistry(true)}>
              Edit
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="px-4 pb-3">
          <TabsList
            aria-label="Ministry sections"
            className="grid h-auto w-full grid-cols-2 gap-2 rounded-none bg-transparent p-0 text-zinc-600"
          >
            <TabsTrigger
              value="members"
              className={tabTriggerClass}
              aria-label={`Members, ${memberCount} active`}
            >
              <span className="flex w-full items-start gap-2">
                <Users className={tabIconClass} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">Members</span>
                  <span className={tabMetaClass}>{memberCount} active</span>
                </span>
              </span>
            </TabsTrigger>
            {canManage && (
              <TabsTrigger
                value="join-requests"
                className={tabTriggerClass}
                aria-label={`Requests, ${requestBadgeCount} pending`}
              >
                <span className="flex w-full items-start gap-2">
                  <UserPlus className={tabIconClass} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="block text-sm font-semibold leading-tight">Requests</span>
                      {requestBadgeCount > 0 && (
                        <span
                          aria-label={`${requestBadgeCount} pending requests`}
                          className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white"
                        >
                          {requestBadgeCount}
                        </span>
                      )}
                    </span>
                    <span className={tabMetaClass}>{requestBadgeCount > 0 ? "Needs review" : "No pending"}</span>
                  </span>
                </span>
              </TabsTrigger>
            )}
            <TabsTrigger
              value="announcements"
              className={tabTriggerClass}
              aria-label="Announcements"
            >
              <span className="flex w-full items-start gap-2">
                <MessageCircle className={tabIconClass} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">Announcements</span>
                  <span className={tabMetaClass}>Updates</span>
                </span>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="resources"
              className={tabTriggerClass}
              aria-label={`Resources, ${resourceCount} items`}
            >
              <span className="flex w-full items-start gap-2">
                <FileText className={tabIconClass} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">Resources</span>
                  <span className={tabMetaClass}>{resourceCount} items</span>
                </span>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="finance"
              className={tabTriggerClass}
              aria-label="Finanzas"
            >
              <span className="flex w-full items-start gap-2">
                <ShieldCheck className={tabIconClass} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">Finanzas</span>
                  <span className={tabMetaClass}>Donations</span>
                </span>
              </span>
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="h-px bg-zinc-200" />
      </div>

      <div className="space-y-4 p-4 pb-[calc(var(--tchurch-mobile-content-clearance,var(--tchurch-mobile-nav-reserved,0px))+1rem)]">
        <Card className="border-zinc-200 bg-white">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ministry overview</p>
                <h2 className="mt-1 text-base font-semibold text-zinc-950">{ministry.name}</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  {ministry.description || "A place for people, resources, announcements, and ministry-specific coordination."}
                </p>
              </div>
              <Badge variant={isMember ? "default" : isPending ? "secondary" : "outline"} className="shrink-0">
                {isMember ? formatRole(myRole) : isPending ? "Pending" : "Open"}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-3">
                <p className="text-lg font-semibold text-zinc-950">{memberCount}</p>
                <p className="text-[0.7rem] font-medium text-muted-foreground">Members</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-3">
                <p className="text-lg font-semibold text-zinc-950">{leaderCount}</p>
                <p className="text-[0.7rem] font-medium text-muted-foreground">Leaders</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-3">
                <p className="text-lg font-semibold text-zinc-950">{resourceCount}</p>
                <p className="text-[0.7rem] font-medium text-muted-foreground">Resources</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* MEMBERS TAB */}
        <TabsContent value="members" className="m-0 space-y-3">
          {canManage && (
            <div className="flex justify-end gap-2">
              {ministry.whatsappGroupUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={ministry.whatsappGroupUrl} target="_blank" rel="noreferrer">
                    <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                  </a>
                </Button>
              )}
              <Button size="sm" onClick={() => setShowAddMember(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add Member
              </Button>
            </div>
          )}
          {!canManage && ministry.whatsappGroupUrl && (
            <Card className="border-emerald-100 bg-emerald-50">
              <CardContent className="p-4">
                <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <a href={ministry.whatsappGroupUrl} target="_blank" rel="noreferrer">
                    <MessageCircle className="w-4 h-4 mr-2" /> Open ministry WhatsApp group
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}

          {!isMember && !isPending && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <UserPlus className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-950">Join this ministry</p>
                    <p className="mt-1 text-sm leading-5 text-zinc-600">
                      Send a request to the ministry leaders. Once approved, resources and member updates will appear here.
                    </p>
                  </div>
                </div>
                {joinError && (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {joinError}
                  </p>
                )}
                <Button className="h-11 w-full" onClick={handleJoinRequest} disabled={joinSubmitting}>
                  {joinSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending request...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      Join this ministry
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {isPending && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-4 flex items-center gap-3">
                <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <p className="font-medium text-amber-800 text-sm">Request sent to leaders</p>
                  <p className="text-xs text-amber-600">Waiting for a ministry leader to approve it.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {isMember && (
            <Card>
              <CardContent className="flex items-center gap-3 p-3">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-950">You're in this ministry</p>
                  <p className="text-xs text-muted-foreground">Role: {formatRole(myRole)}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {activeMembers.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Users className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                <p className="text-sm text-muted-foreground">No members yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {activeMembers.map((member) => (
                <Card key={member.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                        {getInitials(member.user?.firstName, member.user?.lastName, member.user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {getDisplayName(member.user)}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">{member.user?.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={normalizeRole(member.role) === "ADMIN" || normalizeRole(member.role) === "LEADER" || normalizeRole(member.role) === "CO_LEADER" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {formatRole(member.role)}
                      </Badge>
                      {canManage && normalizeRole(member.role) !== "ADMIN" && (
                        <button
                          type="button"
                          aria-label={`Remove ${getDisplayName(member.user)}`}
                          onClick={() => handleRemoveMember(member.userId)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
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
        </TabsContent>

        {/* JOIN REQUESTS TAB */}
        {canManage && (
          <TabsContent value="join-requests" className="m-0 space-y-3">
            <p className="text-sm text-muted-foreground">
              Requests from the Join this ministry button appear here for leaders to approve or deny.
            </p>

            {requestsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : joinRequests.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Check className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">No pending requests</p>
                </CardContent>
              </Card>
            ) : (
              joinRequests.map((req) => (
                <Card key={req.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                          {getInitials(req.user?.firstName, req.user?.lastName, req.user?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {getDisplayName(req.user)}
                        </p>
                        <p className="text-xs text-zinc-500 truncate">{req.user?.email}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleApprove(req.id)}
                      >
                        <Check className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDeny(req.id)}
                      >
                        <X className="w-4 h-4 mr-1" /> Deny
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        )}

        {/* ANNOUNCEMENTS TAB */}
        <TabsContent value="announcements" className="m-0 space-y-3">
          {announcements.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">No announcements yet</p>
              </CardContent>
            </Card>
          ) : (
            announcements.map((ann) => (
              <Card key={ann.id}>
                <CardContent className="p-4">
                  {ann.imageUrl && (
                    <img src={ann.imageUrl} alt={ann.title} className="w-full h-40 object-cover rounded-lg mb-3" />
                  )}
                  <h3 className="font-semibold text-zinc-900">{ann.title}</h3>
                  {ann.content && (
                    <p className="text-sm text-zinc-500 mt-1 line-clamp-3">{ann.content}</p>
                  )}
                  <p className="text-xs text-zinc-400 mt-2">
                    {new Date(ann.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* RESOURCES TAB */}
        <TabsContent value="resources" className="m-0">
          {canManage || isMember ? (
            <MinistryResources ministryId={id!} canManage={canManage} />
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">Recursos solo para miembros</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Solicita unirte para ver clases, documentos y materiales de este ministerio.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* FINANCE TAB */}
        <TabsContent value="finance" className="m-0">
          <MinistryFinance ministryId={id!} ministryName={ministry.name} canManage={canManage} />
        </TabsContent>
      </div>

      {/* ADD MEMBER DIALOG */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
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
              <Label>Role</Label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="LEADER">Leader</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT MINISTRY DIALOG */}
      <Dialog open={showEditMinistry} onOpenChange={setShowEditMinistry}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Ministry</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateMinistry} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
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
                    className="w-10 h-10 rounded-lg border border-zinc-200 shrink-0"
                    style={{ backgroundColor: editForm.color }}
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>WhatsApp Group Link</Label>
              <Input
                value={editForm.whatsappGroupUrl}
                onChange={(e) => setEditForm({ ...editForm, whatsappGroupUrl: e.target.value })}
                placeholder="https://chat.whatsapp.com/..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditMinistry(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
