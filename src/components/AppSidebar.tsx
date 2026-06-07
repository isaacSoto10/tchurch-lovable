import {
  LayoutDashboard,
  Music,
  ListChecks,
  Megaphone,
  Users,
  CalendarDays,
  UsersRound,
  LogOut,
  ClipboardList,
  Settings,
  MessageCircle,
  Heart,
  BookOpen,
  Calendar,
  UserCircle,
  CalendarX,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useChurch } from "@/providers/ChurchProvider";
import { useApi } from "@/hooks/useApi";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TchurchLogo } from "@/components/TchurchLogo";

interface Ministry {
  id: string;
  name: string;
  color: string;
}

type FetchApi = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;

interface MyMinistriesResponse {
  ministries?: Ministry[];
}

interface ChurchMemberSummary {
  status?: string | null;
}

interface ChurchMembersResponse {
  members?: ChurchMemberSummary[];
}

function MinistriesSection({ fetchApi, selectedChurchId, collapsed }: { fetchApi: FetchApi; selectedChurchId?: string; collapsed: boolean }) {
  const [ministries, setMinistries] = useState<Ministry[]>([]);

  useEffect(() => {
    if (!selectedChurchId) return;
    fetchApi<Ministry[] | MyMinistriesResponse>(`/my-ministries`)
      .then((data) => {
        const list = Array.isArray(data) ? data : Array.isArray(data?.ministries) ? data.ministries : [];
        setMinistries(list.slice(0, 5));
      })
      .catch(() => setMinistries([]));
  }, [fetchApi, selectedChurchId]);

  if (ministries.length === 0) return null;

  if (collapsed) {
    return (
      <div className="px-2 py-2 border-t">
        <Users className="w-4 h-4 mx-auto text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-t">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
        Mis ministerios
      </p>
      <div className="space-y-0.5">
        {ministries.map((m) => (
          <NavLink
            key={m.id}
            to={`/app/ministries/${m.id}`}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: m.color || "#6366f1" }}
            />
            <span className="truncate">{m.name}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  leaderOnly?: boolean;
}

const navItems: NavItem[] = [
  { title: "Panel", url: "/app", icon: LayoutDashboard },
  { title: "Canciones", url: "/app/songs", icon: Music },
  { title: "Servicios", url: "/app/services", icon: ListChecks },
  { title: "Anuncios", url: "/app/announcements", icon: Megaphone },
  { title: "Devocionales", url: "/app/devotionals", icon: BookOpen },
  { title: "Dar", url: "/app/giving", icon: Heart },
  { title: "Mis asignaciones", url: "/app/my-assignments", icon: ClipboardList },
  { title: "Ministerios", url: "/app/ministries", icon: Users },
  { title: "Eventos", url: "/app/events", icon: CalendarDays },
  { title: "Equipos", url: "/app/teams", icon: UsersRound },
  { title: "Calendario", url: "/app/calendar", icon: Calendar },
  { title: "Miembros", url: "/app/users", icon: UserCircle },
  { title: "Fechas bloqueadas", url: "/app/blockouts", icon: CalendarX },
  { title: "Ajustes", url: "/app/settings", icon: Settings },
  { title: "Mensajes", url: "/app/messages", icon: MessageCircle },
  { title: "Oración", url: "/app/prayer", icon: Heart },
  { title: "Capacitación", url: "/app/training", icon: BookOpen },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, user } = useAppAuth();
  const { selectedChurch } = useChurch();
  const { fetchApi } = useApi();

  const [pendingCount, setPendingCount] = useState(0);
  const isAdmin = selectedChurch?.role === "ADMIN";
  const isPlanner = selectedChurch?.role === "PLANNER" || isAdmin;
  const isLeader = selectedChurch?.role === "LEADER" || isPlanner;

  const loadPendingCount = useCallback(async () => {
    if (!selectedChurch?.id) return;
    try {
      const data = await fetchApi<ChurchMembersResponse>(`/churches/${selectedChurch.id}/members`);
      const members = Array.isArray(data?.members) ? data.members : [];
      setPendingCount(members.filter((member) => member.status === "PENDING" || !member.status).length);
    } catch (e) {
      console.error("Failed to load pending count:", e);
      setPendingCount(0);
    }
  }, [fetchApi, selectedChurch?.id]);

  useEffect(() => {
    if (isAdmin && selectedChurch?.id) {
      loadPendingCount();
    } else {
      setPendingCount(0);
    }
  }, [isAdmin, loadPendingCount, selectedChurch?.id]);

  function canSee(item: NavItem): boolean {
    if (item.adminOnly) return isAdmin;
    if (item.leaderOnly) return isLeader;
    return true;
  }

  const visibleItems = navItems.filter(canSee);

  return (
    <Sidebar collapsible="icon">
      <div className="flex items-center gap-2 border-b px-3" style={{ paddingTop: "max(1rem, env(safe-area-inset-top, 1rem))", paddingBottom: "1rem" }}>
        <div className="min-w-0 flex-1">
          {collapsed ? <TchurchLogo variant="mark" size="md" /> : <TchurchLogo size="sm" wordPurple />}
        </div>
        <SidebarTrigger className="h-9 w-9 shrink-0 rounded-xl border border-zinc-200 bg-white shadow-sm" />
      </div>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/app"}
                      className="hover:bg-muted/50"
                      activeClassName="bg-primary text-primary-foreground font-medium hover:bg-primary/90"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && (
                        <span className="flex items-center gap-2">
                          {item.title}
                          {item.title === "Miembros" && pendingCount > 0 && (
                            <Badge
                              variant="destructive"
                              className="h-5 w-5 p-0 text-xs justify-center items-center"
                            >
                              {pendingCount}
                            </Badge>
                          )}
                          {item.title === "Ajustes" && isAdmin && (
                            <Badge
                              variant="secondary"
                              className="h-5 px-1.5 text-xs justify-center items-center"
                            >
                              <Shield className="w-3 h-3" />
                            </Badge>
                          )}
                        </span>
                      )}
                      {collapsed && item.title === "Miembros" && pendingCount > 0 && (
                        <Badge
                          variant="destructive"
                          className="absolute -top-1 -right-1 h-4 w-4 p-0 text-[10px] justify-center items-center"
                        >
                          {pendingCount > 9 ? "9+" : pendingCount}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Mis ministerios */}
      {!collapsed && (
        <MinistriesSection fetchApi={fetchApi} selectedChurchId={selectedChurch?.id} collapsed={false} />
      )}
      {collapsed && (
        <MinistriesSection fetchApi={fetchApi} selectedChurchId={selectedChurch?.id} collapsed={true} />
      )}
      {!collapsed && (
        <div className="px-3 py-2 border-t">
          {isAdmin && (
            <div className="px-2 py-1.5 mb-2 rounded-md bg-primary/10 text-primary text-xs font-medium">
              <Shield className="w-3 h-3 inline mr-1" />
              Acceso de administrador
            </div>
          )}
          {isPlanner && !isAdmin && (
            <div className="px-2 py-1.5 mb-2 rounded-md bg-amber-500/10 text-amber-700 text-xs font-medium">
              Acceso de planificación
            </div>
          )}
        </div>
      )}
      <div className="mt-auto border-t p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}>
        {!collapsed && user && (
          <p className="text-xs text-muted-foreground truncate mb-2 px-1">
            {user.primaryEmailAddress?.emailAddress}
          </p>
        )}
        <button
          onClick={() => signOut("/")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
      </div>
      <SidebarRail />
    </Sidebar>
  );
}
