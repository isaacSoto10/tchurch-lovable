import { useEffect, useMemo, useState } from "react";
import { BarChart3, Bluetooth, Bot, Cable, MessageCircle, Radio, RotateCcw, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PresentationAutomationPanel } from "@/components/presentation/PresentationAutomationPanel";
import { PresentationBroadcastPanel } from "@/components/presentation/PresentationBroadcastPanel";
import { PresentationIntegrationsPanel } from "@/components/presentation/PresentationIntegrationsPanel";
import { PresentationPrivateChat } from "@/components/presentation/PresentationPrivateChat";
import { PresentationReportPanel } from "@/components/presentation/PresentationReportPanel";
import {
  DEFAULT_PRESENTATION_PEDAL_MAPPING,
  formatPresentationKeyCode,
  presentationKeyCode,
  updatePresentationPedalBinding,
  type PresentationPedalAction,
  type PresentationPedalMapping,
} from "@/lib/presentationPedal";
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
  accountId: string;
  churchId?: string | null;
  networkState: PresentationNetworkState;
  snapshot: PresentationLiveSnapshot | null;
  clientId: string;
  hasActivePresentationSession: boolean;
  automationState: PresentationAutomationRuntimeState;
  pedalMapping: PresentationPedalMapping;
  onPedalMappingChange: (mapping: PresentationPedalMapping) => void;
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
  accountId,
  churchId,
  networkState,
  snapshot,
  clientId,
  hasActivePresentationSession,
  automationState,
  pedalMapping,
  onPedalMappingChange,
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
      if (event.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#080b10] text-white" role="dialog" aria-modal="true" aria-label="Centro de producción Tchurch Live" onClick={(event) => event.stopPropagation()} style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(34,211,238,0.09),transparent_32%),radial-gradient(circle_at_90%_0%,rgba(244,114,182,0.08),transparent_28%)]" />
      <header className="relative z-10 flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 px-3 sm:px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/10 text-cyan-200"><Settings2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">Centro de producción</p><p className="truncate text-[10px] text-slate-500">{serviceTitle} · {mode === "rehearsal" ? "Ensayo aislado" : "Sesión en vivo"}</p></div>
        <div className={`hidden rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] sm:block ${mode === "rehearsal" ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}>{mode === "rehearsal" ? "Sin salida pública" : controllerOwned ? "Control activo" : "Solo lectura"}</div>
        <Button variant="ghost" aria-label="Cerrar centro de producción" className="h-11 w-11 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => onOpenChange(false)}><X className="h-5 w-5" /></Button>
      </header>

      <nav className="relative z-10 shrink-0 overflow-x-auto border-b border-white/10 px-3 sm:px-5" aria-label="Herramientas de producción"><div className="flex min-w-max gap-1 py-2">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-black transition-colors ${tab === id ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"}`} onClick={() => setTab(id)}><Icon className="h-4 w-4" />{label}</button>)}</div></nav>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-5"><div className="mx-auto w-full max-w-6xl">
        {tab === "chat" ? <PresentationPrivateChat serviceId={serviceId} mode={mode} channels={channels} privacyScope={privacyScope} /> : null}
        {tab === "automation" ? <PresentationAutomationPanel serviceId={serviceId} mode={mode} canEdit={canEdit} controllerOwned={controllerOwned} snapshot={snapshot} clientId={clientId} runtimeState={automationState} /> : null}
        {tab === "report" ? <PresentationReportPanel serviceId={serviceId} mode={mode} /> : null}
        {tab === "integrations" ? <PresentationIntegrationsPanel serviceId={serviceId} serviceTitle={serviceTitle} mode={mode} accountId={accountId} churchId={churchId} externalAuthorityScope={externalAuthorityScope} canEdit={canEdit} canOperateExternal={canOperateExternal} canExportPublic={canUseProductionTools} hasActivePresentationSession={hasActivePresentationSession} /> : null}
        {tab === "broadcast" ? <PresentationBroadcastPanel serviceId={serviceId} mode={mode} churchId={churchId} privacyScope={externalAuthorityScope} canEdit={canEdit} canOperateExternal={canOperateExternal} /> : null}
        {tab === "pedal" ? <PresentationPedalPanel mapping={pedalMapping} controllerOwned={controllerOwned} mode={mode} onChange={onPedalMappingChange} /> : null}
      </div></main>
    </div>
  );
}

const PEDAL_LABELS: Record<PresentationPedalAction, string> = {
  next: "Siguiente",
  previous: "Anterior",
  toggle_blackout: "Salida en negro",
  toggle_chords: "Mostrar acordes",
};

function PresentationPedalPanel({ mapping, controllerOwned, mode, onChange }: { mapping: PresentationPedalMapping; controllerOwned: boolean; mode: PresentationRunMode; onChange: (mapping: PresentationPedalMapping) => void }) {
  const [capturing, setCapturing] = useState<PresentationPedalAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return undefined;
    function capture(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCapturing(null);
        return;
      }
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const code = presentationKeyCode(event);
      if (!code || code === "Unidentified" || code === "Dead" || code === "Process") return;
      event.preventDefault();
      event.stopPropagation();
      onChange(updatePresentationPedalBinding(mapping, capturing, code));
      setNotice(`${PEDAL_LABELS[capturing]} ahora usa ${formatPresentationKeyCode(code)}.`);
      setCapturing(null);
    }
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [capturing, mapping, onChange]);

  return (
    <section>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-start"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">Bluetooth HID</p><h3 className="mt-1 text-xl font-black text-white">Pedal y clicker</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Funciona con controles que envían flechas, Page Up/Down o Espacio. Ignora repetición, modificadores, composición y campos editables.</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex min-h-11 items-center justify-between gap-3"><div><p className="text-xs font-black text-slate-200">Pedal habilitado</p><p className="text-[10px] text-slate-600">Guardado solo en esta iglesia</p></div><Switch checked={mapping.enabled} onCheckedChange={(enabled) => onChange({ ...mapping, enabled })} /></div></div></div>
      <div className={`mt-4 rounded-xl border px-3 py-2 text-xs font-semibold ${controllerOwned ? "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-100" : "border-amber-300/15 bg-amber-300/[0.07] text-amber-100"}`}>{controllerOwned ? `Listo para controlar ${mode === "live" ? "la sesión en vivo" : "el ensayo aislado"}.` : `Solo lectura: el pedal se ignora hasta que este dispositivo tenga el control de ${mode === "live" ? "la sesión en vivo" : "este ensayo"}.`}</div>
      {notice ? <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-200" role="status">{notice}</div> : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{(Object.keys(PEDAL_LABELS) as PresentationPedalAction[]).map((action) => <div key={action} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-300/10 text-amber-200"><Bluetooth className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-black text-white">{PEDAL_LABELS[action]}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{mapping.bindings[action].length ? mapping.bindings[action].map(formatPresentationKeyCode).join(" · ") : "Sin tecla asignada"}</p></div></div><Button variant="outline" className={`mt-4 h-11 w-full rounded-xl border-white/10 text-white hover:text-white ${capturing === action ? "bg-amber-300/15 hover:bg-amber-300/20" : "bg-black/20 hover:bg-white/[0.06]"}`} disabled={!mapping.enabled || Boolean(capturing && capturing !== action)} onClick={() => setCapturing(capturing === action ? null : action)}>{capturing === action ? "Presiona una tecla…" : "Cambiar tecla"}</Button></div>)}</div>
      <div className="mt-5 flex justify-end"><Button variant="ghost" className="h-11 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white" onClick={() => { onChange({ ...DEFAULT_PRESENTATION_PEDAL_MAPPING, bindings: { next: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.next], previous: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.previous], toggle_blackout: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.toggle_blackout], toggle_chords: [...DEFAULT_PRESENTATION_PEDAL_MAPPING.bindings.toggle_chords] } }); setNotice("Asignaciones predeterminadas restauradas."); }}><RotateCcw className="h-4 w-4" />Restaurar</Button></div>
    </section>
  );
}
