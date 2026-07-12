import { useEffect, useMemo, useState } from "react";
import { Browser } from "@capacitor/browser";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MonitorPlay,
  Palette,
  Plus,
  RefreshCw,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PresentationAudienceOutput } from "@/components/presentation/PresentationAudienceOutput";
import {
  DEFAULT_PRESENTATION_STAGE_LAYOUTS,
  DEFAULT_PRESENTATION_THEME,
  presentationColorContrast,
  safePresentationAssetUrl,
  type PresentationAudienceSlide,
  type PresentationOutputConfig,
  type PresentationOutputFont,
  type PresentationOutputFontWeight,
  type PresentationOutputLink,
  type PresentationOutputPlacement,
  type PresentationResolvedTheme,
  type PresentationStageMode,
  type PresentationStageRole,
} from "@/lib/presentationOutput";
import {
  createPresentationLayout,
  createPresentationOutputLink,
  createPresentationTheme,
  deletePresentationLayout,
  deletePresentationTheme,
  fetchPresentationOutputConfig,
  fetchPresentationOutputLinks,
  revokePresentationOutputLink,
  updatePresentationLayout,
  updatePresentationOutputConfig,
  updatePresentationTheme,
} from "@/lib/presentationOutputApi";

type PresentationOutputManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  serviceTitle: string;
  previewSlide: PresentationAudienceSlide | null;
  blackout: boolean;
  onConfigChange?: (config: PresentationOutputConfig) => void;
  initialTab?: "audience" | "themes" | "layouts";
};

const ROLES: PresentationStageRole[] = ["worship_leader", "musicians", "preacher", "production"];
const ROLE_LABELS: Record<PresentationStageRole, string> = {
  worship_leader: "Líder de alabanza",
  musicians: "Músicos",
  preacher: "Predicador",
  production: "Producción",
};
const MODE_LABELS: Record<PresentationStageMode, string> = {
  confidence: "Confianza",
  lyrics: "Letra y acordes",
  speaker: "Orador",
  production: "Producción",
};
const FONT_LABELS: Record<PresentationOutputFont, string> = {
  sans: "Sans",
  serif: "Serif",
  condensed: "Condensada",
  rounded: "Redondeada",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

function formatLinkDate(value: string) {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs font-bold text-slate-300">{label}</Label>
      <div className="mt-2 flex items-center gap-2">
        <input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-14 cursor-pointer rounded-xl border border-white/10 bg-white/5 p-1" />
        <Input value={value} onChange={(event) => onChange(event.target.value)} maxLength={7} className="h-11 rounded-xl border-white/10 bg-white/[0.06] font-mono text-white" aria-label={`${label} hexadecimal`} />
      </div>
    </div>
  );
}

function ShowToggle({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <span className="text-xs font-bold text-slate-200">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

export function PresentationOutputManager({
  open,
  onOpenChange,
  serviceId,
  serviceTitle,
  previewSlide,
  blackout,
  onConfigChange,
  initialTab = "audience",
}: PresentationOutputManagerProps) {
  const [config, setConfig] = useState<PresentationOutputConfig | null>(null);
  const [links, setLinks] = useState<PresentationOutputLink[]>([]);
  const [themeDraft, setThemeDraft] = useState<PresentationResolvedTheme>(DEFAULT_PRESENTATION_THEME);
  const [themeName, setThemeName] = useState("");
  const [newThemeName, setNewThemeName] = useState("Tema nuevo");
  const [linkLabel, setLinkLabel] = useState("Pantalla del santuario");
  const [ttlHours, setTtlHours] = useState("24");
  const [oneTimeShareUrl, setOneTimeShareUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [layoutRole, setLayoutRole] = useState<PresentationStageRole>("musicians");
  const [layoutName, setLayoutName] = useState("Vista personalizada");
  const [layoutMode, setLayoutMode] = useState<PresentationStageMode>("lyrics");
  const [layoutFontScale, setLayoutFontScale] = useState(1);
  const [layoutShow, setLayoutShow] = useState(DEFAULT_PRESENTATION_STAGE_LAYOUTS.musicians.show);
  const [editingLayoutId, setEditingLayoutId] = useState<string | null>(null);

  function acceptConfig(next: PresentationOutputConfig) {
    setConfig(next);
    setThemeDraft(next.resolvedTheme);
    setThemeName(next.themes.find((theme) => theme.id === next.activeThemeId)?.name || "");
    onConfigChange?.(next);
  }

  async function reload() {
    setLoading(true);
    setNotice(null);
    try {
      const [nextConfig, nextLinks] = await Promise.all([
        fetchPresentationOutputConfig(serviceId),
        fetchPresentationOutputLinks(serviceId),
      ]);
      acceptConfig(nextConfig);
      setLinks(nextLinks.links);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setOneTimeShareUrl(null);
      setNotice(null);
      return;
    }
    let active = true;
    setLoading(true);
    setNotice(null);
    void Promise.all([fetchPresentationOutputConfig(serviceId), fetchPresentationOutputLinks(serviceId)])
      .then(([nextConfig, nextLinks]) => {
        if (!active) return;
        acceptConfig(nextConfig);
        setLinks(nextLinks.links);
      })
      .catch((error) => { if (active) setNotice(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // onConfigChange is intentionally delivered only when authoritative config changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serviceId]);

  const contrast = presentationColorContrast(themeDraft.textColor, themeDraft.background.color);
  const contrastSafe = contrast >= 4.5;
  const themeAssetsSafe = (!themeDraft.background.imageUrl || Boolean(safePresentationAssetUrl(themeDraft.background.imageUrl))) && (!themeDraft.logo.url || Boolean(safePresentationAssetUrl(themeDraft.logo.url)));
  const activeTheme = config?.themes.find((theme) => theme.id === config.activeThemeId) || null;
  const activeLinks = links.filter((link) => !link.revokedAt && Date.parse(link.expiresAt) > Date.now());

  const previewCountdownDuration = previewSlide?.kind === "countdown" ? previewSlide.durationSeconds : 0;
  const previewAnchor = useMemo(() => {
    const receivedAtMs = Date.now();
    return {
      slideId: previewSlide?.id || "",
      receivedAtMs,
      serverNow: new Date(receivedAtMs).toISOString(),
      targetAt: previewCountdownDuration ? new Date(receivedAtMs + previewCountdownDuration * 1_000).toISOString() : "",
    };
  }, [previewCountdownDuration, previewSlide?.id]);
  const previewCountdown = previewSlide?.kind === "countdown" && previewAnchor.targetAt
    ? { durationSeconds: previewSlide.durationSeconds, targetAt: previewAnchor.targetAt }
    : null;

  function updateTheme(mutator: (current: PresentationResolvedTheme) => PresentationResolvedTheme) {
    setThemeDraft((current) => mutator(current));
  }

  async function applyConfig(input: {
    activeThemeId?: string | null;
    themeOverrides?: PresentationResolvedTheme | null;
    roleLayoutIds?: PresentationOutputConfig["roleLayoutIds"];
  }, success: string) {
    if (!config) return;
    setBusy("config");
    setNotice(null);
    try {
      const next = await updatePresentationOutputConfig(serviceId, {
        expectedVersion: config.version,
        activeThemeId: input.activeThemeId === undefined ? config.activeThemeId : input.activeThemeId,
        themeOverrides: input.themeOverrides === undefined ? config.themeOverrides : input.themeOverrides,
        roleLayoutIds: input.roleLayoutIds || config.roleLayoutIds,
      });
      acceptConfig(next);
      setNotice(success);
    } catch (error) {
      setNotice(errorMessage(error));
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function saveTheme(createNew: boolean) {
    const requestedName = createNew ? newThemeName.trim() : themeName.trim();
    if (!config || !requestedName) {
      setNotice("Escribe un nombre para el tema.");
      return;
    }
    if (!contrastSafe || !themeAssetsSafe) {
      setNotice(!contrastSafe ? "Aumenta el contraste entre texto y fondo antes de guardar." : "El fondo y el logo deben usar URLs HTTPS válidas.");
      return;
    }
    setBusy("theme");
    setNotice(null);
    try {
      const mutation = createNew || !activeTheme
        ? await createPresentationTheme({ name: requestedName, isDefault: false, theme: themeDraft })
        : await updatePresentationTheme(activeTheme.id, { expectedVersion: activeTheme.version, name: requestedName, isDefault: activeTheme.isDefault, theme: themeDraft });
      const next = await updatePresentationOutputConfig(serviceId, {
        expectedVersion: config.version,
        activeThemeId: mutation.theme.id,
        themeOverrides: null,
        roleLayoutIds: config.roleLayoutIds,
      });
      acceptConfig(next);
      if (createNew) setNewThemeName("Tema nuevo");
      setNotice(createNew || !activeTheme ? "Tema guardado y aplicado." : "Tema actualizado.");
    } catch (error) {
      setNotice(errorMessage(error));
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function applyRoleLayout(role: PresentationStageRole, layoutId: string) {
    if (!config) return;
    await applyConfig({ roleLayoutIds: { ...config.roleLayoutIds, [role]: layoutId } }, `Vista de ${ROLE_LABELS[role].toLowerCase()} aplicada.`);
  }

  function resetLayoutDraft(role: PresentationStageRole) {
    const defaults = DEFAULT_PRESENTATION_STAGE_LAYOUTS[role];
    setLayoutRole(role);
    setLayoutMode(defaults.mode);
    setLayoutFontScale(defaults.fontScale);
    setLayoutShow(defaults.show);
  }

  async function saveLayout() {
    if (!config || !layoutName.trim()) {
      setNotice("Escribe un nombre para la vista.");
      return;
    }
    setBusy("layout");
    setNotice(null);
    try {
      const existing = editingLayoutId ? config.roleLayouts.find((layout) => layout.id === editingLayoutId) : null;
      const mutation = existing
        ? await updatePresentationLayout(existing.id, { expectedVersion: existing.version, name: layoutName.trim(), targetRole: layoutRole, isDefault: existing.isDefault, layout: { mode: layoutMode, fontScale: layoutFontScale, show: layoutShow } })
        : await createPresentationLayout({ name: layoutName.trim(), targetRole: layoutRole, isDefault: false, layout: { mode: layoutMode, fontScale: layoutFontScale, show: layoutShow } });
      const next = await updatePresentationOutputConfig(serviceId, {
        expectedVersion: config.version,
        activeThemeId: config.activeThemeId,
        themeOverrides: config.themeOverrides,
        roleLayoutIds: { ...config.roleLayoutIds, [layoutRole]: mutation.layout.id },
      });
      acceptConfig(next);
      setEditingLayoutId(mutation.layout.id);
      setNotice(existing ? "Vista actualizada y aplicada." : "Vista guardada y aplicada.");
    } catch (error) {
      setNotice(errorMessage(error));
      await reload();
    } finally {
      setBusy(null);
    }
  }

  function editLayout(layoutId: string) {
    if (!config || layoutId === "new") {
      setEditingLayoutId(null);
      resetLayoutDraft(layoutRole);
      setLayoutName("Vista personalizada");
      return;
    }
    const layout = config.roleLayouts.find((candidate) => candidate.id === layoutId);
    if (!layout) return;
    setEditingLayoutId(layout.id);
    setLayoutRole(layout.targetRole);
    setLayoutName(layout.name);
    setLayoutMode(layout.mode);
    setLayoutFontScale(layout.fontScale);
    setLayoutShow(layout.show);
  }

  async function removeTheme(themeId: string) {
    if (!config) return;
    const theme = config.themes.find((candidate) => candidate.id === themeId);
    if (!theme || config.activeThemeId === theme.id) {
      setNotice("Aplica otro tema antes de eliminar este.");
      return;
    }
    setBusy(`theme-delete:${theme.id}`);
    try {
      await deletePresentationTheme(theme.id, theme.version);
      await reload();
      setNotice("Tema eliminado.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeLayout() {
    if (!config || !editingLayoutId) return;
    const layout = config.roleLayouts.find((candidate) => candidate.id === editingLayoutId);
    if (!layout) return;
    if (Object.values(config.roleLayoutIds).includes(layout.id)) {
      setNotice("Aplica otra vista a esa función antes de eliminarla.");
      return;
    }
    setBusy("layout-delete");
    try {
      await deletePresentationLayout(layout.id, layout.version);
      setEditingLayoutId(null);
      await reload();
      setNotice("Vista eliminada.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function createLink() {
    const ttl = Number(ttlHours);
    if (!linkLabel.trim() || !Number.isInteger(ttl) || ttl < 1 || ttl > 168) {
      setNotice("Usa una etiqueta y una vigencia de 1 a 168 horas.");
      return;
    }
    setBusy("link");
    setNotice(null);
    setOneTimeShareUrl(null);
    try {
      const created = await createPresentationOutputLink(serviceId, { label: linkLabel.trim(), ttlHours: ttl });
      setOneTimeShareUrl(created.shareUrl);
      setLinks((current) => [created.link, ...current.filter((link) => link.id !== created.link.id)]);
      setNotice("Enlace creado. Se mostrará solo durante esta sesión.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function revokeLink(linkId: string) {
    setBusy(`revoke:${linkId}`);
    setNotice(null);
    try {
      const revoked = await revokePresentationOutputLink(serviceId, linkId);
      setLinks((current) => current.map((link) => link.id === revoked.id ? revoked : link));
      setNotice("Enlace revocado.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function copyOneTimeLink() {
    if (!oneTimeShareUrl) return;
    try {
      await navigator.clipboard.writeText(oneTimeShareUrl);
      setNotice("Enlace copiado. Guárdalo ahora; Tchurch no volverá a mostrar el token.");
    } catch {
      setNotice("No se pudo copiar. Usa Compartir para enviarlo de forma segura.");
    }
  }

  async function shareOneTimeLink() {
    if (!oneTimeShareUrl) return;
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: `Presentación · ${serviceTitle}`, text: "Salida congregacional de Tchurch", url: oneTimeShareUrl, dialogTitle: "Compartir salida" });
    } catch {
      setNotice("No se pudo abrir el panel para compartir.");
    }
  }

  async function openOneTimeLink() {
    if (!oneTimeShareUrl) return;
    try {
      await Browser.open({ url: oneTimeShareUrl });
    } catch {
      setNotice("No se pudo abrir la salida en el navegador.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(94svh,920px)] max-w-5xl gap-0 overflow-hidden border-white/10 bg-[#0b0c12] p-0 text-white sm:rounded-[2rem]">
        <DialogHeader className="border-b border-white/10 px-5 pb-4 pt-5 pr-14 sm:px-7 sm:pt-6">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-300 text-[#121014]"><MonitorPlay className="h-5 w-5" /></span><div><DialogTitle className="text-xl font-black">Salida congregacional</DialogTitle><DialogDescription className="mt-1 text-slate-400">Temas, pantallas y vistas privadas del equipo</DialogDescription></div></div>
        </DialogHeader>

        {notice ? <div className="flex min-h-11 items-center justify-between gap-3 border-b border-amber-300/20 bg-amber-300/10 px-5 py-2 text-xs font-semibold text-amber-100"><span>{notice}</span><button type="button" className="min-h-9 rounded-lg px-2 font-black" onClick={() => setNotice(null)}>Cerrar</button></div> : null}

        {loading && !config ? (
          <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-amber-300" /><span className="ml-3 text-sm font-bold text-slate-300">Cargando configuración…</span></div>
        ) : (
          <Tabs defaultValue={initialTab} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-white/10 px-4 py-3 sm:px-7">
              <TabsList className="grid h-12 w-full grid-cols-3 rounded-2xl bg-white/[0.06] p-1">
                <TabsTrigger value="audience" className="rounded-xl text-xs font-black text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white"><Link2 className="mr-1.5 h-4 w-4" />Audiencia</TabsTrigger>
                <TabsTrigger value="themes" className="rounded-xl text-xs font-black text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white"><Palette className="mr-1.5 h-4 w-4" />Temas</TabsTrigger>
                <TabsTrigger value="layouts" className="rounded-xl text-xs font-black text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white"><SlidersHorizontal className="mr-1.5 h-4 w-4" />Equipo</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-7">
              <TabsContent value="audience" className="mt-5 space-y-5">
                <section className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black shadow-2xl">
                  <div className="aspect-video min-h-[12rem] max-h-[28rem]">
                    <PresentationAudienceOutput slide={previewSlide} theme={themeDraft} blackout={blackout} countdown={previewCountdown} serverNow={previewAnchor.serverNow} receivedAtMs={previewAnchor.receivedAtMs} showPlaybackRecovery embedded />
                  </div>
                  <div className="flex items-center justify-between border-t border-white/10 px-4 py-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">Vista previa local</p><p className="mt-1 text-xs text-slate-400">Sin notas, acordes, roles ni controles privados.</p></div>{blackout ? <span className="rounded-full bg-red-400/15 px-3 py-1 text-[10px] font-black text-red-200">NEGRO</span> : <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-[10px] font-black text-emerald-200">VISIBLE</span>}</div>
                </section>

                <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-black">Enlaces de pantalla</h3><p className="mt-1 text-xs leading-5 text-slate-400">Solo lectura. El token se entrega una vez y nunca aparece en la lista.</p></div><Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => void reload()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
                    <Input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} maxLength={100} placeholder="Pantalla del santuario" className="h-11 rounded-xl border-white/10 bg-black/20 text-white" aria-label="Etiqueta del enlace" />
                    <Input type="number" min={1} max={168} value={ttlHours} onChange={(event) => setTtlHours(event.target.value)} className="h-11 rounded-xl border-white/10 bg-black/20 text-white" aria-label="Vigencia en horas" />
                    <Button type="button" className="h-11 rounded-xl bg-amber-300 font-black text-[#17120a] hover:bg-amber-200" onClick={() => void createLink()} disabled={busy === "link"}>{busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Crear</Button>
                  </div>

                  {oneTimeShareUrl ? (
                    <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-4">
                      <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><div><p className="text-sm font-black text-emerald-100">Enlace listo, visible solo ahora</p><p className="mt-1 text-xs leading-5 text-emerald-100/70">Cópialo o compártelo antes de cerrar. La app no guarda el token.</p></div></div>
                      <div className="mt-3 grid grid-cols-3 gap-2"><Button type="button" variant="outline" className="h-11 rounded-xl border-white/10 bg-black/20 text-white hover:bg-black/40 hover:text-white" onClick={() => void copyOneTimeLink()}><Copy className="h-4 w-4" /><span className="hidden sm:inline">Copiar</span></Button><Button type="button" variant="outline" className="h-11 rounded-xl border-white/10 bg-black/20 text-white hover:bg-black/40 hover:text-white" onClick={() => void shareOneTimeLink()}><Share2 className="h-4 w-4" /><span className="hidden sm:inline">Compartir</span></Button><Button type="button" variant="outline" className="h-11 rounded-xl border-white/10 bg-black/20 text-white hover:bg-black/40 hover:text-white" onClick={() => void openOneTimeLink()}><ExternalLink className="h-4 w-4" /><span className="hidden sm:inline">Abrir</span></Button></div>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-2">
                    {activeLinks.length ? activeLinks.map((link) => (
                      <div key={link.id} className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07]"><MonitorPlay className="h-4 w-4 text-slate-300" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{link.label}</p><p className="mt-0.5 text-[10px] text-slate-500">Vence {formatLinkDate(link.expiresAt)}</p></div><Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={busy === `revoke:${link.id}`} onClick={() => void revokeLink(link.id)} aria-label={`Revocar ${link.label}`}>{busy === `revoke:${link.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button></div>
                    )) : <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">No hay pantallas activas.</p>}
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="themes" className="mt-5 space-y-5">
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3"><div><h3 className="font-black">Temas guardados</h3><p className="mt-1 text-xs text-slate-400">El mismo tema se aplica a todas las diapositivas públicas.</p></div></div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(config?.themes || []).map((theme) => {
                      const active = config?.activeThemeId === theme.id && !config.themeOverrides;
                      return <div key={theme.id} className={`relative overflow-hidden rounded-2xl border ${active ? "border-amber-300/60 ring-2 ring-amber-300/15" : "border-white/10"}`}><button type="button" className="block w-full text-left" onClick={() => void applyConfig({ activeThemeId: theme.id, themeOverrides: null }, `Tema ${theme.name} aplicado.`)}><span className="block h-20 p-3" style={{ backgroundColor: theme.background.color, color: theme.textColor }}><span className="text-xl" style={{ fontWeight: theme.fontWeight }}>Aa</span><span className="ml-2 text-xs" style={{ color: theme.accentColor }}>Tchurch</span></span><span className="flex items-center justify-between bg-white/[0.04] px-3 py-2 pr-12"><span className="truncate text-xs font-black">{theme.name}</span>{active ? <CheckCircle2 className="h-4 w-4 text-amber-300" /> : null}</span></button>{!active && !theme.isDefault ? <button type="button" className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-xl text-red-300 hover:bg-red-400/10" onClick={() => void removeTheme(theme.id)} aria-label={`Eliminar tema ${theme.name}`} disabled={busy === `theme-delete:${theme.id}`}>{busy === `theme-delete:${theme.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button> : null}</div>;
                    })}
                    {!config?.themes.length ? <p className="col-span-full rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">Guarda tu primer tema abajo.</p> : null}
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4"><div><h3 className="font-black">Diseño de audiencia</h3><p className="mt-1 text-xs leading-5 text-slate-400">Texto limpio, fondo, logo y atribución.</p></div><div className={`rounded-full px-3 py-1 text-[10px] font-black ${contrastSafe ? "bg-emerald-300/10 text-emerald-200" : "bg-red-300/10 text-red-200"}`}>{contrast.toFixed(1)}:1</div></div>
                  {!contrastSafe ? <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-300/20 bg-red-300/10 p-3 text-xs leading-5 text-red-100"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />El texto no alcanza contraste 4.5:1. La vista previa conserva tus colores, pero no podrás aplicarlos hasta corregirlos.</div> : null}

                  <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div><Label className="text-xs font-bold text-slate-300">Tipografía</Label><Select value={themeDraft.fontFamily} onValueChange={(value) => updateTheme((current) => ({ ...current, fontFamily: value as PresentationOutputFont }))}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(FONT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label className="text-xs font-bold text-slate-300">Peso</Label><Select value={String(themeDraft.fontWeight)} onValueChange={(value) => updateTheme((current) => ({ ...current, fontWeight: Number(value) as PresentationOutputFontWeight }))}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent>{[400, 500, 600, 700, 800].map((weight) => <SelectItem key={weight} value={String(weight)}>{weight}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label className="text-xs font-bold text-slate-300">Ubicación</Label><Select value={themeDraft.placement} onValueChange={(value) => updateTheme((current) => ({ ...current, placement: value as PresentationOutputPlacement }))}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="center">Centro</SelectItem><SelectItem value="lower_third">Tercio inferior</SelectItem></SelectContent></Select></div>
                    <ColorField id="theme-text" label="Texto" value={themeDraft.textColor} onChange={(textColor) => updateTheme((current) => ({ ...current, textColor }))} />
                    <ColorField id="theme-accent" label="Acento" value={themeDraft.accentColor} onChange={(accentColor) => updateTheme((current) => ({ ...current, accentColor }))} />
                    <ColorField id="theme-background" label="Fondo" value={themeDraft.background.color} onChange={(color) => updateTheme((current) => ({ ...current, background: { ...current.background, color } }))} />
                    <ColorField id="theme-overlay" label="Capa sobre imagen" value={themeDraft.background.overlayColor} onChange={(overlayColor) => updateTheme((current) => ({ ...current, background: { ...current.background, overlayColor } }))} />
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div><Label htmlFor="theme-background-image" className="text-xs font-bold text-slate-300">Imagen de fondo HTTPS</Label><Input id="theme-background-image" value={themeDraft.background.imageUrl || ""} onChange={(event) => updateTheme((current) => ({ ...current, background: { ...current.background, type: event.target.value.trim() ? "image" : "color", imageUrl: event.target.value.trim() || null } }))} placeholder="https://…" className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white" /></div>
                    <div><Label htmlFor="theme-logo" className="text-xs font-bold text-slate-300">Logo HTTPS</Label><Input id="theme-logo" value={themeDraft.logo.url || ""} onChange={(event) => updateTheme((current) => ({ ...current, logo: { ...current.logo, url: event.target.value.trim() || null, position: event.target.value.trim() && current.logo.position === "none" ? "top_right" : current.logo.position } }))} placeholder="https://…" className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white" /></div>
                    <div><Label className="text-xs font-bold text-slate-300">Posición del logo</Label><Select value={themeDraft.logo.position} onValueChange={(position) => updateTheme((current) => ({ ...current, logo: { ...current.logo, position: position as PresentationResolvedTheme["logo"]["position"] } }))}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Oculto</SelectItem><SelectItem value="top_left">Arriba izquierda</SelectItem><SelectItem value="top_right">Arriba derecha</SelectItem><SelectItem value="bottom_left">Abajo izquierda</SelectItem><SelectItem value="bottom_right">Abajo derecha</SelectItem></SelectContent></Select></div>
                    <div><Label className="text-xs font-bold text-slate-300">Posición del copyright</Label><Select value={themeDraft.copyright.position} onValueChange={(position) => updateTheme((current) => ({ ...current, copyright: { ...current.copyright, position: position as PresentationResolvedTheme["copyright"]["position"] } }))}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bottom_left">Abajo izquierda</SelectItem><SelectItem value="bottom_center">Abajo centro</SelectItem><SelectItem value="bottom_right">Abajo derecha</SelectItem></SelectContent></Select></div>
                    <div><Label className="text-xs font-bold text-slate-300">Opacidad de capa · {Math.round(themeDraft.background.overlayOpacity * 100)}%</Label><Slider className="mt-4" min={0} max={1} step={0.05} value={[themeDraft.background.overlayOpacity]} onValueChange={([overlayOpacity]) => updateTheme((current) => ({ ...current, background: { ...current.background, overlayOpacity } }))} /></div>
                    <ShowToggle label="Mostrar copyright y CCLI" checked={themeDraft.copyright.visible} onCheckedChange={(visible) => updateTheme((current) => ({ ...current, copyright: { ...current.copyright, visible } }))} />
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <Input value={newThemeName} onChange={(event) => setNewThemeName(event.target.value)} maxLength={80} className="h-11 rounded-xl border-white/10 bg-black/20 text-white" aria-label="Nombre del tema nuevo" />
                    <Button type="button" variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.05] text-white hover:bg-white/10 hover:text-white" disabled={!contrastSafe || !themeAssetsSafe || busy === "config"} onClick={() => void applyConfig({ themeOverrides: themeDraft }, "Diseño aplicado solo a este servicio.")}>Aplicar aquí</Button>
                    <Button type="button" className="h-11 rounded-xl bg-amber-300 font-black text-[#17120a] hover:bg-amber-200" disabled={!contrastSafe || !themeAssetsSafe || busy === "theme"} onClick={() => void saveTheme(true)}>{busy === "theme" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}Guardar tema</Button>
                  </div>
                  {activeTheme ? <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Input value={themeName} onChange={(event) => setThemeName(event.target.value)} maxLength={80} className="h-11 rounded-xl border-white/10 bg-black/20 text-white" aria-label="Nombre del tema activo" /><Button type="button" variant="ghost" className="h-11 rounded-xl text-xs text-slate-300 hover:bg-white/5 hover:text-white" disabled={!contrastSafe || !themeAssetsSafe || busy === "theme"} onClick={() => void saveTheme(false)}>Actualizar tema activo</Button></div> : null}
                </section>
              </TabsContent>

              <TabsContent value="layouts" className="mt-5 space-y-5">
                <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <Label className="text-xs font-bold text-slate-300">Vista guardada para editar</Label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Select value={editingLayoutId || "new"} onValueChange={editLayout}>
                      <SelectTrigger className="h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="new">Crear nueva vista</SelectItem>{(config?.roleLayouts || []).map((layout) => <SelectItem key={layout.id} value={layout.id}>{layout.name} · {ROLE_LABELS[layout.targetRole]}</SelectItem>)}</SelectContent>
                    </Select>
                    {editingLayoutId ? <Button type="button" variant="ghost" className="h-11 rounded-xl text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={busy === "layout-delete"} onClick={() => void removeLayout()}><Trash2 className="h-4 w-4" />Eliminar</Button> : null}
                  </div>
                </section>
                <section><h3 className="font-black">Vista por función</h3><p className="mt-1 text-xs leading-5 text-slate-400">Cada persona recibe solo la información que necesita. La prioridad es líder, predicador, producción y músicos.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{ROLES.map((role) => { const resolved = config?.resolvedRoleLayouts[role]; const options = config?.roleLayouts.filter((layout) => layout.targetRole === role) || []; return <div key={role} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">{ROLE_LABELS[role]}</p><Select value={config?.roleLayoutIds[role] || resolved?.id || ""} onValueChange={(value) => void applyRoleLayout(role, value)}><SelectTrigger className="mt-3 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue placeholder="Vista predeterminada" /></SelectTrigger><SelectContent>{options.map((layout) => <SelectItem key={layout.id} value={layout.id}>{layout.name}</SelectItem>)}</SelectContent></Select><div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-slate-300">{resolved ? MODE_LABELS[resolved.mode] : "—"}</span><span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-slate-300">{resolved ? `${Math.round(resolved.fontScale * 100)}%` : "—"}</span>{resolved?.show.chords ? <span className="rounded-md bg-violet-300/10 px-2 py-1 text-[10px] font-bold text-violet-200">Acordes</span> : null}{resolved?.show.notes ? <span className="rounded-md bg-emerald-300/10 px-2 py-1 text-[10px] font-bold text-emerald-200">Notas</span> : null}</div></div>; })}</div></section>

                <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4 sm:p-5"><div><h3 className="font-black">Nueva vista de escenario</h3><p className="mt-1 text-xs text-slate-400">Guárdala en la biblioteca y aplícala a una función.</p></div><div className="mt-5 grid gap-4 sm:grid-cols-3"><div><Label className="text-xs font-bold text-slate-300">Función</Label><Select value={layoutRole} onValueChange={(value) => resetLayoutDraft(value as PresentationStageRole)}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-xs font-bold text-slate-300">Modo</Label><Select value={layoutMode} onValueChange={(value) => setLayoutMode(value as PresentationStageMode)}><SelectTrigger className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(MODE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-xs font-bold text-slate-300">Escala · {Math.round(layoutFontScale * 100)}%</Label><Slider className="mt-5" min={0.7} max={1.5} step={0.02} value={[layoutFontScale]} onValueChange={([value]) => setLayoutFontScale(value)} /></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><ShowToggle label="Actual" checked={layoutShow.current} onCheckedChange={(current) => setLayoutShow((show) => ({ ...show, current }))} /><ShowToggle label="Siguiente" checked={layoutShow.next} onCheckedChange={(next) => setLayoutShow((show) => ({ ...show, next }))} /><ShowToggle label="Notas" checked={layoutShow.notes} onCheckedChange={(notes) => setLayoutShow((show) => ({ ...show, notes }))} /><ShowToggle label="Acordes" checked={layoutShow.chords} onCheckedChange={(chords) => setLayoutShow((show) => ({ ...show, chords }))} /><ShowToggle label="Reloj" checked={layoutShow.clock} onCheckedChange={(clock) => setLayoutShow((show) => ({ ...show, clock }))} /><ShowToggle label="Tiempo servicio" checked={layoutShow.serviceTimer} onCheckedChange={(serviceTimer) => setLayoutShow((show) => ({ ...show, serviceTimer }))} /><ShowToggle label="Tiempo elemento" checked={layoutShow.itemTimer} onCheckedChange={(itemTimer) => setLayoutShow((show) => ({ ...show, itemTimer }))} /><ShowToggle label="Mensajes" checked={layoutShow.messages} onCheckedChange={(messages) => setLayoutShow((show) => ({ ...show, messages }))} /></div><div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><Input value={layoutName} onChange={(event) => setLayoutName(event.target.value)} maxLength={80} className="h-11 rounded-xl border-white/10 bg-black/20 text-white" aria-label="Nombre de la vista" /><Button type="button" className="h-11 rounded-xl bg-amber-300 font-black text-[#17120a] hover:bg-amber-200" disabled={busy === "layout"} onClick={() => void saveLayout()}>{busy === "layout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Guardar vista</Button></div></section>
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
