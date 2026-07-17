import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useAppAuth } from "@/hooks/useAppAuth";
import { fetchUserChurchSelection, getChurchId, setChurchId } from "@/lib/api";
import { logUserAction } from "@/lib/userActionLogger";
import { studioLANPrivacyCoordinator } from "@/lib/studioLANPrivacyCoordinator";

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
  selectChurch: (church: Church) => Promise<void>;
  switchChurch: (church: Church) => Promise<void>;
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
  const { getToken, userId, isLoaded, isSignedIn } = useAppAuth();
  const [churches, setChurches] = useState<Church[]>([]);
  const [selectedChurch, setSelectedChurch] = useState<Church | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activePrincipalRef = useRef(userId);
  const publishedPrincipalRef = useRef<string | null>(null);
  const selectionRevisionRef = useRef(0);

  if (activePrincipalRef.current !== userId) {
    activePrincipalRef.current = userId;
    selectionRevisionRef.current += 1;
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadChurches() {
      if (!isLoaded) return;
      if (!isSignedIn || !userId) {
        const revision = ++selectionRevisionRef.current;
        await studioLANPrivacyCoordinator.signedOut().catch(() => undefined);
        if (cancelled || selectionRevisionRef.current !== revision) return;
        setChurches([]);
        setSelectedChurch(null);
        setChurchId(null);
        publishedPrincipalRef.current = null;
        setLoading(false);
        return;
      }

      const principalId = userId;
      const revision = ++selectionRevisionRef.current;
      const transitionIsCurrent = () => !cancelled
        && activePrincipalRef.current === principalId
        && selectionRevisionRef.current === revision;

      if (publishedPrincipalRef.current && publishedPrincipalRef.current !== principalId) {
        setChurches([]);
        setSelectedChurch(null);
        setChurchId(null);
        publishedPrincipalRef.current = null;
      }

      try {
        await studioLANPrivacyCoordinator.principal(principalId);
        if (!transitionIsCurrent()) return;
        const token = await getToken();
        if (!transitionIsCurrent()) return;

        if (!token) {
          await studioLANPrivacyCoordinator.authorizationUnknown().catch(() => undefined);
          if (!transitionIsCurrent()) return;
          setError("Not authenticated - no token");
          setLoading(false);
          return;
        }

        const churchSelection = await fetchUserChurchSelection<Church>(token, {
          signal: controller.signal,
        });
        if (!transitionIsCurrent()) return;
        const userChurches = churchSelection.churches.map(normalizeChurch);

        if (userChurches.length === 0) {
          await studioLANPrivacyCoordinator.accessRevoked();
          if (!transitionIsCurrent()) return;
          setChurches([]);
          setSelectedChurch(null);
          setChurchId(null);
          publishedPrincipalRef.current = principalId;
          setError(null);
          return;
        }

        const savedChurchId = getChurchId();
        const serverSelectedChurchId = churchSelection.selectedChurchId;
        const preferredChurchId = serverSelectedChurchId || savedChurchId;
        const preferred = preferredChurchId
          ? userChurches.find((church) => church.id === preferredChurchId)
          : null;
        const nextChurch = preferred || userChurches[0];
        const source = preferred
          ? (serverSelectedChurchId ? "server_preference" : "saved_preference")
          : (preferredChurchId ? "fallback_first_available" : "first_available");

        await studioLANPrivacyCoordinator.authorize(principalId, nextChurch.id);
        if (!transitionIsCurrent()) return;
        setChurches(userChurches);
        setSelectedChurch(nextChurch);
        setChurchId(nextChurch.id);
        publishedPrincipalRef.current = principalId;
        setError(null);
        recordChurchSelection(nextChurch, source);
      } catch (e) {
        if (!transitionIsCurrent()) return;
        await studioLANPrivacyCoordinator.authorizationUnknown().catch(() => undefined);
        if (!transitionIsCurrent()) return;
        console.error("[ChurchProvider] Error loading churches:", e);
        setError(e instanceof Error ? e.message : "Failed to load churches");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadChurches();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isLoaded, isSignedIn, userId, getToken]);

  const selectChurch = async (church: Church) => {
    const normalizedChurch = normalizeChurch(church);
    const principalId = userId;
    const revision = ++selectionRevisionRef.current;
    if (!principalId) {
      await studioLANPrivacyCoordinator.authorizationUnknown();
      return;
    }
    try {
      await studioLANPrivacyCoordinator.authorize(principalId, normalizedChurch.id);
    } catch {
      if (activePrincipalRef.current === principalId && selectionRevisionRef.current === revision) {
        setError("No se pudo proteger el estado privado de Studio al cambiar de iglesia.");
      }
      return;
    }
    if (activePrincipalRef.current !== principalId || selectionRevisionRef.current !== revision) return;
    setSelectedChurch(normalizedChurch);
    setChurchId(normalizedChurch.id);
    publishedPrincipalRef.current = principalId;
    setError(null);
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
