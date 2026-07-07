import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import QRCode from "qrcode";
import {
  AlertCircle,
  BarChart3,
  Copy,
  CreditCard,
  DollarSign,
  Download,
  ExternalLink,
  Heart,
  Loader2,
  Plus,
  QrCode,
  Receipt,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import { useChurch } from "@/providers/ChurchProvider";

type MinistryFinanceProps = {
  ministryId: string;
  ministryName: string;
  canManage: boolean;
};

type Fund = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
  ministryId?: string | null;
  goalCents?: number | null;
};

type Donation = {
  id: string;
  fundId?: string | null;
  fundName?: string | null;
  amountCents: number;
  status: string;
  frequency?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
};

type FinanceTransaction = Donation & {
  donorName?: string | null;
  donorEmail?: string | null;
  manualMethod?: string | null;
  paymentProvider?: string | null;
  note?: string | null;
};

type MinistryExpense = {
  id: string;
  amountCents: number;
  category?: string | null;
  vendor?: string | null;
  note?: string | null;
  spentAt?: string | null;
  createdAt?: string | null;
};

type MinistryFinanceSummary = {
  receivedCents?: number;
  expenseCents?: number;
  budgetCents?: number;
  balanceCents?: number;
  goalCents?: number;
  giftCount?: number;
};

type MinistryFinanceSnapshot = {
  giving?: {
    enabled?: boolean;
    connected?: boolean;
    publicUrl?: string | null;
    provider?: "tchurch_stripe" | "church_center" | "external_url";
    externalUrl?: string | null;
    externalLabel?: string | null;
    externalInstructions?: string | null;
  } | null;
  fund?: Fund | null;
  funds?: Fund[];
  summary?: MinistryFinanceSummary | null;
  transactions?: FinanceTransaction[];
  expenses?: MinistryExpense[];
};

type GivingConfig = NonNullable<MinistryFinanceSnapshot["giving"]>;

const completedStatuses = new Set(["succeeded", "paid", "confirmed"]);

const frequencyLabels: Record<string, string> = {
  one_time: "Una vez",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function sanitizeFileName(value: string) {
  return normalizeText(value).replace(/\s+/g, "-") || "ministerio";
}

function parseAmountToCents(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function centsToAmount(value?: number | null) {
  if (!value) return "";
  return String((value / 100).toFixed(2)).replace(/\.00$/, "");
}

function isCompleted(status?: string | null) {
  return completedStatuses.has(String(status || "").toLowerCase());
}

function matchesFund(transaction: Donation, fund: Fund | null) {
  if (!fund) return false;
  if (transaction.fundId && transaction.fundId === fund.id) return true;
  return normalizeText(transaction.fundName) === normalizeText(fund.name);
}

function chooseMinistryFund(funds: Fund[], ministryId: string, ministryName: string) {
  const activeFunds = funds.filter((fund) => fund.active !== false);
  const normalizedMinistry = normalizeText(ministryName);

  return (
    activeFunds.find((fund) => fund.ministryId === ministryId) ||
    activeFunds.find((fund) => normalizeText(fund.name) === normalizedMinistry) ||
    activeFunds.find((fund) => normalizeText(fund.name).includes(normalizedMinistry)) ||
    null
  );
}

function buildCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(",")
    )
    .join("\n");
}

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function MinistryFinance({ ministryId, ministryName, canManage }: MinistryFinanceProps) {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const { selectedChurch } = useChurch();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancedAvailable, setAdvancedAvailable] = useState(true);
  const [fund, setFund] = useState<Fund | null>(null);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [givingConfig, setGivingConfig] = useState<GivingConfig>({});
  const [summary, setSummary] = useState<Required<MinistryFinanceSummary>>({
    receivedCents: 0,
    expenseCents: 0,
    budgetCents: 0,
    balanceCents: 0,
    goalCents: 0,
    giftCount: 0,
  });
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [expenses, setExpenses] = useState<MinistryExpense[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);

  const [submittingDonation, setSubmittingDonation] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [creatingFund, setCreatingFund] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [donationForm, setDonationForm] = useState({
    amount: "50",
    frequency: "one_time",
    donorName: "",
    donorEmail: "",
    anonymous: false,
    note: "",
  });
  const [planForm, setPlanForm] = useState({
    goal: "",
    budget: "",
    publicGoal: true,
  });
  const [expenseForm, setExpenseForm] = useState({
    amount: "",
    category: "",
    vendor: "",
    spentAt: new Date().toISOString().slice(0, 10),
    note: "",
  });

  const externalGivingUrl = givingConfig.externalUrl?.trim() || "";
  const usesExternalGiving = Boolean(externalGivingUrl);
  const externalGivingLabel = givingConfig.externalLabel || "Church Center";
  const publicGivingUrl = useMemo(() => {
    if (externalGivingUrl) return externalGivingUrl;
    if (!fund || !selectedChurch?.slug) return "";
    return `https://www.tchurchapp.com/give/${selectedChurch.slug}?fund=${encodeURIComponent(fund.id)}&ministry=${encodeURIComponent(ministryId)}`;
  }, [externalGivingUrl, fund, ministryId, selectedChurch?.slug]);

  const qrFileName = `tchurch-${sanitizeFileName(selectedChurch?.slug || selectedChurch?.name || "iglesia")}-${sanitizeFileName(ministryName)}-qr.png`;
  const csvFileName = `tchurch-${sanitizeFileName(ministryName)}-finanzas.csv`;
  const goalProgress = summary.goalCents > 0 ? Math.min(100, Math.round((summary.receivedCents / summary.goalCents) * 100)) : 0;
  const canDonate = Boolean(fund && enabled && connected && !usesExternalGiving);

  const loadFinance = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let snapshot: MinistryFinanceSnapshot | null = null;
      let hasAdvancedEndpoint = true;

      try {
        snapshot = await fetchApi<MinistryFinanceSnapshot>(`/ministries/${ministryId}/finance`);
      } catch (snapshotError) {
        console.warn("Ministry finance endpoint unavailable, falling back to giving data:", snapshotError);
        hasAdvancedEndpoint = false;
      }

      setAdvancedAvailable(hasAdvancedEndpoint);

      const fundData = await fetchApi<{ funds: Fund[]; giving?: GivingConfig }>("/giving/funds");
      const availableFunds = snapshot?.funds?.length ? snapshot.funds : fundData.funds || [];
      const selectedFund = snapshot?.fund || chooseMinistryFund(availableFunds, ministryId, ministryName);
      const mergedGiving: GivingConfig = {
        ...(fundData.giving || {}),
        ...(snapshot?.giving || {}),
        externalUrl: snapshot?.giving?.externalUrl ?? fundData.giving?.externalUrl ?? null,
        externalLabel: snapshot?.giving?.externalLabel ?? fundData.giving?.externalLabel ?? null,
        externalInstructions: snapshot?.giving?.externalInstructions ?? fundData.giving?.externalInstructions ?? null,
      };

      setFunds(availableFunds.filter((item) => item.active !== false));
      setFund(selectedFund);
      setGivingConfig(mergedGiving);
      setEnabled(Boolean(mergedGiving.enabled));
      setConnected(Boolean(mergedGiving.connected));

      let scopedTransactions = snapshot?.transactions || [];
      if (canManage && scopedTransactions.length === 0 && selectedFund) {
        try {
          const transactionData = await fetchApi<{ transactions: FinanceTransaction[]; summary?: MinistryFinanceSummary }>("/giving/transactions?limit=100");
          scopedTransactions = (transactionData.transactions || []).filter((transaction) => matchesFund(transaction, selectedFund));
        } catch (transactionError) {
          console.warn("Could not load finance transactions:", transactionError);
        }
      }

      let scopedDonations: Donation[] = [];
      if (selectedFund) {
        try {
          const donationData = await fetchApi<{ donations: Donation[] }>("/giving/me");
          scopedDonations = (donationData.donations || []).filter((donation) => matchesFund(donation, selectedFund));
        } catch (donationError) {
          console.warn("Could not load personal ministry donations:", donationError);
        }
      }

      const scopedExpenses = snapshot?.expenses || [];
      const receivedCents =
        snapshot?.summary?.receivedCents ??
        scopedTransactions
          .filter((transaction) => isCompleted(transaction.status))
          .reduce((total, transaction) => total + (Number(transaction.amountCents) || 0), 0);
      const expenseCents =
        snapshot?.summary?.expenseCents ??
        scopedExpenses.reduce((total, expense) => total + (Number(expense.amountCents) || 0), 0);
      const budgetCents = snapshot?.summary?.budgetCents ?? 0;
      const goalCents = snapshot?.summary?.goalCents ?? selectedFund?.goalCents ?? 0;
      const giftCount =
        snapshot?.summary?.giftCount ??
        scopedTransactions.filter((transaction) => isCompleted(transaction.status)).length;

      setTransactions(scopedTransactions);
      setExpenses(scopedExpenses);
      setDonations(scopedDonations);
      setSummary({
        receivedCents,
        expenseCents,
        budgetCents,
        balanceCents: snapshot?.summary?.balanceCents ?? receivedCents + budgetCents - expenseCents,
        goalCents,
        giftCount,
      });
      setPlanForm({
        goal: centsToAmount(goalCents),
        budget: centsToAmount(budgetCents),
        publicGoal: true,
      });
    } catch (financeError) {
      setError(financeError instanceof Error ? financeError.message : "No se pudieron cargar las finanzas del ministerio.");
    } finally {
      setLoading(false);
    }
  }, [canManage, fetchApi, ministryId, ministryName]);

  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  useEffect(() => {
    const success = searchParams.get("success") === "true";
    const canceled = searchParams.get("canceled") === "true";

    if (!success && !canceled) return;

    if (success) {
      toast({ title: "Gracias por tu generosidad", description: `Estamos actualizando ${ministryName}.` });
    } else {
      toast({ title: "Pago cancelado", description: "No registramos ninguna donación completada." });
    }

    loadFinance();
    setSearchParams({ tab: "finance" }, { replace: true });
  }, [loadFinance, ministryName, searchParams, setSearchParams, toast]);

  useEffect(() => {
    let active = true;

    async function generateQr() {
      if (!publicGivingUrl) {
        setQrDataUrl("");
        setQrLoading(false);
        return;
      }

      setQrLoading(true);
      try {
        const dataUrl = await QRCode.toDataURL(publicGivingUrl, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 768,
          color: {
            dark: "#111827",
            light: "#ffffff",
          },
        });

        if (active) setQrDataUrl(dataUrl);
      } catch (qrError) {
        console.warn("Could not generate ministry giving QR:", qrError);
        if (active) setQrDataUrl("");
      } finally {
        if (active) setQrLoading(false);
      }
    }

    generateQr();

    return () => {
      active = false;
    };
  }, [publicGivingUrl]);

  function getCheckoutReturnUrl(status: "success" | "canceled") {
    if (Capacitor.isNativePlatform()) {
      return `tchurchapp://tchurchapp.com/#/app/ministries/${ministryId}?tab=finance&${status}=true`;
    }

    return `${window.location.origin}/app/ministries/${ministryId}?tab=finance&${status}=true`;
  }

  async function openCheckoutUrl(url: string) {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url });
      return;
    }

    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = url;
  }

  async function copyPublicGivingLink() {
    if (!publicGivingUrl) return;

    try {
      await navigator.clipboard.writeText(publicGivingUrl);
      toast({ title: "Link copiado", description: "Listo para compartir con miembros e invitados." });
    } catch {
      toast({ title: "No se pudo copiar", description: publicGivingUrl });
    }
  }

  async function downloadPublicGivingQr() {
    if (!qrDataUrl) return;

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
          title: `QR para ${ministryName}`,
          text: `Donaciones para ${ministryName}`,
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
      toast({ title: "QR descargado", description: "El PNG ya está listo para imprimir o compartir." });
    } catch (downloadError) {
      toast({
        title: "No se pudo descargar el QR",
        description: downloadError instanceof Error ? downloadError.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function startCheckout() {
    if (!fund) {
      toast({ title: "Este ministerio no tiene fondo", description: "Crea o vincula un fondo antes de recibir donaciones.", variant: "destructive" });
      return;
    }

    const amountCents = parseAmountToCents(donationForm.amount);
    if (amountCents < 100) {
      toast({ title: "Cantidad inválida", description: "Ingresa al menos $1.00.", variant: "destructive" });
      return;
    }

    setSubmittingDonation(true);
    try {
      const data = await fetchApi<{ url: string }>("/giving/checkout", {
        method: "POST",
        body: JSON.stringify({
          fundId: fund.id,
          amountCents,
          frequency: donationForm.frequency,
          donorName: donationForm.donorName,
          donorEmail: donationForm.donorEmail,
          anonymous: donationForm.anonymous,
          note: donationForm.note,
          returnUrl: getCheckoutReturnUrl("success"),
          cancelUrl: getCheckoutReturnUrl("canceled"),
        }),
      });
      await openCheckoutUrl(data.url);
    } catch (checkoutError) {
      toast({
        title: "No se pudo abrir el pago",
        description: checkoutError instanceof Error ? checkoutError.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmittingDonation(false);
    }
  }

  async function createMinistryFund() {
    setCreatingFund(true);
    try {
      await fetchApi(`/ministries/${ministryId}/finance/fund`, {
        method: "POST",
        body: JSON.stringify({
          name: ministryName,
          description: `Donaciones designadas para ${ministryName}`,
        }),
      });
      toast({ title: "Fondo creado", description: "Ya puedes recibir donaciones para este ministerio." });
      await loadFinance();
    } catch (fundError) {
      toast({
        title: "No se pudo crear el fondo",
        description: fundError instanceof Error ? fundError.message : "El backend necesita habilitar fondos por ministerio.",
        variant: "destructive",
      });
    } finally {
      setCreatingFund(false);
    }
  }

  async function savePlan() {
    setSavingPlan(true);
    try {
      await fetchApi(`/ministries/${ministryId}/finance/plan`, {
        method: "PUT",
        body: JSON.stringify({
          fundId: fund?.id || null,
          goalCents: parseAmountToCents(planForm.goal),
          budgetCents: parseAmountToCents(planForm.budget),
          publicGoal: planForm.publicGoal,
        }),
      });
      toast({ title: "Plan financiero guardado" });
      await loadFinance();
    } catch (planError) {
      toast({
        title: "No se pudo guardar el plan",
        description: planError instanceof Error ? planError.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingPlan(false);
    }
  }

  async function saveExpense() {
    const amountCents = parseAmountToCents(expenseForm.amount);
    if (amountCents < 1) {
      toast({ title: "Cantidad inválida", variant: "destructive" });
      return;
    }

    setSavingExpense(true);
    try {
      await fetchApi(`/ministries/${ministryId}/finance/expenses`, {
        method: "POST",
        body: JSON.stringify({
          amountCents,
          category: expenseForm.category,
          vendor: expenseForm.vendor,
          spentAt: expenseForm.spentAt,
          note: expenseForm.note,
        }),
      });
      toast({ title: "Gasto registrado" });
      setExpenseForm({
        amount: "",
        category: "",
        vendor: "",
        spentAt: new Date().toISOString().slice(0, 10),
        note: "",
      });
      await loadFinance();
    } catch (expenseError) {
      toast({
        title: "No se pudo registrar el gasto",
        description: expenseError instanceof Error ? expenseError.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingExpense(false);
    }
  }

  async function exportFinanceCsv() {
    setExporting(true);
    try {
      const rows = [
        ["Tipo", "Fecha", "Nombre", "Categoria/Fondo", "Estado", "Nota", "Monto"],
        ...transactions.map((transaction) => [
          "Donacion",
          transaction.paidAt || transaction.createdAt || "",
          transaction.donorName || transaction.donorEmail || "Donante",
          transaction.fundName || fund?.name || "",
          transaction.status || "",
          transaction.note || transaction.manualMethod || transaction.paymentProvider || "",
          String((Number(transaction.amountCents) || 0) / 100),
        ]),
        ...expenses.map((expense) => [
          "Gasto",
          expense.spentAt || expense.createdAt || "",
          expense.vendor || "",
          expense.category || "",
          "",
          expense.note || "",
          String(((Number(expense.amountCents) || 0) / 100) * -1),
        ]),
      ];
      const csv = buildCsv(rows);

      if (Capacitor.isNativePlatform()) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        const saved = await Filesystem.writeFile({
          path: csvFileName,
          data: toBase64(csv),
          directory: Directory.Cache,
          recursive: true,
        });

        await Share.share({
          title: `Finanzas de ${ministryName}`,
          text: "Reporte CSV",
          url: saved.uri,
          dialogTitle: "Compartir reporte",
        });
        return;
      }

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Reporte descargado" });
    } catch (exportError) {
      toast({
        title: "No se pudo exportar",
        description: exportError instanceof Error ? exportError.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <AlertCircle className="mx-auto h-9 w-9 text-destructive/70" />
          <div>
            <p className="font-semibold">No se pudieron cargar las finanzas</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" onClick={loadFinance}>Intentar de nuevo</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!advancedAvailable && canManage && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-900">Finanzas avanzadas listas para conectar</p>
              <p className="text-xs leading-5 text-amber-800">
                La app ya muestra donaciones por fondo. Presupuestos, gastos y metas persistentes requieren los endpoints de finanzas por ministerio.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Heart className="h-4 w-4 text-primary" />
              Donar a {ministryName}
            </CardTitle>
            <CardDescription>
              {usesExternalGiving
                ? `Las donaciones se completan en ${externalGivingLabel}.`
                : "Las donaciones usan Stripe y quedan designadas al fondo del ministerio."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {usesExternalGiving ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-950">Donaciones en {externalGivingLabel}</p>
                <p className="mt-1 text-xs leading-5 text-emerald-900">
                  {givingConfig.externalInstructions || `Grace en Espanol recibe diezmos y ofrendas a traves de ${externalGivingLabel}.`}
                </p>
                <Button type="button" className="mt-4 h-11 w-full rounded-2xl" onClick={() => void openCheckoutUrl(externalGivingUrl)}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Abrir {externalGivingLabel}
                </Button>
                <p className="mt-3 text-xs leading-5 text-emerald-900">
                  Los recibos, metodos de pago e historial de donaciones se manejan directamente en {externalGivingLabel}.
                </p>
              </div>
            ) : !fund ? (
              <div className="rounded-2xl border border-dashed p-4 text-center">
                <Wallet className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm font-semibold">Este ministerio no tiene fondo vinculado</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Crea un fondo para que los aportes entren directamente a {ministryName}.
                </p>
                {canManage && (
                  <Button className="mt-3 rounded-2xl" size="sm" onClick={createMinistryFund} disabled={creatingFund}>
                    {creatingFund ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Crear fondo
                  </Button>
                )}
              </div>
            ) : !enabled || !connected ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Donaciones no configuradas</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  Un administrador debe conectar Stripe Connect antes de recibir donaciones.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {["25", "50", "100"].map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      variant={donationForm.amount === amount ? "default" : "outline"}
                      className="h-11 rounded-2xl"
                      onClick={() => setDonationForm((current) => ({ ...current, amount }))}
                    >
                      ${amount}
                    </Button>
                  ))}
                </div>
                <Input
                  value={donationForm.amount}
                  onChange={(event) => setDonationForm((current) => ({ ...current, amount: event.target.value }))}
                  inputMode="decimal"
                  className="h-12 rounded-2xl text-lg font-bold"
                  placeholder="Cantidad"
                />
                <Select value={donationForm.frequency} onValueChange={(frequency) => setDonationForm((current) => ({ ...current, frequency }))}>
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
                  <Input value={donationForm.donorName} onChange={(event) => setDonationForm((current) => ({ ...current, donorName: event.target.value }))} className="h-12 rounded-2xl" placeholder="Nombre" />
                  <Input value={donationForm.donorEmail} onChange={(event) => setDonationForm((current) => ({ ...current, donorEmail: event.target.value }))} className="h-12 rounded-2xl" placeholder="Correo para recibo" />
                </div>
                <Textarea value={donationForm.note} onChange={(event) => setDonationForm((current) => ({ ...current, note: event.target.value }))} className="min-h-20 rounded-2xl" placeholder="Nota opcional" />
                <div className="flex items-center justify-between rounded-2xl border p-3">
                  <span className="text-sm font-medium">Dar anonimamente</span>
                  <Switch checked={donationForm.anonymous} onCheckedChange={(anonymous) => setDonationForm((current) => ({ ...current, anonymous }))} />
                </div>
                <Button onClick={startCheckout} disabled={submittingDonation || !canDonate} className="h-12 w-full rounded-2xl text-base font-bold">
                  {submittingDonation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Continuar a pago seguro
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4 text-primary" />
              Link y QR del ministerio
            </CardTitle>
            <CardDescription>
              {usesExternalGiving ? `Compártelo para abrir ${externalGivingLabel}.` : "Compártelo para que el fondo salga preseleccionado."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-2xl border bg-white p-3 shadow-sm">
              {qrLoading ? (
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR para donar a ${ministryName}`} className="h-full w-full" />
              ) : (
                <QrCode className="h-11 w-11 text-muted-foreground" />
              )}
            </div>
            <div className="break-all rounded-2xl bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              {publicGivingUrl || "Crea o vincula un fondo para generar el link."}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" className="h-10 rounded-2xl px-2 text-xs" onClick={copyPublicGivingLink} disabled={!publicGivingUrl}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                Copiar
              </Button>
              <Button type="button" variant="outline" className="h-10 rounded-2xl px-2 text-xs" onClick={() => void openCheckoutUrl(publicGivingUrl)} disabled={!publicGivingUrl}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Abrir
              </Button>
              <Button type="button" variant="outline" className="h-10 rounded-2xl px-2 text-xs" onClick={downloadPublicGivingQr} disabled={!qrDataUrl}>
                <Download className="mr-1 h-3.5 w-3.5" />
                QR
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {summary.goalCents > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-primary" />
              Meta del ministerio
            </CardTitle>
            <CardDescription>{money(summary.receivedCents)} de {money(summary.goalCents)} recibidos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={goalProgress} />
            <p className="text-xs text-muted-foreground">{goalProgress}% completado</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" />
            Mi historial en este ministerio
          </CardTitle>
          <CardDescription>Donaciones completadas para {fund?.name || ministryName}.</CardDescription>
        </CardHeader>
        <CardContent>
          {donations.filter((donation) => isCompleted(donation.status)).length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Todavía no tienes donaciones registradas para este ministerio.</p>
          ) : (
            <div className="divide-y">
              {donations
                .filter((donation) => isCompleted(donation.status))
                .slice(0, 8)
                .map((donation) => (
                  <div key={donation.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold">{donation.fundName || fund?.name || "Fondo"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(donation.paidAt || donation.createdAt || Date.now()).toLocaleDateString()} · {frequencyLabels[donation.frequency || ""] || donation.frequency || "Una vez"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-black">{money(donation.amountCents)}</p>
                      <Badge variant="secondary">{donation.status}</Badge>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <DollarSign className="mb-2 h-5 w-5 text-emerald-600" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recibido</p>
                <p className="mt-1 text-xl font-black">{money(summary.receivedCents)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <Wallet className="mb-2 h-5 w-5 text-primary" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Presupuesto</p>
                <p className="mt-1 text-xl font-black">{money(summary.budgetCents)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <BarChart3 className="mb-2 h-5 w-5 text-amber-600" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gastos</p>
                <p className="mt-1 text-xl font-black">{money(summary.expenseCents)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <TrendingUp className="mb-2 h-5 w-5 text-zinc-700" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance</p>
                <p className="mt-1 text-xl font-black">{money(summary.balanceCents)}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Plan financiero</CardTitle>
                <CardDescription>Define meta pública y presupuesto interno del ministerio.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {funds.length > 0 && (
                  <div className="space-y-2">
                    <Label>Fondo vinculado</Label>
                    <div className="rounded-2xl border bg-muted/40 px-3 py-2 text-sm">
                      {fund?.name || "Ningún fondo vinculado"}
                    </div>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Meta de donaciones</Label>
                    <Input value={planForm.goal} onChange={(event) => setPlanForm((current) => ({ ...current, goal: event.target.value }))} inputMode="decimal" placeholder="5000" className="h-11 rounded-2xl" />
                  </div>
                  <div className="space-y-2">
                    <Label>Presupuesto asignado</Label>
                    <Input value={planForm.budget} onChange={(event) => setPlanForm((current) => ({ ...current, budget: event.target.value }))} inputMode="decimal" placeholder="1200" className="h-11 rounded-2xl" />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-2xl border p-3">
                  <span className="text-sm font-medium">Mostrar meta a miembros</span>
                  <Switch checked={planForm.publicGoal} onCheckedChange={(publicGoal) => setPlanForm((current) => ({ ...current, publicGoal }))} />
                </div>
                <Button onClick={savePlan} disabled={savingPlan} className="w-full rounded-2xl">
                  {savingPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Guardar plan
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Registrar gasto</CardTitle>
                <CardDescription>Guarda salidas para calcular el balance del ministerio.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Cantidad</Label>
                    <Input value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))} inputMode="decimal" placeholder="75" className="h-11 rounded-2xl" />
                  </div>
                  <div className="space-y-2">
                    <Label>Fecha</Label>
                    <Input type="date" value={expenseForm.spentAt} onChange={(event) => setExpenseForm((current) => ({ ...current, spentAt: event.target.value }))} className="h-11 rounded-2xl" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Categoría</Label>
                    <Input value={expenseForm.category} onChange={(event) => setExpenseForm((current) => ({ ...current, category: event.target.value }))} placeholder="Materiales" className="h-11 rounded-2xl" />
                  </div>
                  <div className="space-y-2">
                    <Label>Proveedor</Label>
                    <Input value={expenseForm.vendor} onChange={(event) => setExpenseForm((current) => ({ ...current, vendor: event.target.value }))} placeholder="Tienda / persona" className="h-11 rounded-2xl" />
                  </div>
                </div>
                <Textarea value={expenseForm.note} onChange={(event) => setExpenseForm((current) => ({ ...current, note: event.target.value }))} placeholder="Nota interna" className="min-h-20 rounded-2xl" />
                <Button onClick={saveExpense} disabled={savingExpense} className="w-full rounded-2xl">
                  {savingExpense ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Registrar gasto
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Movimientos</CardTitle>
                <CardDescription>{summary.giftCount} donaciones confirmadas · {expenses.length} gastos</CardDescription>
              </div>
              <Button variant="outline" className="rounded-2xl" onClick={exportFinanceCsv} disabled={exporting || (transactions.length === 0 && expenses.length === 0)}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Exportar CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Donaciones recientes</p>
                {transactions.length === 0 ? (
                  <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">No hay donaciones registradas para este fondo.</p>
                ) : (
                  <div className="divide-y rounded-2xl border">
                    {transactions.slice(0, 8).map((transaction) => (
                      <div key={transaction.id} className="flex items-center justify-between gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{transaction.donorName || transaction.donorEmail || "Donante"}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(transaction.paidAt || transaction.createdAt || Date.now()).toLocaleDateString()} · {transaction.status}
                          </p>
                        </div>
                        <p className="shrink-0 font-black">{money(transaction.amountCents)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Gastos recientes</p>
                {expenses.length === 0 ? (
                  <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">No hay gastos registrados todavía.</p>
                ) : (
                  <div className="divide-y rounded-2xl border">
                    {expenses.slice(0, 8).map((expense) => (
                      <div key={expense.id} className="flex items-center justify-between gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{expense.vendor || expense.category || "Gasto"}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(expense.spentAt || expense.createdAt || Date.now()).toLocaleDateString()}
                            {expense.note ? ` · ${expense.note}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 font-black text-red-600">-{money(expense.amountCents)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
