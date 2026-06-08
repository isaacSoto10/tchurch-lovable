import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Loader2, QrCode, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchEvent, fetchMyEventQr } from "@/lib/api";
import { createEventQrDataUrl } from "@/lib/eventQr";
import type { ChurchEvent, EventQrResponse } from "@/types/events";
import { getEventTypeLabel } from "@/types/events";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" });
}

export default function EventQr() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [qr, setQr] = useState<EventQrResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [eventData, qrData] = await Promise.all([fetchEvent(id).catch(() => null), fetchMyEventQr(id)]);
      const dataUrl = await createEventQrDataUrl(qrData, id);
      setEvent(eventData);
      setQr(qrData);
      setQrDataUrl(dataUrl);
      if (!dataUrl) setError("El servidor no regresó un QR válido para mostrar.");
    } catch (loadError) {
      console.error("Failed to load event QR:", loadError);
      setError("No se pudo cargar tu QR personal para este evento.");
      setQr(null);
      setQrDataUrl(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/95">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(id ? `/app/events/${id}` : "/app/events")} className="-ml-2 rounded-lg p-2 hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold">Mi QR</h1>
            <p className="truncate text-xs text-white/60">{event?.title || "Check-in del evento"}</p>
          </div>
          <Button variant="secondary" size="icon" onClick={loadPage} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <main className="mx-auto flex min-h-[calc(100svh-65px)] max-w-md flex-col justify-center gap-5 p-4">
        {event && (
          <div className="space-y-3 text-center">
            <Badge variant="secondary" className="mx-auto w-fit">{getEventTypeLabel(event.type)}</Badge>
            <h2 className="text-2xl font-bold leading-tight">{event.title}</h2>
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-white/70">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {formatDate(event.date)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {formatTime(event.date)}
              </span>
            </div>
          </div>
        )}

        <Card className="border-white/10 bg-white text-zinc-950">
          <CardContent className="p-5">
            <div className="flex aspect-square items-center justify-center rounded-lg border border-zinc-200 bg-white p-4">
              {loading ? (
                <Loader2 className="h-10 w-10 animate-spin text-zinc-400" />
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt="QR personal para check-in" className="h-full w-full object-contain" />
              ) : (
                <QrCode className="h-20 w-20 text-zinc-300" />
              )}
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert className="border-red-400/30 bg-red-500/10 text-red-50">
            <AlertTitle>QR no disponible</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {qr?.expiresAt && (
          <p className="text-center text-xs text-white/60">Expira {new Date(qr.expiresAt).toLocaleString("es-US")}</p>
        )}
      </main>
    </div>
  );
}
