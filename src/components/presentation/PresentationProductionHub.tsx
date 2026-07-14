import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Bluetooth, Bot, Cable, Gamepad2, Keyboard, MessageCircle, Music2, Radio, RotateCcw, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PresentationAutomationPanel } from "@/components/presentation/PresentationAutomationPanel";
import { PresentationBroadcastPanel } from "@/components/presentation/PresentationBroadcastPanel";
import { PresentationIntegrationsPanel } from "@/components/presentation/PresentationIntegrationsPanel";
import { PresentationPrivateChat } from "@/components/presentation/PresentationPrivateChat";
import { PresentationReportPanel } from "@/components/presentation/PresentationReportPanel";
import {
  DEFAULT_PRESENTATION_HARDWARE_SETTINGS,
  formatPresentationKeyCode,
  isAllowedPresentationHardwareKeyCode,
  normalizePresentationHardwareSettings,
  presentationGamepadBindingsForAction,
  presentationKeyboardBindingsForAction,
  presentationMidiBindingsForAction,
  presentationKeyCode,
  setPresentationHardwareSourceEnabled,
  updatePresentationGamepadBinding,
  updatePresentationKeyboardBinding,
  updatePresentationMidiBinding,
  type PresentationHardwareAction,
  type PresentationHardwareSettings,
  type PresentationNativeHardwareLearnedInput,
} from "@/lib/presentationPedal";
import {
  presentationNativeHardwareStatusMessage,
  type PresentationNativeHardwareStatus,
} from "@/lib/presentationNativeHardware";
import type { PresentationChatChannel, PresentationRunMode } from "@/lib/presentationProduction";
import type { PresentationTargetRole } from "@/lib/presentationWorkspace";
import type { PresentationAutomationRuntimeState } from "@/hooks/usePresentationAutomations";
import type { PresentationLiveSnapshot, PresentationNetworkState } from "@/lib/presentationLive";
import {
  canOperatePresentationExternalSystems,
  presentationExternalAuthorityScope,
} from "@/lib/presentationLocalConnectors";

type ProductionTab = "chat" | "automation" | "report" | "integrations" | "broadcast" | "pedal";

type PresentationProductionHubProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  serviceTitle: string;
  mode: PresentationRunMode;
  canEdit: boolean;
  controllerOwned: boolean;
  viewerRoles: PresentationTargetRole[];
  privacyScope: string;
  churchId?: string | null;
  networkState: PresentationNetworkState;
  snapshot: PresentationLiveSnapshot | null;
  clientId: string;
  automationState: PresentationAutomationRuntimeState;
  hardwareSettings: PresentationHardwareSettings;
  hardwareAppActive: boolean;
  hardwareCommandPending: boolean;
  hardwareNativeStatus: PresentationNativeHardwareStatus;
  onHardwareSettingsChange: (settings: PresentationHardwareSettings) => void;
  onHardwareCaptureChange: (capturing: boolean) => void;
  onLearnNativeHardwareInput: (source: "gamepad" | "midi", timeoutMs?: number) => Promise<PresentationNativeHardwareLearnedInput | null>;
  onCancelNativeHardwareLearning: () => void;
  initialTab?: ProductionTab;
};

const TABS: Array<{ id: ProductionTab; label: string; icon: typeof MessageCircle }> = [
  { id: "chat", label: "Equipo", icon: MessageCircle },
  { id: "automation", label: "Automatizar", icon: Bot },
  { id: "report", label: "Reporte", icon: BarChart3 },
  { id: "integrations", label: "Conexiones", icon: Cable },
  { id: "broadcast", label: "Broadcast", icon: Radio },
  { id: "pedal", label: "Pedal", icon: Bluetooth },
];

function allowedChatChannels(roles: PresentationTargetRole[], canEdit: boolean): PresentationChatChannel[] {
  const normalized = new Set(roles);
  const channels: PresentationChatChannel[] = ["all"];
  if (canEdit || normalized.has("all") || normalized.has("worship_leader") || normalized.has("band") || normalized.has("vocals")) channels.push("worship");
  if (canEdit || normalized.has("all") || normalized.has("operator") || normalized.has("av")) channels.push("production");
  return channels;
}

export function PresentationProductionHub({
  open,
  onOpenChange,
  serviceId,
  serviceTitle,
  mode,
  canEdit,
  controllerOwned,
  viewerRoles,
  privacyScope,
  churchId,
  networkState,
  snapshot,
  clientId,
  automationState,
  hardwareSettings,
  hardwareAppActive,
  hardwareCommandPending,
  hardwareNativeStatus,
  onHardwareSettingsChange,
  onHardwareCaptureChange,
  onLearnNativeHardwareInput,
  onCancelNativeHardwareLearning,
  initialTab = "chat",
}: PresentationProductionHubProps) {
  const [tab, setTab] = useState<ProductionTab>(initialTab);
  const channels = useMemo(() => allowedChatChannels(viewerRoles, canEdit), [canEdit, viewerRoles]);
  const canUseProductionTools = canEdit || viewerRoles.includes("operator") || viewerRoles.includes("av") || viewerRoles.includes("all");
  const canOperateExternal = networkState === "online" && canOperatePresentationExternalSystems({ mode, controllerOwned, canEdit, roles: viewerRoles });
  const externalAuthorityScope = `${presentationExternalAuthorityScope({ baseScope: privacyScope, mode, controllerOwned, canEdit, roles: viewerRoles })}::${networkState}`;

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnEscape(event: KeyboardEvent) {
      if (!event.defaultPrevented && event.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#080b10] text-white" role="dialog" aria-modal="true" aria-label="Centro de producción Tchurch Live" onClick={(event) => event.stopPropagation()} style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(139,92,246,0.14),transparent_34%),radial-gradient(circle_at_90%_0%,rgba(192,132,252,0.09),transparent_30%)]" />
      <header className="relative z-10 flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 px-3 sm:px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-300/10 text-violet-200"><Settings2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">Centro de producción</p><p className="truncate text-[10px] text-slate-500">{serviceTitle} · {mode === "rehearsal" ? "Ensayo aislado" : "Sesión en vivo"}</p></div>
        <div className={`hidden rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] sm:block ${mode === "rehearsal" ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}>{mode === "rehearsal" ? "Sin salida pública" : controllerOwned ? "Control activo" : "Solo lectura"}</div>
        <Button variant="ghost" aria-label="Cerrar centro de producción" className="h-11 w-11 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => onOpenChange(false)}><X className="h-5 w-5" /></Button>
      </header>

      <nav className="relative z-10 shrink-0 overflow-x-auto border-b border-white/10 px-3 sm:px-5" aria-label="Herramientas de producción"><div className="flex min-w-max gap-1 py-2">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-black transition-colors ${tab === id ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"}`} onClick={() => setTab(id)}><Icon className="h-4 w-4" />{label}</button>)}</div></nav>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-5"><div className="mx-auto w-full max-w-6xl">
        {tab === "chat" ? <PresentationPrivateChat serviceId={serviceId} mode={mode} channels={channels} privacyScope={privacyScope} /> : null}
        {tab === "automation" ? <PresentationAutomationPanel serviceId={serviceId} mode={mode} canEdit={canEdit} controllerOwned={controllerOwned} snapshot={snapshot} clientId={clientId} runtimeState={automationState} /> : null}
        {tab === "report" ? <PresentationReportPanel serviceId={serviceId} mode={mode} /> : null}
        {tab === "integrations" ? <PresentationIntegrationsPanel serviceId={serviceId} serviceTitle={serviceTitle} mode={mode} churchId={churchId} externalAuthorityScope={externalAuthorityScope} canOperateExternal={canOperateExternal} canExportPublic={canUseProductionTools} /> : null}
        {tab === "broadcast" ? <PresentationBroadcastPanel serviceId={serviceId} mode={mode} churchId={churchId} privacyScope={externalAuthorityScope} canEdit={canEdit} canOperateExternal={canOperateExternal} /> : null}
        {tab === "pedal" ? <PresentationHardwarePanel settings={hardwareSettings} controllerOwned={controllerOwned} mode={mode} appActive={hardwareAppActive} commandPending={hardwareCommandPending} networkState={networkState} nativeStatus={hardwareNativeStatus} onChange={onHardwareSettingsChange} onCaptureChange={onHardwareCaptureChange} onLearnNative={onLearnNativeHardwareInput} onCancelNativeLearning={onCancelNativeHardwareLearning} /> : null}
      </div></main>
    </div>
  );
}

const HARDWARE_ACTION_LABELS: Record<PresentationHardwareAction, string> = {
  next: "Siguiente",
  previous: "Anterior",
  toggle_blackout: "Salida en negro",
  toggle_chords: "Mostrar acordes",
};

type HardwareCapture = {
  action: PresentationHardwareAction;
  source: "keyboard" | "gamepad" | "midi";
};

const GAMEPAD_CONTROL_LABELS: Record<string, string> = {
  button_a: "Botón A",
  button_b: "Botón B",
  button_x: "Botón X",
  button_y: "Botón Y",
  left_shoulder: "Botón superior izquierdo",
  right_shoulder: "Botón superior derecho",
  left_trigger: "Gatillo izquierdo",
  right_trigger: "Gatillo derecho",
  left_thumbstick_button: "Click de stick izquierdo",
  right_thumbstick_button: "Click de stick derecho",
  dpad_up: "Cruceta arriba",
  dpad_down: "Cruceta abajo",
  dpad_left: "Cruceta izquierda",
  dpad_right: "Cruceta derecha",
  left_stick_up: "Stick izquierdo arriba",
  left_stick_down: "Stick izquierdo abajo",
  left_stick_left: "Stick izquierdo izquierda",
  left_stick_right: "Stick izquierdo derecha",
  right_stick_up: "Stick derecho arriba",
  right_stick_down: "Stick derecho abajo",
  right_stick_left: "Stick derecho izquierda",
  right_stick_right: "Stick derecho derecha",
};

function connectedDeviceName(status: PresentationNativeHardwareStatus, source: "gamepad" | "midi", id: string | null) {
  if (!id) return "Cualquier dispositivo";
  const devices = source === "gamepad" ? status.gamepads : status.midiSources;
  return devices.find((device) => device.id === id)?.name || "Dispositivo guardado";
}

function PresentationHardwarePanel({ settings, controllerOwned, mode, appActive, commandPending, networkState, nativeStatus, onChange, onCaptureChange, onLearnNative, onCancelNativeLearning }: {
  settings: PresentationHardwareSettings;
  controllerOwned: boolean;
  mode: PresentationRunMode;
  appActive: boolean;
  commandPending: boolean;
  networkState: PresentationNetworkState;
  nativeStatus: PresentationNativeHardwareStatus;
  onChange: (settings: PresentationHardwareSettings) => void;
  onCaptureChange: (capturing: boolean) => void;
  onLearnNative: (source: "gamepad" | "midi", timeoutMs?: number) => Promise<PresentationNativeHardwareLearnedInput | null>;
  onCancelNativeLearning: () => void;
}) {
  const [capturing, setCapturing] = useState<HardwareCapture | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const captureGenerationRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const keyboardEnabled = settings.enabled && settings.sources.keyboard;
  const nativeMessage = presentationNativeHardwareStatusMessage(nativeStatus.message);
  const nativeSourceRequested = settings.enabled && (settings.sources.gamepad || settings.sources.midi);
  const nativeReady = !nativeSourceRequested || (nativeStatus.supported && nativeStatus.active && !nativeMessage);
  const gamepadEnabled = settings.enabled && settings.sources.gamepad && nativeReady;
  const midiEnabled = settings.enabled && settings.sources.midi && nativeReady;
  const networkDiverged = networkState === "diverged";
  const anySourceConfigured = keyboardEnabled || nativeSourceRequested;
  const ready = anySourceConfigured && nativeReady && controllerOwned && appActive && !commandPending && !networkDiverged;

  function nativeSourceSummary(source: "gamepad" | "midi") {
    const configured = settings.sources[source];
    if (!configured) return "Desactivado";
    if (!nativeStatus.supported) return "Solo en iPhone o iPad";
    if (!nativeStatus.active || nativeMessage) return "Configurado · entrada no disponible";
    const devices = source === "gamepad" ? nativeStatus.gamepads : nativeStatus.midiSources;
    return devices.map((device) => device.name).join(" · ") || (source === "gamepad" ? "Activo · sin controles conectados" : "Activo · sin fuentes conectadas");
  }

  function cancelCapture(message?: string) {
    captureGenerationRef.current += 1;
    if (capturing?.source !== "keyboard") onCancelNativeLearning();
    setCapturing(null);
    if (message) setNotice(message);
  }

  useEffect(() => {
    onCaptureChange(Boolean(capturing));
    return () => onCaptureChange(false);
  }, [capturing, onCaptureChange]);

  useEffect(() => {
    if (!capturing) return undefined;
    const timer = setTimeout(() => cancelCapture("Tiempo agotado. Vuelve a presionar Aprender e intenta de nuevo."), 10_250);
    return () => clearTimeout(timer);
  }, [capturing]);

  useEffect(() => () => {
    captureGenerationRef.current += 1;
    onCancelNativeLearning();
  }, [onCancelNativeLearning]);

  useEffect(() => {
    if (!capturing) return;
    const sourceStillEnabled = capturing.source === "keyboard" ? keyboardEnabled : capturing.source === "gamepad" ? gamepadEnabled : midiEnabled;
    if (!sourceStillEnabled) cancelCapture();
  }, [capturing, gamepadEnabled, keyboardEnabled, midiEnabled]);

  useEffect(() => {
    if (!capturing || capturing.source !== "keyboard") return undefined;
    function capture(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelCapture("Aprendizaje cancelado.");
        return;
      }
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const code = presentationKeyCode(event);
      if (!isAllowedPresentationHardwareKeyCode(code)) {
        setNotice("Esa tecla está reservada para navegación, accesibilidad o controles del sistema. Elige otra entrada.");
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onChange(updatePresentationKeyboardBinding(settingsRef.current, capturing.action, code));
      setNotice(`${HARDWARE_ACTION_LABELS[capturing.action]} ahora usa ${formatPresentationKeyCode(code)}.`);
      setCapturing(null);
    }
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [capturing, onChange]);

  async function beginNativeCapture(action: PresentationHardwareAction, source: "gamepad" | "midi") {
    if (capturing?.action === action && capturing.source === source) {
      cancelCapture("Aprendizaje cancelado.");
      return;
    }
    if (capturing) cancelCapture();
    const generation = ++captureGenerationRef.current;
    setNotice(source === "gamepad" ? "Presiona un botón, cruceta o mueve un stick." : "Envía una nota o control MIDI. Se aceptan valores CC 0 y 1.");
    setCapturing({ action, source });
    const learned = await onLearnNative(source, 10_000);
    if (generation !== captureGenerationRef.current) return;
    if (!learned || learned.source !== source) {
      setCapturing(null);
      setNotice("No se detectó una entrada. Verifica la conexión e intenta de nuevo.");
      return;
    }
    if (learned.source === "gamepad") {
      onChange(updatePresentationGamepadBinding(settingsRef.current, action, learned));
      setNotice(`${HARDWARE_ACTION_LABELS[action]} ahora usa ${GAMEPAD_CONTROL_LABELS[learned.control] || learned.control} de ${learned.deviceName}.`);
    } else {
      onChange(updatePresentationMidiBinding(settingsRef.current, action, learned));
      const message = learned.message === "note_on" ? "Nota" : "CC";
      setNotice(`${HARDWARE_ACTION_LABELS[action]} ahora usa ${message} ${learned.number} · canal ${learned.channel + 1} de ${learned.deviceName}.`);
    }
    setCapturing(null);
  }

  let readiness = "Listo para aprender entradas físicas y controlar la sesión.";
  if (!settings.enabled) readiness = "Las entradas físicas están desactivadas en este dispositivo.";
  else if (!anySourceConfigured) readiness = "Activa al menos una fuente de entrada.";
  else if (!appActive) readiness = "En espera: Tchurch debe estar visible y en primer plano.";
  else if (nativeSourceRequested && !nativeStatus.supported) readiness = "Gamepad y MIDI solo están disponibles en la app de iPhone o iPad.";
  else if (nativeSourceRequested && !nativeReady) readiness = nativeMessage || "Iniciando las entradas nativas. Si no se activan, vuelve a conectar el dispositivo.";
  else if (!controllerOwned) readiness = `Solo lectura: toma el control de ${mode === "live" ? "la sesión en vivo" : "este ensayo"}.`;
  else if (commandPending) readiness = "En espera: Tchurch está confirmando el comando anterior.";
  else if (networkDiverged) readiness = "En espera: revisa la cola divergente antes de usar entradas físicas.";

  return (
    <section>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-start"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Entradas físicas</p><h3 className="mt-1 text-xl font-black text-white">Pedal, teclado y controles</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Conecta un pedal HID, gamepad o interfaz MIDI. Tchurch filtra rebotes y solo ejecuta entradas con control exacto de la sesión.</p></div><div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.055] p-4"><div className="flex min-h-11 items-center justify-between gap-3"><div><p className="text-xs font-black text-slate-100">Entradas habilitadas</p><p className="text-[10px] text-slate-500">Guardadas para esta cuenta e iglesia</p></div><Switch aria-label="Habilitar entradas físicas" checked={settings.enabled} onCheckedChange={(enabled) => onChange({ ...settings, enabled })} /></div></div></div>
      <div className={`mt-4 rounded-xl border px-3 py-2 text-xs font-semibold ${ready ? "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-100" : "border-amber-300/15 bg-amber-300/[0.07] text-amber-100"}`} role="status">{readiness}</div>
      {notice ? <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-200" role="status">{notice}</div> : null}
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] p-4"><div className="flex min-h-11 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Keyboard className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-black text-white">Teclado HID</p><p className="text-[10px] text-slate-400">Disponible ahora</p></div><Switch aria-label="Habilitar teclado HID" checked={settings.sources.keyboard} disabled={!settings.enabled} onCheckedChange={(enabled) => onChange(setPresentationHardwareSourceEnabled(settings, "keyboard", enabled))} /></div></div>
        <div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.045] p-4"><div className="flex min-h-11 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Gamepad2 className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-black text-white">Gamepad</p><p className="truncate text-[10px] text-slate-400">{nativeSourceSummary("gamepad")}</p></div><Switch aria-label="Habilitar Gamepad" checked={settings.sources.gamepad} disabled={!settings.enabled || !nativeStatus.supported} onCheckedChange={(enabled) => onChange(setPresentationHardwareSourceEnabled(settings, "gamepad", enabled))} /></div></div>
        <div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.045] p-4"><div className="flex min-h-11 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Music2 className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-black text-white">MIDI</p><p className="truncate text-[10px] text-slate-400">{nativeSourceSummary("midi")}</p></div><Switch aria-label="Habilitar MIDI" checked={settings.sources.midi} disabled={!settings.enabled || !nativeStatus.supported} onCheckedChange={(enabled) => onChange(setPresentationHardwareSourceEnabled(settings, "midi", enabled))} /></div></div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{(Object.keys(HARDWARE_ACTION_LABELS) as PresentationHardwareAction[]).map((action) => {
        const keyboardBindings = presentationKeyboardBindingsForAction(settings, action);
        const gamepadBindings = presentationGamepadBindingsForAction(settings, action);
        const midiBindings = presentationMidiBindingsForAction(settings, action);
        const keyboardCapture = capturing?.action === action && capturing.source === "keyboard";
        const gamepadCapture = capturing?.action === action && capturing.source === "gamepad";
        const midiCapture = capturing?.action === action && capturing.source === "midi";
        return <div key={action} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Bluetooth className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-black text-white">{HARDWARE_ACTION_LABELS[action]}</p><div className="mt-1 space-y-0.5 text-[10px] leading-4 text-slate-500"><p>Teclado: {keyboardBindings.length ? keyboardBindings.map((binding) => formatPresentationKeyCode(binding.code)).join(" · ") : "sin asignar"}</p><p>Gamepad: {gamepadBindings.length ? gamepadBindings.map((binding) => `${GAMEPAD_CONTROL_LABELS[binding.control] || binding.control} · ${connectedDeviceName(nativeStatus, "gamepad", binding.deviceId)}`).join(" · ") : "sin asignar"}</p><p>MIDI: {midiBindings.length ? midiBindings.map((binding) => `${binding.message === "note_on" ? "Nota" : "CC"} ${binding.number} · canal ${binding.channel === null ? "cualquiera" : binding.channel + 1} · ${connectedDeviceName(nativeStatus, "midi", binding.deviceId)}`).join(" · ") : "sin asignar"}</p></div></div></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><Button variant="outline" aria-label={`Aprender teclado para ${HARDWARE_ACTION_LABELS[action]}`} className={`h-11 rounded-xl border-white/10 text-white hover:text-white ${keyboardCapture ? "bg-violet-300/15 hover:bg-violet-300/20" : "bg-black/20 hover:bg-white/[0.06]"}`} disabled={!keyboardEnabled || Boolean(capturing && !keyboardCapture)} onClick={() => keyboardCapture ? cancelCapture("Aprendizaje cancelado.") : setCapturing({ action, source: "keyboard" })}>{keyboardCapture ? "Cancelar" : "Teclado"}</Button><Button variant="outline" aria-label={`Aprender Gamepad para ${HARDWARE_ACTION_LABELS[action]}`} className={`h-11 rounded-xl border-white/10 text-white hover:text-white ${gamepadCapture ? "bg-violet-300/15 hover:bg-violet-300/20" : "bg-black/20 hover:bg-white/[0.06]"}`} disabled={!gamepadEnabled || Boolean(capturing && !gamepadCapture)} onClick={() => void beginNativeCapture(action, "gamepad")}>{gamepadCapture ? "Cancelar" : "Gamepad"}</Button><Button variant="outline" aria-label={`Aprender MIDI para ${HARDWARE_ACTION_LABELS[action]}`} className={`h-11 rounded-xl border-white/10 text-white hover:text-white ${midiCapture ? "bg-violet-300/15 hover:bg-violet-300/20" : "bg-black/20 hover:bg-white/[0.06]"}`} disabled={!midiEnabled || Boolean(capturing && !midiCapture)} onClick={() => void beginNativeCapture(action, "midi")}>{midiCapture ? "Cancelar" : "MIDI"}</Button></div></div>;
      })}</div>
      <div className="mt-5 flex justify-end"><Button variant="ghost" className="h-11 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white" onClick={() => { onChange(normalizePresentationHardwareSettings(DEFAULT_PRESENTATION_HARDWARE_SETTINGS)); setNotice("Asignaciones predeterminadas restauradas."); }}><RotateCcw className="h-4 w-4" />Restaurar</Button></div>
    </section>
  );
}
