import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@/providers/ClerkProvider";
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
import Placeholder from "./pages/app/Placeholder";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ClerkProvider>
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
              <Route path="ministries" element={<Placeholder />} />
              <Route path="events" element={<Placeholder />} />
              <Route path="teams" element={<Placeholder />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ClerkProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
