import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Copy, Heart, Loader2, ExternalLink, Receipt, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";

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
  paidAt?: string | null;
  createdAt?: string | null;
};

type Transaction = Donation & {
  donorName?: string | null;
  donorEmail?: string | null;
  manualMethod?: string | null;
  paymentProvider?: string | null;
};

const frequencyLabels: Record<string, string> = {
  one_time: "Una vez",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
}

export default function Giving() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const { selectedChurch } = useChurch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState({ totalCents: 0, gifts: 0 });
  const [canViewFinance, setCanViewFinance] = useState(false);
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
  const publicGivingUrl = selectedChurch?.slug ? `https://www.tchurchapp.com/give/${selectedChurch.slug}` : "";

  function getCheckoutReturnUrl(status: "success" | "canceled") {
    if (Capacitor.isNativePlatform()) {
      return `tchurchapp://tchurchapp.com/#/app/giving?${status}=true`;
    }

    return `${window.location.origin}/app/giving?${status}=true`;
  }

  function openCheckoutUrl(url: string) {
    if (Capacitor.isNativePlatform()) {
      window.open(url, "_system", "noopener,noreferrer");
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

  const loadGiving = useCallback(async () => {
    setLoading(true);
    try {
      const [fundData, meData] = await Promise.all([
        fetchApi<{ funds: Fund[]; giving?: { enabled?: boolean; connected?: boolean } }>("/giving/funds"),
        fetchApi<{ donations: Donation[] }>("/giving/me").catch(() => ({ donations: [] })),
      ]);
      const activeFunds = (fundData.funds || []).filter((fund) => fund.active);
      setFunds(activeFunds);
      setEnabled(Boolean(fundData.giving?.enabled));
      setConnected(Boolean(fundData.giving?.connected));
      setDonations(meData.donations || []);
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
  }, [fetchApi, toast]);

  useEffect(() => {
    loadGiving();
  }, [loadGiving]);

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
      openCheckoutUrl(data.url);
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
            <CardTitle>Link público para donar</CardTitle>
            <CardDescription>
              Compártelo con visitantes, familiares o cualquier persona que quiera apoyar a la iglesia.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-2xl bg-muted px-4 py-3 font-mono text-sm text-muted-foreground">
              {publicGivingUrl}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={copyPublicGivingLink}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </Button>
              <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={() => openCheckoutUrl(publicGivingUrl)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!enabled || !connected ? (
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

      <Card className="app-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Mi historial
          </CardTitle>
          <CardDescription>Donaciones registradas en esta iglesia.</CardDescription>
        </CardHeader>
        <CardContent>
          {donations.filter((donation) => ["succeeded", "paid", "confirmed"].includes(donation.status)).length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Todavía no tienes donaciones registradas.</p>
          ) : (
            <div className="divide-y">
              {donations
                .filter((donation) => ["succeeded", "paid", "confirmed"].includes(donation.status))
                .slice(0, 8)
                .map((donation) => (
                <div key={donation.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{donation.fundName || "Fondo"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(donation.paidAt || donation.createdAt || Date.now()).toLocaleDateString()} · {frequencyLabels[donation.frequency] || donation.frequency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black">{money(donation.amountCents)}</p>
                    <Badge variant={donation.status === "succeeded" ? "secondary" : "outline"}>{donation.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(canViewFinance || isAdmin) && (
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
