import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { fetchUserChurches, getChurchId, setChurchId, USE_MOCK } from "@/lib/api";
import { MOCK_CHURCHES } from "@/lib/mock-data";

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
      if (USE_MOCK) {
        // Mock mode: use mock data directly, no auth needed
        setChurches(MOCK_CHURCHES as Church[]);
        const savedId = getChurchId();
        const church = savedId
          ? (MOCK_CHURCHES as Church[]).find(c => c.id === savedId)
          : MOCK_CHURCHES[0];
        if (church) {
          setSelectedChurch(church as Church);
          setChurchId((church as Church).id);
        }
        setLoading(false);
        return;
      }

      // Production mode: fetch from API
      if (!isSignedIn || !userId) {
        setLoading(false);
        return;
      }

      try {
        const token = await getToken();
        if (!token) {
          setError("Not authenticated - no token");
          setLoading(false);
          return;
        }

        const userChurches = await fetchUserChurches(token);
        setChurches(userChurches);

        const savedChurchId = getChurchId();
        if (savedChurchId) {
          const saved = userChurches.find((c: Church) => c.id === savedChurchId);
          if (saved) {
            setSelectedChurch(saved);
          } else if (userChurches.length > 0) {
            setSelectedChurch(userChurches[0]);
            setChurchId(userChurches[0].id);
          }
        } else if (userChurches.length > 0) {
          setSelectedChurch(userChurches[0]);
          setChurchId(userChurches[0].id);
        }
      } catch (e) {
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
