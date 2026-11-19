import { Capacitor } from "@capacitor/core";
import { useToast } from "@/components/ui/use-toast";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Loader2, QrCode, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchEvent } from "@/lib/api";
import { buildEventRegistrationUrl, createEventRegistrationQrDataUrl } from "@/lib/eventQr";
import type { ChurchEvent } from "@/types/events";
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
  const { toast } = useToast();
  const navigate = useNavigate();
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [registrationUrl, setRegistrationUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const eventData = await fetchEvent(id);
      setEvent(eventData);
      if (eventData.registrationEnabled === false) {
        setQrDataUrl(null);
        setRegistrationUrl(null);
        setError("El registro está apagado para este evento.");
        return;
      }

      const url = buildEventRegistrationUrl(eventData);
      const dataUrl = await createEventRegistrationQrDataUrl(eventData);
      setRegistrationUrl(url);
      setQrDataUrl(dataUrl);
      if (!dataUrl) setError("No se pudo generar un QR de registro válido.");
    } catch (loadError) {
      console.error("Failed to load event registration QR:", loadError);
      setError("No se pudo cargar el QR de registro para este evento.");
      setQrDataUrl(null);
      setRegistrationUrl(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  async function shareRegistration() {
    if (!registrationUrl) return;
    try {
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import("@capacitor/share");
        await Share.share({ title: event?.title, url: registrationUrl });
      } else {
        await navigator.share({ title: event?.title, url: registrationUrl });
      }
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || /cancel/i.test(error.message))) return;
      toast({ title: "No se pudo compartir el enlace", variant: "destructive" });
    }
  }

  async function copyRegistration() {
    if (!registrationUrl) return;
    try {
      await navigator.clipboard.writeText(registrationUrl);
      toast({ title: "Enlace copiado" });
    } catch {
      toast({ title: "No se pudo copiar el enlace", variant: "destructive" });
    }
  }

  async function savePng() {
    if (!qrDataUrl) return;
    const filename = `tchurch-evento-${id}.png`;
    try {
      if (Capacitor.isNativePlatform()) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
        const saved = await Filesystem.writeFile({ path: filename, data: qrDataUrl.split(",")[1], directory: Directory.Documents });
        await Share.share({ title: filename, files: [saved.uri], dialogTitle: "Guardar PNG" });
      } else {
        const link = document.createElement("a");
        link.href = qrDataUrl;
        link.download = filename;
        link.click();
      }
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || /cancel/i.test(error.message))) return;
      toast({ title: "No se pudo guardar el PNG", variant: "destructive" });
    }
  }

  return (
    <div className="rounded-xl bg-zinc-950 text-white">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/95">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(id ? `/app/events/${id}` : "/app/events")} className="-ml-2 rounded-lg p-2 hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold">QR de registro</h1>
            <p className="truncate text-xs text-white/60">{event?.title || "Registro del evento"}</p>
          </div>
          <Button variant="secondary" size="icon" onClick={loadPage} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5">
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

        <Card className="mx-auto w-full max-w-[17rem] border-white/10 bg-white text-zinc-950">
          <CardContent className="p-5">
            <div className="flex aspect-square items-center justify-center rounded-lg border border-zinc-200 bg-white p-4">
              {loading ? (
                <Loader2 className="h-10 w-10 animate-spin text-zinc-400" />
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt="QR de registro del evento" className="h-full w-full object-contain" />
              ) : (
                <QrCode className="h-20 w-20 text-zinc-300" />
              )}
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert className="border-red-400/30 bg-red-500/10 text-red-50">
            <AlertTitle>QR de registro no disponible</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && registrationUrl && qrDataUrl && (
          <div className="grid gap-2">
            {(Capacitor.isNativePlatform() || typeof navigator.share === "function") && <Button variant="secondary" onClick={shareRegistration}>Compartir registro</Button>}
            <Button variant="secondary" onClick={copyRegistration}>Copiar enlace</Button>
            <Button variant="secondary" onClick={savePng}>Descargar PNG</Button>
          </div>
        )}
        {registrationUrl && (
          <p className="break-all text-center text-xs text-white/60">{registrationUrl}</p>
        )}
      </main>
    </div>
  );
}
