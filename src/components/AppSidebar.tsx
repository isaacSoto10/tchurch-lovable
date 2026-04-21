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
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useState } from "react";
import { USE_MOCK } from "@/lib/api";
import { MOCK_MINISTRIES } from "@/lib/mock-data";

const mainItems = [
  { title: "Dashboard", url: "/app", icon: LayoutDashboard },
  { title: "Songs", url: "/app/songs", icon: Music },
  { title: "Services", url: "/app/services", icon: ListChecks },
  { title: "Announcements", url: "/app/announcements", icon: Megaphone },
  { title: "My Assignments", url: "/app/my-assignments", icon: ClipboardList },
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

// Mock user ministries (ministries the user belongs to)
const MY_MINISTRIES = USE_MOCK
  ? [
      { id: "min-1", name: "Alabanza", color: "#6366f1" },
      { id: "min-3", name: "Medios", color: "#10b981" },
    ]
  : [];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [ministriesOpen, setMinistriesOpen] = useState(true);

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
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/app"}
                      className="hover:bg-muted/50"
                      activeClassName="bg-primary text-primary-foreground font-medium hover:bg-primary/90"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* My Ministries section */}
        {MY_MINISTRIES.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="cursor-pointer select-none flex items-center justify-between px-2" onClick={() => setMinistriesOpen(!ministriesOpen)}>
              {!collapsed && (
                <>
                  <span className="text-xs font-semibold uppercase tracking-wider">My Ministries</span>
                  {ministriesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </>
              )}
            </SidebarGroupLabel>
            {ministriesOpen && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {MY_MINISTRIES.map((ministry) => (
                    <SidebarMenuItem key={ministry.id}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={`/app/ministries`}
                          className="hover:bg-muted/50"
                          activeClassName="bg-primary text-primary-foreground font-medium hover:bg-primary/90"
                        >
                          <div className="w-2.5 h-2.5 rounded-full mr-2 shrink-0" style={{ backgroundColor: ministry.color }} />
                          {!collapsed && <span>{ministry.name}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>
      <div className="mt-auto border-t p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}>
        {!collapsed && user && (
          <p className="text-xs text-muted-foreground truncate mb-2 px-1">
            {user.primaryEmailAddress?.emailAddress}
          </p>
        )}
        {!USE_MOCK && (
          <button
            onClick={() => signOut({ redirectUrl: "/" })}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        )}
      </div>
    </Sidebar>
  );
}
