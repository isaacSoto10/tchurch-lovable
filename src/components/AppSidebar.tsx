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
  Loader2,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useChurch } from "@/providers/ChurchProvider";
import { useApi } from "@/hooks/useApi";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface Ministry {
  id: string;
  name: string;
  color: string;
}

function MinistriesSection({ fetchApi, selectedChurchId, collapsed }: { fetchApi: any; selectedChurchId?: string; collapsed: boolean }) {
  const [ministries, setMinistries] = useState<Ministry[]>([]);

  useEffect(() => {
    if (!selectedChurchId) return;
    fetchApi(`/my-ministries`)
      .then((data: any) => {
        const list = Array.isArray(data) ? data : Array.isArray(data?.ministries) ? data.ministries : [];
        setMinistries(list.slice(0, 5));
      })
      .catch(() => setMinistries([]));
  }, [selectedChurchId]);

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
        My Ministries
      </p>
      <div className="space-y-0.5">
        {ministries.map((m) => (
          <NavLink
            key={m.id}
            to={`/app/ministries`}
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
  icon: any;
  adminOnly?: boolean;
  leaderOnly?: boolean;
}

const navItems: NavItem[] = [
  { title: "Dashboard", url: "/app", icon: LayoutDashboard },
  { title: "Songs", url: "/app/songs", icon: Music },
  { title: "Services", url: "/app/services", icon: ListChecks },
  { title: "Announcements", url: "/app/announcements", icon: Megaphone },
  { title: "My Assignments", url: "/app/my-assignments", icon: ClipboardList },
  { title: "Ministries", url: "/app/ministries", icon: Users },
  { title: "Events", url: "/app/events", icon: CalendarDays },
  { title: "Teams", url: "/app/teams", icon: UsersRound },
  { title: "Calendar", url: "/app/calendar", icon: Calendar },
  { title: "Members", url: "/app/users", icon: UserCircle },
  { title: "Blockouts", url: "/app/blockouts", icon: CalendarX },
  { title: "Settings", url: "/app/settings", icon: Settings },
  { title: "Messages", url: "/app/messages", icon: MessageCircle },
  { title: "Prayer", url: "/app/prayer", icon: Heart },
  { title: "Training", url: "/app/training", icon: BookOpen },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { selectedChurch } = useChurch();
  const { fetchApi } = useApi();

  const [pendingCount, setPendingCount] = useState(0);
  const [loadingPending, setLoadingPending] = useState(false);

  const isAdmin = selectedChurch?.role === "ADMIN";
  const isPlanner = selectedChurch?.role === "PLANNER" || isAdmin;
  const isLeader = selectedChurch?.role === "LEADER" || isPlanner;

  useEffect(() => {
    if (isAdmin && selectedChurch?.id) {
      loadPendingCount();
    } else {
      setPendingCount(0);
    }
  }, [isAdmin, selectedChurch?.id]);

  async function loadPendingCount() {
    setLoadingPending(true);
    try {
      const data = await fetchApi<{ users: any[] }>(`/churches/${selectedChurch.id}/pending-users`);
      setPendingCount(data.users?.length || 0);
    } catch (e) {
      console.error("Failed to load pending count:", e);
      setPendingCount(0);
    } finally {
      setLoadingPending(false);
    }
  }

  function canSee(item: NavItem): boolean {
    if (item.adminOnly) return isAdmin;
    if (item.leaderOnly) return isLeader;
    return true;
  }

  const visibleItems = navItems.filter(canSee);

  return (
    <Sidebar collapsible="icon">
      <div className="flex items-center gap-2 px-4 border-b" style={{ paddingTop: "max(1rem, env(safe-area-inset-top, 1rem))", paddingBottom: "1rem" }}>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
          T
        </div>
        {!collapsed && <span className="font-bold text-base tracking-tight">Tchurch</span>}
      </div>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
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
                          {item.title === "Members" && pendingCount > 0 && (
                            <Badge
                              variant="destructive"
                              className="h-5 w-5 p-0 text-xs justify-center items-center"
                            >
                              {pendingCount}
                            </Badge>
                          )}
                          {item.title === "Settings" && isAdmin && (
                            <Badge
                              variant="secondary"
                              className="h-5 px-1.5 text-xs justify-center items-center"
                            >
                              <Shield className="w-3 h-3" />
                            </Badge>
                          )}
                        </span>
                      )}
                      {collapsed && item.title === "Members" && pendingCount > 0 && (
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
      {/* My Ministries */}
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
              Admin Access
            </div>
          )}
          {isPlanner && !isAdmin && (
            <div className="px-2 py-1.5 mb-2 rounded-md bg-amber-500/10 text-amber-700 text-xs font-medium">
              Planner Access
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
          onClick={() => signOut({ redirectUrl: "/" })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </Sidebar>
  );
}
