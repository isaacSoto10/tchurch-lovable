import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAppAuth } from "@/hooks/useAppAuth";
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
  switchChurch: (church: Church) => void;
  loading: boolean;
  error: string | null;
}

const ChurchContext = createContext<ChurchContextType | null>(null);

function normalizeChurch(church: Church): Church {
  return {
    ...church,
    role: String(church.role || "MEMBER").toUpperCase(),
  };
}

export function useChurch() {
  const ctx = useContext(ChurchContext);
  if (!ctx) throw new Error("useChurch must be used within ChurchProvider");
  return ctx;
}

export function ChurchProvider({ children }: { children: ReactNode }) {
  const { getToken, userId, isSignedIn } = useAppAuth();
  const [churches, setChurches] = useState<Church[]>([]);
  const [selectedChurch, setSelectedChurch] = useState<Church | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadChurches() {
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

        const userChurches = (await fetchUserChurches<Church>(token)).map(normalizeChurch);

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
        console.error("[ChurchProvider] Error loading churches:", e);
        setError(e instanceof Error ? e.message : "Failed to load churches");
      } finally {
        setLoading(false);
      }
    }

    loadChurches();
  }, [isSignedIn, userId, getToken]);

  const selectChurch = (church: Church) => {
    const normalizedChurch = normalizeChurch(church);
    setSelectedChurch(normalizedChurch);
    setChurchId(normalizedChurch.id);
  };

  return (
    <ChurchContext.Provider value={{ churches, selectedChurch, selectChurch, switchChurch: selectChurch, loading, error }}>
      {children}
    </ChurchContext.Provider>
  );
}
