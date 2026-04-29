import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
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
import { AppLayout } from "./layouts/AppLayout";
import Dashboard from "./pages/app/Dashboard";
import Songs from "./pages/app/Songs";
import SongDetail from "./pages/app/SongDetail";
import Services from "./pages/app/Services";
import ServiceDetail from "./pages/app/ServiceDetail";
import Announcements from "./pages/app/Announcements";
import Ministries from "./pages/app/Ministries";
import MinistryDetail from "./pages/app/MinistryDetail";
import Events from "./pages/app/Events";
import EventDetail from "./pages/app/EventDetail";
import Teams from "./pages/app/Teams";
import TeamDetail from "./pages/app/TeamDetail";
import MyAssignments from "./pages/app/MyAssignments";
import Settings from "./pages/app/Settings";
import Messages from "./pages/app/Messages";
import Prayer from "./pages/app/Prayer";
import Training from "./pages/app/Training";
import Calendar from "./pages/app/Calendar";
import Users from "./pages/app/Users";
import Blockouts from "./pages/app/Blockouts";
import Onboarding from "./pages/app/Onboarding";
import JoinChurch from "./pages/app/JoinChurch";
import CreateChurchForm from "./pages/app/CreateChurchForm";
import Presets from "./pages/app/Presets";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Router>
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
                <Route path="songs/:id" element={<SongDetail />} />
                <Route path="services" element={<Services />} />
                <Route path="services/:id" element={<ServiceDetail />} />
                <Route path="announcements" element={<Announcements />} />
                <Route path="ministries" element={<Ministries />} />
                <Route path="ministries/:id" element={<MinistryDetail />} />
                <Route path="events" element={<Events />} />
                <Route path="events/:id" element={<EventDetail />} />
                <Route path="teams" element={<Teams />} />
                <Route path="teams/:id" element={<TeamDetail />} />
                <Route path="my-assignments" element={<MyAssignments />} />
                <Route path="settings" element={<Settings />} />
                <Route path="messages" element={<Messages />} />
                <Route path="prayer" element={<Prayer />} />
                <Route path="training" element={<Training />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="users" element={<Users />} />
                <Route path="blockouts" element={<Blockouts />} />
              </Route>
              <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
              <Route path="/join-church" element={<JoinChurch />} />
              <Route path="/create-church" element={<RequireAuth><CreateChurchForm /></RequireAuth>} />
              <Route path="/app/presets" element={<RequireAuth><Presets /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ChurchProvider>
        </ClerkProvider>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
