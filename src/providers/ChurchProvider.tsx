import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { fetchUserChurches, getChurchId, setChurchId } from "@/lib/api";

interface Church {
  id: string;
  name: string;
  slug: string;
  role: string;
  brandColor: string | null;
  logoUrl: string | null;
  plan: string;
  memberLimit: number;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
}

interface ChurchContextType {
  churches: Church[];
  selectedChurch: Church | null;
  selectChurch: (church: Church) => void;
  loading: boolean;
  error: string | null;
}

const ChurchContext = createContext<ChurchContextType | null>(null);

export function useChurch() {
  const ctx = useContext(ChurchContext);
  if (!ctx) throw new Error("useChurch must be used within ChurchProvider");
  return ctx;
}

export function ChurchProvider({ children }: { children: ReactNode }) {
  const { getToken, userId, isSignedIn } = useAuth();
  const [churches, setChurches] = useState<Church[]>([]);
  const [selectedChurch, setSelectedChurch] = useState<Church | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadChurches() {
      console.log("[ChurchProvider] Loading churches... isSignedIn:", isSignedIn, "userId:", userId);
      
      if (!isSignedIn || !userId) {
        console.log("[ChurchProvider] Not signed in, skipping");
        setLoading(false);
        return;
      }

      try {
        const token = await getToken();
        console.log("[ChurchProvider] Got token:", token ? "yes" : "no");
        
        if (!token) {
          setError("Not authenticated - no token");
          setLoading(false);
          return;
        }

        console.log("[ChurchProvider] Fetching churches from API...");
        const userChurches = await fetchUserChurches(token);
        console.log("[ChurchProvider] Got churches:", userChurches);
        
        setChurches(userChurches);

        const savedChurchId = getChurchId();
        console.log("[ChurchProvider] Saved church ID:", savedChurchId);
        
        if (savedChurchId) {
          const saved = userChurches.find((c: Church) => c.id === savedChurchId);
          if (saved) {
            setSelectedChurch(saved);
            console.log("[ChurchProvider] Using saved church:", saved.name);
          } else if (userChurches.length > 0) {
            setSelectedChurch(userChurches[0]);
            setChurchId(userChurches[0].id);
            console.log("[ChurchProvider] Saved not found, using first:", userChurches[0].name);
          }
        } else if (userChurches.length > 0) {
          setSelectedChurch(userChurches[0]);
          setChurchId(userChurches[0].id);
          console.log("[ChurchProvider] No saved, using first:", userChurches[0].name);
        } else {
          console.log("[ChurchProvider] No churches found for user");
        }
      } catch (e) {
        console.error("[ChurchProvider] Error loading churches:", e);
        setError(e instanceof Error ? e.message : "Failed to load churches");
      } finally {
        setLoading(false);
      }
    }

    loadChurches();
  }, [isSignedIn, userId, getToken]);

  const selectChurch = (church: Church) => {
    setSelectedChurch(church);
    setChurchId(church.id);
  };

  return (
    <ChurchContext.Provider value={{ churches, selectedChurch, selectChurch, loading, error }}>
      {children}
    </ChurchContext.Provider>
  );
}