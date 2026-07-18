import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Plus, Radio, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { isMediaEndpointUnavailableError, type LiveDestination } from "@/lib/media";

type Credentials = {
  id: string;
  provider: string;
  name: string;
  cloudflareEnabled: boolean;
  rtmpServerUrl: string | null;
  streamKey: string | null;
  srtUrl: string | null;
  srtStreamId: string | null;
  srtPassphrase: string | null;
  masked?: {
    streamKey?: string | null;
    srtStreamId?: string | null;
    srtPassphrase?: string | null;
  };
};

const providerOptions = [
  { value: "cloudflare", label: "OBS por Tchurch" },
  { value: "facebook", label: "Facebook Live" },
  { value: "resi", label: "Resi / Pushpay" },
  { value: "hls", label: "HLS .m3u8" },
  { value: "custom", label: "Enlace personalizado" },
];

const emptyForm = {
  provider: "cloudflare",
  name: "",
  description: "",
  playbackUrl: "",
  embedUrl: "",
  hlsUrl: "",
};

function statusLabel(destination: LiveDestination) {
  if (destination.status === "setup_required") return "Configurar";
  if (destination.streamStatus === "live") return "En vivo";
  if (destination.streamStatus === "scheduled") return "Programado";
  return destination.status === "active" ? "Activo" : destination.status;
}

function statusClass(destination: LiveDestination) {
  if (destination.streamStatus === "live") return "border-red-100 bg-red-50 text-red-700";
  if (destination.status === "setup_required") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

export function LiveDestinationSetup({ compact = false }: { compact?: boolean }) {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [destinations, setDestinations] = useState<LiveDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [credentials, setCredentials] = useState<Record<string, Credentials>>({});
  const [processingCredentialId, setProcessingCredentialId] = useState<string | null>(null);
  const [endpointUnavailable, setEndpointUnavailable] = useState(false);

  const loadDestinations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ destinations?: LiveDestination[] }>("/live-destinations");
      setDestinations(Array.isArray(data.destinations) ? data.destinations : []);
      setEndpointUnavailable(false);
    } catch (error) {
      if (isMediaEndpointUnavailableError(error)) {
        setDestinations([]);
        setEndpointUnavailable(true);
        setShowForm(false);
        return;
      }
      console.warn("No se pudieron cargar destinos de transmisión:", error);
    } finally {
      setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    loadDestinations();
  }, [loadDestinations]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await fetchApi<LiveDestination>("/live-destinations", {
        method: "POST",
        body: JSON.stringify({
          provider: form.provider,
          name: form.name.trim() || undefined,
          description: form.description.trim() || undefined,
          playbackUrl: form.playbackUrl.trim() || undefined,
          embedUrl: form.embedUrl.trim() || undefined,
          hlsUrl: form.hlsUrl.trim() || undefined,
          createCloudflare: form.provider === "cloudflare",
        }),
      });
      setForm(emptyForm);
      setShowForm(false);
      toast({ title: "Destino de transmisión guardado" });
      await loadDestinations();
    } catch (error) {
      if (isMediaEndpointUnavailableError(error)) {
        setEndpointUnavailable(true);
        setShowForm(false);
        return;
      }
      toast({
        title: error instanceof Error ? error.message : "No se pudo guardar el destino",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function revealCredentials(id: string, regenerate = false) {
    setProcessingCredentialId(id);
    try {
      const data = await fetchApi<Credentials>(`/live-destinations/${encodeURIComponent(id)}/credentials`, {
        method: regenerate ? "POST" : "GET",
        cache: "no-store",
      });
      setCredentials((current) => ({ ...current, [id]: data }));
      toast({ title: regenerate ? "Credenciales regeneradas" : "Credenciales listas" });
      if (regenerate) await loadDestinations();
    } catch (error) {
      if (isMediaEndpointUnavailableError(error)) {
        setEndpointUnavailable(true);
        setShowForm(false);
        return;
      }
      toast({
        title: error instanceof Error ? error.message : "No se pudieron cargar credenciales",
        variant: "destructive",
      });
    } finally {
      setProcessingCredentialId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-black uppercase text-zinc-500">
            <Radio className="h-4 w-4" />
            Transmisión
          </p>
          <h2 className="mt-1 text-lg font-black text-zinc-950">Destinos en vivo</h2>
          {!compact && (
            <p className="mt-1 text-sm text-zinc-500">
              Conecta Facebook, Resi, HLS o crea un destino OBS administrado por Tchurch.
            </p>
          )}
        </div>
        {!endpointUnavailable && (
          <Button type="button" size="sm" onClick={() => setShowForm((value) => !value)}>
            <Plus className="h-4 w-4" />
            Nuevo
          </Button>
        )}
      </div>

      {showForm && !endpointUnavailable && (
        <form onSubmit={handleCreate} className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Select value={form.provider} onValueChange={(value) => setForm((current) => ({ ...current, provider: value }))}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={form.provider === "cloudflare" ? "OBS principal" : "Transmisión principal"}
                className="bg-white"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={2}
              className="bg-white"
            />
          </div>
          {form.provider !== "cloudflare" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{form.provider === "hls" ? "HLS .m3u8" : "Playback / enlace público"}</Label>
                <Input
                  value={form.playbackUrl}
                  onChange={(event) => setForm((current) => ({ ...current, playbackUrl: event.target.value }))}
                  placeholder="https://..."
                  inputMode="url"
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label>Embed permitido</Label>
                <Input
                  value={form.embedUrl}
                  onChange={(event) => setForm((current) => ({ ...current, embedUrl: event.target.value }))}
                  placeholder="https://embed..."
                  inputMode="url"
                  className="bg-white"
                />
              </div>
            </div>
          )}
          <Button type="submit" disabled={submitting} className="w-full sm:w-fit">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Guardar destino
          </Button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : endpointUnavailable ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
          <Radio className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-2 text-sm font-bold text-zinc-700">La configuración de transmisiones todavía no está activa</p>
          <p className="mx-auto mt-1 max-w-sm text-xs font-medium text-zinc-500">
            Sermones se puede revisar en modo lectura hasta que el backend de transmisiones esté desplegado.
          </p>
        </div>
      ) : destinations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
          <Radio className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-2 text-sm font-bold text-zinc-700">No hay destinos configurados</p>
        </div>
      ) : (
        <div className="space-y-3">
          {destinations.map((destination) => {
            const revealed = credentials[destination.id];
            const isCloudflare = destination.provider === "cloudflare";
            return (
              <article key={destination.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-zinc-950">{destination.name}</h3>
                      <Badge variant="outline" className={statusClass(destination)}>{statusLabel(destination)}</Badge>
                      <Badge variant="secondary">{destination.provider}</Badge>
                    </div>
                    {destination.description && <p className="mt-1 text-sm text-zinc-500">{destination.description}</p>}
                    {destination.status === "setup_required" && (
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                        Cloudflare Stream necesita variables de entorno antes de generar credenciales OBS.
                      </p>
                    )}
                  </div>
                  {isCloudflare && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={processingCredentialId === destination.id}
                        onClick={() => revealCredentials(destination.id)}
                      >
                        {processingCredentialId === destination.id ? <Loader2 className="h-4 w-4 animate-spin" /> : revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        Credenciales
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={processingCredentialId === destination.id}
                        onClick={() => revealCredentials(destination.id, true)}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Regenerar
                      </Button>
                    </div>
                  )}
                </div>

                {revealed && (
                  <div className="mt-3 grid gap-2 rounded-lg border border-zinc-200 bg-white p-3">
                    <p className="flex items-center gap-2 text-xs font-black uppercase text-zinc-500">
                      <KeyRound className="h-4 w-4" />
                      OBS
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input value={revealed.rtmpServerUrl || ""} readOnly aria-label="RTMPS URL" />
                      <Input value={revealed.streamKey || ""} readOnly aria-label="Stream key" />
                    </div>
                    {revealed.srtUrl && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input value={revealed.srtUrl} readOnly aria-label="SRT URL" />
                        <Input value={revealed.srtStreamId || ""} readOnly aria-label="SRT stream ID" />
                        {revealed.srtPassphrase && <Input value={revealed.srtPassphrase} readOnly aria-label="SRT passphrase" />}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
