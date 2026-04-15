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

const items = [
  { title: "Dashboard", url: "/app", icon: LayoutDashboard },
  { title: "Songs", url: "/app/songs", icon: Music },
  { title: "Services", url: "/app/services", icon: ListChecks },
  { title: "Announcements", url: "/app/announcements", icon: Megaphone },
  { title: "My Assignments", url: "/app/my-assignments", icon: ClipboardList },
  { title: "Ministries", url: "/app/ministries", icon: Users },
  { title: "Events", url: "/app/events", icon: CalendarDays },
  { title: "Teams", url: "/app/teams", icon: UsersRound },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();

  return (
    <Sidebar collapsible="icon">
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
          T
        </div>
        {!collapsed && <span className="font-bold text-base tracking-tight">Tchurch</span>}
      </div>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
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
      </SidebarContent>
      <div className="mt-auto border-t p-3">
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
