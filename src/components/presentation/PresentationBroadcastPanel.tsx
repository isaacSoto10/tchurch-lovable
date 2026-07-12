import { useEffect, useRef, useState } from "react";
import { Share } from "@capacitor/share";
import { Cast, CheckCircle2, Copy, Loader2, MonitorPlay, Radio, RefreshCw, ShieldAlert, Square, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  disconnectActivePresentationObsConnection,
  getActivePresentationObsConnection,
  ObsWebSocketClient,
  normalizePresentationConnectorEndpoint,
  readPresentationLocalConnectorSettings,
  setActivePresentationObsConnection,
  writePresentationLocalConnectorSettings,
} from "@/lib/presentationLocalConnectors";
import {
  createPresentationBroadcastLink,
  fetchPresentationBroadcastLinks,
  revokePresentationBroadcastLink,
  type PresentationBroadcastLink,
  type PresentationBroadcastLinkCreated,
  type PresentationRunMode,
} from "@/lib/presentationProduction";

type PresentationBroadcastPanelProps = {
  serviceId: string;
  mode: PresentationRunMode;
  churchId?: string | null;
  privacyScope: string;
  canEdit: boolean;
  canOperateExternal: boolean;
};

function date(value: string) {
  return new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function PresentationBroadcastPanel({ serviceId, mode, churchId, privacyScope, canEdit, canOperateExternal }: PresentationBroadcastPanelProps) {
  const connectorScope = `${privacyScope}::${churchId || "no-church"}::${serviceId}`;
  const [links, setLinks] = useState<PresentationBroadcastLink[]>([]);
  const [created, setCreated] = useState<PresentationBroadcastLinkCreated | null>(null);
  const [label, setLabel] = useState("OBS · letras");
  const [ttlHours, setTtlHours] = useState("8");
  const [loading, setLoading] = useState(mode === "live");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState(() => readPresentationLocalConnectorSettings(churchId));
  const [obsPassword, setObsPassword] = useState("");
  const [obsState, setObsState] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [obsVersion, setObsVersion] = useState<string | null>(null);
  const [scenes, setScenes] = useState<string[]>([]);
  const [selectedScene, setSelectedScene] = useState("");
  const [confirmStream, setConfirmStream] = useState<"start" | "stop" | null>(null);
  const obsRef = useRef<ObsWebSocketClient | null>(null);
  const connectorScopeRef = useRef(connectorScope);
  const canOperateExternalRef = useRef(canOperateExternal);
  const modeRef = useRef(mode);
  connectorScopeRef.current = connectorScope;
  canOperateExternalRef.current = canOperateExternal;
  modeRef.current = mode;

  useEffect(() => {
    setSettings(readPresentationLocalConnectorSettings(churchId));
    const active = getActivePresentationObsConnection();
    if (active?.scope === connectorScope) {
      obsRef.current = active.client;
      setObsState("connected");
      setObsVersion(active.version);
    } else {
      disconnectActivePresentationObsConnection();
      obsRef.current = null;
      setObsState("disconnected");
      setObsVersion(null);
    }
    setCreated(null);
    setObsPassword("");
    setConfirmStream(null);
  }, [churchId, connectorScope, privacyScope, serviceId]);

  useEffect(() => {
    let active = true;
    setCreated(null);
    setNotice(null);
    if (mode !== "live" || !canEdit) {
      setLinks([]);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void fetchPresentationBroadcastLinks(serviceId).then((response) => {
      if (active) setLinks(response.links);
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : "No se pudieron cargar las fuentes de navegador.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canEdit, mode, serviceId]);

  useEffect(() => {
    if (mode === "live" && canOperateExternal) return;
    disconnectActivePresentationObsConnection(connectorScope);
    obsRef.current = null;
    setObsPassword("");
    setObsState("disconnected");
    setObsVersion(null);
    setConfirmStream(null);
  }, [canOperateExternal, connectorScope, mode]);

  useEffect(() => {
    function clearSensitiveState() {
      if (document.visibilityState !== "hidden") return;
      setCreated(null);
      setObsPassword("");
      setConfirmStream(null);
      disconnectActivePresentationObsConnection();
      obsRef.current = null;
      setObsState("disconnected");
    }
    document.addEventListener("visibilitychange", clearSensitiveState);
    return () => {
      document.removeEventListener("visibilitychange", clearSensitiveState);
      setCreated(null);
      setObsPassword("");
    };
  }, []);

  function saveSettings(next = settings) {
    try {
      const normalized = writePresentationLocalConnectorSettings(churchId, {
        ...next,
        obsEndpoint: normalizePresentationConnectorEndpoint(next.obsEndpoint, "obs"),
      });
      setSettings(normalized);
      setNotice("Direcciones locales guardadas. Ninguna contraseña se almacenó.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La dirección local es inválida.");
    }
  }

  async function createSource() {
    if (mode !== "live" || !canEdit) {
      setNotice("Solo un editor puede crear una Browser Source durante el modo en vivo.");
      return;
    }
    setBusy("create");
    setNotice(null);
    setCreated(null);
    try {
      const next = await createPresentationBroadcastLink(serviceId, { label: label.trim(), ttlHours: Math.max(1, Math.min(24, Number(ttlHours) || 8)) });
      setCreated(next);
      setLinks((current) => [next.link, ...current.filter((link) => link.id !== next.link.id)]);
      setNotice("Fuente creada. La URL completa se muestra una sola vez.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo crear la fuente de navegador.");
    } finally {
      setBusy(null);
    }
  }

  async function copySource() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setNotice("URL copiada. Pégala como Browser Source en OBS.");
    } catch {
      await Share.share({ title: "Tchurch Browser Source", text: created.url, dialogTitle: "Compartir fuente de navegador" });
    }
  }

  async function revoke(linkId: string) {
    if (mode !== "live" || !canEdit) {
      setNotice("Solo un editor puede revocar una Browser Source.");
      return;
    }
    setBusy(`revoke:${linkId}`);
    setNotice(null);
    try {
      const response = await revokePresentationBroadcastLink(serviceId, linkId);
      setLinks(response.links);
      if (created?.link.id === linkId) setCreated(null);
      setNotice("Fuente revocada.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo revocar la fuente.");
    } finally {
      setBusy(null);
    }
  }

  async function connectObs() {
    if (mode !== "live" || !canOperateExternal) {
      setNotice("Necesitas el control de producción activo para conectar OBS.");
      return;
    }
    const requestedScope = connectorScope;
    setObsState("connecting");
    setNotice(null);
    setScenes([]);
    try {
      const endpoint = normalizePresentationConnectorEndpoint(settings.obsEndpoint, "obs");
      const client = new ObsWebSocketClient();
      disconnectActivePresentationObsConnection();
      obsRef.current = client;
      const connected = await client.connect(endpoint, obsPassword);
      setObsPassword("");
      if (connectorScopeRef.current !== requestedScope || !canOperateExternalRef.current || modeRef.current !== "live") {
        client.disconnect();
        throw new Error("El control o la identidad cambió antes de terminar la conexión con OBS.");
      }
      const response = await client.request("GetSceneList", {}, { mode });
      if (connectorScopeRef.current !== requestedScope || !canOperateExternalRef.current || modeRef.current !== "live") {
        client.disconnect();
        throw new Error("El control o la identidad cambió mientras OBS respondía.");
      }
      setActivePresentationObsConnection({ client, endpoint, version: connected.version, scope: requestedScope });
      setObsVersion(connected.version);
      setObsState("connected");
      const rawScenes = Array.isArray(response.scenes) ? response.scenes : [];
      const names = rawScenes.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const name = (entry as { sceneName?: unknown }).sceneName;
        return typeof name === "string" && name.trim() && name.length <= 120 ? [name.trim()] : [];
      }).slice(0, 100);
      setScenes(names);
      const current = typeof response.currentProgramSceneName === "string" ? response.currentProgramSceneName : names[0] || "";
      setSelectedScene(current);
      setNotice(`OBS ${connected.version} conectado. La contraseña se eliminó de memoria.`);
    } catch (error) {
      setObsPassword("");
      disconnectActivePresentationObsConnection(requestedScope);
      obsRef.current?.disconnect();
      obsRef.current = null;
      setObsState("disconnected");
      setNotice(error instanceof Error ? error.message : "No se pudo conectar con OBS.");
    }
  }

  async function selectObsScene(sceneName: string) {
    setSelectedScene(sceneName);
    if (!obsRef.current || mode !== "live" || !canOperateExternal) {
      setNotice("Necesitas el control de producción activo para cambiar escenas en OBS.");
      return;
    }
    setBusy("scene");
    setNotice(null);
    try {
      await obsRef.current.request("SetCurrentProgramScene", { sceneName }, { mode });
      setNotice(`Escena “${sceneName}” enviada a OBS.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cambiar la escena.");
    } finally {
      setBusy(null);
    }
  }

  async function changeStream(operation: "start" | "stop") {
    if (!obsRef.current || mode !== "live" || !canOperateExternal || !canEdit || confirmStream !== operation) {
      setNotice("Iniciar o detener el stream requiere control activo, permiso de edición y confirmación explícita.");
      return;
    }
    setBusy(`stream:${operation}`);
    setNotice(null);
    try {
      await obsRef.current.request(operation === "start" ? "StartStream" : "StopStream", {}, { mode });
      setNotice(operation === "start" ? "OBS confirmó el inicio del stream." : "OBS confirmó que el stream se detuvo.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "OBS no confirmó la acción.");
    } finally {
      setBusy(null);
      setConfirmStream(null);
    }
  }

  if (loading) return <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-500" /></div>;

  return (
    <section className="space-y-5">
      <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-200">Salida profesional</p><h3 className="mt-1 text-xl font-black text-white">Broadcast y OBS</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Browser Source usa un token separado y mínimo. OBS WebSocket 5 corre en tu red local; su contraseña vive solo en memoria.</p></div>
      {mode === "rehearsal" ? <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-4"><p className="text-sm font-black text-amber-100">Ensayo protegido</p><p className="mt-1 text-xs leading-5 text-amber-100/70">No se crean fuentes, no se cambia escena y nunca se inicia o detiene stream. Las automatizaciones OBS se simulan.</p></div> : null}
      {notice ? <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-slate-200" role="status">{notice}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className={`${canEdit ? "" : "hidden "}rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5`}>
          <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-300/10 text-rose-200"><MonitorPlay className="h-5 w-5" /></div><div><h4 className="font-black text-white">Browser Source</h4><p className="mt-1 text-xs leading-5 text-slate-500">Para letras, Biblia y medios dentro de una escena OBS.</p></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_auto]"><div><Label className="text-xs font-bold text-slate-300">Etiqueta</Label><Input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} disabled={mode !== "live" || !canEdit} className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white" /></div><div><Label className="text-xs font-bold text-slate-300">Horas</Label><Input type="number" min={1} max={24} value={ttlHours} onChange={(event) => setTtlHours(event.target.value)} disabled={mode !== "live" || !canEdit} className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white" /></div><Button className="mt-auto h-11 rounded-xl bg-rose-400 font-black text-slate-950 hover:bg-rose-300" disabled={mode !== "live" || !canEdit || busy === "create" || !label.trim()} onClick={() => void createSource()}>{busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cast className="h-4 w-4" />}Crear</Button></div>
          {created ? <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.08] p-3"><div className="flex items-center gap-2 text-xs font-black text-emerald-100"><CheckCircle2 className="h-4 w-4" />Disponible una sola vez</div><p className="mt-2 break-all rounded-lg bg-black/30 p-2 font-mono text-[10px] leading-5 text-emerald-100/80">{created.url}</p><div className="mt-2 flex gap-2"><Button variant="outline" className="h-11 rounded-xl border-emerald-200/20 bg-emerald-200/10 text-emerald-100 hover:bg-emerald-200/15 hover:text-emerald-50" onClick={() => void copySource()}><Copy className="h-4 w-4" />Copiar</Button><Button variant="ghost" className="h-11 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setCreated(null)}>Ocultar ahora</Button></div></div> : null}
          <div className="mt-5 space-y-2"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Fuentes activas</p>{links.filter((link) => !link.revokedAt && Date.parse(link.expiresAt) > Date.now()).map((link) => <div key={link.id} className="flex min-h-12 items-center gap-3 rounded-xl bg-black/20 px-3"><Radio className="h-4 w-4 text-rose-200" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-slate-200">{link.label}</p><p className="text-[10px] text-slate-600">Expira {date(link.expiresAt)}</p></div><Button variant="ghost" aria-label={`Revocar ${link.label}`} className="h-11 w-11 rounded-xl text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={!canEdit || mode !== "live" || busy === `revoke:${link.id}`} onClick={() => void revoke(link.id)}>{busy === `revoke:${link.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button></div>)}{!links.some((link) => !link.revokedAt && Date.parse(link.expiresAt) > Date.now()) ? <p className="rounded-xl bg-black/20 p-4 text-center text-xs text-slate-600">No hay fuentes activas.</p> : null}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-300/10 text-blue-200"><Wifi className="h-5 w-5" /></div><div><h4 className="font-black text-white">OBS WebSocket 5</h4><p className="mt-1 text-xs leading-5 text-slate-500">Puerto predeterminado 4455. Usa una contraseña en OBS.</p></div></div>
          <div className="mt-4 space-y-3"><div><Label className="text-xs font-bold text-slate-300">Dirección local</Label><Input value={settings.obsEndpoint} onChange={(event) => setSettings((current) => ({ ...current, obsEndpoint: event.target.value }))} onBlur={() => saveSettings()} disabled={mode !== "live" || !canOperateExternal} className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 font-mono text-xs text-white" /></div><div><Label className="text-xs font-bold text-slate-300">Contraseña · solo memoria</Label><div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2"><Input type="password" autoComplete="off" value={obsPassword} onChange={(event) => setObsPassword(event.target.value)} disabled={mode !== "live" || !canOperateExternal} className="h-11 rounded-xl border-white/10 bg-black/20 text-white" /><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.05] text-white hover:bg-white/10 hover:text-white" disabled={mode !== "live" || !canOperateExternal || obsState === "connecting"} onClick={() => void connectObs()}>{obsState === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{obsState === "connected" ? "Reconectar" : "Conectar"}</Button></div></div></div>
          {obsState === "connected" ? <div className="mt-4 rounded-xl border border-blue-300/15 bg-blue-300/[0.06] p-3"><p className="text-xs font-black text-blue-100">Conectado · {obsVersion}</p><div className="mt-3"><Label className="text-xs font-bold text-slate-300">Escena de programa</Label><Select value={selectedScene || undefined} disabled={mode !== "live" || !canOperateExternal || busy === "scene"} onValueChange={(value) => void selectObsScene(value)}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue placeholder="Sin escenas" /></SelectTrigger><SelectContent>{scenes.map((scene) => <SelectItem key={scene} value={scene}>{scene}</SelectItem>)}</SelectContent></Select></div><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" className="h-11 rounded-xl border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15 hover:text-emerald-50" disabled={mode !== "live" || !canOperateExternal || !canEdit} onClick={() => setConfirmStream("start")}><Radio className="h-4 w-4" />Iniciar stream</Button><Button variant="outline" className="h-11 rounded-xl border-red-300/20 bg-red-300/10 text-red-100 hover:bg-red-300/15 hover:text-red-50" disabled={mode !== "live" || !canOperateExternal || !canEdit} onClick={() => setConfirmStream("stop")}><Square className="h-4 w-4" />Detener stream</Button></div></div> : null}
          {confirmStream ? <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3"><div className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><p className="text-xs leading-5 text-amber-100">Confirma manualmente: {confirmStream === "start" ? "OBS comenzará a transmitir" : "OBS detendrá la transmisión"}. Ninguna automatización puede hacer esto.</p></div><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" className="h-11 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setConfirmStream(null)}>Cancelar</Button><Button className={`h-11 rounded-xl font-black ${confirmStream === "start" ? "bg-emerald-400 text-slate-950 hover:bg-emerald-300" : "bg-red-400 text-white hover:bg-red-300"}`} disabled={busy === `stream:${confirmStream}`} onClick={() => void changeStream(confirmStream)}>{busy === `stream:${confirmStream}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar</Button></div></div> : null}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-700/30 text-slate-300"><Cast className="h-5 w-5" /></div><div><p className="font-black text-slate-200">NDI requiere Tchurch Studio</p><p className="mt-1 text-xs leading-5 text-slate-500">La app iOS no incluye ni afirma incluir el SDK comercial de NDI. La futura app de Mac ejecutará el bridge y convertirá el frame feed de Tchurch en una salida NDI local.</p></div></div></div>
    </section>
  );
}
