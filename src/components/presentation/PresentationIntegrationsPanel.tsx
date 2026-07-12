import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Cable, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  normalizePresentationConnectorEndpoint,
  readPresentationLocalConnectorSettings,
  requestProPresenter,
  writePresentationLocalConnectorSettings,
  type ProPresenterStatus,
} from "@/lib/presentationLocalConnectors";
import {
  connectPlanningCenter,
  disconnectPlanningCenter,
  fetchPlanningCenterCatalog,
  fetchPresentationIntegrations,
  fetchProPresenterExport,
  importPlanningCenterPlan,
  planningCenterRelayErrorNotice,
  PRESENTATION_PLANNING_CENTER_RELAY_EVENT,
  type PlanningCenterRelayEventDetail,
  type PlanningCenterCatalogResponse,
  type PlanningCenterImportResponse,
  type PresentationIntegrationSummary,
  type PresentationRunMode,
} from "@/lib/presentationProduction";

type PresentationIntegrationsPanelProps = {
  serviceId: string;
  serviceTitle: string;
  mode: PresentationRunMode;
  churchId?: string | null;
  canEdit: boolean;
  canOperateExternal: boolean;
  canExportPublic: boolean;
  hasActivePresentationSession: boolean;
};

function fileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "servicio";
}

export function PresentationIntegrationsPanel({ serviceId, serviceTitle, mode, churchId, canEdit, canOperateExternal, canExportPublic, hasActivePresentationSession }: PresentationIntegrationsPanelProps) {
  const [summary, setSummary] = useState<PresentationIntegrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [serviceTypes, setServiceTypes] = useState<Extract<PlanningCenterCatalogResponse, { resource: "service_types" }>["items"]>([]);
  const [plans, setPlans] = useState<Extract<PlanningCenterCatalogResponse, { resource: "plans" }>["items"]>([]);
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [planId, setPlanId] = useState("");
  const [preview, setPreview] = useState<PlanningCenterImportResponse | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const [settings, setSettings] = useState(() => readPresentationLocalConnectorSettings(churchId));
  const [proStatus, setProStatus] = useState<ProPresenterStatus | null>(null);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const pendingPlanningCenterReturnRef = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      setSummary(await fetchPresentationIntegrations());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar las integraciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSettings(readPresentationLocalConnectorSettings(churchId));
  }, [churchId]);

  useEffect(() => {
    void reload();
  }, [reload, serviceId]);

  useEffect(() => {
    const handleRelay = (event: Event) => {
      const detail = (event as CustomEvent<PlanningCenterRelayEventDetail>).detail;
      if (!detail || detail.serviceId !== serviceId) return;
      pendingPlanningCenterReturnRef.current = false;
      setPreview(null);
      setImportConfirm(false);
      setCatalogRefresh((value) => value + 1);
      if (detail.outcome === "complete") {
        setSummary(detail.summary);
        setNotice("Planning Center quedó conectado.");
      } else {
        setNotice(planningCenterRelayErrorNotice(detail.code));
      }
    };
    window.addEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, handleRelay);
    return () => window.removeEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, handleRelay);
  }, [serviceId]);

  const planningCenter = summary?.integrations.find((integration) => integration.provider === "planning_center");

  useEffect(() => {
    if (mode !== "live" || planningCenter?.provider !== "planning_center" || planningCenter.status !== "connected") {
      setServiceTypes([]);
      setPlans([]);
      setServiceTypeId("");
      setPlanId("");
      setPreview(null);
      setImportConfirm(false);
      return;
    }
    let active = true;
    void fetchPlanningCenterCatalog({}).then((catalog) => {
      if (active && catalog.resource === "service_types") setServiceTypes(catalog.items);
    }).catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "No se pudo cargar Planning Center."); });
    return () => { active = false; };
  }, [catalogRefresh, mode, planningCenter?.provider, planningCenter?.status]);

  useEffect(() => {
    let disposed = false;
    let appListener: { remove: () => Promise<void> } | null = null;
    let browserListener: { remove: () => Promise<void> } | null = null;
    const refreshAfterOAuth = () => {
      if (!pendingPlanningCenterReturnRef.current) return;
      pendingPlanningCenterReturnRef.current = false;
      setPreview(null);
      setImportConfirm(false);
      setPlans([]);
      setPlanId("");
      setCatalogRefresh((value) => value + 1);
      void reload();
    };
    void App.addListener("appStateChange", ({ isActive }) => { if (isActive) refreshAfterOAuth(); }).then((listener) => {
      if (disposed) void listener.remove();
      else appListener = listener;
    });
    void Browser.addListener("browserFinished", refreshAfterOAuth).then((listener) => {
      if (disposed) void listener.remove();
      else browserListener = listener;
    });
    return () => {
      disposed = true;
      void appListener?.remove();
      void browserListener?.remove();
    };
  }, [reload, serviceId]);

  async function beginPlanningCenter() {
    if (!canEdit || mode !== "live") return;
    setBusy("pco-connect");
    setNotice(null);
    try {
      const response = await connectPlanningCenter(serviceId);
      pendingPlanningCenterReturnRef.current = true;
      await Browser.open({ url: response.authorizeUrl, presentationStyle: "popover" });
      setNotice("Completa el acceso en Planning Center. Tchurch actualizará la conexión al volver.");
    } catch (error) {
      pendingPlanningCenterReturnRef.current = false;
      setNotice(error instanceof Error ? error.message : "No se pudo abrir Planning Center.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!disconnectConfirm || !canEdit || mode !== "live") return;
    setBusy("pco-disconnect");
    setNotice(null);
    try {
      setSummary(await disconnectPlanningCenter());
      setDisconnectConfirm(false);
      setNotice("Planning Center fue desconectado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo desconectar Planning Center.");
    } finally {
      setBusy(null);
    }
  }

  async function chooseServiceType(value: string) {
    if (!canEdit || mode !== "live" || hasActivePresentationSession) return;
    setServiceTypeId(value);
    setPlanId("");
    setPreview(null);
    setImportConfirm(false);
    setBusy("plans");
    try {
      const catalog = await fetchPlanningCenterCatalog({ serviceTypeId: value });
      if (catalog.resource !== "plans" || catalog.serviceTypeId !== value) throw new Error("Planning Center respondió con otro tipo de servicio.");
      setPlans(catalog.items);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar los planes.");
    } finally {
      setBusy(null);
    }
  }

  async function runImport(operation: "preview" | "import") {
    if (!serviceTypeId || !planId || mode !== "live" || !canEdit || hasActivePresentationSession) {
      if (hasActivePresentationSession) setNotice("Termina la sesión en vivo o de ensayo antes de previsualizar o importar un plan.");
      return;
    }
    if (operation === "import" && (!preview || !importConfirm)) return;
    setBusy(`pco-${operation}`);
    setNotice(null);
    try {
      const result = await importPlanningCenterPlan(serviceId, { serviceTypeId, planId, operation });
      setPreview(result);
      setImportConfirm(false);
      setNotice(operation === "preview" ? "Vista previa lista; todavía no se cambió el servicio." : "Plan importado. Reabre la presentación para cargar el nuevo orden.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo importar el plan.");
    } finally {
      setBusy(null);
    }
  }

  function saveProEndpoint() {
    try {
      const endpoint = normalizePresentationConnectorEndpoint(settings.propresenterEndpoint, "propresenter");
      setSettings(writePresentationLocalConnectorSettings(churchId, { ...settings, propresenterEndpoint: endpoint }));
      setNotice("Dirección local guardada. No se guardaron credenciales.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La dirección de ProPresenter es inválida.");
    }
  }

  async function testProPresenter() {
    setBusy("pro-status");
    setNotice(null);
    try {
      const response = await requestProPresenter(settings.propresenterEndpoint, "status", { mode });
      if (!("connected" in response)) throw new Error("ProPresenter no devolvió estado.");
      setProStatus(response);
      setNotice(`ProPresenter ${response.version || ""} conectado en ${response.host}.`);
    } catch (error) {
      setProStatus(null);
      setNotice(`${error instanceof Error ? error.message : "No se pudo conectar."} Si ProPresenter bloquea CORS en iOS, usa el futuro conector local de Tchurch Studio; Tchurch no envía esta solicitud por un proxy.`);
    } finally {
      setBusy(null);
    }
  }

  async function triggerProPresenter(action: "next" | "previous") {
    if (mode !== "live" || !canOperateExternal) {
      setNotice("Necesitas el control de producción activo para mover ProPresenter.");
      return;
    }
    setBusy(`pro-${action}`);
    setNotice(null);
    try {
      await requestProPresenter(settings.propresenterEndpoint, action, { mode });
      setNotice(action === "next" ? "ProPresenter avanzó al siguiente cue." : "ProPresenter regresó al cue anterior.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "ProPresenter no confirmó la acción.");
    } finally {
      setBusy(null);
    }
  }

  async function exportForProPresenter() {
    if (mode !== "live" || !canExportPublic) return;
    setBusy("pro-export");
    setNotice(null);
    const path = `Tchurch-${fileName(serviceTitle)}-ProPresenter.txt`;
    let wroteFile = false;
    try {
      const content = await fetchProPresenterExport(serviceId);
      const saved = await Filesystem.writeFile({ path, data: content, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
      wroteFile = true;
      await Share.share({ title: `${serviceTitle} · ProPresenter`, text: "Exportación de Tchurch con slides separados por //", files: [saved.uri], dialogTitle: "Exportar a ProPresenter" });
      setNotice("Exportación preparada. El archivo no contiene tokens ni credenciales locales.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo preparar la exportación.");
    } finally {
      if (wroteFile) await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
      setBusy(null);
    }
  }

  if (loading && !summary) return <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-500" /></div>;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-200">Flujo de producción</p><h3 className="mt-1 text-xl font-black text-white">Integraciones</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">OAuth en servidor para Planning Center; conexiones LAN directas para ProPresenter. Ninguna contraseña se manda al backend.</p></div><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={loading} onClick={() => void reload()}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar</Button></div>
      {mode === "rehearsal" ? <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">Importar, exportar y controlar software externo está deshabilitado durante el ensayo. La sesión en vivo no cambia.</div> : null}
      {hasActivePresentationSession ? <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.06] px-3 py-2 text-xs font-semibold text-sky-100">Planning Center queda en solo lectura mientras exista una sesión en vivo o de ensayo. Termínala antes de previsualizar o importar.</div> : null}
      {notice ? <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold leading-5 text-slate-200" role="status">{notice}</div> : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-300/10 text-sky-200"><ExternalLink className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-white">Planning Center</h4>{planningCenter?.provider === "planning_center" && planningCenter.status === "connected" ? <span className="rounded-md bg-emerald-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200">Conectado</span> : null}</div><p className="mt-1 text-xs leading-5 text-slate-500">Importa el orden y tiempos de un plan de Services.</p></div></div>
          {planningCenter?.provider === "planning_center" && planningCenter.status === "connected" ? <div className="mt-4 rounded-xl bg-black/20 p-3"><p className="text-xs font-black text-slate-200">{planningCenter.externalOrganization?.name || "Organización conectada"}</p><p className="mt-1 text-[10px] text-slate-600">Última sincronización {planningCenter.lastSyncAt ? new Date(planningCenter.lastSyncAt).toLocaleString("es") : "—"}</p></div> : <Button className="mt-4 h-11 rounded-xl bg-sky-400 font-black text-slate-950 hover:bg-sky-300" disabled={!canEdit || mode !== "live" || busy === "pco-connect"} onClick={() => void beginPlanningCenter()}>{busy === "pco-connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}Conectar con OAuth</Button>}
          {planningCenter?.provider === "planning_center" && planningCenter.status === "connected" ? <div className="mt-4 space-y-3"><div><Label className="text-xs font-bold text-slate-300">Tipo de servicio</Label><Select value={serviceTypeId || undefined} disabled={mode !== "live" || !canEdit || hasActivePresentationSession} onValueChange={(value) => void chooseServiceType(value)}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{serviceTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-xs font-bold text-slate-300">Plan</Label><Select value={planId || undefined} disabled={!serviceTypeId || busy === "plans" || mode !== "live" || !canEdit || hasActivePresentationSession} onValueChange={(value) => { setPlanId(value); setPreview(null); setImportConfirm(false); }}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue placeholder={busy === "plans" ? "Cargando…" : "Selecciona…"} /></SelectTrigger><SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.title} · {plan.dates}</SelectItem>)}</SelectContent></Select></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={!canEdit || hasActivePresentationSession || !planId || busy === "pco-preview" || mode !== "live"} onClick={() => void runImport("preview")}>{busy === "pco-preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Vista previa</Button><Button className="h-11 rounded-xl bg-sky-400 font-black text-slate-950 hover:bg-sky-300" disabled={!canEdit || hasActivePresentationSession || !preview || busy === "pco-import" || mode !== "live"} onClick={() => setImportConfirm(true)}>{busy === "pco-import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Importar</Button><Button variant="ghost" className="ml-auto h-11 rounded-xl text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={!canEdit || mode !== "live"} onClick={() => setDisconnectConfirm(true)}><Unplug className="h-4 w-4" />Desconectar</Button></div>{preview ? <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.06] p-3 text-xs text-sky-100"><p className="font-black">{preview.source.title}</p><p className="mt-1">{preview.changes.create} nuevos · {preview.changes.update} actualizados · {preview.changes.unchanged} sin cambio{preview.changes.reorderedLocal ? ` · ${preview.changes.reorderedLocal} locales reordenados` : ""}</p></div> : null}{importConfirm && preview ? <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3"><div className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><p className="text-xs leading-5 text-amber-100">Confirma la importación de “{preview.source.title}”. Se aplicarán {preview.changes.create} elementos nuevos y {preview.changes.update} actualizaciones.</p></div><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" className="h-11 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setImportConfirm(false)}>Cancelar</Button><Button className="h-11 rounded-xl bg-amber-300 font-black text-slate-950 hover:bg-amber-200" disabled={busy === "pco-import"} onClick={() => void runImport("import")}>{busy === "pco-import" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar importación</Button></div></div> : null}</div> : null}
          {disconnectConfirm ? <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/10 p-3"><div className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-200" /><p className="text-xs leading-5 text-red-100">Se revocará la conexión guardada para esta iglesia. No elimina datos ya importados.</p></div><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" className="h-11 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setDisconnectConfirm(false)}>Cancelar</Button><Button className="h-11 rounded-xl bg-red-400 font-black text-white hover:bg-red-300" disabled={busy === "pco-disconnect"} onClick={() => void disconnect()}>{busy === "pco-disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Desconectar</Button></div></div> : null}
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Cable className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-white">ProPresenter</h4>{proStatus ? <span className="rounded-md bg-emerald-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200"><CheckCircle2 className="mr-1 inline h-3 w-3" />LAN</span> : null}</div><p className="mt-1 text-xs leading-5 text-slate-500">OpenAPI local predeterminada en localhost:50001.</p></div></div>
          <div className="mt-4"><Label className="text-xs font-bold text-slate-300">Dirección local</Label><div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Input value={settings.propresenterEndpoint} onChange={(event) => setSettings((current) => ({ ...current, propresenterEndpoint: event.target.value }))} className="h-11 rounded-xl border-white/10 bg-black/20 font-mono text-xs text-white" /><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" onClick={saveProEndpoint}>Guardar</Button></div></div>
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={busy === "pro-status"} onClick={() => void testProPresenter()}>{busy === "pro-status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Probar conexión</Button><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={!proStatus || mode !== "live" || !canOperateExternal || busy === "pro-previous"} onClick={() => void triggerProPresenter("previous")}>Anterior</Button><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={!proStatus || mode !== "live" || !canOperateExternal || busy === "pro-next"} onClick={() => void triggerProPresenter("next")}>Siguiente</Button></div>
          <Button className="mt-4 h-11 w-full rounded-xl bg-violet-400 font-black text-slate-950 hover:bg-violet-300" disabled={!canExportPublic || mode !== "live" || busy === "pro-export"} onClick={() => void exportForProPresenter()}>{busy === "pro-export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Exportar texto con slides //</Button>
          <p className="mt-3 text-[11px] leading-5 text-slate-600">La app nativa llama directamente a tu LAN con timeout y redirects bloqueados; el navegador usa fetch local. Nunca pasa por servidores Tchurch.</p>
        </article>
      </div>
    </section>
  );
}
