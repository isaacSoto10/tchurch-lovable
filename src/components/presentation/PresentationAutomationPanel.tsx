import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronUp, Loader2, PlayCircle, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  PRESENTATION_PRODUCTION_MAX_ACTIONS,
  PRESENTATION_PRODUCTION_MAX_RULES,
  PRESENTATION_SLIDE_KINDS,
  PRESENTATION_STAGE_MESSAGE_MAX_LIFETIME_SECONDS,
  PRESENTATION_STAGE_MESSAGE_MIN_LIFETIME_SECONDS,
  dispatchPresentationAutomation,
  fetchPresentationAutomations,
  updatePresentationAutomations,
  type PresentationAutomationAction,
  type PresentationAutomationEnvelope,
  type PresentationAutomationEventInput,
  type PresentationAutomationRule,
  type PresentationAutomationTrigger,
  type PresentationAutomationTriggerType,
  type PresentationOutputSlideKind,
  type PresentationRunMode,
  type PresentationStageMessageRole,
} from "@/lib/presentationProduction";
import {
  projectPresentationAutomationOccurredAt,
  projectPresentationAutomationTiming,
  type PresentationAutomationRuntimeState,
} from "@/hooks/usePresentationAutomations";
import type { PresentationLiveSnapshot } from "@/lib/presentationLive";

type PresentationAutomationPanelProps = {
  serviceId: string;
  mode: PresentationRunMode;
  canEdit: boolean;
  controllerOwned: boolean;
  snapshot: PresentationLiveSnapshot | null;
  clientId: string;
  runtimeState: PresentationAutomationRuntimeState;
};

const TRIGGER_LABELS: Record<PresentationAutomationTriggerType, string> = {
  session_started: "Al iniciar sesión",
  session_ended: "Al terminar sesión",
  slide_entered: "Al entrar a un tipo de slide",
  countdown_elapsed: "Al terminar cuenta regresiva",
  item_elapsed: "Al pasar tiempo del elemento",
};

const ACTION_LABELS: Record<PresentationAutomationAction["type"], string> = {
  stage_message: "Mensaje al escenario",
  set_blackout: "Cambiar salida en negro",
  set_chords: "Cambiar acordes",
  obs_scene: "Cambiar escena de OBS",
  broadcast_visibility: "Cambiar visibilidad broadcast",
};

const SLIDE_KIND_LABELS: Record<PresentationOutputSlideKind, string> = {
  lyrics: "Letra",
  scripture: "Biblia",
  image: "Imagen",
  video: "Video",
  audio: "Audio",
  countdown: "Conteo",
  sermon: "Sermón",
  announcement: "Anuncio",
  blank: "En blanco",
};

const STAGE_ROLE_OPTIONS: Array<{ value: PresentationStageMessageRole; label: string }> = [
  { value: "worship_leader", label: "Líder" },
  { value: "band", label: "Banda" },
  { value: "vocals", label: "Voces" },
  { value: "av", label: "A/V" },
  { value: "speaker", label: "Orador" },
  { value: "operator", label: "Operador" },
  { value: "stage", label: "Escenario" },
  { value: "all", label: "Todos" },
];

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("Este dispositivo no puede crear identificadores de automatización seguros.");
}

function id(prefix: string) {
  return `${prefix}-${uuid()}`;
}

function defaultAction(type: PresentationAutomationAction["type"]): PresentationAutomationAction {
  if (type === "stage_message") return { type, body: "Siguiente momento", tone: "info", roles: ["all"], lifetimeSeconds: 20 };
  if (type === "set_blackout") return { type, enabled: true };
  if (type === "set_chords") return { type, visible: true };
  if (type === "obs_scene") return { type, sceneName: "Wide" };
  return { type, visible: true };
}

function defaultTrigger(type: PresentationAutomationTriggerType): PresentationAutomationTrigger {
  if (type === "slide_entered") return { type, slideKinds: [] };
  if (type === "item_elapsed") return { type, afterSeconds: 300 };
  return { type };
}

function newRule(priority: number): PresentationAutomationRule {
  return {
    id: id("rule"),
    name: "Nueva automatización",
    enabled: true,
    modes: { live: true, rehearsal: true },
    priority,
    trigger: { type: "session_started" },
    actions: [defaultAction("stage_message")],
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

function actionType(action: PresentationAutomationAction, type: PresentationAutomationAction["type"]) {
  return action.type === type ? action : defaultAction(type);
}

function toggleSlideKind(current: PresentationOutputSlideKind[], value: PresentationOutputSlideKind, checked: boolean): PresentationOutputSlideKind[] {
  return checked ? [...new Set([...current, value])] : current.filter((kind) => kind !== value);
}

function toggleStageRole(current: PresentationStageMessageRole[], value: PresentationStageMessageRole, checked: boolean): PresentationStageMessageRole[] {
  if (checked && value === "all") return ["all"];
  if (checked) return [...new Set([...current.filter((role) => role !== "all"), value])];
  const remaining = current.filter((role) => role !== value);
  return remaining.length ? remaining : current;
}

function buildSimulationEvent(rule: PresentationAutomationRule, snapshot: PresentationLiveSnapshot): PresentationAutomationEventInput {
  const session = snapshot.session;
  if (!session || session.mode !== "rehearsal" || session.status !== "live") throw new Error("Inicia el ensayo antes de simular una regla.");
  const deviceNowMs = Date.now();
  const occurredAt = rule.trigger.type === "session_started"
    ? session.startedAt
    : projectPresentationAutomationOccurredAt(snapshot, deviceNowMs);
  const common = { id: uuid(), occurredAt, sessionId: session.id, revision: session.revision };
  if (rule.trigger.type === "item_elapsed") {
    const timing = projectPresentationAutomationTiming(snapshot, deviceNowMs)?.item;
    const elapsedSeconds = Math.max(0, Math.floor(timing?.elapsedSeconds || 0));
    if (!timing?.itemId || timing.status !== "running" || !timing.startedAt || elapsedSeconds < rule.trigger.afterSeconds) throw new Error(`El temporizador todavía no llega a ${rule.trigger.afterSeconds} segundos.`);
    return { ...common, type: "item_elapsed", thresholdSeconds: rule.trigger.afterSeconds, elapsedSeconds };
  }
  if (rule.trigger.type === "countdown_elapsed") {
    const countdown = projectPresentationAutomationTiming(snapshot, deviceNowMs)?.countdown;
    if (!countdown || countdown.remainingSeconds > 0) throw new Error("La cuenta regresiva todavía no termina.");
  }
  return { ...common, type: rule.trigger.type };
}

export function PresentationAutomationPanel({ serviceId, mode, canEdit, controllerOwned, snapshot, clientId, runtimeState }: PresentationAutomationPanelProps) {
  const [envelope, setEnvelope] = useState<PresentationAutomationEnvelope | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "simulate" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice(null);
    void fetchPresentationAutomations(serviceId).then((next) => {
      if (active) setEnvelope(next);
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : "No se pudieron cargar las automatizaciones.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [serviceId]);

  const enabledCount = useMemo(() => envelope?.rules.filter((rule) => rule.enabled && rule.modes[mode]).length || 0, [envelope?.rules, mode]);

  function mutateRule(ruleId: string, mutator: (rule: PresentationAutomationRule) => PresentationAutomationRule) {
    setEnvelope((current) => current ? { ...current, rules: current.rules.map((rule) => rule.id === ruleId ? mutator(rule) : rule) } : current);
  }

  function addRule() {
    if (!envelope || envelope.rules.length >= PRESENTATION_PRODUCTION_MAX_RULES) return;
    try {
      const rule = newRule(envelope.rules.length * 10);
      setEnvelope((current) => current && current.rules.length < PRESENTATION_PRODUCTION_MAX_RULES
        ? { ...current, rules: [...current.rules, rule] }
        : current);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo crear la regla.");
    }
  }

  async function save() {
    if (!envelope || !canEdit) return;
    setBusy("save");
    setNotice(null);
    try {
      const saved = await updatePresentationAutomations(serviceId, envelope);
      setEnvelope(saved);
      setNotice("Automatizaciones guardadas.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron guardar las automatizaciones.");
      const latest = await fetchPresentationAutomations(serviceId).catch(() => null);
      if (latest) setEnvelope(latest);
    } finally {
      setBusy(null);
    }
  }

  async function simulate() {
    if (!controllerOwned || !snapshot?.session || snapshot.session.mode !== "rehearsal" || snapshot.session.status !== "live") {
      setNotice("Inicia el ensayo antes de simular una regla.");
      return;
    }
    const rule = envelope?.rules.find((candidate) => candidate.enabled && candidate.modes.rehearsal);
    if (!rule) {
      setNotice("Activa una regla para ensayo antes de simular.");
      return;
    }
    setBusy("simulate");
    setNotice(null);
    try {
      const result = await dispatchPresentationAutomation(serviceId, { mode: "rehearsal", clientId, event: buildSimulationEvent(rule, snapshot) });
      setNotice(result.actions.length ? `${result.actions.length} acción(es) simuladas. No se cambió OBS, broadcast ni la salida en vivo.` : "La simulación no produjo acciones para este evento.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo simular la automatización.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-500" /></div>;

  return (
    <section>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Motor de cues</p><h3 className="mt-1 text-xl font-black text-white">Automatizaciones deterministas</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Hasta 20 reglas, cuatro acciones por regla. En ensayo todas las entregas son simuladas; iniciar o detener stream nunca es una acción automática.</p></div>
        <div className="flex gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={!canEdit || !envelope || envelope.rules.length >= PRESENTATION_PRODUCTION_MAX_RULES} onClick={addRule}><Plus className="h-4 w-4" />Regla</Button><Button className="h-11 rounded-xl bg-cyan-400 font-black text-slate-950 hover:bg-cyan-300" disabled={!canEdit || !envelope || busy === "save"} onClick={() => void save()}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar</Button></div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Revisión</p><p className="mt-1 text-lg font-black text-white">{envelope?.revision ?? "—"}</p></div><div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Activas aquí</p><p className="mt-1 text-lg font-black text-white">{enabledCount}</p></div><div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Modo</p><p className={`mt-1 text-sm font-black ${mode === "rehearsal" ? "text-amber-200" : "text-emerald-200"}`}>{mode === "rehearsal" ? "Ensayo · simulado" : "En vivo · ejecutable"}</p></div></div>

      <div className={`mt-4 rounded-xl border px-3 py-3 text-xs ${runtimeState.phase === "error" ? "border-red-300/20 bg-red-300/[0.08] text-red-100" : runtimeState.phase === "applying" || runtimeState.phase === "dispatching" ? "border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-100" : "border-white/10 bg-white/[0.035] text-slate-300"}`} role="status"><span className="font-black">Motor: {runtimeState.phase === "applying" ? "aplicando" : runtimeState.phase === "dispatching" ? "registrando evento" : runtimeState.phase === "error" ? "requiere atención" : "listo"}</span>{runtimeState.queuedEvents ? ` · ${runtimeState.queuedEvents} evento(s) en cola` : ""}{runtimeState.notice ? <span className="mt-1 block leading-5 opacity-80">{runtimeState.notice}</span> : null}</div>

      {notice ? <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100" role="status">{notice}</div> : null}

      <div className="mt-4 space-y-3">
        {!envelope?.rules.length ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center"><Bot className="mx-auto h-8 w-8 text-slate-700" /><p className="mt-3 text-sm font-bold text-slate-300">Todavía no hay reglas</p><p className="mt-1 text-xs text-slate-500">Empieza con un aviso al escenario o una visibilidad de broadcast.</p></div> : null}
        {envelope?.rules.map((rule) => {
          const expanded = expandedId === rule.id;
          return (
            <article key={rule.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
              <div className="flex min-h-14 items-center gap-3 px-3 py-2 sm:px-4"><Switch checked={rule.enabled} disabled={!canEdit} onCheckedChange={(enabled) => mutateRule(rule.id, (current) => ({ ...current, enabled }))} aria-label={`Activar ${rule.name}`} /><button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => setExpandedId(expanded ? null : rule.id)}><span className="block truncate text-sm font-black text-white">{rule.name}</span><span className="block truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{TRIGGER_LABELS[rule.trigger.type]} · {rule.actions.length} acción(es)</span></button><button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white" aria-label={expanded ? "Cerrar regla" : "Editar regla"} onClick={() => setExpandedId(expanded ? null : rule.id)}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></div>
              {expanded ? (
                <div className="border-t border-white/10 p-4">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]"><div><Label className="text-xs font-bold text-slate-300">Nombre</Label><Input value={rule.name} maxLength={100} disabled={!canEdit} onChange={(event) => mutateRule(rule.id, (current) => ({ ...current, name: event.target.value }))} className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white" /></div><div><Label className="text-xs font-bold text-slate-300">Disparador</Label><Select value={rule.trigger.type} disabled={!canEdit} onValueChange={(value) => mutateRule(rule.id, (current) => ({ ...current, trigger: defaultTrigger(value as PresentationAutomationTriggerType) }))}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TRIGGER_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-xs font-bold text-slate-300">Prioridad · 0 primero</Label><Input aria-label="Prioridad de automatización" type="number" min={0} max={1000} step={1} value={rule.priority} disabled={!canEdit} onChange={(event) => mutateRule(rule.id, (current) => ({ ...current, priority: Math.max(0, Math.min(1_000, Math.floor(Number(event.target.value) || 0))) }))} className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white" /></div></div>
                  {rule.trigger.type === "slide_entered" ? <fieldset className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3"><legend className="px-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Tipos de slide · vacío = cualquiera</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{PRESENTATION_SLIDE_KINDS.map((kind) => <label key={kind} className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 text-xs font-bold text-slate-300"><input type="checkbox" checked={rule.trigger.type === "slide_entered" && rule.trigger.slideKinds.includes(kind)} disabled={!canEdit} onChange={(event) => mutateRule(rule.id, (current) => current.trigger.type === "slide_entered" ? { ...current, trigger: { ...current.trigger, slideKinds: toggleSlideKind(current.trigger.slideKinds, kind, event.target.checked) } } : current)} />{SLIDE_KIND_LABELS[kind]}</label>)}</div></fieldset> : null}
                  {rule.trigger.type === "item_elapsed" ? <div className="mt-4 max-w-xs"><Label className="text-xs font-bold text-slate-300">Después de segundos</Label><Input type="number" min={1} max={21600} value={rule.trigger.afterSeconds} disabled={!canEdit} onChange={(event) => mutateRule(rule.id, (current) => ({ ...current, trigger: { type: "item_elapsed", afterSeconds: Math.max(1, Math.min(21600, Number(event.target.value) || 1)) } }))} className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white" /></div> : null}
                  <div className="mt-4 grid gap-2 sm:grid-cols-2"><label className="flex min-h-11 items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 text-xs font-bold text-slate-300">En vivo<Switch checked={rule.modes.live} disabled={!canEdit} onCheckedChange={(live) => mutateRule(rule.id, (current) => ({ ...current, modes: { ...current.modes, live } }))} /></label><label className="flex min-h-11 items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 text-xs font-bold text-slate-300">Ensayo simulado<Switch checked={rule.modes.rehearsal} disabled={!canEdit} onCheckedChange={(rehearsal) => mutateRule(rule.id, (current) => ({ ...current, modes: { ...current.modes, rehearsal } }))} /></label></div>
                  <div className="mt-5 flex items-center justify-between"><div><p className="text-xs font-black text-slate-200">Acciones</p><p className="text-[10px] text-slate-500">Se ejecutan en este orden.</p></div><Button variant="ghost" className="h-11 rounded-xl text-xs text-cyan-200 hover:bg-cyan-300/10 hover:text-cyan-100" disabled={!canEdit || rule.actions.length >= PRESENTATION_PRODUCTION_MAX_ACTIONS} onClick={() => mutateRule(rule.id, (current) => ({ ...current, actions: [...current.actions, defaultAction("stage_message")] }))}><Plus className="h-4 w-4" />Acción</Button></div>
                  <div className="mt-2 space-y-3">{rule.actions.map((action, actionIndex) => <AutomationActionEditor key={`${rule.id}-${actionIndex}`} action={action} disabled={!canEdit} canRemove={rule.actions.length > 1} onChange={(next) => mutateRule(rule.id, (current) => ({ ...current, actions: current.actions.map((candidate, index) => index === actionIndex ? next : candidate) }))} onRemove={() => mutateRule(rule.id, (current) => ({ ...current, actions: current.actions.filter((_, index) => index !== actionIndex) }))} />)}</div>
                  <div className="mt-5 flex justify-end"><Button variant="ghost" className="h-11 rounded-xl text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={!canEdit} onClick={() => { setEnvelope((current) => current ? { ...current, rules: current.rules.filter((candidate) => candidate.id !== rule.id) } : current); setExpandedId(null); }}><Trash2 className="h-4 w-4" />Eliminar regla</Button></div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {mode === "rehearsal" ? <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-4"><p className="text-sm font-black text-amber-100">Prueba segura de ensayo</p><p className="mt-1 text-xs leading-5 text-amber-100/70">El servidor devuelve entregas simuladas. Tchurch no toca OBS, ProPresenter, broadcast ni la sesión en vivo.</p><Button variant="outline" className="mt-3 h-11 rounded-xl border-amber-200/20 bg-amber-200/10 text-amber-100 hover:bg-amber-200/15 hover:text-amber-50" disabled={busy === "simulate" || !controllerOwned || !snapshot?.session} onClick={() => void simulate()}>{busy === "simulate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}Simular regla activa</Button></div> : null}
    </section>
  );
}

function AutomationActionEditor({ action, disabled, canRemove, onChange, onRemove }: { action: PresentationAutomationAction; disabled: boolean; canRemove: boolean; onChange: (action: PresentationAutomationAction) => void; onRemove: () => void }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_3rem]"><Select value={action.type} disabled={disabled} onValueChange={(value) => onChange(actionType(action, value as PresentationAutomationAction["type"]))}><SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ACTION_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button variant="ghost" aria-label="Eliminar acción" className="h-11 w-11 rounded-xl text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={disabled || !canRemove} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button></div>
      {action.type === "stage_message" ? <div className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem]"><Input value={action.body} maxLength={160} disabled={disabled} onChange={(event) => onChange({ ...action, body: event.target.value })} className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white" aria-label="Mensaje automático" /><Select value={action.tone} disabled={disabled} onValueChange={(tone) => onChange({ ...action, tone: tone as "info" | "urgent" })}><SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="urgent">Urgente</SelectItem></SelectContent></Select><Input type="number" min={PRESENTATION_STAGE_MESSAGE_MIN_LIFETIME_SECONDS} max={PRESENTATION_STAGE_MESSAGE_MAX_LIFETIME_SECONDS} value={action.lifetimeSeconds} disabled={disabled} onChange={(event) => onChange({ ...action, lifetimeSeconds: Math.max(PRESENTATION_STAGE_MESSAGE_MIN_LIFETIME_SECONDS, Math.min(PRESENTATION_STAGE_MESSAGE_MAX_LIFETIME_SECONDS, Number(event.target.value) || PRESENTATION_STAGE_MESSAGE_MIN_LIFETIME_SECONDS)) })} className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white" aria-label="Duración del mensaje" /></div><fieldset className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3"><legend className="px-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Roles del escenario</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{STAGE_ROLE_OPTIONS.map(({ value, label }) => { const checked = action.roles.includes(value); return <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 text-xs font-bold text-slate-300"><input type="checkbox" checked={checked} disabled={disabled || (checked && action.roles.length === 1)} onChange={(event) => onChange({ ...action, roles: toggleStageRole(action.roles, value, event.target.checked) })} />{label}</label>; })}</div></fieldset></div> : null}
      {action.type === "obs_scene" ? <div className="mt-3"><Input value={action.sceneName} maxLength={120} disabled={disabled} onChange={(event) => onChange({ ...action, sceneName: event.target.value })} className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white" placeholder="Nombre exacto de escena OBS" /></div> : null}
      {action.type === "set_blackout" ? <label className="mt-3 flex min-h-11 items-center justify-between rounded-xl bg-white/[0.04] px-3 text-xs font-bold text-slate-300">Salida en negro<Switch checked={action.enabled} disabled={disabled} onCheckedChange={(enabled) => onChange({ ...action, enabled })} /></label> : null}
      {action.type === "set_chords" || action.type === "broadcast_visibility" ? <label className="mt-3 flex min-h-11 items-center justify-between rounded-xl bg-white/[0.04] px-3 text-xs font-bold text-slate-300">Visible<Switch checked={action.visible} disabled={disabled} onCheckedChange={(visible) => onChange({ ...action, visible })} /></label> : null}
    </div>
  );
}
