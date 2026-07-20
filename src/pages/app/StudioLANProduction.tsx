import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  MonitorUp,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Timer,
  Unplug,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStudioLANClient } from "@/hooks/useStudioLANClient";
import { scannerErrorNotice } from "@/lib/barcodeScannerErrors";
import {
  normalizeStudioLANPairingQR,
  normalizeStudioLANLocalBroadcastLowerThirdAction,
  projectStudioLANOperatorTimerMilliseconds,
  type StudioLANLocalBroadcastLowerThirdFeedback,
  type StudioLANLocalOBSSceneFeedback,
  type StudioLANRemoteFeedback,
  type StudioLANOperatorTimerFeedback,
  type StudioLANOperatorTimerState,
} from "@/lib/studioLANClient";

function goBack(navigate: ReturnType<typeof useNavigate>) {
  if (window.history.length > 1) navigate(-1);
  else navigate("/app/services", { replace: true });
}

const REJECTION_MESSAGES: Record<NonNullable<StudioLANRemoteFeedback["rejection"]>, string> = {
  routeDisabled: "Studio desactivó el control LAN local.",
  unauthorizedDevice: "Este dispositivo ya no tiene permiso para controlar Program.",
  staleRoute: "La ruta de salida cambió. Esperando el nuevo estado firmado.",
  authorityMismatch: "La autoridad del show cambió. Reconectando de forma segura.",
  expiredCommand: "El comando venció antes de llegar a Studio.",
  invalidSignature: "Studio rechazó la firma del dispositivo.",
  invalidCommand: "Studio rechazó este comando cerrado.",
  revisionConflict: "Program cambió antes del comando. Esperando la revisión nueva.",
  commandIDCollision: "Studio detectó un identificador de comando repetido.",
  rateLimited: "Demasiados controles seguidos. Espera un momento.",
  unavailable: "El motor local de Program no está disponible.",
};

function feedbackMessage(feedback: StudioLANRemoteFeedback | null) {
  if (!feedback) return null;
  if (feedback.state === "queued") return "Enviado a Studio; esperando confirmación firmada…";
  if (feedback.state === "accepted") {
    return feedback.wasIdempotentReplay
      ? "Studio confirmó el comando anterior sin ejecutarlo dos veces."
      : "Studio confirmó el cambio en Program.";
  }
  if (feedback.state === "rejected" && feedback.rejection) return REJECTION_MESSAGES[feedback.rejection];
  if (feedback.state === "timedOut") return "Studio no confirmó el comando. Reconectando sin repetirlo.";
  return "El comando se interrumpió antes de ser confirmado.";
}

function operatorTimerFeedbackMessage(feedback: StudioLANOperatorTimerFeedback | null) {
  if (!feedback) return null;
  if (feedback.state === "queued") return "Timer enviado por LAN; esperando confirmación firmada…";
  if (feedback.state === "accepted") {
    return feedback.wasIdempotentReplay
      ? "Studio confirmó el timer anterior sin ejecutarlo dos veces."
      : "Studio confirmó el timer local de Producción.";
  }
  if (feedback.state === "rejected" && feedback.rejection) {
    if (feedback.rejection === "revisionConflict") {
      return "El timer cambió antes del comando. Esperando la revisión firmada nueva.";
    }
    return REJECTION_MESSAGES[feedback.rejection];
  }
  if (feedback.state === "timedOut") return "Studio no confirmó el timer. Reconectando sin repetirlo.";
  return "El timer se interrumpió antes de ser confirmado.";
}

function localBroadcastLowerThirdFeedbackMessage(
  feedback: StudioLANLocalBroadcastLowerThirdFeedback | null,
) {
  if (!feedback) return null;
  if (feedback.state === "queued") {
    return "Lower third enviado por LAN; esperando confirmación firmada…";
  }
  if (feedback.state === "accepted") {
    return feedback.wasIdempotentReplay
      ? "Studio confirmó el lower third anterior sin ejecutarlo dos veces."
      : "Studio confirmó el lower third del Browser Source local de OBS.";
  }
  if (feedback.state === "rejected" && feedback.rejection) {
    if (feedback.rejection === "revisionConflict") {
      return "El lower third cambió antes del comando. Esperando la revisión firmada nueva.";
    }
    if (feedback.rejection === "unavailable") {
      return "El Browser Source local de OBS no está disponible.";
    }
    return REJECTION_MESSAGES[feedback.rejection];
  }
  if (feedback.state === "timedOut") {
    return "Studio no confirmó el lower third. Reconectando sin repetirlo.";
  }
  return "El lower third se interrumpió antes de ser confirmado.";
}

function localOBSSceneFeedbackMessage(feedback: StudioLANLocalOBSSceneFeedback | null) {
  if (!feedback) return null;
  if (feedback.state === "queued") {
    return "Escena enviada por LAN; esperando confirmación firmada de OBS local…";
  }
  if (feedback.state === "accepted") return "Studio confirmó la escena de OBS local.";
  if (feedback.state === "rejected" && feedback.rejection) {
    if (feedback.rejection === "revisionConflict") {
      return "La conexión o el catálogo de OBS cambió. Esperando el estado firmado nuevo.";
    }
    if (feedback.rejection === "unavailable") {
      return "OBS local no está disponible para cambiar de escena.";
    }
    return REJECTION_MESSAGES[feedback.rejection];
  }
  if (feedback.state === "unconfirmed") {
    return "OBS puede haber ejecutado el cambio. No lo repetiremos; esperando estado firmado nuevo.";
  }
  return "El cambio de escena se interrumpió antes de enviarse a OBS.";
}

function formatOperatorTimer(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function StudioLANProduction() {
  const navigate = useNavigate();
  const {
    status,
    update,
    remoteFeedback,
    operatorTimerFeedback,
    localBroadcastLowerThirdFeedback,
    localOBSSceneFeedback,
    localOBSOutputFeedback,
    cueCatalog: pagedCueCatalog,
    connect,
    disconnect,
    forget,
    refresh,
    sendRemoteCommand,
    sendOperatorTimerCommand,
    sendLocalBroadcastLowerThirdCommand,
    sendLocalOBSSceneCommand,
    sendLocalOBSOutputCommand,
    requestReapproval,
  } = useStudioLANClient();
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [showSetup, setShowSetup] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [selectedCueId, setSelectedCueId] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(0);
  const [localCommandPending, setLocalCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [localTimerCommandPending, setLocalTimerCommandPending] = useState(false);
  const [timerCommandError, setTimerCommandError] = useState<string | null>(null);
  const [lowerThirdTitle, setLowerThirdTitle] = useState("");
  const [lowerThirdSubtitle, setLowerThirdSubtitle] = useState("");
  const [localLowerThirdCommandPending, setLocalLowerThirdCommandPending] = useState(false);
  const [lowerThirdCommandError, setLowerThirdCommandError] = useState<string | null>(null);
  const [selectedLocalOBSSceneId, setSelectedLocalOBSSceneId] = useState("");
  const [localOBSSceneCommandPending, setLocalOBSSceneCommandPending] = useState(false);
  const [localOBSSceneCommandError, setLocalOBSSceneCommandError] = useState<string | null>(null);
  const [localOBSOutputCommandPending, setLocalOBSOutputCommandPending] = useState(false);
  const [localOBSOutputCommandError, setLocalOBSOutputCommandError] = useState<string | null>(null);
  const [timerMonotonicNow, setTimerMonotonicNow] = useState(() => performance.now());
  const [reapproving, setReapproving] = useState(false);
  const [reapprovalError, setReapprovalError] = useState<string | null>(null);

  useEffect(() => {
    if (status.selectedServiceId) setSelectedServiceId(status.selectedServiceId);
    else if (!selectedServiceId && status.services[0]) setSelectedServiceId(status.services[0].id);
  }, [selectedServiceId, status.selectedServiceId, status.services]);

  useEffect(() => {
    const ready = status.phase === "connected"
      && status.channel === "control"
      && status.enrollmentState === "approved"
      && status.role === "production"
      && update?.channel === "control";
    if (ready) setShowSetup(false);
    if (status.phase === "failed" || status.enrollmentState === "pending" || status.enrollmentState === "revoked") {
      setShowSetup(true);
    }
  }, [status, update?.channel]);

  useEffect(() => {
    if (remoteFeedback?.state && remoteFeedback.state !== "queued") setLocalCommandPending(false);
  }, [remoteFeedback]);

  useEffect(() => {
    if (operatorTimerFeedback?.state && operatorTimerFeedback.state !== "queued") {
      setLocalTimerCommandPending(false);
    }
  }, [operatorTimerFeedback]);

  useEffect(() => {
    if (localBroadcastLowerThirdFeedback?.state
      && localBroadcastLowerThirdFeedback.state !== "queued") {
      setLocalLowerThirdCommandPending(false);
    }
  }, [localBroadcastLowerThirdFeedback]);

  useEffect(() => {
    if (localOBSSceneFeedback?.state && localOBSSceneFeedback.state !== "queued") {
      setLocalOBSSceneCommandPending(false);
    }
  }, [localOBSSceneFeedback]);

  useEffect(() => {
    if (localOBSOutputFeedback?.state && localOBSOutputFeedback.state !== "queued") {
      setLocalOBSOutputCommandPending(false);
    }
  }, [localOBSOutputFeedback]);

  const selectedService = useMemo(
    () => status.services.find((service) => service.id === selectedServiceId) ?? null,
    [selectedServiceId, status.services],
  );
  const controlUpdate = update?.channel === "control" ? update : null;
  const usesPagedCatalog = controlUpdate?.payloadVersion === 5
    || controlUpdate?.payloadVersion === 6 || controlUpdate?.payloadVersion === 7
    || controlUpdate?.payloadVersion === 8 || controlUpdate?.payloadVersion === 9;
  const cueCatalog = useMemo(() => (
    usesPagedCatalog
      ? (pagedCueCatalog?.phase === "ready" ? pagedCueCatalog.cues ?? [] : [])
      : controlUpdate?.control?.cueCatalog ?? []
  ), [controlUpdate?.control?.cueCatalog, pagedCueCatalog, usesPagedCatalog]);
  const commandPending = localCommandPending || localTimerCommandPending
    || localLowerThirdCommandPending || localOBSSceneCommandPending || localOBSOutputCommandPending
    || status.remoteCommandInFlight || status.operatorTimerCommandInFlight
    || status.localBroadcastLowerThirdCommandInFlight || status.localOBSSceneCommandInFlight
    || status.localOBSStreamCommandInFlight || status.localOBSRecordingCommandInFlight;
  const controlsEnabled = status.remoteControlAvailable && !commandPending && controlUpdate?.control != null;
  const jumpEnabled = controlsEnabled && (!usesPagedCatalog || pagedCueCatalog?.phase === "ready") && cueCatalog.length > 0;
  const currentCue = controlUpdate?.audience.cue ?? null;
  const feedback = feedbackMessage(remoteFeedback);
  const timerFeedback = operatorTimerFeedbackMessage(operatorTimerFeedback);
  const lowerThirdFeedback = localBroadcastLowerThirdFeedbackMessage(
    localBroadcastLowerThirdFeedback,
  );
  const routing = controlUpdate?.control?.routing ?? null;
  const operatorTimers = controlUpdate?.payloadVersion === 6
    || controlUpdate?.payloadVersion === 7 || controlUpdate?.payloadVersion === 8
    || controlUpdate?.payloadVersion === 9
    ? controlUpdate.control?.operatorTimers ?? null : null;
  const timerClockOrigin = useMemo(() => ({
    sequence: controlUpdate?.sequence ?? "0",
    timerRevision: operatorTimers?.revision ?? null,
    monotonicMilliseconds: performance.now(),
  }), [controlUpdate?.sequence, operatorTimers?.revision]);
  const timerControlsEnabled = status.operatorTimerControlAvailable
    && (controlUpdate?.payloadVersion === 6 || controlUpdate?.payloadVersion === 7
      || controlUpdate?.payloadVersion === 8 || controlUpdate?.payloadVersion === 9)
    && operatorTimers != null
    && !commandPending;
  const lowerThird = controlUpdate?.payloadVersion === 7 || controlUpdate?.payloadVersion === 8
    || controlUpdate?.payloadVersion === 9
    ? controlUpdate.control?.localBroadcastLowerThird ?? null : null;
  const lowerThirdShowAction = useMemo(() => {
    const title = lowerThirdTitle.trim();
    const subtitle = lowerThirdSubtitle.trim();
    return normalizeStudioLANLocalBroadcastLowerThirdAction({
      kind: "localBroadcastLowerThird",
      operation: "show",
      title,
      ...(subtitle ? { subtitle } : {}),
    });
  }, [lowerThirdSubtitle, lowerThirdTitle]);
  const lowerThirdControlsEnabled = status.localBroadcastLowerThirdControlAvailable
    && (controlUpdate?.payloadVersion === 7 || controlUpdate?.payloadVersion === 8
      || controlUpdate?.payloadVersion === 9)
    && lowerThird != null
    && !commandPending;
  const localOBS = controlUpdate?.payloadVersion === 8 || controlUpdate?.payloadVersion === 9
    ? controlUpdate.control?.localOBS ?? null : null;
  const localOBSFeedback = localOBSSceneFeedbackMessage(localOBSSceneFeedback);
  const localOBSControlsEnabled = status.localOBSSceneControlAvailable
    && (controlUpdate?.payloadVersion === 8 || controlUpdate?.payloadVersion === 9)
    && localOBS?.availability === "ready"
    && routing?.localBroadcast === true
    && routing.tchurchCloudProgram === false
    && !commandPending;
  const localOBSOutputs = controlUpdate?.payloadVersion === 9
    ? controlUpdate.control?.localOBSOutputs ?? null : null;
  const outputProfileReady = controlUpdate?.payloadVersion === 9
    && routing?.localBroadcast === true
    && routing.lanRemoteControl === true
    && routing.stageAndMusicians === false
    && routing.tchurchCloudProgram === false
    && routing.lightingAndMIDI === false
    && localOBSOutputs?.availability === "ready";
  const localOBSOutputFeedbackMessage = localOBSOutputFeedback?.state === "accepted"
    ? "Studio confirmó el cambio de salida OBS."
    : localOBSOutputFeedback?.state === "rejected"
      ? "Studio rechazó el cambio de salida OBS."
      : localOBSOutputFeedback?.state === "unconfirmed"
        ? "OBS puede haber aplicado el cambio. No se repetirá automáticamente; esperando estado firmado nuevo."
        : localOBSOutputFeedback?.state === "interrupted"
          ? "El cambio de salida OBS se interrumpió antes de confirmarse."
          : localOBSOutputFeedback?.state === "queued"
            ? "Cambio de salida OBS enviado; esperando confirmación firmada."
            : null;
  const signedRoutingIndicators = (controlUpdate?.payloadVersion === 8
    || controlUpdate?.payloadVersion === 9) && routing ? [
    { key: "localAudience", label: "Audiencia local", enabled: routing.localAudience },
    { key: "stageAndMusicians", label: "Stage / músicos", enabled: routing.stageAndMusicians },
    { key: "localBroadcast", label: "Transmisión local", enabled: routing.localBroadcast },
    { key: "lanRemoteControl", label: "Control LAN", enabled: routing.lanRemoteControl },
    {
      key: "lightingAndMIDI",
      label: "Ruta luces / MIDI",
      enabled: routing.lightingAndMIDI,
      activeLabel: "Habilitada",
      inactiveLabel: "Deshabilitada",
    },
    {
      key: "lightingArmed",
      label: "Luces armadas",
      enabled: controlUpdate?.control?.lightingArmed,
      activeLabel: "Armadas",
      inactiveLabel: "Desarmadas",
    },
    { key: "tchurchCloudProgram", label: "Cloud Program", enabled: routing.tchurchCloudProgram },
  ] : null;

  useEffect(() => {
    const preferredSceneId = localOBS?.currentSceneId ?? localOBS?.scenes[0]?.sceneId ?? "";
    setSelectedLocalOBSSceneId((current) => (
      localOBS?.scenes.some((scene) => scene.sceneId === current) ? current : preferredSceneId
    ));
  }, [localOBS?.connectionId, localOBS?.currentSceneId, localOBS?.revision, localOBS?.scenes]);

  useEffect(() => {
    setLowerThirdTitle(lowerThird?.visible ? lowerThird.title ?? "" : "");
    setLowerThirdSubtitle(lowerThird?.visible ? lowerThird.subtitle ?? "" : "");
  }, [lowerThird?.revision, lowerThird?.subtitle, lowerThird?.title, lowerThird?.visible]);

  useEffect(() => {
    setTimerMonotonicNow(timerClockOrigin.monotonicMilliseconds);
    if (!operatorTimers?.timers.some((timer) => timer.isRunning)) return undefined;
    const interval = window.setInterval(() => setTimerMonotonicNow(performance.now()), 250);
    return () => window.clearInterval(interval);
  }, [operatorTimers, timerClockOrigin]);

  function projectedOperatorTimerMilliseconds(timer: StudioLANOperatorTimerState) {
    if (!controlUpdate) return timer.anchorValueMilliseconds;
    return projectStudioLANOperatorTimerMilliseconds(
      timer,
      controlUpdate.issuedAtMs,
      timerClockOrigin.monotonicMilliseconds,
      timerMonotonicNow,
    );
  }
  const filteredCueCatalog = useMemo(() => {
    const query = catalogSearch.trim().toLocaleLowerCase();
    return query
      ? cueCatalog.filter((cue) => cue.title.toLocaleLowerCase().includes(query)
        || cue.cueId.toLocaleLowerCase().includes(query))
      : cueCatalog;
  }, [catalogSearch, cueCatalog]);
  const catalogPageSize = 48;
  const catalogPageCount = Math.max(1, Math.ceil(filteredCueCatalog.length / catalogPageSize));
  const visibleCueCatalog = filteredCueCatalog.slice(
    catalogPage * catalogPageSize,
    (catalogPage + 1) * catalogPageSize,
  );

  useEffect(() => {
    setSelectedCueId("");
    setCatalogSearch("");
    setCatalogPage(0);
  }, [controlUpdate?.control?.cueCatalogManifest?.catalogId, controlUpdate?.control?.routeEpoch]);

  useEffect(() => {
    if (catalogPage >= catalogPageCount) setCatalogPage(Math.max(0, catalogPageCount - 1));
  }, [catalogPage, catalogPageCount]);

  async function submitConnection() {
    if (!selectedService || selectedService.protocolFloor < 4) return;
    setSubmitting(true);
    setCommandError(null);
    try {
      await connect(selectedService.id, "control", pairingCode, "production");
    } finally {
      setSubmitting(false);
    }
  }

  async function scanPairingQR() {
    setScanning(true);
    setScanNotice(null);
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      });
      const normalized = normalizeStudioLANPairingQR(result.ScanResult);
      if (!normalized) {
        setScanNotice("Ese QR no pertenece al emparejamiento local de Tchurch Studio.");
        return;
      }
      setPairingCode(normalized);
    } catch (error) {
      const notice = scannerErrorNotice(error);
      setScanNotice(`${notice.title}. ${notice.description}`);
    } finally {
      setScanning(false);
    }
  }

  async function runCommand(
    action: Parameters<typeof sendRemoteCommand>[0],
  ) {
    if (!controlsEnabled) return;
    setLocalCommandPending(true);
    setCommandError(null);
    try {
      await sendRemoteCommand(action);
    } catch {
      setLocalCommandPending(false);
      setCommandError("Studio todavía no está listo para aceptar ese control.");
    }
  }

  async function runOperatorTimerCommand(timer: StudioLANOperatorTimerState) {
    if (!timerControlsEnabled) return;
    setLocalTimerCommandPending(true);
    setTimerCommandError(null);
    try {
      await sendOperatorTimerCommand({
        scope: timer.scope,
        operation: timer.isRunning ? "pause" : "start",
      });
    } catch {
      setLocalTimerCommandPending(false);
      setTimerCommandError("Studio todavía no está listo para aceptar ese timer local.");
    }
  }

  async function runLocalBroadcastLowerThirdCommand(operation: "show" | "hide") {
    if (!lowerThirdControlsEnabled) return;
    const action = operation === "show"
      ? lowerThirdShowAction
      : normalizeStudioLANLocalBroadcastLowerThirdAction({
        kind: "localBroadcastLowerThird",
        operation: "hide",
      });
    if (!action) return;
    setLocalLowerThirdCommandPending(true);
    setLowerThirdCommandError(null);
    try {
      await sendLocalBroadcastLowerThirdCommand(action);
    } catch {
      setLocalLowerThirdCommandPending(false);
      setLowerThirdCommandError(
        "Studio todavía no está listo para aceptar ese lower third de OBS local.",
      );
    }
  }

  async function runLocalOBSSceneCommand() {
    if (!localOBSControlsEnabled || !selectedLocalOBSSceneId
      || !localOBS?.scenes.some((scene) => scene.sceneId === selectedLocalOBSSceneId)) return;
    setLocalOBSSceneCommandPending(true);
    setLocalOBSSceneCommandError(null);
    try {
      await sendLocalOBSSceneCommand({
        kind: "selectLocalOBSScene",
        sceneId: selectedLocalOBSSceneId,
      });
    } catch {
      setLocalOBSSceneCommandPending(false);
      setLocalOBSSceneCommandError(
        "Studio todavía no está listo para aceptar ese cambio de escena local.",
      );
    }
  }

  async function runLocalOBSOutputCommand(
    kind: "setLocalOBSStreamActive" | "setLocalOBSRecordingActive",
  ) {
    if (!outputProfileReady || !localOBSOutputs || commandPending) return;
    const isStream = kind === "setLocalOBSStreamActive";
    const expectedCurrentActive = isStream
      ? localOBSOutputs.streamActive : localOBSOutputs.recordingActive;
    const active = !expectedCurrentActive;
    const label = isStream ? "transmisión" : "grabación";
    if (!window.confirm(`¿${active ? "Activar" : "Detener"} ${label} en OBS local?`)) return;
    setLocalOBSOutputCommandPending(true);
    setLocalOBSOutputCommandError(null);
    try {
      await sendLocalOBSOutputCommand({ kind, active, expectedCurrentActive });
    } catch {
      setLocalOBSOutputCommandPending(false);
      setLocalOBSOutputCommandError(
        "El estado de OBS cambió o este dispositivo no tiene ese permiso.",
      );
    }
  }

  async function openSetup() {
    await disconnect();
    setShowSetup(true);
  }

  async function rotateAndRequestReapproval() {
    if (reapproving) return;
    setReapproving(true);
    setReapprovalError(null);
    try {
      await requestReapproval();
    } catch {
      setReapprovalError("No se pudo crear la identidad nueva. Intenta otra vez.");
    } finally {
      setReapproving(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col overflow-hidden bg-[#050507] text-white" data-testid="studio-lan-production">
      <header className="z-20 flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-black/80 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] backdrop-blur sm:px-5">
        <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 rounded-xl text-white hover:bg-white/10 hover:text-white" aria-label="Volver a servicios" onClick={() => goBack(navigate)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-violet-300" aria-hidden="true" />
            <h1 className="truncate text-sm font-black">Control Program · Studio LAN</h1>
          </div>
          <p className="truncate text-[10px] font-semibold text-slate-400">
            Producción local · sin cloud · {routing?.stageAndMusicians === true
              ? "Stage/músicos activos en su ruta"
              : routing?.stageAndMusicians === false ? "Stage/músicos aislados" : "routing por confirmar"}
          </p>
        </div>
        {!showSetup && (
          <Button type="button" variant="ghost" className="h-11 rounded-xl px-3 text-xs font-black text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => void openSetup()}>
            <Unplug className="h-4 w-4" /> Desconectar
          </Button>
        )}
      </header>

      {showSetup || !controlUpdate ? (
        <section className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-6 sm:px-6" aria-label="Conectar control de Producción">
          <div className="mx-auto w-full max-w-2xl space-y-5">
            <div className="rounded-3xl border border-violet-300/20 bg-violet-300/[0.07] p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-300/10 text-violet-200"><ShieldCheck className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-lg font-black">Control local de Program</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-300">Avanza, retrocede, salta o activa blackout en la Mac. Con permisos separados también puede elegir una escena e iniciar o detener la transmisión y la grabación de OBS local. Nunca expone endpoints, contraseñas, claves de stream, destinos, luces, media ni Quick Edit.</p>
                </div>
              </div>
            </div>

            {!status.supported ? (
              <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5" role="status">
                <p className="font-black text-amber-100">Abre este control en la app de iPhone o iPad.</p>
                <p className="mt-2 text-sm leading-6 text-amber-100/80">El navegador no puede firmar comandos con la identidad protegida del dispositivo.</p>
              </div>
            ) : (
              <>
                {status.enrollmentState === "pending" && (
                  <div className="rounded-3xl border border-amber-300/25 bg-amber-300/10 p-5" role="status" data-testid="studio-lan-production-pending">
                    <div className="flex items-start gap-3">
                      <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-amber-200" />
                      <div>
                        <p className="font-black text-amber-100">Esperando aprobación de Producción</p>
                        <p className="mt-1 text-sm leading-6 text-amber-100/80">Aprueba este dispositivo como Producción y habilita “Control Program”. Escenas, transmisión y grabación de OBS local se conceden como tres permisos separados.</p>
                        <p className="mt-2 text-xs font-semibold text-amber-100/65">La solicitud permanece en esta red local; no se publica en internet.</p>
                      </div>
                    </div>
                  </div>
                )}

                {status.enrollmentState === "revoked" && (
                  <div className="rounded-3xl border border-red-300/25 bg-red-300/10 p-5" role="alert">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-200" />
                      <div>
                        <p className="font-black text-red-100">Dispositivo revocado</p>
                        <p className="mt-1 text-sm leading-6 text-red-100/80">La sesión y cualquier estado de control fueron retirados. Ningún botón puede enviar comandos.</p>
                        <p className="mt-2 text-xs font-semibold leading-5 text-red-100/65">Para volver a solicitar acceso se genera otra clave protegida y otro ID local. La identidad revocada nunca se reutiliza.</p>
                        <Button type="button" variant="outline" className="mt-4 h-11 rounded-2xl border-red-100/25 bg-transparent font-black text-red-50 hover:bg-red-100/10 hover:text-white" disabled={reapproving} onClick={() => void rotateAndRequestReapproval()}>
                          {reapproving ? <><LoaderCircle className="h-4 w-4 animate-spin" />Creando identidad…</> : <><ShieldCheck className="h-4 w-4" />Solicitar nueva aprobación</>}
                        </Button>
                        {reapprovalError && <p className="mt-2 text-xs font-bold text-red-100" role="status">{reapprovalError}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {status.message && (
                  <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${status.phase === "failed" ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`} role="status">
                    {status.message}
                  </div>
                )}

                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">1 · Studio LAN disponible</p>
                      <p className="mt-1 text-xs text-slate-400">El iPhone/iPad y la Mac deben estar en la misma red.</p>
                    </div>
                    {(status.phase === "discovering" || status.phase === "connecting" || status.phase === "authenticating") && <LoaderCircle className="h-5 w-5 animate-spin text-violet-300" aria-label="Buscando Studio" />}
                  </div>
                  <div className="mt-4 grid gap-2">
                    {status.services.map((service) => {
                      const compatible = service.protocolFloor >= 4;
                      return (
                        <button key={service.id} type="button" disabled={!compatible} className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-left ${selectedServiceId === service.id ? "border-violet-300/50 bg-violet-300/10" : "border-white/10 bg-black/20"} disabled:cursor-not-allowed disabled:opacity-45`} aria-pressed={selectedServiceId === service.id} onClick={() => setSelectedServiceId(service.id)}>
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06]"><MonitorUp className="h-4 w-4 text-violet-200" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{service.name}</span><span className="block text-[10px] text-slate-500">{compatible ? "Device Trust v4" : "Actualiza Studio para habilitar control"}</span></span>
                          {selectedServiceId === service.id && compatible && <ShieldCheck className="h-4 w-4 text-emerald-300" />}
                        </button>
                      );
                    })}
                    {status.services.length === 0 && (
                      <div className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 px-4 py-4 text-center text-sm text-slate-400">
                        <Wifi className="mb-2 h-5 w-5" />No hay ningún Tchurch Studio visible en esta red.
                        <Button type="button" variant="ghost" size="sm" className="mt-2 h-10 rounded-xl text-violet-200" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Buscar de nuevo</Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <label htmlFor="studio-production-pairing-code" className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">2 · Emparejar como Producción</label>
                  <p className="mt-2 text-xs leading-5 text-slate-400">Este rol se solicita desde el primer enrollment. Studio debe aprobar Control Program y cada permiso de OBS local que necesites: escenas, transmisión o grabación.</p>
                  {scanNotice && <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100" role="alert">{scanNotice}</p>}
                  <Button type="button" className="mt-4 h-12 w-full rounded-2xl font-black" disabled={!selectedService || selectedService.protocolFloor < 4 || scanning || submitting || status.enrollmentState === "revoked"} onClick={() => void scanPairingQR()}>
                    {scanning ? <><LoaderCircle className="h-4 w-4 animate-spin" />Abriendo cámara…</> : <><ScanLine className="h-4 w-4" />Escanear QR de Studio</>}
                  </Button>
                  <div className="my-4 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600"><span className="h-px flex-1 bg-white/10" />o pegar manualmente<span className="h-px flex-1 bg-white/10" /></div>
                  <Input id="studio-production-pairing-code" type="password" autoComplete="off" spellCheck={false} value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="tchurch-studio:…" className="h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-slate-600" />
                  <Button type="button" variant="outline" className="mt-3 h-12 w-full rounded-2xl border-white/15 bg-transparent font-black text-white hover:bg-white/10 hover:text-white" disabled={!selectedService || selectedService.protocolFloor < 4 || submitting || scanning || status.enrollmentState === "revoked"} onClick={() => void submitConnection()}>
                    {submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" />Verificando…</> : <><ShieldCheck className="h-4 w-4" />Solicitar acceso de Producción</>}
                  </Button>
                  {selectedServiceId && status.paired && (
                    <Button type="button" variant="ghost" className="mt-2 h-11 w-full rounded-xl text-xs text-slate-400" onClick={() => void forget(selectedServiceId)}>Olvidar emparejamiento guardado</Button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-6" data-testid="studio-lan-production-controls">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <div className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.07] px-4 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200" role="status">
              <ShieldCheck className="h-3.5 w-3.5" />Producción aprobada · Control Program{status.permissions.includes("controlLocalOBS") ? " + Escenas OBS" : ""}{status.permissions.includes("controlLocalOBSStream") ? " + Transmisión OBS" : ""}{status.permissions.includes("controlLocalOBSRecording") ? " + Grabación OBS" : ""} · revisión {controlUpdate.revision}
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Program actual</p>
              <p className="mt-3 text-2xl font-black sm:text-4xl">{currentCue?.title || currentCue?.lines[0] || "Esperando diapositiva"}</p>
              <p className="mt-3 text-xs font-semibold text-slate-500">{controlUpdate.audience.currentCueIndex == null ? "—" : controlUpdate.audience.currentCueIndex + 1} / {controlUpdate.audience.cueCount}</p>
              <div className="mt-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                <span>{controlUpdate.control?.healthyOutputCount ?? 0}/{controlUpdate.control?.expectedOutputCount ?? 0} salidas sanas</span>
                <span>·</span>
                <span>Ruta {controlUpdate.control?.routeEpoch}</span>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5" data-testid="studio-lan-production-routing">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Routing firmado por la Mac</p>
                  <p className="mt-1 text-xs text-slate-400">Solo lectura en este dispositivo. Ningún estado aquí es un interruptor.</p>
                </div>
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Estado firmado de rutas locales">
                {(signedRoutingIndicators ?? [
                  { key: "stageAndMusicians", label: "Músicos", enabled: routing?.stageAndMusicians },
                  { key: "tchurchCloudProgram", label: "Cloud", enabled: routing?.tchurchCloudProgram },
                  { key: "localBroadcast", label: "OBS", enabled: routing?.localBroadcast },
                  { key: "lightingAndMIDI", label: "Luces", enabled: routing?.lightingAndMIDI },
                ]).map(({ key, label, enabled, activeLabel, inactiveLabel }) => (
                  <div
                    key={key}
                    className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-center"
                    data-testid={`studio-lan-routing-${key}`}
                  >
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
                    <p className={`mt-1 text-sm font-black ${enabled === true ? "text-emerald-300" : enabled === false ? "text-slate-300" : "text-amber-200"}`}>
                      {enabled === true ? activeLabel ?? "Activo" : enabled === false ? inactiveLabel ?? "Apagado" : "Compat. v4"}
                    </p>
                  </div>
                ))}
              </div>
              {signedRoutingIndicators && (
                <p className="mt-3 text-center text-[10px] font-semibold leading-4 text-slate-500" data-testid="studio-lan-lighting-routing-note">
                  La ruta de luces/MIDI y el armado del motor son estados distintos. Este panel no puede modificarlos.
                </p>
              )}
            </div>

            {(controlUpdate.payloadVersion === 8 || controlUpdate.payloadVersion === 9) && (
              <div className="rounded-3xl border border-blue-300/15 bg-blue-300/[0.05] p-5" data-testid="studio-lan-local-obs-scenes">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-200">Escena de OBS local</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">Solo selecciona una escena del catálogo firmado de esta conexión OBS. No toca stream, grabación, credenciales, músicos, Stage, Cloud ni luces.</p>
                  </div>
                  <MonitorUp className="h-5 w-5 shrink-0 text-blue-200" aria-hidden="true" />
                </div>
                {localOBS ? (
                  <>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3" role="status">
                      <span className={`text-xs font-black ${localOBS.availability === "ready" ? "text-emerald-200" : localOBS.availability === "uncertain" ? "text-amber-200" : "text-slate-300"}`}>
                        {localOBS.availability === "ready" ? "OBS listo"
                          : localOBS.availability === "busy" ? "OBS ocupado"
                            : localOBS.availability === "uncertain" ? "Estado incierto; esperando reconciliación"
                              : "OBS desconectado"}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Revisión OBS {localOBS.revision}</span>
                    </div>
                    <label htmlFor="studio-production-local-obs-scene" className="mt-4 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Escena firmada</label>
                    <select
                      id="studio-production-local-obs-scene"
                      value={selectedLocalOBSSceneId}
                      onChange={(event) => setSelectedLocalOBSSceneId(event.target.value)}
                      disabled={!localOBSControlsEnabled || localOBS.scenes.length === 0}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/15 bg-[#0a0a0e] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {localOBS.scenes.length === 0 && <option value="">No hay escenas publicadas</option>}
                      {localOBS.scenes.map((scene) => (
                        <option key={scene.sceneId} value={scene.sceneId}>
                          {scene.title}{scene.sceneId === localOBS.currentSceneId ? " · actual" : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      className="mt-3 h-12 w-full rounded-2xl font-black"
                      disabled={!localOBSControlsEnabled || !selectedLocalOBSSceneId
                        || selectedLocalOBSSceneId === localOBS.currentSceneId}
                      onClick={() => void runLocalOBSSceneCommand()}
                    >
                      {localOBSSceneCommandPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                      Cambiar escena en OBS local
                    </Button>
                  </>
                ) : (
                  <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100" role="status">
                    Studio no publicó un estado OBS firmado para esta conexión. Los demás controles locales siguen disponibles.
                  </p>
                )}
              </div>
            )}

            {(localOBSFeedback || localOBSSceneCommandError) && (
              <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${localOBSSceneFeedback?.state === "accepted" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : localOBSSceneFeedback?.state === "rejected" || localOBSSceneCommandError ? "border-red-300/20 bg-red-300/10 text-red-100" : localOBSSceneFeedback?.state === "unconfirmed" ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-blue-300/20 bg-blue-300/10 text-blue-100"}`} role="status" data-testid="studio-lan-local-obs-scene-feedback">
                {localOBSSceneFeedback?.state === "accepted" && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                {localOBSSceneCommandPending && <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />}
                {localOBSSceneCommandError || localOBSFeedback}
              </div>
            )}

            {controlUpdate.payloadVersion === 9 && (
              <div className="rounded-3xl border border-emerald-300/15 bg-emerald-300/[0.05] p-5" data-testid="studio-lan-local-obs-outputs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Salidas de OBS local</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">Transmisión y grabación tienen permisos separados. Este perfil mantiene Stage, músicos, Cloud y luces apagados.</p>
                  </div>
                  <MonitorUp className="h-5 w-5 shrink-0 text-emerald-200" aria-hidden="true" />
                </div>
                {localOBSOutputs ? (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Transmisión</p>
                        <p className={`mt-1 text-sm font-black ${localOBSOutputs.streamActive ? "text-red-200" : "text-slate-200"}`}>
                          {localOBSOutputs.streamActive ? "En vivo" : "Detenida"}
                        </p>
                        <Button
                          type="button"
                          className="mt-3 h-11 w-full rounded-xl font-black"
                          variant={localOBSOutputs.streamActive ? "destructive" : "default"}
                          disabled={!outputProfileReady || !status.localOBSStreamControlAvailable || commandPending}
                          onClick={() => void runLocalOBSOutputCommand("setLocalOBSStreamActive")}
                          data-testid="studio-lan-local-obs-stream-toggle"
                        >
                          {localOBSOutputs.streamActive ? "Detener transmisión" : "Activar transmisión"}
                        </Button>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Grabación</p>
                        <p className={`mt-1 text-sm font-black ${localOBSOutputs.recordingActive ? "text-red-200" : "text-slate-200"}`}>
                          {localOBSOutputs.recordingActive ? "Grabando" : "Detenida"}
                        </p>
                        <Button
                          type="button"
                          className="mt-3 h-11 w-full rounded-xl font-black"
                          variant={localOBSOutputs.recordingActive ? "destructive" : "default"}
                          disabled={!outputProfileReady || !status.localOBSRecordingControlAvailable || commandPending}
                          onClick={() => void runLocalOBSOutputCommand("setLocalOBSRecordingActive")}
                          data-testid="studio-lan-local-obs-recording-toggle"
                        >
                          {localOBSOutputs.recordingActive ? "Detener grabación" : "Iniciar grabación"}
                        </Button>
                      </div>
                    </div>
                    <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Revisión de operaciones {localOBSOutputs.revision}</p>
                  </>
                ) : (
                  <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100" role="status">
                    Studio no publicó el estado firmado de transmisión y grabación.
                  </p>
                )}
              </div>
            )}

            {(localOBSOutputFeedbackMessage || localOBSOutputCommandError) && (
              <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${localOBSOutputFeedback?.state === "accepted" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : localOBSOutputFeedback?.state === "rejected" || localOBSOutputCommandError ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`} role="status" data-testid="studio-lan-local-obs-output-feedback">
                {localOBSOutputCommandError || localOBSOutputFeedbackMessage}
              </div>
            )}

            {(controlUpdate.payloadVersion === 7 || controlUpdate.payloadVersion === 8
              || controlUpdate.payloadVersion === 9) && (
              <div className="rounded-3xl border border-fuchsia-300/15 bg-fuchsia-300/[0.05] p-5" data-testid="studio-lan-local-broadcast-lower-third">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200">Lower third de transmisión</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">Controla solo el Browser Source loopback que consume OBS.</p>
                  </div>
                  <MonitorUp className="h-5 w-5 shrink-0 text-fuchsia-200" aria-hidden="true" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2" aria-label="Aislamiento del lower third local">
                  {["OBS local", "sin Program", routing?.stageAndMusicians === false ? "Músicos aislados" : "Músicos según routing", "sin Cloud"].map((label) => (
                    <span key={label} className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-black tracking-wide text-slate-200">
                      {label}
                    </span>
                  ))}
                </div>
                {lowerThird ? (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3" role="status">
                    <span className={`text-xs font-black ${lowerThird.visible ? "text-emerald-200" : "text-slate-300"}`}>
                      {lowerThird.visible ? "Visible en OBS local" : "Oculto en OBS local"}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Revisión {lowerThird.revision}</span>
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100" role="status">
                    Studio no publicó el estado firmado del lower third. Program y los demás controles locales siguen disponibles.
                  </p>
                )}
                <div className="mt-4 grid gap-3">
                  <div>
                    <label htmlFor="studio-production-lower-third-title" className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Título</label>
                    <Input
                      id="studio-production-lower-third-title"
                      value={lowerThirdTitle}
                      maxLength={160}
                      autoComplete="off"
                      onChange={(event) => setLowerThirdTitle(event.target.value)}
                      placeholder="Nombre o mensaje principal"
                      className="mt-2 h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-slate-600"
                      disabled={lowerThird == null || localLowerThirdCommandPending || status.localBroadcastLowerThirdCommandInFlight}
                    />
                  </div>
                  <div>
                    <label htmlFor="studio-production-lower-third-subtitle" className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Subtítulo (opcional)</label>
                    <Input
                      id="studio-production-lower-third-subtitle"
                      value={lowerThirdSubtitle}
                      maxLength={240}
                      autoComplete="off"
                      onChange={(event) => setLowerThirdSubtitle(event.target.value)}
                      placeholder="Rol, iglesia o detalle breve"
                      className="mt-2 h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-slate-600"
                      disabled={lowerThird == null || localLowerThirdCommandPending || status.localBroadcastLowerThirdCommandInFlight}
                    />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    className="h-12 rounded-2xl font-black"
                    disabled={!lowerThirdControlsEnabled || lowerThirdShowAction == null}
                    onClick={() => void runLocalBroadcastLowerThirdCommand("show")}
                  >
                    {localLowerThirdCommandPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    Mostrar / actualizar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-2xl border-white/15 bg-transparent font-black text-white hover:bg-white/10 hover:text-white"
                    disabled={!lowerThirdControlsEnabled || lowerThird?.visible !== true}
                    onClick={() => void runLocalBroadcastLowerThirdCommand("hide")}
                  >
                    Ocultar
                  </Button>
                </div>
              </div>
            )}

            {(lowerThirdFeedback || lowerThirdCommandError) && (
              <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${localBroadcastLowerThirdFeedback?.state === "accepted" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : localBroadcastLowerThirdFeedback?.state === "rejected" || localBroadcastLowerThirdFeedback?.state === "timedOut" || lowerThirdCommandError ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100"}`} role="status" data-testid="studio-lan-local-broadcast-lower-third-feedback">
                {localBroadcastLowerThirdFeedback?.state === "accepted" && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                {localLowerThirdCommandPending && <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />}
                {lowerThirdCommandError || lowerThirdFeedback}
              </div>
            )}

            {(controlUpdate.payloadVersion === 6 || controlUpdate.payloadVersion === 7
              || controlUpdate.payloadVersion === 8 || controlUpdate.payloadVersion === 9) && (
              <div className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.05] p-5" data-testid="studio-lan-operator-timers">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Timers de operador</p>
                    <p className="mt-1 text-xs font-semibold text-slate-300">Producción local · {routing?.stageAndMusicians === false ? "Stage/músicos aislados" : "Stage/músicos según routing firmado"} · sin Cloud</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">Estos relojes firmados no son los timers que ven músicos o pantallas Stage.</p>
                  </div>
                  <Timer className="h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
                </div>
                {operatorTimers ? (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {operatorTimers.timers.map((timer) => (
                        <div key={timer.scope} className="rounded-2xl border border-white/10 bg-black/25 p-4" data-testid={`studio-lan-operator-timer-${timer.scope}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{timer.scope === "service" ? "Servicio" : "Elemento"}</p>
                              <p className="mt-1 font-mono text-2xl font-black tabular-nums text-white">{formatOperatorTimer(projectedOperatorTimerMilliseconds(timer))}</p>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${timer.isRunning ? "bg-emerald-300/15 text-emerald-200" : "bg-white/10 text-slate-300"}`}>
                              {timer.isRunning ? "En curso" : "En pausa"}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant={timer.isRunning ? "outline" : "default"}
                            className="mt-4 h-12 w-full rounded-2xl border-white/15 font-black"
                            disabled={!timerControlsEnabled}
                            aria-label={`${timer.isRunning ? "Pausar" : "Iniciar"} timer de ${timer.scope === "service" ? "servicio" : "elemento"} en Producción local`}
                            onClick={() => void runOperatorTimerCommand(timer)}
                          >
                            {timer.isRunning ? <><Pause className="h-4 w-4" />Pausar</> : <><Play className="h-4 w-4" />Iniciar</>}
                          </Button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-center text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Estado firmado · revisión timer {operatorTimers.revision}</p>
                  </>
                ) : (
                  <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100" role="status">
                    Studio no publicó el estado firmado de timers. Program y catálogo local siguen disponibles.
                  </p>
                )}
              </div>
            )}

            {(timerFeedback || timerCommandError) && (
              <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${operatorTimerFeedback?.state === "accepted" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : operatorTimerFeedback?.state === "rejected" || operatorTimerFeedback?.state === "timedOut" || timerCommandError ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`} role="status" data-testid="studio-lan-operator-timer-feedback">
                {operatorTimerFeedback?.state === "accepted" && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                {localTimerCommandPending && <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />}
                {timerCommandError || timerFeedback}
              </div>
            )}

            {(feedback || commandError) && (
              <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${remoteFeedback?.state === "accepted" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : remoteFeedback?.state === "rejected" || remoteFeedback?.state === "timedOut" || commandError ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-violet-300/20 bg-violet-300/10 text-violet-100"}`} role="status" data-testid="studio-lan-production-feedback">
                {remoteFeedback?.state === "accepted" && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                {commandPending && <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />}
                {commandError || feedback}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" className="h-20 rounded-3xl border-white/15 bg-white/[0.04] text-base font-black text-white hover:bg-white/10 hover:text-white" disabled={!controlsEnabled} onClick={() => void runCommand({ kind: "previous" })}>
                <ChevronLeft className="h-6 w-6" />Anterior
              </Button>
              <Button type="button" className="h-20 rounded-3xl text-base font-black" disabled={!controlsEnabled} onClick={() => void runCommand({ kind: "next" })}>
                Siguiente<ChevronRight className="h-6 w-6" />
              </Button>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <label htmlFor="studio-production-jump" className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Saltar a una diapositiva</label>
              <p className="mt-1 text-xs text-slate-400">
                {usesPagedCatalog ? `${pagedCueCatalog?.receivedCount ?? 0}/${controlUpdate.control?.cueCatalogManifest?.totalCount ?? 0} verificadas` : `${cueCatalog.length} disponibles en compatibilidad v4`}
              </p>
              {usesPagedCatalog && pagedCueCatalog?.phase !== "ready" ? (
                <div className={`mt-3 rounded-2xl border px-4 py-4 text-sm font-semibold ${pagedCueCatalog?.phase === "unavailable" ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-violet-300/20 bg-violet-300/10 text-violet-100"}`} role="status" data-testid="studio-lan-production-catalog-status">
                  {pagedCueCatalog?.phase === "loading" && <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />}
                  {pagedCueCatalog?.message ?? "Esperando el catálogo local firmado. Next, Previous y Blackout siguen disponibles."}
                </div>
              ) : (
                <>
                  <Input
                    id="studio-production-jump"
                    type="search"
                    value={catalogSearch}
                    onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(0); }}
                    placeholder="Buscar por título o ID…"
                    className="mt-3 h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-slate-600"
                    disabled={!jumpEnabled}
                  />
                  <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-2" aria-label="Catálogo completo de diapositivas" data-testid="studio-lan-production-catalog">
                    {visibleCueCatalog.map((cue, index) => {
                      const position = catalogPage * catalogPageSize + index + 1;
                      return (
                        <button
                          key={cue.cueId}
                          type="button"
                          className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ${selectedCueId === cue.cueId ? "bg-violet-300/15 text-violet-100" : "text-slate-200 hover:bg-white/[0.06]"}`}
                          aria-pressed={selectedCueId === cue.cueId}
                          onClick={() => setSelectedCueId(cue.cueId)}
                        >
                          <span className="w-10 shrink-0 text-right text-[10px] font-black text-slate-500">{position}</span>
                          <span className="min-w-0 flex-1 truncate font-bold">{cue.title}</span>
                        </button>
                      );
                    })}
                    {visibleCueCatalog.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">No hay diapositivas que coincidan.</p>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Button type="button" variant="ghost" className="h-10 rounded-xl text-xs font-black text-slate-200" disabled={catalogPage === 0} onClick={() => setCatalogPage((page) => Math.max(0, page - 1))}><ChevronLeft className="h-4 w-4" />Página anterior</Button>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{catalogPage + 1} / {catalogPageCount}</span>
                    <Button type="button" variant="ghost" className="h-10 rounded-xl text-xs font-black text-slate-200" disabled={catalogPage + 1 >= catalogPageCount} onClick={() => setCatalogPage((page) => Math.min(catalogPageCount - 1, page + 1))}>Página siguiente<ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </>
              )}
              <Button type="button" variant="outline" className="mt-3 h-12 w-full rounded-2xl border-white/15 bg-transparent font-black text-white hover:bg-white/10 hover:text-white" disabled={!jumpEnabled || !selectedCueId} onClick={() => void runCommand({ kind: "jump", cueId: selectedCueId })}>Ir a selección</Button>
            </div>

            <Button type="button" variant="outline" className={`h-16 w-full rounded-3xl border-red-300/30 font-black ${controlUpdate.audience.isBlackout ? "bg-red-300/20 text-red-100" : "bg-transparent text-red-200"}`} disabled={!controlsEnabled} onClick={() => void runCommand({ kind: "setBlackout", enabled: !controlUpdate.audience.isBlackout })}>
              {controlUpdate.audience.isBlackout ? <><CheckCircle2 className="h-5 w-5" />Quitar blackout</> : <><Ban className="h-5 w-5" />Activar blackout</>}
            </Button>

            {!status.remoteControlAvailable && !commandPending && (
              <p className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-center text-xs font-semibold text-amber-100" role="status">Esperando el siguiente estado de control firmado antes de habilitar otro comando.</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
