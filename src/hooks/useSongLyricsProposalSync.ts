import { useCallback, useEffect, useRef } from "react";

import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useChurch } from "@/providers/ChurchProvider";
import {
  flushSongLyricsProposalOutbox,
  purgeSongLyricsProposalOutbox,
  songLyricsProposalOutboxScope,
} from "@/lib/songLyricsProposalOutbox";

export function useSongLyricsProposalSync() {
  const { getToken, isLoaded, isSignedIn, userId } = useAppAuth();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();
  const flushingRef = useRef(false);

  const flush = useCallback(async (notify = false) => {
    if (!isSignedIn || !userId || !selectedChurch?.id || flushingRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    flushingRef.current = true;
    try {
      const [scope, token] = await Promise.all([
        songLyricsProposalOutboxScope(selectedChurch.id, userId),
        getToken(),
      ]);
      const result = await flushSongLyricsProposalOutbox(scope, token);
      if (notify && result.sent > 0) {
        toast({ title: "Propuestas sincronizadas", description: `${result.sent} cambio(s) de letras enviado(s).` });
      }
      if (notify && result.needsReview > 0) {
        toast({
          title: "Hay letras para revisar",
          description: "La versión original cambió. Tu propuesta sigue guardada en este dispositivo.",
          variant: "destructive",
        });
      }
    } catch {
      // The outbox remains intact and will retry on the next foreground/online event.
    } finally {
      flushingRef.current = false;
    }
  }, [getToken, isSignedIn, selectedChurch?.id, toast, userId]);

  useEffect(() => {
    if (!isLoaded || isSignedIn) return undefined;
    void purgeSongLyricsProposalOutbox().catch(() => undefined);
    return undefined;
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !userId || !selectedChurch?.id) return undefined;
    void flush(false);
    const online = () => void flush(true);
    const visible = () => {
      if (document.visibilityState === "visible") void flush(false);
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [flush, isSignedIn, selectedChurch?.id, userId]);
}
