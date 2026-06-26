import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Check, Clock, Loader2, Mail, Plus, Search, ShieldCheck, User, UserMinus, Users as UsersIcon, X } from "lucide-react";
import { ApiError, getChurchId } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useToast } from "@/components/ui/use-toast";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";

interface Member {
  id: string;
  userId?: string;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  createdAt?: string | null;
  joinedAt?: string | null;
  user?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    imageUrl?: string | null;
  } | null;
}

type UsersSnapshot = {
  members: Member[];
};

const USERS_SNAPSHOT_PREFIX = "tchurch_ios_users_snapshot_v1";

function isUsersSnapshot(data: unknown): data is UsersSnapshot {
  if (!data || typeof data !== "object") return false;
  return Array.isArray((data as Partial<UsersSnapshot>).members);
}

const ROLE_OPTIONS = [
  { value: "MEMBER", label: "Miembro" },
  { value: "PLANNER", label: "Planificador" },
  { value: "MUSICIAN", label: "Músico" },
  { value: "TECH", label: "Técnico" },
  { value: "ADMIN", label: "Admin" },
];

function getInitials(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  if (firstName || lastName) return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

function normalizeStatus(status?: string | null) {
  return String(status || "").trim().toUpperCase();
}

function getMemberRole(member: Member) {
  const role = String(member.role || "MEMBER").toUpperCase();
  return ROLE_OPTIONS.some((option) => option.value === role) ? role : "MEMBER";
}

function getRoleLabel(role?: string | null) {
  const normalizedRole = String(role || "MEMBER").toUpperCase();
  return ROLE_OPTIONS.find((option) => option.value === normalizedRole)?.label || normalizedRole;
}

function isPendingMember(member: Member) {
  return normalizeStatus(member.status) === "PENDING";
}

function getMemberUserId(member: Member) {
  return member.userId || member.user?.id || member.id;
}

function getMemberEmail(member: Member) {
  return member.user?.email || member.email || "";
}

function getMemberName(member: Member) {
  const firstName = member.user?.firstName || member.firstName || "";
  const lastName = member.user?.lastName || member.lastName || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const email = getMemberEmail(member);
  return fullName || (email ? email.split("@")[0] : "Miembro sin nombre");
}

function getMemberInitials(member: Member) {
  return getInitials(
    member.user?.firstName || member.firstName,
    member.user?.lastName || member.lastName,
    getMemberEmail(member),
  );
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

export default function Users() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [showAddMember, setShowAddMember] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("MEMBER");
  const [addError, setAddError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [processingMember, setProcessingMember] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);

  const isAdmin = selectedChurch?.role === "ADMIN";
  const snapshotKey = sessionSnapshotKey(USERS_SNAPSHOT_PREFIX, selectedChurch?.id || getChurchId());

  const applyMembers = useCallback((memberList: Member[]) => {
    setMembers(memberList);
    loadedOnceRef.current = true;
  }, []);

  const loadMembers = useCallback(async () => {
    if (!selectedChurch) {
      setMembers([]);
      setLoading(false);
      return;
    }

    const snapshot = readSessionSnapshot<UsersSnapshot>(snapshotKey, { validate: isUsersSnapshot });
    if (snapshot) {
      applyMembers(snapshot.data.members);
      setLoading(false);
    } else if (!loadedOnceRef.current) {
      setLoading(true);
    }

    try {
      const data = await fetchApi<{ members?: Member[] } | Member[]>(`/churches/${selectedChurch.id}/members`);
      const memberList = Array.isArray(data) ? data : (data.members || []);
      applyMembers(memberList);
      writeSessionSnapshot(snapshotKey, { members: memberList });
    } catch (error) {
      console.error("Failed to load members:", error);
      try {
        const data = await fetchApi<Member[]>("/users");
        const fallbackMembers = (Array.isArray(data) ? data : []).map((member) => ({
          ...member,
          userId: member.userId || member.id,
          status: member.status || "APPROVED",
        }));
        applyMembers(fallbackMembers);
        writeSessionSnapshot(snapshotKey, { members: fallbackMembers });
      } catch (fallbackError) {
        console.error("Fallback also failed:", fallbackError);
        toast({
          title: "No se pudieron cargar los miembros",
          description: getApiErrorMessage(fallbackError, "Intenta nuevamente en unos segundos."),
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [applyMembers, fetchApi, selectedChurch, snapshotKey, toast]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  function resetAddMemberForm() {
    setAddEmail("");
    setAddRole("MEMBER");
    setAddError("");
  }

  async function handleAddMember(event: FormEvent) {
    event.preventDefault();
    const email = addEmail.trim().toLowerCase();
    if (!email || !selectedChurch) return;

    setSubmitting(true);
    setAddError("");
    try {
      await fetchApi(`/churches/${selectedChurch.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email, role: addRole }),
      });
      toast({
        title: "Miembro agregado",
        description: `${email} ya puede aparecer en la lista de miembros.`,
      });
      setShowAddMember(false);
      resetAddMemberForm();
      await loadMembers();
    } catch (error) {
      console.error(error);
      const message = getApiErrorMessage(error, "No se pudo agregar el miembro.");
      setAddError(message);
      toast({ title: "No se pudo agregar el miembro", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateRole(userId: string, newRole: string) {
    if (!selectedChurch) return;
    setUpdatingRole(userId);
    try {
      await fetchApi(`/users/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });
      toast({ title: "Rol actualizado" });
      setMembers((prev) => {
        const nextMembers = prev.map((member) => getMemberUserId(member) === userId ? { ...member, role: newRole } : member);
        writeSessionSnapshot(snapshotKey, { members: nextMembers });
        return nextMembers;
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "No se pudo actualizar el rol",
        description: getApiErrorMessage(error, "Intenta nuevamente."),
        variant: "destructive",
      });
    } finally {
      setUpdatingRole(null);
    }
  }

  async function reviewMemberRequest(userId: string, action: "approve" | "deny") {
    if (!selectedChurch) return;

    try {
      await fetchApi(`/churches/${selectedChurch.id}/members/${userId}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
    } catch (error) {
      if (error instanceof ApiError && action === "approve" && (error.status === 404 || error.status === 405)) {
        await fetchApi(`/churches/${selectedChurch.id}/members/${userId}/approve`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        return;
      }

      if (error instanceof ApiError && action === "deny" && (error.status === 404 || error.status === 405)) {
        await fetchApi(`/churches/${selectedChurch.id}/members/${userId}`, { method: "DELETE" });
        return;
      }

      throw error;
    }
  }

  async function handleApproveMember(userId: string) {
    setProcessingMember(userId);
    try {
      await reviewMemberRequest(userId, "approve");
      toast({ title: "Solicitud aprobada" });
      await loadMembers();
    } catch (error) {
      console.error(error);
      toast({
        title: "No se pudo aprobar",
        description: getApiErrorMessage(error, "Intenta nuevamente."),
        variant: "destructive",
      });
    } finally {
      setProcessingMember(null);
    }
  }

  async function handleDenyMember(userId: string) {
    setProcessingMember(userId);
    try {
      await reviewMemberRequest(userId, "deny");
      toast({ title: "Solicitud rechazada" });
      setMembers((prev) => {
        const nextMembers = prev.filter((member) => getMemberUserId(member) !== userId);
        writeSessionSnapshot(snapshotKey, { members: nextMembers });
        return nextMembers;
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "No se pudo rechazar",
        description: getApiErrorMessage(error, "Intenta nuevamente."),
        variant: "destructive",
      });
    } finally {
      setProcessingMember(null);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!selectedChurch) return;
    setProcessingMember(userId);
    try {
      await fetchApi(`/churches/${selectedChurch.id}/members/${userId}`, { method: "DELETE" });
      toast({ title: "Miembro removido" });
      setMembers((prev) => {
        const nextMembers = prev.filter((member) => getMemberUserId(member) !== userId);
        writeSessionSnapshot(snapshotKey, { members: nextMembers });
        return nextMembers;
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "No se pudo remover",
        description: getApiErrorMessage(error, "Intenta nuevamente."),
        variant: "destructive",
      });
    } finally {
      setProcessingMember(null);
    }
  }

  const filteredMembers = members.filter((member) => {
    const searchLower = search.toLowerCase();
    const searchable = [getMemberName(member), getMemberEmail(member), getRoleLabel(member.role)]
      .join(" ")
      .toLowerCase();
    const matchesSearch = searchable.includes(searchLower);

    if (filter === "pending") return matchesSearch && isPendingMember(member);
    return matchesSearch;
  });

  const pendingCount = members.filter(isPendingMember).length;

  const getRoleBadge = (role?: string | null) => {
    const colors: Record<string, string> = {
      ADMIN: "bg-primary/10 text-primary border-primary/20",
      LEADER: "bg-sky-50 text-sky-700 border-sky-200",
      PLANNER: "bg-cyan-50 text-cyan-700 border-cyan-200",
      MUSICIAN: "bg-emerald-50 text-emerald-700 border-emerald-200",
      TECH: "bg-orange-50 text-orange-700 border-orange-200",
      MEMBER: "bg-zinc-100 text-zinc-700 border-zinc-200",
    };
    const normalizedRole = getMemberRole({ id: "", role });
    return (
      <Badge variant="outline" className={`${colors[normalizedRole] || colors.MEMBER} text-xs`}>
        {getRoleLabel(normalizedRole)}
      </Badge>
    );
  };

  return (
    <div className="mobile-page mx-auto max-w-3xl space-y-4">
      <div className="app-card-soft p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="mobile-section-title">Administración</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-black tracking-tight text-zinc-950">Miembros</h1>
              {pendingCount > 0 && isAdmin && (
                <Badge variant="destructive" className="text-xs">{pendingCount} pendiente{pendingCount === 1 ? "" : "s"}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Busca, aprueba solicitudes y administra roles de la iglesia.
            </p>
          </div>
          {isAdmin && (
            <Button
              className="h-11 rounded-xl sm:self-end"
              onClick={() => {
                resetAddMemberForm();
                setShowAddMember(true);
              }}
            >
              <Plus className="h-4 w-4" /> Agregar miembro
            </Button>
          )}
        </div>
      </div>

      <div className="app-card p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1 sm:w-auto">
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "ghost"}
              className="h-10 rounded-xl"
              onClick={() => setFilter("all")}
            >
              <UsersIcon className="h-4 w-4" /> Todos ({members.length})
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                variant={filter === "pending" ? "default" : "ghost"}
                className="h-10 rounded-xl"
                onClick={() => setFilter("pending")}
              >
                <Clock className="h-4 w-4" /> Pendientes ({pendingCount})
              </Button>
            )}
          </div>

          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar miembros..."
              className="h-11 rounded-xl pl-10 text-base sm:text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {loading && members.length === 0 && (
          <div className="app-card flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && filteredMembers.length === 0 && (
          <Card className="app-card">
            <CardContent className="p-8 text-center">
              <User className="mx-auto mb-2 h-8 w-8 text-zinc-300" />
              <p className="text-sm font-semibold text-zinc-900">
                {filter === "pending" ? "No hay solicitudes pendientes" : "No encontramos miembros"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {search ? "Prueba con otro nombre o correo." : "Cuando agregues miembros aparecerán aquí."}
              </p>
            </CardContent>
          </Card>
        )}

        {filteredMembers.map((member) => {
          const userId = getMemberUserId(member);
          const pending = isPendingMember(member);
          const email = getMemberEmail(member);
          const processing = processingMember === userId;

          return (
            <Card key={userId} className="app-card overflow-hidden">
              <CardContent className="p-3 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar className="h-11 w-11 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
                        {getMemberInitials(member)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-zinc-950">{getMemberName(member)}</p>
                        {pending ? (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-xs text-amber-700">
                            Pendiente
                          </Badge>
                        ) : (
                          !isAdmin && getRoleBadge(member.role)
                        )}
                      </div>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{email || "Sin correo registrado"}</span>
                      </p>
                    </div>
                  </div>

                  {pending ? (
                    isAdmin ? (
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                        <Button
                          size="sm"
                          className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => handleApproveMember(userId)}
                          disabled={processing}
                        >
                          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          Aprobar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-10 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => handleDenyMember(userId)}
                          disabled={processing}
                        >
                          <X className="h-4 w-4" />
                          Rechazar
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-xs text-amber-700">
                        Pendiente
                      </Badge>
                    )
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      {isAdmin ? (
                        <>
                          <Select
                            value={getMemberRole(member)}
                            onValueChange={(value) => handleUpdateRole(userId, value)}
                            disabled={updatingRole === userId || processing}
                          >
                            <SelectTrigger className="h-10 w-full rounded-xl sm:w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-10 w-full rounded-xl text-red-600 hover:bg-red-50 hover:text-red-700 sm:w-10"
                            onClick={() => handleRemoveMember(userId)}
                            disabled={processing}
                            aria-label={`Remover a ${getMemberName(member)}`}
                          >
                            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                          </Button>
                        </>
                      ) : (
                        getRoleBadge(member.role)
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={showAddMember}
        onOpenChange={(open) => {
          setShowAddMember(open);
          if (!open) resetAddMemberForm();
        }}
      >
        <DialogContent className="top-auto bottom-0 max-w-none translate-y-0 gap-0 rounded-t-3xl p-0 sm:bottom-auto sm:top-[50%] sm:max-w-lg sm:translate-y-[-50%] sm:rounded-2xl">
          <DialogHeader className="border-b border-zinc-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Agregar miembro
            </DialogTitle>
            <DialogDescription>
              Agrega una persona por correo y asigna su rol inicial.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4 p-4 sm:p-5">
            {addError && (
              <div className="flex gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-5">{addError}</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-900">Correo</label>
              <Input
                type="email"
                value={addEmail}
                onChange={(event) => {
                  setAddEmail(event.target.value);
                  setAddError("");
                }}
                placeholder="miembro@iglesia.com"
                autoCapitalize="none"
                autoComplete="email"
                className="h-11 rounded-xl text-base sm:text-sm"
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-900">Rol</label>
              <Select value={addRole} onValueChange={setAddRole} disabled={submitting}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting || !addEmail.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Agregar miembro
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
