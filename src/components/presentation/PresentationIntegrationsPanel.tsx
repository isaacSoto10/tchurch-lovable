import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Cable, CheckCircle2, Download, ExternalLink, Loader2, Plus, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
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
import {
  PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS,
  PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES,
  mergePlanningCenterCatalogPage,
} from "@/lib/presentationPlanningCenterCatalog";

type PresentationIntegrationsPanelProps = {
  serviceId: string;
  serviceTitle: string;
  mode: PresentationRunMode;
  accountId: string;
  churchId?: string | null;
  externalAuthorityScope: string;
  canEdit: boolean;
  canOperateExternal: boolean;
  canExportPublic: boolean;
  hasActivePresentationSession: boolean;
};

function fileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "servicio";
}

function planningCenterIdentityScope(input: {
  accountId: string;
  churchId?: string | null;
  serviceId: string;
  mode: PresentationRunMode;
  canEdit: boolean;
  hasActivePresentationSession: boolean;
}) {
  return [
    input.accountId || "signed-out",
    input.churchId || "no-church",
    input.serviceId || "no-service",
    input.mode,
    input.canEdit ? "editor" : "viewer",
    input.hasActivePresentationSession ? "session-active" : "session-idle",
  ].map(encodeURIComponent).join("::");
}

export function PresentationIntegrationsPanel({ serviceId, serviceTitle, mode, accountId, churchId, externalAuthorityScope, canEdit, canOperateExternal, canExportPublic, hasActivePresentationSession }: PresentationIntegrationsPanelProps) {
  const [summary, setSummary] = useState<PresentationIntegrationSummary | null>(null);
  const [summaryIdentity, setSummaryIdentity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [serviceTypes, setServiceTypes] = useState<Extract<PlanningCenterCatalogResponse, { resource: "service_types" }>["items"]>([]);
  const [plans, setPlans] = useState<Extract<PlanningCenterCatalogResponse, { resource: "plans" }>["items"]>([]);
  const [serviceTypesNextOffset, setServiceTypesNextOffset] = useState<number | null>(null);
  const [plansNextOffset, setPlansNextOffset] = useState<number | null>(null);
  const [serviceTypePagesLoaded, setServiceTypePagesLoaded] = useState(0);
  const [planPagesLoaded, setPlanPagesLoaded] = useState(0);
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [planId, setPlanId] = useState("");
  const [preview, setPreview] = useState<PlanningCenterImportResponse | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const [settings, setSettings] = useState(() => readPresentationLocalConnectorSettings(churchId));
  const [proStatus, setProStatus] = useState<ProPresenterStatus | null>(null);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const pendingPlanningCenterReturnRef = useRef<{ identity: string; generation: number } | null>(null);
  const summaryRequestGenerationRef = useRef(0);
  const planningConnectionGenerationRef = useRef(0);
  const serviceTypeCatalogGenerationRef = useRef(0);
  const serviceTypeRequestSequenceRef = useRef(0);
  const planCatalogGenerationRef = useRef(0);
  const planRequestSequenceRef = useRef(0);
  const selectionGenerationRef = useRef(0);
  const importGenerationRef = useRef(0);
  const selectedServiceTypeRef = useRef("");
  const selectedPlanRef = useRef("");
  const previewSelectionRef = useRef<string | null>(null);
  const planningIdentityRef = useRef("");
  const planningAuthorityRef = useRef("");
  const externalAuthorityScopeRef = useRef(externalAuthorityScope);
  const canOperateExternalRef = useRef(canOperateExternal);
  const externalRequestGenerationRef = useRef(0);
  const exportAuthorityRef = useRef("");
  const exportRequestGenerationRef = useRef(0);

  const planningIdentity = planningCenterIdentityScope({ accountId, churchId, serviceId, mode, canEdit, hasActivePresentationSession });
  const currentSummary = summaryIdentity === planningIdentity ? summary : null;
  const planningCenter = currentSummary?.integrations.find((integration) => integration.provider === "planning_center");
  const planningCenterConnected = planningCenter?.provider === "planning_center" && planningCenter.status === "connected";
  const planningAuthority = `${planningIdentity}::${planningCenterConnected ? "connected" : "not-connected"}`;
  const exportAuthority = `${planningIdentity}::${externalAuthorityScope}::${canExportPublic ? "exporter" : "no-export"}::${encodeURIComponent(serviceTitle)}`;
  const hasCompletePlanningIdentity = Boolean(accountId && churchId && serviceId);
  planningIdentityRef.current = planningIdentity;
  planningAuthorityRef.current = planningAuthority;
  externalAuthorityScopeRef.current = externalAuthorityScope;
  canOperateExternalRef.current = canOperateExternal;
  exportAuthorityRef.current = exportAuthority;
  selectedServiceTypeRef.current = serviceTypeId;
  selectedPlanRef.current = planId;

  const reload = useCallback(async () => {
    const requestedIdentity = planningCenterIdentityScope({ accountId, churchId, serviceId, mode, canEdit, hasActivePresentationSession });
    const requestedAuthority = planningAuthorityRef.current;
    const generation = ++summaryRequestGenerationRef.current;
    if (!accountId || !churchId || !serviceId) {
      setSummary(null);
      setSummaryIdentity(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const next = await fetchPresentationIntegrations();
      if (generation !== summaryRequestGenerationRef.current || planningIdentityRef.current !== requestedIdentity || planningAuthorityRef.current !== requestedAuthority) return;
      setSummary(next);
      setSummaryIdentity(requestedIdentity);
    } catch (error) {
      if (generation === summaryRequestGenerationRef.current && planningIdentityRef.current === requestedIdentity && planningAuthorityRef.current === requestedAuthority) {
        setNotice(error instanceof Error ? error.message : "No se pudieron cargar las integraciones.");
      }
    } finally {
      if (generation === summaryRequestGenerationRef.current && planningIdentityRef.current === requestedIdentity && planningAuthorityRef.current === requestedAuthority) setLoading(false);
    }
  }, [accountId, canEdit, churchId, hasActivePresentationSession, mode, serviceId]);

  useEffect(() => {
    setSettings(readPresentationLocalConnectorSettings(churchId));
  }, [churchId]);

  useEffect(() => {
    summaryRequestGenerationRef.current += 1;
    planningConnectionGenerationRef.current += 1;
    serviceTypeCatalogGenerationRef.current += 1;
    serviceTypeRequestSequenceRef.current += 1;
    planCatalogGenerationRef.current += 1;
    planRequestSequenceRef.current += 1;
    selectionGenerationRef.current += 1;
    importGenerationRef.current += 1;
    pendingPlanningCenterReturnRef.current = null;
    previewSelectionRef.current = null;
    selectedServiceTypeRef.current = "";
    selectedPlanRef.current = "";
    setServiceTypes([]);
    setPlans([]);
    setServiceTypesNextOffset(null);
    setPlansNextOffset(null);
    setServiceTypePagesLoaded(0);
    setPlanPagesLoaded(0);
    setServiceTypeId("");
    setPlanId("");
    setPreview(null);
    setImportConfirm(false);
    setDisconnectConfirm(false);
    setBusy(null);
    setNotice(null);
    void reload();
    return () => {
      summaryRequestGenerationRef.current += 1;
      planningConnectionGenerationRef.current += 1;
      serviceTypeCatalogGenerationRef.current += 1;
      serviceTypeRequestSequenceRef.current += 1;
      planCatalogGenerationRef.current += 1;
      planRequestSequenceRef.current += 1;
      selectionGenerationRef.current += 1;
      importGenerationRef.current += 1;
    };
  }, [planningIdentity, reload]);

  useEffect(() => {
    externalRequestGenerationRef.current += 1;
    setProStatus(null);
    setBusy((current) => current === "pro-status" || current === "pro-next" || current === "pro-previous" ? null : current);
  }, [canOperateExternal, externalAuthorityScope]);

  useEffect(() => {
    exportRequestGenerationRef.current += 1;
    setBusy((current) => current === "pro-export" ? null : current);
  }, [exportAuthority]);

  useEffect(() => {
    const handleRelay = (event: Event) => {
      const detail = (event as CustomEvent<PlanningCenterRelayEventDetail>).detail;
      const pending = pendingPlanningCenterReturnRef.current;
      if (!detail
        || detail.serviceId !== serviceId
        || !pending
        || pending.identity !== planningIdentityRef.current
        || pending.generation !== planningConnectionGenerationRef.current) return;
      pendingPlanningCenterReturnRef.current = null;
      planningConnectionGenerationRef.current += 1;
      serviceTypeCatalogGenerationRef.current += 1;
      serviceTypeRequestSequenceRef.current += 1;
      planCatalogGenerationRef.current += 1;
      planRequestSequenceRef.current += 1;
      selectionGenerationRef.current += 1;
      importGenerationRef.current += 1;
      previewSelectionRef.current = null;
      setPreview(null);
      setImportConfirm(false);
      setBusy((current) => current === "pco-connect" ? null : current);
      setCatalogRefresh((value) => value + 1);
      if (detail.outcome === "complete") {
        setSummary(detail.summary);
        setSummaryIdentity(planningIdentityRef.current);
        setNotice("Planning Center quedó conectado.");
      } else {
        setNotice(planningCenterRelayErrorNotice(detail.code));
      }
    };
    window.addEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, handleRelay);
    return () => window.removeEventListener(PRESENTATION_PLANNING_CENTER_RELAY_EVENT, handleRelay);
  }, [serviceId]);

  useEffect(() => {
    const generation = ++serviceTypeCatalogGenerationRef.current;
    const requestSequence = ++serviceTypeRequestSequenceRef.current;
    planCatalogGenerationRef.current += 1;
    planRequestSequenceRef.current += 1;
    selectionGenerationRef.current += 1;
    importGenerationRef.current += 1;
    previewSelectionRef.current = null;
    if (mode !== "live" || !canEdit || !planningCenterConnected || !hasCompletePlanningIdentity) {
      setBusy((current) => current === "plans" || current === "plans-more" || current === "service-types-more" || current === "pco-preview" || current === "pco-import" ? null : current);
      setServiceTypes([]);
      setPlans([]);
      setServiceTypesNextOffset(null);
      setPlansNextOffset(null);
      setServiceTypePagesLoaded(0);
      setPlanPagesLoaded(0);
      selectedServiceTypeRef.current = "";
      selectedPlanRef.current = "";
      setServiceTypeId("");
      setPlanId("");
      setPreview(null);
      setImportConfirm(false);
      return;
    }
    const requestedAuthority = planningAuthority;
    let active = true;
    void fetchPlanningCenterCatalog({}).then((catalog) => {
      if (active
        && generation === serviceTypeCatalogGenerationRef.current
        && requestSequence === serviceTypeRequestSequenceRef.current
        && planningAuthorityRef.current === requestedAuthority
        && catalog.resource === "service_types") {
        const page = mergePlanningCenterCatalogPage({ current: [], incoming: catalog.items, requestedOffset: 0, nextOffset: catalog.nextOffset, pagesLoaded: 0 });
        setServiceTypes(page.items);
        setServiceTypesNextOffset(page.nextOffset);
        setServiceTypePagesLoaded(page.pagesLoaded);
      }
    }).catch((error) => {
      if (active
        && generation === serviceTypeCatalogGenerationRef.current
        && requestSequence === serviceTypeRequestSequenceRef.current
        && planningAuthorityRef.current === requestedAuthority) {
        setNotice(error instanceof Error ? error.message : "No se pudo cargar Planning Center.");
      }
    });
    return () => { active = false; };
  }, [canEdit, catalogRefresh, hasCompletePlanningIdentity, mode, planningAuthority, planningCenterConnected]);

  useEffect(() => {
    let disposed = false;
    let appListener: { remove: () => Promise<void> } | null = null;
    let browserListener: { remove: () => Promise<void> } | null = null;
    const refreshAfterOAuth = () => {
      const pending = pendingPlanningCenterReturnRef.current;
      if (!pending) return;
      if (pending.identity !== planningIdentityRef.current || pending.generation !== planningConnectionGenerationRef.current) return;
      setPreview(null);
      setImportConfirm(false);
      setPlans([]);
      setPlansNextOffset(null);
      setPlanPagesLoaded(0);
      serviceTypeCatalogGenerationRef.current += 1;
      serviceTypeRequestSequenceRef.current += 1;
      planCatalogGenerationRef.current += 1;
      planRequestSequenceRef.current += 1;
      selectionGenerationRef.current += 1;
      importGenerationRef.current += 1;
      previewSelectionRef.current = null;
      selectedServiceTypeRef.current = "";
      selectedPlanRef.current = "";
      setServiceTypeId("");
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
    if (!canEdit || mode !== "live" || !hasCompletePlanningIdentity) return;
    const requestedAuthority = planningAuthorityRef.current;
    const requestedIdentity = planningIdentityRef.current;
    const generation = ++planningConnectionGenerationRef.current;
    setBusy("pco-connect");
    setNotice(null);
    try {
      const response = await connectPlanningCenter(serviceId);
      if (generation !== planningConnectionGenerationRef.current || planningAuthorityRef.current !== requestedAuthority) return;
      pendingPlanningCenterReturnRef.current = { identity: requestedIdentity, generation };
      await Browser.open({ url: response.authorizeUrl, presentationStyle: "popover" });
      if (generation !== planningConnectionGenerationRef.current || planningAuthorityRef.current !== requestedAuthority) return;
      setNotice("Completa el acceso en Planning Center. Tchurch actualizará la conexión al volver.");
    } catch (error) {
      if (generation === planningConnectionGenerationRef.current && planningAuthorityRef.current === requestedAuthority) {
        pendingPlanningCenterReturnRef.current = null;
        setNotice(error instanceof Error ? error.message : "No se pudo abrir Planning Center.");
      }
    } finally {
      if (generation === planningConnectionGenerationRef.current && planningAuthorityRef.current === requestedAuthority) setBusy(null);
    }
  }

  async function disconnect() {
    if (!disconnectConfirm || !canEdit || mode !== "live" || !planningCenterConnected) return;
    const requestedAuthority = planningAuthorityRef.current;
    const generation = ++planningConnectionGenerationRef.current;
    serviceTypeCatalogGenerationRef.current += 1;
    serviceTypeRequestSequenceRef.current += 1;
    planCatalogGenerationRef.current += 1;
    planRequestSequenceRef.current += 1;
    selectionGenerationRef.current += 1;
    importGenerationRef.current += 1;
    previewSelectionRef.current = null;
    setBusy("pco-disconnect");
    setNotice(null);
    try {
      const next = await disconnectPlanningCenter();
      if (generation !== planningConnectionGenerationRef.current || planningAuthorityRef.current !== requestedAuthority) return;
      setSummary(next);
      setSummaryIdentity(planningIdentityRef.current);
      setDisconnectConfirm(false);
      setServiceTypes([]);
      setPlans([]);
      setServiceTypesNextOffset(null);
      setPlansNextOffset(null);
      setServiceTypePagesLoaded(0);
      setPlanPagesLoaded(0);
      selectedServiceTypeRef.current = "";
      selectedPlanRef.current = "";
      setServiceTypeId("");
      setPlanId("");
      setPreview(null);
      setImportConfirm(false);
      setNotice("Planning Center fue desconectado.");
    } catch (error) {
      if (generation === planningConnectionGenerationRef.current && planningAuthorityRef.current === requestedAuthority) {
        setNotice(error instanceof Error ? error.message : "No se pudo desconectar Planning Center.");
      }
    } finally {
      if (generation === planningConnectionGenerationRef.current && planningAuthorityRef.current === requestedAuthority) setBusy(null);
    }
  }

  async function chooseServiceType(value: string) {
    if (!canEdit || mode !== "live" || hasActivePresentationSession || !planningCenterConnected || !hasCompletePlanningIdentity) return;
    const requestedAuthority = planningAuthorityRef.current;
    const generation = ++planCatalogGenerationRef.current;
    const requestSequence = ++planRequestSequenceRef.current;
    const selectionGeneration = ++selectionGenerationRef.current;
    importGenerationRef.current += 1;
    previewSelectionRef.current = null;
    selectedServiceTypeRef.current = value;
    selectedPlanRef.current = "";
    setServiceTypeId(value);
    setPlanId("");
    setPlans([]);
    setPlansNextOffset(null);
    setPlanPagesLoaded(0);
    setPreview(null);
    setImportConfirm(false);
    setBusy("plans");
    try {
      const catalog = await fetchPlanningCenterCatalog({ serviceTypeId: value });
      if (generation !== planCatalogGenerationRef.current
        || requestSequence !== planRequestSequenceRef.current
        || selectionGeneration !== selectionGenerationRef.current
        || planningAuthorityRef.current !== requestedAuthority
        || selectedServiceTypeRef.current !== value) return;
      if (catalog.resource !== "plans" || catalog.serviceTypeId !== value) throw new Error("Planning Center respondió con otro tipo de servicio.");
      const page = mergePlanningCenterCatalogPage({ current: [], incoming: catalog.items, requestedOffset: 0, nextOffset: catalog.nextOffset, pagesLoaded: 0 });
      setPlans(page.items);
      setPlansNextOffset(page.nextOffset);
      setPlanPagesLoaded(page.pagesLoaded);
    } catch (error) {
      if (generation === planCatalogGenerationRef.current
        && requestSequence === planRequestSequenceRef.current
        && selectionGeneration === selectionGenerationRef.current
        && planningAuthorityRef.current === requestedAuthority
        && selectedServiceTypeRef.current === value) {
        setNotice(error instanceof Error ? error.message : "No se pudieron cargar los planes.");
      }
    } finally {
      if (generation === planCatalogGenerationRef.current
        && requestSequence === planRequestSequenceRef.current
        && selectionGeneration === selectionGenerationRef.current
        && planningAuthorityRef.current === requestedAuthority
        && selectedServiceTypeRef.current === value) setBusy(null);
    }
  }

  async function loadMoreServiceTypes() {
    if (!planningCenterConnected || !hasCompletePlanningIdentity || serviceTypesNextOffset === null || busy || serviceTypePagesLoaded >= PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES || serviceTypes.length >= PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS) return;
    const requestedAuthority = planningAuthorityRef.current;
    const generation = serviceTypeCatalogGenerationRef.current;
    const requestSequence = ++serviceTypeRequestSequenceRef.current;
    const requestedOffset = serviceTypesNextOffset;
    setBusy("service-types-more");
    setNotice(null);
    try {
      const catalog = await fetchPlanningCenterCatalog({ offset: requestedOffset });
      if (generation !== serviceTypeCatalogGenerationRef.current || requestSequence !== serviceTypeRequestSequenceRef.current || planningAuthorityRef.current !== requestedAuthority) return;
      if (catalog.resource !== "service_types") throw new Error("Planning Center respondió con otro catálogo.");
      const page = mergePlanningCenterCatalogPage({ current: serviceTypes, incoming: catalog.items, requestedOffset, nextOffset: catalog.nextOffset, pagesLoaded: serviceTypePagesLoaded });
      setServiceTypes(page.items);
      setServiceTypesNextOffset(page.nextOffset);
      setServiceTypePagesLoaded(page.pagesLoaded);
      if (page.nextOffset === null && catalog.nextOffset !== null && catalog.nextOffset > requestedOffset) setNotice(`Se alcanzó el límite seguro de ${PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS} tipos o ${PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES} páginas.`);
    } catch (error) {
      if (generation === serviceTypeCatalogGenerationRef.current && requestSequence === serviceTypeRequestSequenceRef.current && planningAuthorityRef.current === requestedAuthority) {
        setNotice(error instanceof Error ? error.message : "No se pudieron cargar más tipos de servicio.");
      }
    } finally {
      if (generation === serviceTypeCatalogGenerationRef.current && requestSequence === serviceTypeRequestSequenceRef.current && planningAuthorityRef.current === requestedAuthority) setBusy(null);
    }
  }

  async function loadMorePlans() {
    if (!planningCenterConnected || !hasCompletePlanningIdentity || !serviceTypeId || plansNextOffset === null || busy || planPagesLoaded >= PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES || plans.length >= PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS) return;
    const requestedAuthority = planningAuthorityRef.current;
    const generation = planCatalogGenerationRef.current;
    const requestSequence = ++planRequestSequenceRef.current;
    const requestedServiceTypeId = serviceTypeId;
    const requestedOffset = plansNextOffset;
    setBusy("plans-more");
    setNotice(null);
    try {
      const catalog = await fetchPlanningCenterCatalog({ serviceTypeId: requestedServiceTypeId, offset: requestedOffset });
      if (generation !== planCatalogGenerationRef.current
        || requestSequence !== planRequestSequenceRef.current
        || planningAuthorityRef.current !== requestedAuthority
        || selectedServiceTypeRef.current !== requestedServiceTypeId) return;
      if (catalog.resource !== "plans" || catalog.serviceTypeId !== requestedServiceTypeId) {
        throw new Error("Planning Center respondió con otro tipo de servicio.");
      }
      const page = mergePlanningCenterCatalogPage({ current: plans, incoming: catalog.items, requestedOffset, nextOffset: catalog.nextOffset, pagesLoaded: planPagesLoaded });
      setPlans(page.items);
      setPlansNextOffset(page.nextOffset);
      setPlanPagesLoaded(page.pagesLoaded);
      if (page.nextOffset === null && catalog.nextOffset !== null && catalog.nextOffset > requestedOffset) setNotice(`Se alcanzó el límite seguro de ${PRESENTATION_PLANNING_CENTER_MAX_CATALOG_ITEMS} planes o ${PRESENTATION_PLANNING_CENTER_MAX_CATALOG_PAGES} páginas.`);
    } catch (error) {
      if (generation === planCatalogGenerationRef.current
        && requestSequence === planRequestSequenceRef.current
        && planningAuthorityRef.current === requestedAuthority
        && selectedServiceTypeRef.current === requestedServiceTypeId) {
        setNotice(error instanceof Error ? error.message : "No se pudieron cargar más planes.");
      }
    } finally {
      if (generation === planCatalogGenerationRef.current
        && requestSequence === planRequestSequenceRef.current
        && planningAuthorityRef.current === requestedAuthority
        && selectedServiceTypeRef.current === requestedServiceTypeId) setBusy(null);
    }
  }

  function choosePlan(value: string) {
    selectionGenerationRef.current += 1;
    importGenerationRef.current += 1;
    previewSelectionRef.current = null;
    selectedPlanRef.current = value;
    setPlanId(value);
    setPreview(null);
    setImportConfirm(false);
  }

  async function runImport(operation: "preview" | "import") {
    if (!serviceTypeId || !planId || mode !== "live" || !canEdit || hasActivePresentationSession || !planningCenterConnected || !hasCompletePlanningIdentity) {
      if (hasActivePresentationSession) setNotice("Termina la sesión en vivo o de ensayo antes de previsualizar o importar un plan.");
      return;
    }
    const selectionKey = `${serviceTypeId}::${planId}`;
    if (operation === "import" && (!preview || !importConfirm || previewSelectionRef.current !== selectionKey)) return;
    const requestedAuthority = planningAuthorityRef.current;
    const selectionGeneration = selectionGenerationRef.current;
    const generation = ++importGenerationRef.current;
    const requestedServiceTypeId = serviceTypeId;
    const requestedPlanId = planId;
    setBusy(`pco-${operation}`);
    setNotice(null);
    try {
      const result = await importPlanningCenterPlan(serviceId, { serviceTypeId: requestedServiceTypeId, planId: requestedPlanId, operation });
      if (generation !== importGenerationRef.current
        || selectionGeneration !== selectionGenerationRef.current
        || planningAuthorityRef.current !== requestedAuthority
        || selectedServiceTypeRef.current !== requestedServiceTypeId
        || selectedPlanRef.current !== requestedPlanId) return;
      if (result.operation !== operation || result.source.serviceTypeId !== requestedServiceTypeId || result.source.planId !== requestedPlanId) {
        throw new Error("Planning Center respondió con otro plan.");
      }
      previewSelectionRef.current = selectionKey;
      setPreview(result);
      setImportConfirm(false);
      setNotice(operation === "preview" ? "Vista previa lista; todavía no se cambió el servicio." : "Plan importado. Reabre la presentación para cargar el nuevo orden.");
    } catch (error) {
      if (generation === importGenerationRef.current
        && selectionGeneration === selectionGenerationRef.current
        && planningAuthorityRef.current === requestedAuthority
        && selectedServiceTypeRef.current === requestedServiceTypeId
        && selectedPlanRef.current === requestedPlanId) {
        setNotice(error instanceof Error ? error.message : "No se pudo importar el plan.");
      }
    } finally {
      if (generation === importGenerationRef.current
        && selectionGeneration === selectionGenerationRef.current
        && planningAuthorityRef.current === requestedAuthority
        && selectedServiceTypeRef.current === requestedServiceTypeId
        && selectedPlanRef.current === requestedPlanId) setBusy(null);
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

  if (loading && !currentSummary) return <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-500" /></div>;

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
          {planningCenter?.provider === "planning_center" && planningCenter.status === "connected" ? (
            <div className="mt-4 space-y-3">
              <div>
                <Label className="text-xs font-bold text-slate-300">Tipo de servicio</Label>
                <Select value={serviceTypeId || undefined} disabled={mode !== "live" || !canEdit || hasActivePresentationSession} onValueChange={(value) => void chooseServiceType(value)}>
                  <SelectTrigger aria-label="Tipo de servicio" className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                  <SelectContent>{serviceTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                </Select>
                {serviceTypesNextOffset !== null ? <Button variant="ghost" className="mt-2 h-11 w-full rounded-xl text-xs font-black text-sky-200 hover:bg-sky-300/10 hover:text-sky-100" disabled={Boolean(busy) || !canEdit || hasActivePresentationSession} onClick={() => void loadMoreServiceTypes()}>{busy === "service-types-more" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Cargar más tipos</Button> : null}
              </div>
              <div>
                <Label className="text-xs font-bold text-slate-300">Plan</Label>
                <Select value={planId || undefined} disabled={!serviceTypeId || Boolean(busy) || mode !== "live" || !canEdit || hasActivePresentationSession} onValueChange={choosePlan}>
                  <SelectTrigger aria-label="Plan" className="mt-2 h-11 rounded-xl border-white/10 bg-black/20 text-white"><SelectValue placeholder={busy === "plans" ? "Cargando…" : "Selecciona…"} /></SelectTrigger>
                  <SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.title} · {plan.dates}</SelectItem>)}</SelectContent>
                </Select>
                {plansNextOffset !== null ? <Button variant="ghost" className="mt-2 h-11 w-full rounded-xl text-xs font-black text-sky-200 hover:bg-sky-300/10 hover:text-sky-100" disabled={Boolean(busy) || !canEdit || hasActivePresentationSession} onClick={() => void loadMorePlans()}>{busy === "plans-more" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Cargar más planes</Button> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" disabled={!canEdit || hasActivePresentationSession || !planId || Boolean(busy) || mode !== "live"} onClick={() => void runImport("preview")}>{busy === "pco-preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Vista previa</Button>
                <Button className="h-11 rounded-xl bg-sky-400 font-black text-slate-950 hover:bg-sky-300" disabled={!canEdit || hasActivePresentationSession || !preview || Boolean(busy) || mode !== "live"} onClick={() => setImportConfirm(true)}>{busy === "pco-import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Importar</Button>
                <Button variant="ghost" className="ml-auto h-11 rounded-xl text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={!canEdit || mode !== "live" || Boolean(busy)} onClick={() => setDisconnectConfirm(true)}><Unplug className="h-4 w-4" />Desconectar</Button>
              </div>
              {preview ? <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.06] p-3 text-xs text-sky-100"><p className="font-black">{preview.source.title}</p><p className="mt-1">{preview.changes.create} nuevos · {preview.changes.update} actualizados · {preview.changes.unchanged} sin cambio{preview.changes.reorderedLocal ? ` · ${preview.changes.reorderedLocal} locales reordenados` : ""}</p></div> : null}
              {importConfirm && preview ? <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3"><div className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><p className="text-xs leading-5 text-amber-100">Confirma la importación de “{preview.source.title}”. Se aplicarán {preview.changes.create} elementos nuevos y {preview.changes.update} actualizaciones.</p></div><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" className="h-11 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setImportConfirm(false)}>Cancelar</Button><Button className="h-11 rounded-xl bg-amber-300 font-black text-slate-950 hover:bg-amber-200" disabled={busy === "pco-import"} onClick={() => void runImport("import")}>{busy === "pco-import" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar importación</Button></div></div> : null}
            </div>
          ) : null}
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
