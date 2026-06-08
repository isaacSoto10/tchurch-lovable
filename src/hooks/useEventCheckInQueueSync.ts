import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/hooks/useAppAuth";
import { flushQueuedEventCheckIns } from "@/lib/eventCheckInQueue";

export function useEventCheckInQueueSync() {
  const { getToken, isSignedIn } = useAppAuth();
  const { toast } = useToast();
  const flushingRef = useRef(false);

  const flushQueue = useCallback(
    async (notify = false) => {
      if (!isSignedIn || flushingRef.current) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;

      flushingRef.current = true;
      try {
        const token = await getToken();
        const result = await flushQueuedEventCheckIns(token);
        if (notify && result.sent > 0) {
          toast({ title: "Check-ins sincronizados", description: `${result.sent} check-in(s) enviados.` });
        }
      } catch (error) {
        console.warn("[Events] No se pudo sincronizar la cola de check-ins:", error);
      } finally {
        flushingRef.current = false;
      }
    },
    [getToken, isSignedIn, toast]
  );

  useEffect(() => {
    if (!isSignedIn) return undefined;

    void flushQueue(false);
    const handleOnline = () => void flushQueue(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void flushQueue(false);
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushQueue, isSignedIn]);
}
