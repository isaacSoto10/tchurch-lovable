import { useEffect, useRef, useState } from "react";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Cable, CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  normalizePresentationConnectorEndpoint,
  readPresentationLocalConnectorSettings,
  requestProPresenter,
  writePresentationLocalConnectorSettings,
  type ProPresenterStatus,
} from "@/lib/presentationLocalConnectors";
import { fetchProPresenterExport, type PresentationRunMode } from "@/lib/presentationProduction";

type PresentationIntegrationsPanelProps = {
  serviceId: string;
  serviceTitle: string;
  mode: PresentationRunMode;
  churchId?: string | null;
  externalAuthorityScope: string;
  canOperateExternal: boolean;
  canExportPublic: boolean;
};

function fileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "servicio";
}

export function PresentationIntegrationsPanel({ serviceId, serviceTitle, mode, churchId, externalAuthorityScope, canOperateExternal, canExportPublic }: PresentationIntegrationsPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState(() => readPresentationLocalConnectorSettings(churchId));
  const [proStatus, setProStatus] = useState<ProPresenterStatus | null>(null);
  const externalAuthorityScopeRef = useRef(externalAuthorityScope);
  const canOperateExternalRef = useRef(canOperateExternal);
  const externalRequestGenerationRef = useRef(0);
  const exportAuthorityRef = useRef("");
  const exportRequestGenerationRef = useRef(0);

  const exportAuthority = `${churchId || "no-church"}::${serviceId}::${mode}::${externalAuthorityScope}::${canExportPublic ? "exporter" : "no-export"}::${encodeURIComponent(serviceTitle)}`;
  externalAuthorityScopeRef.current = externalAuthorityScope;
  canOperateExternalRef.current = canOperateExternal;
  exportAuthorityRef.current = exportAuthority;

  useEffect(() => {
    setSettings(readPresentationLocalConnectorSettings(churchId));
    setNotice(null);
  }, [churchId]);

  useEffect(() => {
    externalRequestGenerationRef.current += 1;
    setProStatus(null);
    setNotice(null);
    setBusy((current) => current === "pro-status" || current === "pro-next" || current === "pro-previous" ? null : current);
  }, [canOperateExternal, externalAuthorityScope]);

  useEffect(() => {
    exportRequestGenerationRef.current += 1;
    setBusy((current) => current === "pro-export" ? null : current);
  }, [exportAuthority]);

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
    const requestedAuthority = externalAuthorityScopeRef.current;
    const generation = ++externalRequestGenerationRef.current;
    setBusy("pro-status");
    setNotice(null);
    try {
      const response = await requestProPresenter(settings.propresenterEndpoint, "status", { mode });
      if (generation !== externalRequestGenerationRef.current || externalAuthorityScopeRef.current !== requestedAuthority) return;
      if (!("connected" in response)) throw new Error("ProPresenter no devolvió estado.");
      setProStatus(response);
      setNotice(`ProPresenter ${response.version || ""} conectado en ${response.host}.`);
    } catch (error) {
      if (generation === externalRequestGenerationRef.current && externalAuthorityScopeRef.current === requestedAuthority) {
        setProStatus(null);
        setNotice(`${error instanceof Error ? error.message : "No se pudo conectar."} Si ProPresenter bloquea CORS en iOS, usa el futuro conector local de Tchurch Studio; Tchurch no envía esta solicitud por un proxy.`);
      }
    } finally {
      if (generation === externalRequestGenerationRef.current && externalAuthorityScopeRef.current === requestedAuthority) setBusy(null);
    }
  }

  async function triggerProPresenter(action: "next" | "previous") {
    if (mode !== "live" || !canOperateExternalRef.current) {
      setNotice("Necesitas el control de producción activo para mover ProPresenter.");
      return;
    }
    const requestedAuthority = externalAuthorityScopeRef.current;
    const generation = ++externalRequestGenerationRef.current;
    setBusy(`pro-${action}`);
    setNotice(null);
    try {
      await requestProPresenter(settings.propresenterEndpoint, action, { mode });
      if (generation !== externalRequestGenerationRef.current || externalAuthorityScopeRef.current !== requestedAuthority || !canOperateExternalRef.current) return;
      setNotice(action === "next" ? "ProPresenter avanzó al siguiente cue." : "ProPresenter regresó al cue anterior.");
    } catch (error) {
      if (generation === externalRequestGenerationRef.current && externalAuthorityScopeRef.current === requestedAuthority && canOperateExternalRef.current) {
        setNotice(error instanceof Error ? error.message : "ProPresenter no confirmó la acción.");
      }
    } finally {
      if (generation === externalRequestGenerationRef.current && externalAuthorityScopeRef.current === requestedAuthority) setBusy(null);
    }
  }

  async function exportForProPresenter() {
    if (mode !== "live" || !canExportPublic) return;
    const requestedAuthority = exportAuthorityRef.current;
    const generation = ++exportRequestGenerationRef.current;
    setBusy("pro-export");
    setNotice(null);
    const path = `Tchurch-${fileName(serviceTitle)}-ProPresenter.txt`;
    let wroteFile = false;
    try {
      const content = await fetchProPresenterExport(serviceId);
      if (generation !== exportRequestGenerationRef.current || exportAuthorityRef.current !== requestedAuthority) return;
      const saved = await Filesystem.writeFile({ path, data: content, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
      wroteFile = true;
      if (generation !== exportRequestGenerationRef.current || exportAuthorityRef.current !== requestedAuthority) return;
      await Share.share({ title: `${serviceTitle} · ProPresenter`, text: "Exportación de Tchurch con slides separados por //", files: [saved.uri], dialogTitle: "Exportar a ProPresenter" });
      if (generation !== exportRequestGenerationRef.current || exportAuthorityRef.current !== requestedAuthority) return;
      setNotice("Exportación preparada. El archivo no contiene tokens ni credenciales locales.");
    } catch (error) {
      if (generation === exportRequestGenerationRef.current && exportAuthorityRef.current === requestedAuthority) {
        setNotice(error instanceof Error ? error.message : "No se pudo preparar la exportación.");
      }
    } finally {
      if (wroteFile) await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
      if (generation === exportRequestGenerationRef.current && exportAuthorityRef.current === requestedAuthority) setBusy(null);
    }
  }

  return (
    <section className="space-y-5">
      <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-200">Flujo de producción</p><h3 className="mt-1 text-xl font-black text-white">Conexiones locales</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Conecta ProPresenter directamente por LAN. Ninguna contraseña ni solicitud local pasa por los servidores de Tchurch.</p></div>
      {mode === "rehearsal" ? <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">Exportar y controlar software externo está deshabilitado durante el ensayo. La sesión en vivo no cambia.</div> : null}
      {notice ? <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold leading-5 text-slate-200" role="status">{notice}</div> : null}

      <article className="max-w-2xl rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
        <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Cable className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-white">ProPresenter</h4>{proStatus ? <span className="rounded-md bg-emerald-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200"><CheckCircle2 className="mr-1 inline h-3 w-3" />LAN</span> : null}</div><p className="mt-1 text-xs leading-5 text-slate-500">OpenAPI local predeterminada en localhost:50001.</p></div></div>
        <div className="mt-4"><Label className="text-xs font-bold text-slate-300">Dirección local</Label><div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Input value={settings.propresenterEndpoint} onChange={(event) => setSettings((current) => ({ ...current, propresenterEndpoint: event.target.value }))} className="h-11 rounded-xl border-white/10 bg-black/20 font-mono text-xs text-white" /><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" onClick={saveProEndpoint}>Guardar</Button></div></div>
        <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={busy === "pro-status"} onClick={() => void testProPresenter()}>{busy === "pro-status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Probar conexión</Button><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={!proStatus || mode !== "live" || !canOperateExternal || busy === "pro-previous"} onClick={() => void triggerProPresenter("previous")}>Anterior</Button><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={!proStatus || mode !== "live" || !canOperateExternal || busy === "pro-next"} onClick={() => void triggerProPresenter("next")}>Siguiente</Button></div>
        <Button className="mt-4 h-11 w-full rounded-xl bg-violet-400 font-black text-slate-950 hover:bg-violet-300" disabled={!canExportPublic || mode !== "live" || busy === "pro-export"} onClick={() => void exportForProPresenter()}>{busy === "pro-export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Exportar texto con slides //</Button>
        <p className="mt-3 text-[11px] leading-5 text-slate-600">La app nativa llama directamente a tu LAN con timeout y redirects bloqueados; el navegador usa fetch local. Nunca pasa por servidores Tchurch.</p>
      </article>
    </section>
  );
}
