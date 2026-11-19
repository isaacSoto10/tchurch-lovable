import { GivingControls, type RecurringGift } from "@/components/GivingControls";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import QRCode from "qrcode";
import { Copy, Download, FileText, Heart, Loader2, ExternalLink, QrCode, Receipt, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/useApi";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";
import { API_BASE } from "@/lib/apiConfig";
import { getChurchId } from "@/lib/api";

type Fund = {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
};

type Donation = {
  id: string;
  fundName?: string | null;
  amountCents: number;
  status: string;
  frequency: string;
  receiptUrl?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
};

type Transaction = Donation & {
  donorName?: string | null;
  donorEmail?: string | null;
  manualMethod?: string | null;
  paymentProvider?: string | null;
};

type GivingMeResponse = {
  recurring?: RecurringGift[];
  donations?: Donation[];
  attempts?: Donation[];
  summary?: {
    totalCents?: number;
    gifts?: number;
  };
};

type GivingConfig = {
  mercadoPagoUrl?: string | null;
  enabled?: boolean;
  connected?: boolean;
  provider?: "tchurch_stripe" | "church_center" | "external_url";
  externalUrl?: string | null;
  externalLabel?: string | null;
  externalInstructions?: string | null;
};

type GivingSummary = {
  totalCents: number;
  gifts: number;
};

const confirmedStatus = "succeeded";

const frequencyLabels: Record<string, string> = {
  one_time: "Una vez",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
};

const statusLabels: Record<string, string> = {
  succeeded: "Confirmada",
  pending: "Pendiente",
  pending_review: "En revisión",
  failed: "Fallida",
  expired: "Expirada",
  canceled: "Cancelada",
  rejected: "Rechazada",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
}

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "donaciones";
}

function isSucceeded(status?: string | null) {
  return String(status || "").toLowerCase() === confirmedStatus;
}

function donationTime(donation: Donation) {
  const time = new Date(donation.paidAt || donation.createdAt || Date.now()).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatDonationDate(donation: Donation) {
  return new Date(donation.paidAt || donation.createdAt || Date.now()).toLocaleDateString("es-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pdfFileNameFromHeaders(headers: Headers, fallback: string) {
  const disposition = headers.get("content-disposition") || "";
  const named = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
  const raw = named?.[1] || named?.[2];
  if (!raw) return fallback;

  try {
    return decodeURIComponent(raw).replace(/[^\w.-]+/g, "-") || fallback;
  } catch {
    return raw.replace(/[^\w.-]+/g, "-") || fallback;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export default function Giving() {
  const { selectedChurch, loading } = useChurch();
  if (loading && !selectedChurch) return <div role="status" className="p-5">Cargando iglesia…</div>;
  if (!selectedChurch) return <div className="p-5">Selecciona una iglesia para dar.</div>;
  return <ChurchGiving key={selectedChurch.id} />;
}

function ChurchGiving() {
  const { fetchApi } = useApi();
  const { getToken } = useAppAuth();
  const { toast } = useToast();
  const { selectedChurch } = useChurch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [givingConfig, setGivingConfig] = useState<GivingConfig>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recurring, setRecurring] = useState<RecurringGift[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [paymentAttempts, setPaymentAttempts] = useState<Donation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState({ totalCents: 0, gifts: 0 });
  const [personalSummary, setPersonalSummary] = useState<GivingSummary>({ totalCents: 0, gifts: 0 });
  const [canViewFinance, setCanViewFinance] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [form, setForm] = useState({
    amount: "50",
    fundId: "",
    frequency: "one_time",
    donorName: "",
    donorEmail: "",
    anonymous: false,
    note: "",
  });

  const isAdmin = selectedChurch?.role === "ADMIN";
  const externalGivingUrl = givingConfig.externalUrl?.trim() || "";
  const usesExternalGiving = Boolean(externalGivingUrl);
  const externalGivingLabel = givingConfig.externalLabel || "Church Center";
  const publicGivingUrl = selectedChurch?.slug && (givingConfig.mercadoPagoUrl || !externalGivingUrl)
    ? `https://www.tchurchapp.com/give/${selectedChurch.slug}` : externalGivingUrl;
  const qrFileName = `tchurch-${sanitizeFileName(selectedChurch?.slug || selectedChurch?.name || "donaciones")}-qr-donaciones.png`;
  const annualStatementYear = new Date().getFullYear();
  const confirmedDonations = donations
    .filter((donation) => isSucceeded(donation.status))
    .sort((a, b) => donationTime(b) - donationTime(a));
  const recentAttempts = [...donations.filter((donation) => !isSucceeded(donation.status)), ...paymentAttempts]
    .sort((a, b) => donationTime(b) - donationTime(a))
    .slice(0, 8);

  function getCheckoutReturnUrl(status: "success" | "canceled") {
    if (Capacitor.isNativePlatform()) {
      return `tchurchapp://tchurchapp.com/#/app/giving?${status}=true`;
    }

    return `${window.location.origin}/app/giving?${status}=true`;
  }

  async function openCheckoutUrl(url: string) {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url });
      return;
    }

    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = url;
    }
  }

  async function copyPublicGivingLink() {
    if (!publicGivingUrl) return;

    try {
      await navigator.clipboard.writeText(publicGivingUrl);
      toast({ title: "Link copiado", description: "Ya puedes compartirlo con invitados y miembros." });
    } catch {
      toast({ title: "No se pudo copiar", description: publicGivingUrl });
    }
  }

  async function downloadPublicGivingQr() {
    if (!qrDataUrl) {
      toast({ title: "QR no disponible", description: "Espera unos segundos e intenta otra vez." });
      return;
    }

    try {
      if (Capacitor.isNativePlatform()) {
        const base64 = qrDataUrl.includes(",") ? qrDataUrl.split(",")[1] : qrDataUrl;
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        const saved = await Filesystem.writeFile({
          path: qrFileName,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });

        await Share.share({
          title: "QR para donaciones",
          text: `Donaciones para ${selectedChurch?.name || "la iglesia"}`,
          url: saved.uri,
          dialogTitle: "Guardar o compartir QR",
        });
        return;
      }

      const link = document.createElement("a");
      link.href = qrDataUrl;
      link.download = qrFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast({ title: "QR descargado", description: "El archivo PNG ya está listo para imprimir o compartir." });
    } catch (error) {
      toast({
        title: "No se pudo descargar el QR",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function downloadAuthenticatedPdf(path: string, fallbackFileName: string, label: string) {
    setDownloadingPdf(label);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        Accept: "application/pdf",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const churchId = getChurchId();
      if (churchId) {
        headers["x-church-id"] = churchId;
      }

      const response = await fetch(`${API_BASE}${path}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        let message = response.status === 401 || response.status === 403
          ? "No tienes permiso para ver este recibo."
          : "No se pudo descargar el PDF.";

        const text = await response.text().catch(() => "");
        if (text) {
          try {
            const data = JSON.parse(text) as { error?: string; message?: string };
            message = String(data.error || data.message || message);
          } catch {
            message = text;
          }
        }

        throw new Error(message);
      }

      const fileName = pdfFileNameFromHeaders(response.headers, fallbackFileName);
      const blob = await response.blob();

      if (Capacitor.isNativePlatform()) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        const saved = await Filesystem.writeFile({
          path: fileName,
          data: arrayBufferToBase64(await blob.arrayBuffer()),
          directory: Directory.Cache,
          recursive: true,
        });

        await Share.share({
          title: "PDF de donación",
          text: "Recibo de donación de Tchurch",
          url: saved.uri,
          dialogTitle: "Abrir, guardar o compartir PDF",
        });
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      toast({
        title: "No se pudo descargar el PDF",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDownloadingPdf(null);
    }
  }

  function downloadReceipt(donation: Donation) {
    return downloadAuthenticatedPdf(
      `/giving/transactions/${donation.id}/invoice`,
      `tchurch-recibo-${donation.id}.pdf`,
      `receipt:${donation.id}`,
    );
  }

  function downloadAnnualStatement() {
    return downloadAuthenticatedPdf(
      `/giving/annual-statement?year=${annualStatementYear}`,
      `tchurch-reporte-anual-${annualStatementYear}.pdf`,
      `annual:${annualStatementYear}`,
    );
  }

  const loadGiving = useCallback(async () => {
    setLoading(true);
    try {
      const [fundData, meData] = await Promise.all([
        fetchApi<{ funds: Fund[]; giving?: GivingConfig }>("/giving/funds", {cache: "no-store", churchId: selectedChurch?.id}),
        fetchApi<GivingMeResponse>("/giving/me", {cache: "no-store", churchId: selectedChurch?.id}).catch(() => ({ recurring: [], donations: [], attempts: [], summary: { totalCents: 0, gifts: 0 } })),
      ]);
      const activeFunds = (fundData.funds || []).filter((fund) => fund.active);
      const confirmed = (meData.donations || []).filter((donation) => isSucceeded(donation.status));
      setFunds(activeFunds);
      setGivingConfig(fundData.giving || {});
      setEnabled(Boolean(fundData.giving?.enabled));
      setConnected(Boolean(fundData.giving?.connected));
      setRecurring(meData.recurring || []);
      setDonations(meData.donations || []);
      setPaymentAttempts(meData.attempts || []);
      setPersonalSummary({
        totalCents: Number(meData.summary?.totalCents ?? confirmed.reduce((total, donation) => total + Number(donation.amountCents || 0), 0)),
        gifts: Number(meData.summary?.gifts ?? confirmed.length),
      });
      setForm((current) => ({ ...current, fundId: current.fundId || activeFunds[0]?.id || "" }));

      try {
        const transactionData = await fetchApi<{ transactions: Transaction[]; summary?: { totalCents: number; gifts: number } }>("/giving/transactions?limit=20");
        setCanViewFinance(true);
        setTransactions(transactionData.transactions || []);
        setSummary(transactionData.summary || { totalCents: 0, gifts: 0 });
      } catch {
        setCanViewFinance(false);
      }
    } catch (error) {
      toast({ title: "No se pudo cargar donaciones", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchApi, selectedChurch?.id, toast]);

  useEffect(() => {
    loadGiving();
  }, [loadGiving]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    async function generateQr() {
      try {
        const dataUrl = await QRCode.toDataURL(publicGivingUrl, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: Capacitor.isNativePlatform() ? 512 : 768,
          color: {
            dark: "#111827",
            light: "#ffffff",
          },
        });

        if (active) {
          setQrDataUrl(dataUrl);
        }
      } catch (error) {
        if (active) {
          setQrDataUrl("");
          toast({
            title: "No se pudo generar el QR",
            description: error instanceof Error ? error.message : undefined,
            variant: "destructive",
          });
        }
      } finally {
        if (active) {
          setQrLoading(false);
        }
      }
    }

    if (!publicGivingUrl) {
      setQrDataUrl("");
      setQrLoading(false);
      return undefined;
    }

    setQrDataUrl("");
    setQrLoading(true);

    if (!loading) {
      timer = window.setTimeout(() => {
        void generateQr();
      }, Capacitor.isNativePlatform() ? 180 : 0);
    }

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [loading, publicGivingUrl, toast]);

  useEffect(() => {
    const success = searchParams.get("success") === "true";
    const canceled = searchParams.get("canceled") === "true";

    if (!success && !canceled) return;

    if (success) {
      toast({ title: "Gracias por tu generosidad", description: "Estamos actualizando tu historial de donaciones." });
    } else {
      toast({ title: "Pago cancelado", description: "No registramos ninguna donación completada." });
    }

    loadGiving();
    setSearchParams({}, { replace: true });
  }, [loadGiving, searchParams, setSearchParams, toast]);

  useEffect(() => {
    const refreshAfterCheckout = () => {
      if (document.visibilityState !== "hidden") {
        loadGiving();
      }
    };

    window.addEventListener("focus", refreshAfterCheckout);
    document.addEventListener("visibilitychange", refreshAfterCheckout);

    return () => {
      window.removeEventListener("focus", refreshAfterCheckout);
      document.removeEventListener("visibilitychange", refreshAfterCheckout);
    };
  }, [loadGiving]);

  async function startCheckout() {
    if (!form.fundId) {
      toast({ title: "Elige un fondo", variant: "destructive" });
      return;
    }

    const amountCents = Math.round(Number(form.amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 100) {
      toast({ title: "Cantidad inválida", description: "Ingresa al menos $1.00.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const data = await fetchApi<{ url: string }>("/giving/checkout", {
        method: "POST",
        body: JSON.stringify({
          fundId: form.fundId,
          amountCents,
          frequency: form.frequency,
          donorName: form.donorName,
          donorEmail: form.donorEmail,
          anonymous: form.anonymous,
          note: form.note,
          returnUrl: getCheckoutReturnUrl("success"),
          cancelUrl: getCheckoutReturnUrl("canceled"),
        }),
      });
      await openCheckoutUrl(data.url);
    } catch (error) {
      toast({ title: "No se pudo abrir el pago", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-5">
      <div className="app-card-soft p-4">
        <p className="mobile-section-title">Generosidad</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">Dar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Diezmos, ofrendas y donaciones para {selectedChurch?.name || "tu iglesia"}.
        </p>
      </div>

      {publicGivingUrl ? (
        <Card className="app-card">
          <CardHeader>
            <CardTitle>Link público y QR para donar</CardTitle>
            <CardDescription>
              {usesExternalGiving
                ? `Este link abre ${externalGivingLabel} para completar la donación.`
                : "Compártelo con visitantes, familiares o cualquier persona que quiera apoyar a la iglesia."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-[176px_1fr] sm:items-center">
              <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-2xl border bg-white p-3 shadow-sm sm:mx-0">
                {qrLoading ? (
                  <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                ) : qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR del link público para donar" className="h-full w-full" />
                ) : (
                  <QrCode className="h-12 w-12 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-3">
                <div className="break-all rounded-2xl bg-muted px-4 py-3 font-mono text-sm text-muted-foreground">
                  {publicGivingUrl}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={copyPublicGivingLink}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar
                  </Button>
                  <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={() => void openCheckoutUrl(publicGivingUrl)}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir
                  </Button>
                  <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={downloadPublicGivingQr} disabled={qrLoading || !qrDataUrl}>
                    <Download className="mr-2 h-4 w-4" />
                    Descargar QR
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <GivingControls key={selectedChurch?.id + (givingConfig.mercadoPagoUrl || "")}
        url={givingConfig.mercadoPagoUrl || ""} gifts={recurring} admin={isAdmin}
        request={(path, options) => fetchApi(path, { ...options, churchId: selectedChurch!.id })} reload={loadGiving} openPaymentLink={openCheckoutUrl} />
      {usesExternalGiving ? (
        <Card className="app-card border-emerald-200 bg-emerald-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-950">
              <ShieldCheck className="h-5 w-5" />
              Donaciones en {externalGivingLabel}
            </CardTitle>
            <CardDescription className="text-emerald-900">
              {givingConfig.externalInstructions || `Grace en Espanol recibe diezmos y ofrendas a traves de ${externalGivingLabel}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" className="h-12 w-full rounded-2xl text-base font-bold" onClick={() => void openCheckoutUrl(externalGivingUrl)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Abrir {externalGivingLabel}
            </Button>
            <p className="text-xs leading-5 text-emerald-900">
              Los recibos, metodos de pago e historial de donaciones se manejan directamente en {externalGivingLabel}.
            </p>
          </CardContent>
        </Card>
      ) : (!enabled || !connected) && givingConfig.mercadoPagoUrl ? null : !enabled || !connected ? (
        <Card className="app-card border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <ShieldCheck className="h-5 w-5" />
              Donaciones no configuradas
            </CardTitle>
            <CardDescription className="text-amber-800">
              Un administrador debe conectar Stripe Connect desde el website antes de recibir donaciones.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="app-card overflow-hidden">
          <CardHeader className="bg-gradient-to-br from-primary/10 to-emerald-50">
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-primary" />
              Nueva donación
            </CardTitle>
            <CardDescription>El pago se abre en una ventana segura de Stripe fuera del app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid grid-cols-3 gap-2">
              {["25", "50", "100"].map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant={form.amount === amount ? "default" : "outline"}
                  className="h-12 rounded-2xl"
                  onClick={() => setForm((current) => ({ ...current, amount }))}
                >
                  ${amount}
                </Button>
              ))}
            </div>
            <Input
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              inputMode="decimal"
              className="h-12 rounded-2xl text-lg font-bold"
              placeholder="Cantidad"
            />
            <Select value={form.fundId} onValueChange={(fundId) => setForm((current) => ({ ...current, fundId }))}>
              <SelectTrigger className="h-12 rounded-2xl">
                <SelectValue placeholder="Fondo" />
              </SelectTrigger>
              <SelectContent>
                {funds.map((fund) => (
                  <SelectItem key={fund.id} value={fund.id}>{fund.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.frequency} onValueChange={(frequency) => setForm((current) => ({ ...current, frequency }))}>
              <SelectTrigger className="h-12 rounded-2xl">
                <SelectValue placeholder="Frecuencia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_time">Una vez</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="biweekly">Quincenal</SelectItem>
                <SelectItem value="monthly">Mensual</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={form.donorName} onChange={(event) => setForm((current) => ({ ...current, donorName: event.target.value }))} className="h-12 rounded-2xl" placeholder="Nombre" />
              <Input value={form.donorEmail} onChange={(event) => setForm((current) => ({ ...current, donorEmail: event.target.value }))} className="h-12 rounded-2xl" placeholder="Correo para recibo" />
            </div>
            <Textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className="min-h-24 rounded-2xl" placeholder="Nota opcional" />
            <div className="flex items-center justify-between rounded-2xl border p-3">
              <span className="text-sm font-medium">Dar anónimamente</span>
              <Switch checked={form.anonymous} onCheckedChange={(anonymous) => setForm((current) => ({ ...current, anonymous }))} />
            </div>
            <Button onClick={startCheckout} disabled={submitting} className="h-12 w-full rounded-2xl text-base font-bold">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              Continuar a pago seguro
            </Button>
          </CardContent>
        </Card>
      )}

      {!usesExternalGiving && <Card className="app-card">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Mi historial
              </CardTitle>
              <CardDescription>
                {personalSummary.gifts} donaciones confirmadas · {money(personalSummary.totalCents)} para taxes.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-2xl"
              onClick={() => void downloadAnnualStatement()}
              disabled={downloadingPdf === `annual:${annualStatementYear}`}
            >
              {downloadingPdf === `annual:${annualStatementYear}` ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Reporte anual
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {confirmedDonations.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Todavía no tienes donaciones registradas.</p>
          ) : (
            <div className="divide-y">
              {confirmedDonations.slice(0, 8).map((donation) => (
                <div key={donation.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">{donation.fundName || "Fondo"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDonationDate(donation)} · {frequencyLabels[donation.frequency] || donation.frequency}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right">
                      <p className="font-black">{money(donation.amountCents)}</p>
                      <Badge variant="secondary">Confirmada</Badge>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl"
                      onClick={() => void downloadReceipt(donation)}
                      disabled={downloadingPdf === `receipt:${donation.id}`}
                    >
                      {downloadingPdf === `receipt:${donation.id}` ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Recibo PDF
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>}

      {!usesExternalGiving && recentAttempts.length > 0 && (
        <Card className="app-card">
          <CardHeader>
            <CardTitle>Intentos recientes</CardTitle>
            <CardDescription>
              Pagos pendientes, expirados, cancelados o en revisión. Estos no cuentan como donaciones confirmadas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {recentAttempts.map((attempt) => (
                <div key={`${attempt.id}-${attempt.status}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{attempt.fundName || "Fondo"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDonationDate(attempt)} · {frequencyLabels[attempt.frequency] || attempt.frequency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black">{money(attempt.amountCents)}</p>
                    <Badge variant="outline">{statusLabels[attempt.status] || attempt.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!usesExternalGiving && (canViewFinance || isAdmin) && (
        <Card className="app-card">
          <CardHeader>
            <CardTitle>Finanzas</CardTitle>
            <CardDescription>{money(summary.totalCents)} confirmados · {summary.gifts} donaciones</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {transactions.slice(0, 8).map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{transaction.donorName || transaction.donorEmail || "Donante"} · {transaction.fundName}</p>
                    <p className="text-xs text-muted-foreground">{transaction.manualMethod || transaction.paymentProvider} · {transaction.status}</p>
                  </div>
                  <p className="font-black">{money(transaction.amountCents)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
