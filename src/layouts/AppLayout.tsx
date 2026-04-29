import { Outlet } from "react-router-dom";
import { AppSidebar } from "../components/AppSidebar";

export function AppLayout() {
  return (
    <div className="flex min-h-svh bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <Outlet />
      </main>
    </div>
  );
}
