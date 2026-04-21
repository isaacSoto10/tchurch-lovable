import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@/providers/ClerkProvider";
import { ChurchProvider } from "@/providers/ChurchProvider";
import { LocaleProvider } from "@/lib/locale";
import { RequireAuth } from "@/components/RequireAuth";
import { USE_MOCK } from "@/lib/api";

import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/app/Dashboard";
import Songs from "./pages/app/Songs";
import Services from "./pages/app/Services";
import ServiceDetail from "./pages/app/ServiceDetail";
import Announcements from "./pages/app/Announcements";
import Ministries from "./pages/app/Ministries";
import Events from "./pages/app/Events";
import EventDetail from "./pages/app/EventDetail";
import Teams from "./pages/app/Teams";
import MyAssignments from "./pages/app/MyAssignments";
import Settings from "./pages/app/Settings";
import Messages from "./pages/app/Messages";
import Prayer from "./pages/app/Prayer";
import Training from "./pages/app/Training";
import Calendar from "./pages/app/Calendar";
import Users from "./pages/app/Users";
import Blockouts from "./pages/app/Blockouts";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ClerkProvider>
          <LocaleProvider>
            <ChurchProvider>
              <Routes>
              {USE_MOCK ? (
                <>
                  {/* Mock mode: skip landing/login, go straight to app */}
                  <Route path="/" element={<Navigate to="/app" replace />} />
                  <Route path="/login" element={<Navigate to="/app" replace />} />
                  <Route path="/signup" element={<Navigate to="/app" replace />} />
                </>
              ) : (
                <>
                  <Route path="/" element={<Landing />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                </>
              )}
              <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route index element={<Dashboard />} />
                <Route path="songs" element={<Songs />} />
                <Route path="services" element={<Services />} />
                <Route path="services/:id" element={<ServiceDetail />} />
                <Route path="announcements" element={<Announcements />} />
                <Route path="ministries" element={<Ministries />} />
                <Route path="events" element={<Events />} />
                <Route path="events/:id" element={<EventDetail />} />
                <Route path="teams" element={<Teams />} />
                <Route path="my-assignments" element={<MyAssignments />} />
                <Route path="settings" element={<Settings />} />
                <Route path="messages" element={<Messages />} />
                <Route path="prayer" element={<Prayer />} />
                <Route path="training" element={<Training />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="users" element={<Users />} />
                <Route path="blockouts" element={<Blockouts />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ChurchProvider>
          </LocaleProvider>
        </ClerkProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
