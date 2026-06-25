import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@/providers/ClerkProvider";
import { ChurchProvider } from "@/providers/ChurchProvider";
import { UserActionLoggingProvider } from "@/providers/UserActionLoggingProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { useNativeDeepLinks } from "@/hooks/useNativeDeepLinks";
import { appRouteLoaders, scheduleNativeAppPreload } from "@/lib/appRoutePreloaders";

const Landing = lazy(appRouteLoaders.Landing);
const Login = lazy(appRouteLoaders.Login);
const Signup = lazy(appRouteLoaders.Signup);
const AppLayout = lazy(() => appRouteLoaders.AppLayout().then((module) => ({ default: module.AppLayout })));
const Dashboard = lazy(appRouteLoaders.Dashboard);
const Songs = lazy(appRouteLoaders.Songs);
const SongDetail = lazy(appRouteLoaders.SongDetail);
const Services = lazy(appRouteLoaders.Services);
const ServiceDetail = lazy(appRouteLoaders.ServiceDetail);
const ServicePresentation = lazy(appRouteLoaders.ServicePresentation);
const Announcements = lazy(appRouteLoaders.Announcements);
const Devotionals = lazy(appRouteLoaders.Devotionals);
const Giving = lazy(appRouteLoaders.Giving);
const Ministries = lazy(appRouteLoaders.Ministries);
const MinistryDetail = lazy(appRouteLoaders.MinistryDetail);
const Events = lazy(appRouteLoaders.Events);
const EventDetail = lazy(appRouteLoaders.EventDetail);
const EventQr = lazy(appRouteLoaders.EventQr);
const EventScanner = lazy(appRouteLoaders.EventScanner);
const Teams = lazy(appRouteLoaders.Teams);
const TeamDetail = lazy(appRouteLoaders.TeamDetail);
const MyAssignments = lazy(appRouteLoaders.MyAssignments);
const Settings = lazy(appRouteLoaders.Settings);
const Messages = lazy(appRouteLoaders.Messages);
const Prayer = lazy(appRouteLoaders.Prayer);
const Training = lazy(appRouteLoaders.Training);
const Calendar = lazy(appRouteLoaders.Calendar);
const Users = lazy(appRouteLoaders.Users);
const Blockouts = lazy(appRouteLoaders.Blockouts);
const Onboarding = lazy(appRouteLoaders.Onboarding);
const JoinChurch = lazy(appRouteLoaders.JoinChurch);
const CreateChurchForm = lazy(appRouteLoaders.CreateChurchForm);
const Presets = lazy(appRouteLoaders.Presets);
const NotFound = lazy(appRouteLoaders.NotFound);

const isNativePlatform = Capacitor.isNativePlatform();
const Router = isNativePlatform ? HashRouter : BrowserRouter;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: isNativePlatform ? 60_000 : 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status =
          error && typeof error === "object" && "status" in error
            ? Number((error as { status?: unknown }).status)
            : 0;

        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});

function PageLoader() {
  return (
    <div className="min-h-screen bg-background px-5 pt-[calc(env(safe-area-inset-top,0px)+5rem)]" role="status" aria-label="Cargando Tchurch">
      <div className="mx-auto w-full max-w-md animate-pulse space-y-5">
        <div className="h-5 w-36 rounded-full bg-muted/70" />
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="h-4 w-28 rounded-full bg-muted" />
          <div className="h-16 rounded-2xl bg-muted/70" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-10 rounded-xl bg-muted/70" />
            <div className="h-10 rounded-xl bg-muted/70" />
            <div className="h-10 rounded-xl bg-muted/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

function NativeDeepLinkHandler() {
  const navigate = useNavigate();
  useNativeDeepLinks(navigate);

  return null;
}

const App = () => {
  useEffect(() => {
    const savedLanguage = localStorage.getItem("tchurch_language");
    document.documentElement.lang = savedLanguage === "en" ? "en" : "es";

    if (isNativePlatform) {
      return scheduleNativeAppPreload();
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Router>
        <NativeDeepLinkHandler />
        <ClerkProvider>
          <UserActionLoggingProvider>
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
                    <Route path="events/:id/rsvp" element={<EventDetail />} />
                    <Route path="events/:id/my-qr" element={<EventDetail />} />
                    <Route path="events/:id/participation" element={<EventDetail />} />
                    <Route path="events/:id/check-in" element={<EventDetail />} />
                    <Route path="events/:id/admin" element={<EventDetail />} />
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
          </UserActionLoggingProvider>
        </ClerkProvider>
      </Router>
    </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
