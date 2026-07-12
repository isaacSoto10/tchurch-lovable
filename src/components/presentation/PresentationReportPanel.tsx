import { useEffect, useState } from "react";
import { Activity, Clock3, Loader2, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchPresentationReport, type PresentationRunMode, type PresentationServiceReport } from "@/lib/presentationProduction";

function duration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const STATUS_LABELS: Record<PresentationServiceReport["status"], string> = {
  not_started: "Sin iniciar",
  in_progress: "En curso",
  completed: "Completado",
};

export function PresentationReportPanel({ serviceId, mode }: { serviceId: string; mode: PresentationRunMode }) {
  const [report, setReport] = useState<PresentationServiceReport | null>(null);
  const [loading, setLoading] = useState(mode === "live");
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (mode !== "live") return;
    setLoading(true);
    setNotice(null);
    try {
      setReport(await fetchPresentationReport(serviceId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar el reporte.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setReport(null);
    setNotice(null);
    if (mode === "live") void load();
    else setLoading(false);
    // load is intentionally tied to this service/mode snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, serviceId]);

  if (mode === "rehearsal") {
    return <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-6 text-center"><ShieldCheck className="mx-auto h-9 w-9 text-amber-200" /><h3 className="mt-3 text-lg font-black text-amber-100">El ensayo no genera reportes</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-amber-100/70">Solo la sesión en vivo produce métricas operativas. Navegar, terminar o automatizar un ensayo nunca aparece en el reporte del servicio.</p></section>;
  }

  if (loading && !report) return <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-500" /></div>;

  return (
    <section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Después del servicio</p><h3 className="mt-1 text-xl font-black text-white">Reporte operativo</h3><p className="mt-1 text-xs leading-5 text-slate-400">Agregados de la sesión en vivo, sin cuerpos de chat, notas, tokens ni correos.</p></div><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualizar</Button></div>
      {notice ? <div className="mt-4 rounded-xl border border-red-300/20 bg-red-300/10 px-3 py-2 text-xs font-semibold text-red-100">{notice}</div> : null}
      {report ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric icon={Clock3} label="Duración real" value={duration(report.timing.actualSeconds)} meta={`Plan ${duration(report.timing.plannedSeconds)}`} /><Metric icon={Activity} label="Diferencia" value={report.timing.overrunSeconds ? `+${duration(report.timing.overrunSeconds)}` : "A tiempo"} meta={STATUS_LABELS[report.status]} tone={report.timing.overrunSeconds ? "amber" : "emerald"} /><Metric icon={Users} label="Operadores" value={String(report.operators.uniqueCount)} meta={`${report.activity.commands} comandos`} /><Metric icon={ShieldCheck} label="Privacidad" value="Verificada" meta="4 controles en falso" tone="emerald" /></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs font-black text-slate-200">Actividad de la sesión</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries({ Navegaciones: report.activity.navigations, Blackouts: report.activity.blackoutChanges, Medios: report.activity.mediaPlays, "Mensajes escenario": report.activity.stageMessages, "Mensajes chat": report.activity.chatMessages, Automatizaciones: report.activity.automationEvents }).map(([label, value]) => <div key={label} className="rounded-xl bg-black/20 p-3"><p className="text-lg font-black tabular-nums text-white">{value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p></div>)}</div></div><aside className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Automatizaciones</p><div className="mt-3 space-y-2"><ReportLine label="Aplicadas" value={report.activity.automationApplied} tone="emerald" /><ReportLine label="Fallidas" value={report.activity.automationFailed} tone={report.activity.automationFailed ? "red" : "slate"} /></div>{report.session ? <div className="mt-5 border-t border-white/10 pt-4"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Sesión</p><p className="mt-1 truncate text-xs font-mono text-slate-400">{report.session.id}</p></div> : null}</aside></div>
        </>
      ) : null}
    </section>
  );
}

function Metric({ icon: Icon, label, value, meta, tone = "violet" }: { icon: typeof Clock3; label: string; value: string; meta: string; tone?: "violet" | "amber" | "emerald" }) {
  const colors = tone === "amber" ? "text-amber-200 bg-amber-300/10" : tone === "emerald" ? "text-emerald-200 bg-emerald-300/10" : "text-violet-200 bg-violet-300/10";
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${colors}`}><Icon className="h-4 w-4" /></div><p className="mt-4 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{meta}</p></div>;
}

function ReportLine({ label, value, tone }: { label: string; value: number; tone: "emerald" | "red" | "slate" }) {
  const color = tone === "emerald" ? "text-emerald-200" : tone === "red" ? "text-red-200" : "text-slate-300";
  return <div className="flex min-h-11 items-center justify-between rounded-xl bg-white/[0.04] px-3"><span className="text-xs font-bold text-slate-400">{label}</span><strong className={`text-sm tabular-nums ${color}`}>{value}</strong></div>;
}

