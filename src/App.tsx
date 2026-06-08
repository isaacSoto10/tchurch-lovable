import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@/providers/ClerkProvider";
import { ChurchProvider } from "@/providers/ChurchProvider";
import { RequireAuth } from "@/components/RequireAuth";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const AppLayout = lazy(() => import("./layouts/AppLayout").then((module) => ({ default: module.AppLayout })));
const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const Songs = lazy(() => import("./pages/app/Songs"));
const SongDetail = lazy(() => import("./pages/app/SongDetail"));
const Services = lazy(() => import("./pages/app/Services"));
const ServiceDetail = lazy(() => import("./pages/app/ServiceDetail"));
const ServicePresentation = lazy(() => import("./pages/app/ServicePresentation"));
const Announcements = lazy(() => import("./pages/app/Announcements"));
const Devotionals = lazy(() => import("./pages/app/Devotionals"));
const Giving = lazy(() => import("./pages/app/Giving"));
const Ministries = lazy(() => import("./pages/app/Ministries"));
const MinistryDetail = lazy(() => import("./pages/app/MinistryDetail"));
const Events = lazy(() => import("./pages/app/Events"));
const EventDetail = lazy(() => import("./pages/app/EventDetail"));
const EventQr = lazy(() => import("./pages/app/EventQr"));
const EventScanner = lazy(() => import("./pages/app/EventScanner"));
const Teams = lazy(() => import("./pages/app/Teams"));
const TeamDetail = lazy(() => import("./pages/app/TeamDetail"));
const MyAssignments = lazy(() => import("./pages/app/MyAssignments"));
const Settings = lazy(() => import("./pages/app/Settings"));
const Messages = lazy(() => import("./pages/app/Messages"));
const Prayer = lazy(() => import("./pages/app/Prayer"));
const Training = lazy(() => import("./pages/app/Training"));
const Calendar = lazy(() => import("./pages/app/Calendar"));
const Users = lazy(() => import("./pages/app/Users"));
const Blockouts = lazy(() => import("./pages/app/Blockouts"));
const Onboarding = lazy(() => import("./pages/app/Onboarding"));
const JoinChurch = lazy(() => import("./pages/app/JoinChurch"));
const CreateChurchForm = lazy(() => import("./pages/app/CreateChurchForm"));
const Presets = lazy(() => import("./pages/app/Presets"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();
const isNativePlatform = Capacitor.isNativePlatform();
const Router = isNativePlatform ? HashRouter : BrowserRouter;

function PageLoader() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto mt-24 h-4 w-36 animate-pulse rounded-full bg-muted/30" />
    </div>
  );
}

const App = () => {
  useEffect(() => {
    const savedLanguage = localStorage.getItem("tchurch_language");
    document.documentElement.lang = savedLanguage === "en" ? "en" : "es";
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Router>
        <ClerkProvider>
          <ChurchProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/pricing" element={<Navigate to="/" replace />} />
                <Route path="/login/*" element={<Login />} />
                <Route path="/signup/*" element={<Signup />} />
                <Route path="/app/services/:id/presentation" element={<RequireAuth><ServicePresentation /></RequireAuth>} />
                <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
                  <Route index element={<Dashboard />} />
                  <Route path="songs" element={<Songs />} />
                  <Route path="songs/:id" element={<SongDetail />} />
                  <Route path="services" element={<Services />} />
                  <Route path="services/:id" element={<ServiceDetail />} />
                  <Route path="announcements" element={<Announcements />} />
                  <Route path="devotionals" element={<Devotionals />} />
                  <Route path="giving" element={<Giving />} />
                  <Route path="ministries" element={<Ministries />} />
                  <Route path="ministries/:id" element={<MinistryDetail />} />
                  <Route path="events" element={<Events />} />
                  <Route path="events/:id/qr" element={<EventQr />} />
                  <Route path="events/:id/scanner" element={<EventScanner />} />
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
            </Suspense>
          </ChurchProvider>
        </ClerkProvider>
      </Router>
    </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
