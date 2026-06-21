import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAppAuth } from "@/hooks/useAppAuth";
import { fetchUserChurchSelection, getChurchId, setChurchId } from "@/lib/api";
import { logUserAction } from "@/lib/userActionLogger";

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

function recordChurchSelection(church: Church, source: string) {
  logUserAction("church.selected", {
    churchId: church.id,
    role: church.role,
    source,
  });
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

        const churchSelection = await fetchUserChurchSelection<Church>(token);
        const userChurches = churchSelection.churches.map(normalizeChurch);

        setChurches(userChurches);

        const savedChurchId = getChurchId();
        const serverSelectedChurchId = churchSelection.selectedChurchId;
        const preferredChurchId = serverSelectedChurchId || savedChurchId;

        if (preferredChurchId) {
          const preferred = userChurches.find((c: Church) => c.id === preferredChurchId);
          if (preferred) {
            setSelectedChurch(preferred);
            setChurchId(preferred.id);
            recordChurchSelection(preferred, serverSelectedChurchId ? "server_preference" : "saved_preference");
          } else if (userChurches.length > 0) {
            setSelectedChurch(userChurches[0]);
            setChurchId(userChurches[0].id);
            recordChurchSelection(userChurches[0], "fallback_first_available");
          }
        } else if (userChurches.length > 0) {
          setSelectedChurch(userChurches[0]);
          setChurchId(userChurches[0].id);
          recordChurchSelection(userChurches[0], "first_available");
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
    if (selectedChurch?.id !== normalizedChurch.id) {
      recordChurchSelection(normalizedChurch, "manual");
    }
  };

  return (
    <ChurchContext.Provider value={{ churches, selectedChurch, selectChurch, switchChurch: selectChurch, loading, error }}>
      {children}
    </ChurchContext.Provider>
  );
}
