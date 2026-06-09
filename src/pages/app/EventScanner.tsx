import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, RefreshCw, ScanLine, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useAppAuth } from "@/hooks/useAppAuth";
import { fetchEvent } from "@/lib/api";
import {
  flushQueuedEventCheckIns,
  getQueuedEventCheckInCount,
  submitEventCheckInOnlineFirst,
} from "@/lib/eventCheckInQueue";
import { scannerErrorNotice } from "@/lib/barcodeScannerErrors";
import { extractSignedEventQrValue } from "@/lib/eventQr";
import { useChurch } from "@/providers/ChurchProvider";
import type { ChurchEvent } from "@/types/events";

export default function EventScanner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedChurch } = useChurch();
  const { getToken } = useAppAuth();
  const { toast } = useToast();

  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [queueFlushing, setQueueFlushing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const canManage = selectedChurch?.role === "ADMIN" || selectedChurch?.role === "PLANNER";

  const loadQueueCount = useCallback(async () => {
    if (!id) return;
    try {
      setPendingCount(await getQueuedEventCheckInCount(id));
    } catch (error) {
      console.warn("Could not read check-in queue:", error);
    }
  }, [id]);

  const loadEvent = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setEvent(await fetchEvent(id));
    } catch (error) {
      console.error("Failed to load scanner event:", error);
      toast({ title: "No se pudo cargar el evento", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  const flushQueue = useCallback(
    async (notify = false) => {
      if (!id || queueFlushing) return;
      setQueueFlushing(true);
      try {
        const token = await getToken();
        const result = await flushQueuedEventCheckIns(token, id);
        setPendingCount(result.pending);
        if (result.sent > 0) {
          setLastMessage(`${result.sent} check-in(s) sincronizados.`);
          if (notify) toast({ title: "Cola sincronizada", description: `${result.sent} check-in(s) enviados.` });
        }
      } catch (error) {
        console.error("Failed to flush scanner queue:", error);
        if (notify) toast({ title: "No se pudo sincronizar la cola", variant: "destructive" });
      } finally {
        setQueueFlushing(false);
      }
    },
    [getToken, id, queueFlushing, toast]
  );

  useEffect(() => {
    loadEvent();
    loadQueueCount();
  }, [loadEvent, loadQueueCount]);

  useEffect(() => {
    const handleOnline = () => flushQueue(true);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [flushQueue]);

  async function submitCode(code: string, source: "camera" | "manual") {
    if (!id) return false;
    const qrCode = extractSignedEventQrValue(code);
    if (!qrCode) {
      toast({
        title: "QR inválido",
        description: "Este scanner solo acepta códigos personales firmados de Tchurch.",
        variant: "destructive",
      });
      return false;
    }

    try {
      const token = await getToken();
      const result = await submitEventCheckInOnlineFirst(
        id,
        "scan",
        {
          qrCode,
          scannedAt: new Date().toISOString(),
          source,
        },
        token
      );

      if (result.queued) {
        setLastMessage("Check-in guardado offline. Se sincronizará automáticamente.");
        toast({ title: "Guardado offline", description: "Se enviará cuando vuelva la conexión." });
      } else {
        setLastMessage(result.response?.message || "Check-in registrado.");
        toast({ title: "Check-in registrado" });
      }

      await loadQueueCount();
      return true;
    } catch (error) {
      console.error("Event QR check-in failed:", error);
      toast({
        title: "No se pudo registrar el check-in",
        description: error instanceof Error ? error.message : "Intenta otra vez.",
        variant: "destructive",
      });
      return false;
    }
  }

  async function startScanner() {
    if (!canManage) return;
    setScanning(true);
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "Alinea el QR personal dentro del recuadro.",
        scanButton: true,
        scanText: "Escanear",
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
        web: {
          showCameraSelection: true,
          scannerFPS: 10,
        },
      });
      await submitCode(result.ScanResult || "", "camera");
    } catch (error) {
      console.error("QR scan failed:", error);
      const notice = scannerErrorNotice(error);
      if (notice) toast(notice);
    } finally {
      setScanning(false);
    }
  }

  async function submitManualCode(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setManualSubmitting(true);
    try {
      const submitted = await submitCode(manualCode, "manual");
      if (submitted) setManualCode("");
    } finally {
      setManualSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(id ? `/app/events/${id}` : "/app/events")} className="-ml-2 rounded-lg p-2 hover:bg-zinc-100">
            <ArrowLeft className="h-5 w-5 text-zinc-600" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-zinc-900">Scanner</h1>
            <p className="truncate text-xs text-zinc-500">{event?.title || "Check-in del evento"}</p>
          </div>
          {pendingCount > 0 && <Badge variant="outline">{pendingCount} offline</Badge>}
        </div>
      </div>

      <main className="space-y-4 p-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !canManage ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Acceso restringido</AlertTitle>
            <AlertDescription>Necesitas rol de administrador o planner para registrar check-ins.</AlertDescription>
          </Alert>
        ) : (
          <>
            {pendingCount > 0 && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                <WifiOff className="h-4 w-4" />
                <AlertTitle>Cola offline activa</AlertTitle>
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{pendingCount} check-in(s) pendientes.</span>
                  <Button size="sm" variant="outline" onClick={() => flushQueue(true)} disabled={queueFlushing}>
                    {queueFlushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sincronizar
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {lastMessage && (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Última lectura</AlertTitle>
                <AlertDescription>{lastMessage}</AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ScanLine className="h-4 w-4" />
                  Escanear QR personal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed bg-white">
                  <ScanLine className="h-20 w-20 text-zinc-300" />
                </div>
                <Button className="h-12 w-full" onClick={startScanner} disabled={scanning}>
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                  {scanning ? "Escaneando..." : "Abrir cámara"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Código manual</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitManualCode} className="space-y-3">
                  <Textarea
                    value={manualCode}
                    onChange={(event) => setManualCode(event.target.value)}
                    placeholder="Pega aquí el valor del QR si la cámara no puede leerlo."
                    rows={4}
                  />
                  <Button type="submit" variant="outline" className="w-full" disabled={manualSubmitting || !manualCode.trim()}>
                    {manualSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Registrar código
                  </Button>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
