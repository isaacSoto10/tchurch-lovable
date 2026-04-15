import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@/providers/ClerkProvider";
import { ChurchProvider } from "@/providers/ChurchProvider";
import { RequireAuth } from "@/components/RequireAuth";

import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/app/Dashboard";
import Songs from "./pages/app/Songs";
import Services from "./pages/app/Services";
import Announcements from "./pages/app/Announcements";
import Ministries from "./pages/app/Ministries";
import Events from "./pages/app/Events";
import Teams from "./pages/app/Teams";
import MyAssignments from "./pages/app/MyAssignments";
import Settings from "./pages/app/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ClerkProvider>
          <ChurchProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/login/*" element={<Login />} />
              <Route path="/signup/*" element={<Signup />} />
              <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route index element={<Dashboard />} />
                <Route path="songs" element={<Songs />} />
                <Route path="services" element={<Services />} />
                <Route path="announcements" element={<Announcements />} />
                <Route path="ministries" element={<Ministries />} />
                <Route path="events" element={<Events />} />
                <Route path="teams" element={<Teams />} />
                <Route path="my-assignments" element={<MyAssignments />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ChurchProvider>
        </ClerkProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;