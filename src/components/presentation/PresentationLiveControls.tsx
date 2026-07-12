import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Cast,
  Check,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Eye,
  EyeOff,
  Gauge,
  Hand,
  Loader2,
  MessageSquareText,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  TimerReset,
  Unplug,
  UserRoundCheck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  PresentationCommandPayloads,
  PresentationCommandType,
  PresentationLiveSnapshot,
  PresentationNetworkState,
  PresentationOfflineStep,
  PresentationPrivateLiveView,
  PresentationStageMessage,
  PresentationTiming,
} from "@/lib/presentationLive";
import type { PresentationRunStep } from "@/lib/servicePresentation";
import type { PresentationTargetRole } from "@/lib/presentationWorkspace";

export type PresentationLiveCommandSender = <T extends PresentationCommandType>(
  type: T,
  payload: PresentationCommandPayloads[T],
) => Promise<unknown>;

const MESSAGE_ROLES: Array<{ role: PresentationTargetRole; label: string }> = [
  { role: "all", label: "Todos" },
  { role: "worship_leader", label: "Líder" },
  { role: "band", label: "Banda" },
  { role: "vocals", label: "Voces" },
  { role: "av", label: "A/V" },
  { role: "speaker", label: "Orador" },
  { role: "stage", label: "Escenario" },
];

function formatSeconds(value: number | null | undefined, showSign = false) {
  const total = Math.max(0, Math.round(value || 0));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const text = hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return showSign ? `+${text}` : text;
}

function formatProjectedEnd(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function run(command: () => Promise<unknown>) {
  void command().catch(() => undefined);
}

export function LiveConnectionBadge({
  networkState,
  queueCount,
}: {
  networkState: PresentationNetworkState;
  queueCount: number;
}) {
  if (networkState === "offline") {
    return (
      <span className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/15 px-3 text-[11px] font-black text-amber-100" aria-label={`Modo local, ${queueCount} cambios pendientes`}>
        <WifiOff className="h-3.5 w-3.5" /> Local{queueCount ? ` · ${queueCount}` : ""}
      </span>
    );
  }
  if (networkState === "reconnecting") {
    return <span className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-sky-300/25 bg-sky-300/10 px-3 text-[11px] font-black text-sky-100"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Sincronizando</span>;
  }
  if (networkState === "diverged") {
    return <span className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-red-300/30 bg-red-300/15 px-3 text-[11px] font-black text-red-100"><AlertTriangle className="h-3.5 w-3.5" /> Conflicto</span>;
  }
  return <span className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 text-[11px] font-black text-emerald-100"><Wifi className="h-3.5 w-3.5" /> En vivo</span>;
}

export function PresentationLiveNotice({
  notice,
  networkState,
  queueCount,
  onClose,
  onReconcile,
  onDiscard,
}: {
  notice: string | null;
  networkState: PresentationNetworkState;
  queueCount: number;
  onClose: () => void;
  onReconcile: () => Promise<unknown>;
  onDiscard: () => Promise<unknown>;
}) {
  if (!notice && networkState === "online") return null;
  const local = networkState === "offline";
  const diverged = networkState === "diverged";
  return (
    <div
      className={`relative z-40 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs font-semibold sm:px-5 ${diverged ? "border-red-300/25 bg-red-400/15 text-red-50" : local ? "border-amber-300/20 bg-amber-300/10 text-amber-50" : "border-sky-300/20 bg-sky-300/10 text-sky-50"}`}
      role={diverged ? "alert" : "status"}
    >
      {diverged ? <AlertTriangle className="h-4 w-4 shrink-0" /> : local ? <Unplug className="h-4 w-4 shrink-0" /> : <RefreshCw className="h-4 w-4 shrink-0" />}
      <span className="min-w-[12rem] flex-1">{notice || (diverged ? "Debes elegir entre la copia local y el estado oficial." : local ? "Modo local: todavía no está sincronizado con la nube." : "Actualizando la sesión…")}</span>
      {local && queueCount > 0 && <Button size="sm" className="min-h-11 rounded-xl bg-amber-100 text-amber-950 hover:bg-white" onClick={() => run(onReconcile)}>Reintentar</Button>}
      {diverged && <Button size="sm" variant="outline" className="min-h-11 rounded-xl border-red-100/30 bg-black/15 text-white hover:bg-black/25 hover:text-white" onClick={() => run(onDiscard)}>Usar servidor</Button>}
      {notice && !diverged && <button type="button" aria-label="Cerrar aviso" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10" onClick={onClose}><X className="h-4 w-4" /></button>}
    </div>
  );
}

export function PresentationOwnershipControls({
  snapshot,
  controllerLeaseActive,
  pending,
  onCommand,
  compact = false,
}: {
  snapshot: PresentationLiveSnapshot | null;
  controllerLeaseActive: boolean;
  pending: boolean;
  onCommand: PresentationLiveCommandSender;
  compact?: boolean;
}) {
  const viewer = snapshot?.viewer;
  const session = snapshot?.session;
  const controller = session?.controller;
  const owned = Boolean(controller?.ownedByViewer && controllerLeaseActive);
  if (!viewer) return null;

  if (!session) {
    return viewer.canStart ? (
      <Button className={`${compact ? "h-11" : "h-12"} rounded-xl bg-emerald-500 font-black text-emerald-950 hover:bg-emerald-400`} disabled={pending} onClick={() => run(() => onCommand("start_session", {}))}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Iniciar sesión
      </Button>
    ) : <span className="inline-flex min-h-10 items-center rounded-xl bg-white/[0.06] px-3 text-xs font-bold text-slate-400">Esperando al operador</span>;
  }

  if (owned) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-black text-emerald-100"><ShieldCheck className="h-4 w-4" /> Tú controlas</span>
        {!compact && <Button variant="ghost" className="h-11 rounded-xl border border-white/10 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white" disabled={pending} onClick={() => run(() => onCommand("release_control", {}))}>Soltar</Button>}
      </div>
    );
  }

  if (!viewer.canControl) return <span className="inline-flex min-h-10 items-center rounded-xl bg-white/[0.06] px-3 text-xs font-bold text-slate-400">Solo seguimiento</span>;

  if (!controller || !controllerLeaseActive) {
    return (
      <Button className={`${compact ? "h-11" : "h-12"} rounded-xl bg-violet-500 font-black hover:bg-violet-400`} disabled={pending} onClick={() => run(() => onCommand("claim_control", {}))}>
        <Hand className="h-4 w-4" /> Tomar control
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="max-w-[13rem] truncate rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-slate-300">Control: <strong className="text-white">{controller.displayName}</strong></span>
      <Button variant="outline" className="h-11 rounded-xl border-white/15 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white" disabled={pending} onClick={() => run(() => onCommand("request_control", {}))}><UserRoundCheck className="h-4 w-4" /> Solicitar</Button>
      {viewer.canForceTakeover && <Button variant="ghost" className="h-11 rounded-xl text-amber-100 hover:bg-amber-300/10 hover:text-amber-50" disabled={pending} onClick={() => run(() => onCommand("claim_control", { force: true }))}>Forzar</Button>}
    </div>
  );
}

export function PresentationTimingPanel({
  timing,
  canControl,
  pending,
  onCommand,
  compact = false,
}: {
  timing: PresentationTiming | null;
  canControl: boolean;
  pending: boolean;
  onCommand: PresentationLiveCommandSender;
  compact?: boolean;
}) {
  const [countdownMinutes, setCountdownMinutes] = useState("5");
  if (!timing) return <div className="rounded-2xl border border-dashed border-white/15 p-4 text-center text-sm text-slate-500">Los relojes aparecen al iniciar la sesión.</div>;
  const serviceOver = timing.service.overrunSeconds > 0;
  const itemOver = timing.item.overrunSeconds > 0;
  const timerButton = "h-11 min-w-11 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-white hover:bg-white/10 hover:text-white";

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-400">Servicio</span><Gauge className="h-4 w-4 text-violet-200" /></div>
        <div className="mt-2 flex items-end justify-between gap-2"><span className="text-2xl font-black tabular-nums">{formatSeconds(timing.service.elapsedSeconds)}</span><span className={`text-xs font-black tabular-nums ${serviceOver ? "text-red-300" : "text-emerald-200"}`}>{serviceOver ? formatSeconds(timing.service.overrunSeconds, true) : `−${formatSeconds(timing.service.remainingSeconds)}`}</span></div>
        <p className="mt-1 text-[10px] font-semibold text-slate-500">Fin proyectado {formatProjectedEnd(timing.service.projectedEndAt)}</p>
        {canControl && <div className="mt-3 flex gap-1.5"><Button variant="ghost" aria-label="Iniciar reloj del servicio" className={timerButton} disabled={pending || timing.service.status === "running"} onClick={() => run(() => onCommand("timer_start", { scope: "service" }))}><CirclePlay className="h-4 w-4" /></Button><Button variant="ghost" aria-label="Pausar reloj del servicio" className={timerButton} disabled={pending || timing.service.status === "paused"} onClick={() => run(() => onCommand("timer_pause", { scope: "service" }))}><CirclePause className="h-4 w-4" /></Button><Button variant="ghost" aria-label="Restaurar reloj del servicio" className={timerButton} disabled={pending} onClick={() => run(() => onCommand("timer_reset", { scope: "service" }))}><TimerReset className="h-4 w-4" /></Button></div>}
      </div>

      <div className={`rounded-2xl border p-3 ${itemOver ? "border-red-300/25 bg-red-400/10" : "border-white/10 bg-black/20"}`}>
        <div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-400">Elemento</span><Clock3 className={`h-4 w-4 ${itemOver ? "text-red-200" : "text-violet-200"}`} /></div>
        <div className="mt-2 flex items-end justify-between gap-2"><span className="text-2xl font-black tabular-nums">{formatSeconds(timing.item.elapsedSeconds)}</span><span className={`text-xs font-black tabular-nums ${itemOver ? "text-red-300" : "text-slate-400"}`}>{itemOver ? formatSeconds(timing.item.overrunSeconds, true) : `/ ${formatSeconds(timing.item.plannedSeconds)}`}</span></div>
        <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">{timing.item.itemId || "Sin elemento activo"}</p>
        {canControl && <div className="mt-3 flex gap-1.5"><Button variant="ghost" aria-label="Iniciar reloj del elemento" className={timerButton} disabled={pending || timing.item.status === "running"} onClick={() => run(() => onCommand("timer_start", { scope: "item" }))}><CirclePlay className="h-4 w-4" /></Button><Button variant="ghost" aria-label="Pausar reloj del elemento" className={timerButton} disabled={pending || timing.item.status === "paused"} onClick={() => run(() => onCommand("timer_pause", { scope: "item" }))}><CirclePause className="h-4 w-4" /></Button><Button variant="ghost" aria-label="Restaurar reloj del elemento" className={timerButton} disabled={pending} onClick={() => run(() => onCommand("timer_reset", { scope: "item" }))}><TimerReset className="h-4 w-4" /></Button></div>}
      </div>

      <div className={`${compact ? "col-span-1" : "col-span-1 sm:col-span-2"} rounded-2xl border border-white/10 bg-white/[0.04] p-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[8rem] flex-1"><p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-500">Cuenta regresiva</p><p className={`mt-1 text-xl font-black tabular-nums ${timing.countdown && timing.countdown.remainingSeconds <= 10 ? "text-amber-200" : "text-white"}`}>{timing.countdown ? formatSeconds(timing.countdown.remainingSeconds) : "Sin cuenta"}</p></div>
          {canControl && <><div className="flex h-11 items-center overflow-hidden rounded-xl border border-white/10 bg-black/20"><Input aria-label="Minutos de cuenta regresiva" inputMode="numeric" className="h-11 w-14 border-0 bg-transparent px-2 text-center font-black text-white" value={countdownMinutes} onChange={(event) => setCountdownMinutes(event.target.value.replace(/\D/g, "").slice(0, 3))} /><span className="pr-2 text-[10px] font-bold text-slate-500">min</span></div><Button className="h-11 rounded-xl bg-violet-500 font-black hover:bg-violet-400" disabled={pending || !Number(countdownMinutes)} onClick={() => run(() => onCommand("countdown_set", { durationSeconds: Math.max(5, Math.min(86_400, Number(countdownMinutes) * 60)) }))}>Iniciar</Button>{timing.countdown && <Button variant="ghost" className="h-11 rounded-xl text-slate-300 hover:bg-white/10 hover:text-white" disabled={pending} onClick={() => run(() => onCommand("countdown_clear", {}))}>Quitar</Button>}</>}
        </div>
      </div>
    </div>
  );
}

function StageMessageComposer({ pending, onCommand }: { pending: boolean; onCommand: PresentationLiveCommandSender }) {
  const [body, setBody] = useState("");
  const [tone, setTone] = useState<"info" | "urgent">("info");
  const [lifetimeSeconds, setLifetimeSeconds] = useState(30);
  const [roles, setRoles] = useState<PresentationTargetRole[]>(["all"]);
  const valid = body.trim().length > 0 && body.trim().length <= 160 && roles.length > 0;

  function toggleRole(role: PresentationTargetRole) {
    setRoles((current) => {
      if (role === "all") return current.includes("all") ? [] : ["all"];
      const withoutAll = current.filter((candidate) => candidate !== "all");
      return withoutAll.includes(role) ? withoutAll.filter((candidate) => candidate !== role) : [...withoutAll, role];
    });
  }

  async function send() {
    if (!valid) return;
    await onCommand("stage_message_send", { body: body.trim(), tone, lifetimeSeconds, roles });
    setBody("");
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.17em] text-violet-200">Mensaje privado</p><p className="text-xs text-slate-400">Desaparece automáticamente</p></div><MessageSquareText className="h-5 w-5 text-violet-200" /></div>
      <Textarea aria-label="Mensaje para el escenario" maxLength={160} rows={2} className="mt-3 resize-none rounded-xl border-white/10 bg-white/[0.06] text-white placeholder:text-slate-600" placeholder="Ej. Repite el coro una vez…" value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-slate-500"><span>{tone === "urgent" ? "Urgente" : "Informativo"}</span><span>{body.length}/160</span></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{MESSAGE_ROLES.map(({ role, label }) => <button key={role} type="button" aria-pressed={roles.includes(role)} className={`min-h-11 rounded-xl px-3 text-[11px] font-black ring-1 ${roles.includes(role) ? "bg-violet-500 text-white ring-violet-400" : "bg-white/[0.05] text-slate-400 ring-white/10"}`} onClick={() => toggleRole(role)}>{label}</button>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={tone === "urgent"} className={`min-h-11 rounded-xl px-3 text-xs font-black ${tone === "urgent" ? "bg-red-500 text-white" : "bg-white/[0.06] text-slate-300"}`} onClick={() => setTone((current) => current === "urgent" ? "info" : "urgent")}>Urgente</button>
        <select aria-label="Duración del mensaje" className="h-11 rounded-xl border border-white/10 bg-[#15131d] px-3 text-xs font-bold text-white" value={lifetimeSeconds} onChange={(event) => setLifetimeSeconds(Number(event.target.value))}><option value={10}>10 s</option><option value={30}>30 s</option><option value={60}>1 min</option><option value={120}>2 min</option></select>
        <Button className="ml-auto h-11 rounded-xl bg-violet-500 font-black hover:bg-violet-400" disabled={pending || !valid} onClick={() => run(send)}><Send className="h-4 w-4" /> Enviar</Button>
      </div>
    </div>
  );
}

export function PresentationStageMessages({
  messages,
  canDismiss,
  onCommand,
}: {
  messages: PresentationStageMessage[];
  canDismiss: boolean;
  onCommand: PresentationLiveCommandSender;
}) {
  if (!messages.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col items-center gap-2 sm:inset-x-6" aria-live="assertive">
      {messages.map((message) => (
        <div key={message.id} className={`pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${message.tone === "urgent" ? "border-red-300/45 bg-red-600/90 text-white" : "border-sky-200/35 bg-slate-950/90 text-sky-50"}`}>
          {message.tone === "urgent" ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <MessageSquareText className="h-5 w-5 shrink-0" />}
          <p className="min-w-0 flex-1 text-sm font-black leading-5">{message.body}</p>
          {canDismiss && <button type="button" aria-label="Descartar mensaje" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-black/15" onClick={() => run(() => onCommand("stage_message_dismiss", { messageId: message.id }))}><Check className="h-5 w-5" /></button>}
        </div>
      ))}
    </div>
  );
}

export function PresentationRemoteSurface({
  snapshot,
  activeView,
  controllerLeaseActive,
  timing,
  steps,
  liveSteps,
  activeIndex,
  nextLabel,
  blackout,
  chordsVisible,
  pending,
  onCommand,
}: {
  snapshot: PresentationLiveSnapshot | null;
  activeView: PresentationPrivateLiveView;
  controllerLeaseActive: boolean;
  timing: PresentationTiming | null;
  steps: PresentationRunStep[];
  liveSteps: PresentationOfflineStep[];
  activeIndex: number;
  nextLabel: string;
  blackout: boolean;
  chordsVisible: boolean;
  pending: boolean;
  onCommand: PresentationLiveCommandSender;
}) {
  const [showOrder, setShowOrder] = useState(false);
  const session = snapshot?.session;
  const owned = Boolean(session?.controller?.ownedByViewer && controllerLeaseActive);
  const active = steps[activeIndex];
  const previousLiveStep = liveSteps[activeIndex - 1];
  const nextLiveStep = liveSteps[activeIndex + 1];
  const presence = useMemo(
    () => (session?.presence || []).filter((candidate) => candidate.clientId !== session.controller?.clientId).sort((a, b) => Number(Boolean(b.controlRequestedAt)) - Number(Boolean(a.controlRequestedAt))),
    [session?.controller?.clientId, session?.presence],
  );

  return (
    <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
        <section className="space-y-4">
          <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(145deg,rgba(124,58,237,.24),rgba(12,11,18,.85)_45%)] p-4 shadow-2xl shadow-black/30 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Cast className="h-4 w-4 text-violet-200" /><p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">Control remoto · {activeView}</p></div><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{active?.sectionLabel || active?.title || "Sesión lista"}</h1><p className="mt-1 text-sm font-semibold text-slate-400">{active?.title || "Inicia la sesión para controlar la presentación"}</p></div><PresentationOwnershipControls snapshot={snapshot} controllerLeaseActive={controllerLeaseActive} pending={pending} onCommand={onCommand} /></div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-3"><p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-500">Siguiente</p><p className="mt-1 truncate text-base font-black text-white">{nextLabel}</p></div>

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-2">
              <Button aria-label="Anterior" className="h-16 rounded-2xl border border-white/10 bg-white/[0.08] text-white hover:bg-white/[0.14]" disabled={!owned || pending || !previousLiveStep} onClick={() => previousLiveStep && run(() => onCommand("jump", { itemId: previousLiveStep.itemId, stepId: previousLiveStep.stepId, partIndex: previousLiveStep.partIndex }))}><ArrowLeft className="h-6 w-6" /><span className="hidden sm:inline">Anterior</span></Button>
              <Button className="h-16 rounded-2xl bg-violet-500 text-base font-black shadow-xl shadow-violet-950/40 hover:bg-violet-400" disabled={!owned || pending || !nextLiveStep} onClick={() => nextLiveStep && run(() => onCommand("jump", { itemId: nextLiveStep.itemId, stepId: nextLiveStep.stepId, partIndex: nextLiveStep.partIndex }))}>Siguiente <ArrowRight className="h-5 w-5" /></Button>
              <Button variant="outline" className="h-16 rounded-2xl border-white/10 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white" disabled={!session} onClick={() => setShowOrder((current) => !current)}>Orden <ChevronRight className={`h-4 w-4 transition-transform ${showOrder ? "rotate-90" : ""}`} /></Button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                aria-label={blackout ? "Restaurar salida de presentación" : "Poner salida de presentación en negro"}
                aria-pressed={blackout}
                className={`h-14 rounded-2xl text-sm font-black ${blackout ? "bg-red-500 text-white hover:bg-red-400" : "border border-white/10 bg-black text-white hover:bg-zinc-900"}`}
                disabled={!owned || pending}
                onClick={() => run(() => onCommand("set_blackout", { blackout: !blackout }))}
              >
                {blackout ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />} {blackout ? "Restaurar salida" : "Salida en negro"}
              </Button>
              <Button
                aria-label={chordsVisible ? "Ocultar acordes" : "Mostrar acordes"}
                aria-pressed={chordsVisible}
                className={`h-14 rounded-2xl border text-sm font-black ${chordsVisible ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-50 hover:bg-emerald-300/20" : "border-white/10 bg-white/[0.06] text-slate-300 hover:bg-white/10"}`}
                disabled={!owned || pending}
                onClick={() => run(() => onCommand("set_chords", { chordsVisible: !chordsVisible }))}
              >
                {chordsVisible ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />} Acordes {chordsVisible ? "sí" : "no"}
              </Button>
            </div>
          </div>

          {showOrder && <div className="max-h-[24rem] overflow-y-auto rounded-[1.5rem] border border-white/10 bg-black/25 p-3"><div className="space-y-1.5">{steps.map((step, index) => { const target = liveSteps[index]; return <button key={step.id} type="button" aria-current={index === activeIndex ? "step" : undefined} disabled={!owned || pending || !target} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left ${index === activeIndex ? "bg-violet-500 text-white" : "bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`} onClick={() => target && run(() => onCommand("jump", { itemId: target.itemId, stepId: target.stepId, partIndex: target.partIndex }))}><span className="w-7 text-center text-xs font-black tabular-nums">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-black">{step.title}</span><span className="block truncate text-[10px] text-current opacity-65">{step.sectionLabel || "Cue"}</span></span></button>; })}</div></div>}

          <PresentationTimingPanel timing={timing} canControl={owned} pending={pending} onCommand={onCommand} />
        </section>

        <aside className="space-y-4">
          {owned && <StageMessageComposer pending={pending} onCommand={onCommand} />}
          {owned && presence.length > 0 && <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-500">Dispositivos presentes</p><div className="mt-2 space-y-2">{presence.map((candidate) => <div key={candidate.clientId} className="flex min-h-12 items-center gap-2 rounded-xl bg-white/[0.05] px-3"><span className={`h-2.5 w-2.5 rounded-full ${candidate.controlRequestedAt ? "bg-amber-300" : "bg-emerald-300"}`} /><span className="min-w-0 flex-1 truncate text-xs font-bold">{candidate.displayName}</span>{candidate.controlRequestedAt && <Badge className="bg-amber-300/15 text-amber-100 hover:bg-amber-300/15">Solicita</Badge>}<Button size="sm" variant="ghost" className="min-h-11 rounded-xl text-violet-100 hover:bg-violet-300/10 hover:text-white" disabled={pending} onClick={() => run(() => onCommand("handoff_control", { targetClientId: candidate.clientId }))}>Entregar</Button></div>)}</div></div>}
          {session && snapshot?.viewer.canStart && <Button variant="ghost" className="h-12 w-full rounded-2xl border border-red-300/15 text-red-200 hover:bg-red-300/10 hover:text-red-100" disabled={pending || !owned} onClick={() => run(() => onCommand("end_session", {}))}>Finalizar sesión en vivo</Button>}
        </aside>
      </div>
    </main>
  );
}
