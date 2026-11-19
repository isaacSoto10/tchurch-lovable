import { useState } from "react";

export type RecurringGift = {
  id: string;
  amountCents: number;
  currency: string;
  frequency: string;
  fundName?: string | null;
};

type Props = {
  url: string;
  admin: boolean;
  gifts: RecurringGift[];
  english?: boolean;
  openPaymentLink: (url: string) => void;
  request: (path: string, options: RequestInit) => Promise<unknown>;
  reload: () => Promise<void>;
};

const inputStyle = "min-h-11 rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900";
const buttonStyle = "min-h-11 rounded-lg border px-4 py-2 font-semibold disabled:opacity-50";

export function GivingControls({ url, admin, gifts, english, openPaymentLink, request, reload }: Props) {
  const [link, setLink] = useState(url);
  const [editing, setEditing] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const t = (es: string, en: string) => english ? en : es;

  async function save(path: string, body?: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(path, body ? {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      } : { method: "DELETE" });
      setEditing(null);
      setCanceling(null);
      setNotice(t("Cambios guardados.", "Changes saved."));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Intenta de nuevo.", "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-4">
    {(url || admin) && <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-bold">Mercado Pago</h2>
      {url && <button type="button" className={buttonStyle} onClick={() => openPaymentLink(url)}>
        {t("Dar con Mercado Pago", "Give with Mercado Pago")}
      </button>}
      {admin && <details>
        <summary className="cursor-pointer py-2 text-sm font-semibold">{t("Configurar enlace de cobro", "Configure payment link")}</summary>
        <form className="mt-2 grid gap-2" onSubmit={event => { event.preventDefault(); void save("/giving/mercado-pago", { url: link.trim() }); }}>
          <label className="grid gap-1 text-sm">
            {t("Enlace de la cuenta de Mercado Pago de esta iglesia", "Payment link from this church’s Mercado Pago account")}
            <input type="url" placeholder="https://mpago.la/…" className={inputStyle} value={link} onChange={event => setLink(event.target.value)} />
          </label>
          <p className="text-sm">{t("El dinero y el comprobante se gestionan en Mercado Pago. Deja el campo vacío para retirar este método.", "Mercado Pago handles the funds and receipt. Clear the field to remove this method.")}</p>
          <button className={buttonStyle} disabled={busy || url === link.trim()}>{t("Guardar enlace", "Save payment link")}</button>
        </form>
      </details>}
    </section>}
    {gifts.length > 0 && <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-bold">{t("Mis aportes recurrentes", "My recurring gifts")}</h2>
      {gifts.map(gift => {
        const path = "/giving/recurring/" + encodeURIComponent(gift.id);
        const frequency = gift.frequency === "biweekly" ? t("cada dos semanas", "every two weeks") : gift.frequency === "weekly" ? t("semanal", "weekly") : t("mensual", "monthly");
        return <div key={gift.id} className="space-y-2 border-t pt-3">
          <p>{gift.fundName} · {new Intl.NumberFormat(english ? "en" : "es", { style: "currency", currency: gift.currency }).format(gift.amountCents / 100)} · {frequency}</p>
          {canceling === gift.id ? <div className="space-y-2">
            <p>{t("¿Cancelar los próximos cobros de este aporte?", "Cancel future charges for this gift?")}</p>
            <button className={buttonStyle} disabled={busy} onClick={() => void save(path)}>{t("Sí, cancelar aporte", "Yes, cancel gift")}</button>
            <button className={buttonStyle} disabled={busy} onClick={() => setCanceling(null)}>{t("Conservar", "Keep gift")}</button>
          </div> : editing === gift.id ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void save(path, {amountCents: Math.round(Number(amount) * 100)}); }}>
            <label className="grid gap-1 text-sm">{t("Monto desde el próximo cobro", "Amount from next payment")}
              <input className={inputStyle} type="number" step=".01" min="1" max="999999.99" required value={amount} onChange={event => setAmount(event.target.value)} />
            </label>
            <button className={buttonStyle} disabled={busy}>{t("Guardar", "Save")}</button>
            <button type="button" className={buttonStyle} disabled={busy} onClick={() => setEditing(null)}>{t("Volver", "Back")}</button>
          </form> : <div className="flex flex-wrap gap-2">
            <button className={buttonStyle} disabled={busy} onClick={() => { setEditing(gift.id); setCanceling(null); setAmount((gift.amountCents / 100).toFixed(2)); }}>{t("Editar monto", "Edit amount")}</button>
            <button className={buttonStyle} disabled={busy} onClick={() => { setEditing(null); setCanceling(gift.id); }}>{t("Cancelar aporte", "Cancel gift")}</button>
          </div>}
        </div>;
      })}
    </section>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
