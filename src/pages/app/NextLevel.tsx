import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  BarChart3,
  BellRing,
  Bot,
  Building2,
  CalendarClock,
  Captions,
  CheckSquare,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Code2,
  Flame,
  GraduationCap,
  HandHeart,
  HelpCircle,
  Home,
  Loader2,
  Mail,
  MapPin,
  MapPinned,
  MessageSquareText,
  Phone,
  Plug,
  QrCode,
  RefreshCcw,
  Sparkles,
  Store,
  UserCheck,
  UserPlus,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { cn } from "@/lib/utils";

export type NextLevelSection =
  | "checkin"
  | "visitors"
  | "followup"
  | "heatmap"
  | "lms"
  | "facilities"
  | "integrations"
  | "marketplace"
  | "geofencing"
  | "pastoral"
  | "tasks"
  | "insights";

type NextLevelItem = Record<string, unknown>;
type NextLevelPayload = NextLevelItem[] | Record<string, unknown> | null;
type ActionType = "visitor" | "checkin" | "reservation" | "task" | "none";
type QuickActionForm = {
  primary: string;
  secondary: string;
  tertiary: string;
  notes: string;
};

interface NextLevelPageProps {
  section: NextLevelSection;
}

interface ModuleConfig {
  id: NextLevelSection;
  title: string;
  shortTitle: string;
  eyebrow: string;
  description: string;
  emptyTitle: string;
  emptyBody: string;
  endpoint: string;
  route: string;
  itemKeys: string[];
  icon: LucideIcon;
  accent: string;
  featureTags: string[];
  configurable?: boolean;
  action: ActionType;
  actionEndpoint?: string;
}

const modules: ModuleConfig[] = [
  {
    id: "checkin",
    title: "Check-in QR",
    shortTitle: "Check-in",
    eyebrow: "Entrada móvil",
    description: "Escanea, valida y registra asistencia QR, first-time guests y familias desde el teléfono.",
    emptyTitle: "No hay check-ins recientes",
    emptyBody: "Cuando el equipo registre entradas o visitantes de primera vez, aparecerán aquí.",
    endpoint: "/next-level/check-in",
    route: "/app/next-level/check-in",
    itemKeys: ["checkIns", "checkins", "attendees", "guests", "data", "items", "results"],
    icon: QrCode,
    accent: "from-sky-500 to-cyan-400",
    featureTags: ["QR", "First-time", "Familias"],
    action: "checkin",
    actionEndpoint: "/next-level/check-in",
  },
  {
    id: "visitors",
    title: "Visitantes",
    shortTitle: "Visitantes",
    eyebrow: "Next Level",
    description: "Da seguimiento rápido a personas nuevas, familias y próximos pasos.",
    emptyTitle: "No hay visitantes por ahora",
    emptyBody: "Cuando alguien nuevo se registre, aparecerá aquí para que el equipo pueda darle seguimiento.",
    endpoint: "/next-level/visitors",
    route: "/app/next-level/visitantes",
    itemKeys: ["visitors", "visitantes", "people", "data", "items", "results"],
    icon: UserPlus,
    accent: "from-cyan-500 to-blue-500",
    featureTags: ["Nuevo registro", "Perfil", "Origen"],
    action: "visitor",
  },
  {
    id: "followup",
    title: "Follow-up",
    shortTitle: "Follow-up",
    eyebrow: "Cuidado",
    description: "Organiza llamadas, mensajes, responsables y próximos pasos para visitantes.",
    emptyTitle: "No hay seguimientos abiertos",
    emptyBody: "Los visitantes que necesiten contacto pastoral o equipo de bienvenida se mostrarán aquí.",
    endpoint: "/next-level/follow-up",
    route: "/app/next-level/follow-up",
    itemKeys: ["followUps", "followups", "tasks", "visitors", "data", "items", "results"],
    icon: UserCheck,
    accent: "from-emerald-500 to-lime-400",
    featureTags: ["Llamadas", "WhatsApp", "Responsables"],
    action: "task",
    actionEndpoint: "/next-level/follow-up",
  },
  {
    id: "heatmap",
    title: "Heatmap",
    shortTitle: "Heatmap",
    eyebrow: "Tendencias",
    description: "Detecta zonas, horarios y momentos de mayor movimiento para tomar mejores decisiones.",
    emptyTitle: "No hay señales de heatmap",
    emptyBody: "Cuando existan datos de asistencia, check-in o ubicación, verás puntos calientes aquí.",
    endpoint: "/next-level/heatmap",
    route: "/app/next-level/heatmap",
    itemKeys: ["zones", "heatmap", "areas", "signals", "data", "items", "results"],
    icon: Flame,
    accent: "from-orange-500 to-red-500",
    featureTags: ["Zonas", "Asistencia", "Picos"],
    action: "none",
  },
  {
    id: "lms",
    title: "LMS",
    shortTitle: "LMS",
    eyebrow: "Capacitación",
    description: "Revisa cursos, avance de voluntarios, rutas de onboarding y certificaciones.",
    emptyTitle: "No hay cursos publicados",
    emptyBody: "Cuando el equipo agregue módulos de capacitación, aparecerán con su progreso.",
    endpoint: "/next-level/lms",
    route: "/app/next-level/lms",
    itemKeys: ["courses", "lessons", "materials", "training", "data", "items", "results"],
    icon: GraduationCap,
    accent: "from-indigo-500 to-violet-500",
    featureTags: ["Cursos", "Progreso", "Certificados"],
    action: "none",
  },
  {
    id: "facilities",
    title: "Instalaciones",
    shortTitle: "Reservas",
    eyebrow: "Operaciones",
    description: "Gestiona espacios, reservas, equipos y necesidades del edificio desde el móvil.",
    emptyTitle: "No hay solicitudes de instalaciones",
    emptyBody: "Cuando haya reservas, reportes o mantenimiento, los verás en esta lista.",
    endpoint: "/next-level/facilities",
    route: "/app/next-level/instalaciones",
    itemKeys: ["facilities", "reservations", "instalaciones", "rooms", "requests", "data", "items", "results"],
    icon: Building2,
    accent: "from-amber-500 to-orange-400",
    featureTags: ["Reservas", "Mantenimiento", "Salones"],
    action: "reservation",
  },
  {
    id: "integrations",
    title: "Integraciones",
    shortTitle: "Integraciones",
    eyebrow: "Conectores",
    description: "Monitorea conexiones con CRM, correo, calendario, pagos, streaming y automatizaciones.",
    emptyTitle: "Aún no hay integraciones conectadas",
    emptyBody: "Puedes dejar este módulo visible mientras el equipo configura credenciales o webhooks reales.",
    endpoint: "/next-level/integrations",
    route: "/app/next-level/integraciones",
    itemKeys: ["integrations", "connectors", "providers", "data", "items", "results"],
    icon: Plug,
    accent: "from-slate-700 to-zinc-500",
    featureTags: ["Webhooks", "CRM", "Calendarios"],
    configurable: true,
    action: "none",
  },
  {
    id: "marketplace",
    title: "Marketplace",
    shortTitle: "Marketplace",
    eyebrow: "Recursos",
    description: "Explora ayuda, plantillas, stories, guías y add-ons para acelerar al equipo.",
    emptyTitle: "No hay recursos publicados",
    emptyBody: "Cuando existan stories, paquetes de ayuda o plantillas, se mostrarán aquí.",
    endpoint: "/next-level/marketplace",
    route: "/app/next-level/marketplace",
    itemKeys: ["resources", "stories", "marketplace", "help", "data", "items", "results"],
    icon: Store,
    accent: "from-fuchsia-500 to-rose-500",
    featureTags: ["Ayuda", "Stories", "Plantillas"],
    configurable: true,
    action: "none",
  },
  {
    id: "geofencing",
    title: "Geofencing",
    shortTitle: "Geofencing",
    eyebrow: "Ubicación",
    description: "Prepara zonas de llegada, activaciones por campus y experiencias basadas en ubicación.",
    emptyTitle: "No hay zonas configuradas",
    emptyBody: "El módulo puede quedar listo mientras se configuran permisos móviles y coordenadas reales.",
    endpoint: "/next-level/geofencing",
    route: "/app/next-level/geofencing",
    itemKeys: ["zones", "fences", "locations", "campuses", "data", "items", "results"],
    icon: MapPinned,
    accent: "from-teal-500 to-emerald-500",
    featureTags: ["Campus", "Radio", "Push local"],
    configurable: true,
    action: "none",
  },
  {
    id: "pastoral",
    title: "Pastoral AI",
    shortTitle: "AI + Push",
    eyebrow: "Asistencia inteligente",
    description: "Agrupa ayuda pastoral con AI, captions, API y push sin bloquear si faltan llaves externas.",
    emptyTitle: "No hay automatizaciones activas",
    emptyBody: "Las recomendaciones, captions, tokens API o campañas push aparecerán cuando estén configuradas.",
    endpoint: "/next-level/pastoral-ai",
    route: "/app/next-level/pastoral-ai",
    itemKeys: ["automations", "captions", "recommendations", "push", "api", "data", "items", "results"],
    icon: Bot,
    accent: "from-violet-600 to-indigo-500",
    featureTags: ["Pastoral AI", "Captions", "API", "Push"],
    configurable: true,
    action: "none",
  },
  {
    id: "tasks",
    title: "Tareas",
    shortTitle: "Tareas",
    eyebrow: "Equipo",
    description: "Prioriza pendientes, responsables y fechas para que nada se pierda.",
    emptyTitle: "No hay tareas abiertas",
    emptyBody: "Las tareas asignadas al equipo aparecerán aquí con su prioridad y fecha límite.",
    endpoint: "/next-level/tasks",
    route: "/app/next-level/tareas",
    itemKeys: ["tasks", "tareas", "todos", "data", "items", "results"],
    icon: CheckSquare,
    accent: "from-emerald-500 to-lime-400",
    featureTags: ["Responsables", "Prioridad", "Fechas"],
    action: "task",
  },
  {
    id: "insights",
    title: "Insights",
    shortTitle: "Insights",
    eyebrow: "Dirección",
    description: "Indicadores simples para leer tendencias y tomar mejores decisiones.",
    emptyTitle: "No hay insights disponibles",
    emptyBody: "Cuando existan métricas o recomendaciones, aparecerán aquí de forma resumida.",
    endpoint: "/next-level/insights",
    route: "/app/next-level/insights",
    itemKeys: ["insights", "recommendations", "recomendaciones", "data", "items", "results"],
    icon: BarChart3,
    accent: "from-rose-500 to-pink-400",
    featureTags: ["KPIs", "Señales", "Recomendaciones"],
    action: "none",
  },
];

const blankQuickActionForm: QuickActionForm = {
  primary: "",
  secondary: "",
  tertiary: "",
  notes: "",
};

const pastoralCapabilities = [
  { label: "Pastoral AI", icon: HandHeart, text: "Sugerencias de cuidado, prioridades y próximos pasos." },
  { label: "Captions", icon: Captions, text: "Subtítulos y resúmenes para contenido de servicios." },
  { label: "API", icon: Code2, text: "Estado de llaves, webhooks y consumo de integraciones." },
  { label: "Push", icon: BellRing, text: "Campañas móviles listas cuando existan permisos." },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unwrapArray(payload: NextLevelPayload, keys: string[]): NextLevelItem[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [];
}

function unwrapMetrics(payload: NextLevelPayload): NextLevelItem {
  if (!isRecord(payload)) return {};

  const candidateKeys = ["summary", "metrics", "stats", "totals", "health"];
  for (const key of candidateKeys) {
    const value = payload[key];
    if (isRecord(value)) return value;
  }

  return {};
}

function textFrom(item: NextLevelItem, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "Activo" : "Inactivo";
  }
  return fallback;
}

function nestedTextFrom(item: NextLevelItem, key: string, nestedKeys: string[]): string {
  const value = item[key];
  if (!isRecord(value)) return "";
  return textFrom(value, nestedKeys);
}

function dateFrom(item: NextLevelItem, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value !== "string") continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date.toLocaleDateString("es-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }
  return "";
}

function labelFromKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("es-US").format(value);
  }
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "boolean") return value ? "Activo" : "Pendiente";
  return "";
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (["done", "completed", "complete", "closed", "resolved", "completado", "active", "activo", "connected"].includes(normalized)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["urgent", "high", "overdue", "late", "alta", "vencida", "error", "failed"].includes(normalized)) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (["pending", "open", "in_progress", "nuevo", "pendiente", "draft", "configurable"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function statusLabel(config: ModuleConfig, item: NextLevelItem): string {
  const raw =
    textFrom(item, ["status", "stage", "priority", "condition", "state", "health"]) ||
    nestedTextFrom(item, "status", ["name", "label"]);

  if (raw) return raw;
  if (config.configurable) return "Configurable";
  if (config.id === "visitors" || config.id === "checkin") return "Nuevo";
  if (config.id === "tasks" || config.id === "followup") return "Pendiente";
  if (config.id === "facilities") return "Activo";
  return "Señal";
}

function itemTitle(config: ModuleConfig, item: NextLevelItem, index: number): string {
  const name =
    textFrom(item, ["name", "fullName", "displayName", "title", "label", "subject", "zone", "course", "provider"]) ||
    nestedTextFrom(item, "visitor", ["name", "fullName"]) ||
    nestedTextFrom(item, "person", ["name", "fullName"]) ||
    nestedTextFrom(item, "facility", ["name", "title"]) ||
    nestedTextFrom(item, "room", ["name", "title"]) ||
    nestedTextFrom(item, "integration", ["name", "provider"]);

  if (name) return name;
  if (config.id === "checkin") return `Check-in ${index + 1}`;
  if (config.id === "visitors") return `Visitante ${index + 1}`;
  if (config.id === "followup") return `Seguimiento ${index + 1}`;
  if (config.id === "facilities") return `Reserva ${index + 1}`;
  if (config.id === "lms") return `Curso ${index + 1}`;
  if (config.id === "integrations") return `Integración ${index + 1}`;
  return `${config.title} ${index + 1}`;
}

function itemMeta(config: ModuleConfig, item: NextLevelItem): string[] {
  if (config.id === "visitors" || config.id === "checkin" || config.id === "followup") {
    return [
      textFrom(item, ["phone", "phoneNumber", "mobile"]),
      textFrom(item, ["email"]),
      textFrom(item, ["source", "campus", "serviceName"]),
      dateFrom(item, ["checkedInAt", "lastVisitAt", "firstVisitAt", "visitDate", "createdAt"]),
    ].filter(Boolean);
  }

  if (config.id === "tasks") {
    return [
      textFrom(item, ["assigneeName", "ownerName"]) || nestedTextFrom(item, "assignee", ["name", "fullName"]),
      dateFrom(item, ["dueAt", "dueDate", "scheduledFor"]),
    ].filter(Boolean);
  }

  if (config.id === "facilities") {
    return [
      textFrom(item, ["location", "type", "room", "area"]),
      textFrom(item, ["capacity"]) ? `${textFrom(item, ["capacity"])} personas` : "",
      dateFrom(item, ["requestedAt", "reservedAt", "startsAt", "updatedAt"]),
    ].filter(Boolean);
  }

  if (config.id === "heatmap" || config.id === "geofencing") {
    return [
      textFrom(item, ["campus", "location", "zone", "radius"]),
      textFrom(item, ["visits", "count", "density"]),
      dateFrom(item, ["updatedAt", "createdAt"]),
    ].filter(Boolean);
  }

  if (config.id === "lms") {
    return [
      textFrom(item, ["category", "track", "level"]),
      textFrom(item, ["progress"]) ? `${textFrom(item, ["progress"])}%` : "",
      dateFrom(item, ["updatedAt", "createdAt", "publishedAt"]),
    ].filter(Boolean);
  }

  return [
    textFrom(item, ["provider", "category", "type", "value", "metric", "score"]),
    dateFrom(item, ["createdAt", "updatedAt", "periodStart"]),
  ].filter(Boolean);
}

function itemBody(config: ModuleConfig, item: NextLevelItem): string {
  return (
    textFrom(item, ["description", "notes", "note", "summary", "body", "recommendation", "nextStep"]) ||
    (config.id === "visitors" || config.id === "followup" ? textFrom(item, ["source", "interest"]) : "")
  );
}

function getId(item: NextLevelItem, index: number): string {
  return textFrom(item, ["id", "_id", "slug"], `item-${index}`);
}

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || fullName.trim(),
    lastName: parts.join(" "),
  };
}

function actionCopy(config: ModuleConfig) {
  if (config.action === "visitor") {
    return {
      title: "Registrar visitante",
      body: "Captura lo esencial en menos de un minuto para activar el seguimiento.",
      primary: "Nombre completo",
      secondary: "Correo",
      tertiary: "Teléfono",
      notes: "Notas o próximos pasos",
      button: "Guardar visitante",
    };
  }

  if (config.action === "checkin") {
    return {
      title: "Check-in manual",
      body: "Úsalo cuando el QR no esté disponible o sea visitante de primera vez.",
      primary: "Nombre o código QR",
      secondary: "Servicio / reunión",
      tertiary: "Campus o zona",
      notes: "Notas de bienvenida",
      button: "Registrar check-in",
    };
  }

  if (config.action === "reservation") {
    return {
      title: "Crear reserva",
      body: "Solicita un espacio de forma simple; el backend puede aprobarla después.",
      primary: "Espacio o salón",
      secondary: "Motivo",
      tertiary: "Fecha y hora",
      notes: "Equipo requerido o notas",
      button: "Reservar espacio",
    };
  }

  if (config.action === "task") {
    return {
      title: config.id === "followup" ? "Crear seguimiento" : "Crear tarea",
      body: "Convierte una necesidad del ministerio en una acción clara.",
      primary: config.id === "followup" ? "Persona o familia" : "Título de la tarea",
      secondary: "Responsable / categoría",
      tertiary: "Fecha límite",
      notes: "Descripción",
      button: config.id === "followup" ? "Guardar seguimiento" : "Guardar tarea",
    };
  }

  return null;
}

function buildActionPayload(config: ModuleConfig, form: QuickActionForm) {
  if (config.action === "visitor") {
    const { firstName, lastName } = splitFullName(form.primary);
    return {
      firstName,
      lastName,
      email: form.secondary,
      phone: form.tertiary,
      notes: form.notes,
      source: "Mobile app",
    };
  }

  if (config.action === "checkin") {
    return {
      nameOrCode: form.primary,
      serviceName: form.secondary,
      campus: form.tertiary,
      notes: form.notes,
      source: "Mobile app",
      firstTime: true,
    };
  }

  if (config.action === "reservation") {
    return {
      roomName: form.primary,
      purpose: form.secondary,
      startsAt: form.tertiary,
      notes: form.notes,
      status: "REQUESTED",
      source: "Mobile app",
    };
  }

  return {
    title: form.primary,
    category: form.secondary,
    dueAt: form.tertiary,
    description: form.notes,
    priority: "NORMAL",
    source: "Mobile app",
  };
}

function SectionSwitcher({ activeId }: { activeId: NextLevelSection }) {
  return (
    <div className="-mx-3 overflow-x-auto px-3 pb-1">
      <div className="flex min-w-max gap-2">
        {modules.map((module) => {
          const Icon = module.icon;
          const active = module.id === activeId;
          return (
            <Link
              key={module.id}
              to={module.route}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-zinc-900 bg-zinc-950 text-white shadow-sm"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {module.shortTitle}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ModuleGrid({ activeId }: { activeId: NextLevelSection }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {modules.map((module) => {
        const Icon = module.icon;
        const active = module.id === activeId;
        return (
          <Link key={module.id} to={module.route}>
            <Card className={cn("h-full overflow-hidden border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", active && "border-zinc-900 ring-2 ring-zinc-900/10")}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm", module.accent)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-black text-zinc-950">{module.shortTitle}</p>
                      {module.configurable ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[0.65rem] text-amber-700">
                          Config
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{module.description}</p>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-400" />
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function MetricStrip({ payload, count }: { payload: NextLevelPayload; count: number }) {
  const metrics = unwrapMetrics(payload);
  const entries = Object.entries(metrics)
    .map(([key, value]) => ({ key, label: labelFromKey(key), value: formatMetricValue(value) }))
    .filter((entry) => entry.value)
    .slice(0, 4);

  const visibleEntries = entries.length > 0 ? entries : [{ key: "count", label: "Total", value: String(count) }];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {visibleEntries.map((entry) => (
        <Card key={entry.key} className="border-zinc-200 bg-white/90 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">{entry.label}</p>
            <p className="mt-1 text-2xl font-black tracking-tight text-zinc-950">{entry.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function QuickActionCard({
  config,
  form,
  submitting,
  message,
  onChange,
  onSubmit,
}: {
  config: ModuleConfig;
  form: QuickActionForm;
  submitting: boolean;
  message: string | null;
  onChange: (next: QuickActionForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const copy = actionCopy(config);
  if (!copy) return null;

  return (
    <Card className="border-zinc-200 bg-white shadow-sm">
      <CardContent className="p-4">
        <form className="space-y-3" onSubmit={onSubmit}>
          <div>
            <p className="text-base font-black text-zinc-950">{copy.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
          </div>
          <Input
            value={form.primary}
            onChange={(event) => onChange({ ...form, primary: event.target.value })}
            className="h-12 rounded-2xl"
            placeholder={copy.primary}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={form.secondary}
              onChange={(event) => onChange({ ...form, secondary: event.target.value })}
              className="h-12 rounded-2xl"
              placeholder={copy.secondary}
              type={config.action === "visitor" ? "email" : "text"}
            />
            <Input
              value={form.tertiary}
              onChange={(event) => onChange({ ...form, tertiary: event.target.value })}
              className="h-12 rounded-2xl"
              placeholder={copy.tertiary}
              type={config.action === "task" || config.action === "reservation" ? "datetime-local" : "text"}
            />
          </div>
          <Textarea
            value={form.notes}
            onChange={(event) => onChange({ ...form, notes: event.target.value })}
            className="min-h-24 rounded-2xl"
            placeholder={copy.notes}
          />
          {message ? <p className="text-sm font-medium text-zinc-600">{message}</p> : null}
          <Button type="submit" className="h-12 w-full rounded-2xl" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {copy.button}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ConfigurableState({ config }: { config: ModuleConfig }) {
  if (!config.configurable) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/70">
      <CardContent className="flex gap-3 p-4">
        <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <p className="font-bold text-amber-950">Módulo listo para configurar</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            Si esta integración necesita llaves, permisos móviles o webhooks externos, se muestra como configurable y no bloquea el flujo del equipo.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ config }: { config: ModuleConfig }) {
  const Icon = config.icon;
  return (
    <Card className="border-dashed border-zinc-300 bg-white/80">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <div className={cn("flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br text-white shadow-sm", config.accent)}>
          <Icon className="h-7 w-7" />
        </div>
        <div>
          <p className="font-bold text-zinc-950">{config.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{config.emptyBody}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <Card key={item} className="border-zinc-200 bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 animate-pulse rounded-2xl bg-zinc-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded-full bg-zinc-200" />
                <div className="h-3 w-1/2 animate-pulse rounded-full bg-zinc-100" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ItemCard({ config, item, index }: { config: ModuleConfig; item: NextLevelItem; index: number }) {
  const Icon = config.icon;
  const title = itemTitle(config, item, index);
  const meta = itemMeta(config, item);
  const body = itemBody(config, item);
  const status = statusLabel(config, item);

  return (
    <Card className="overflow-hidden border-zinc-200 bg-white shadow-sm transition-transform active:scale-[0.99]">
      <CardContent className="p-0">
        <div className="flex gap-3 p-4">
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm", config.accent)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-bold leading-tight text-zinc-950">{title}</p>
                {meta.length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {meta.slice(0, 3).map((part) => (
                      <span key={part} className="inline-flex items-center gap-1">
                        {part.includes("@") ? <Mail className="h-3 w-3" /> : /\d{3}/.test(part) ? <Phone className="h-3 w-3" /> : null}
                        {part}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <Badge className={cn("shrink-0 border text-[0.68rem]", statusTone(status))} variant="outline">
                {status}
              </Badge>
            </div>
            {body ? <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-zinc-600">{body}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PastoralCapabilityGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {pastoralCapabilities.map((capability) => {
        const Icon = capability.icon;
        return (
          <Card key={capability.label} className="border-zinc-200 bg-white/90">
            <CardContent className="flex gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-zinc-950">{capability.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{capability.text}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function NextLevel({ section }: NextLevelPageProps) {
  const { fetchApi } = useApi();
  const { selectedChurch, loading: churchLoading } = useChurch();
  const config = useMemo(() => modules.find((entry) => entry.id === section) ?? modules[0], [section]);
  const [payload, setPayload] = useState<NextLevelPayload>(null);
  const [items, setItems] = useState<NextLevelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quickActionForm, setQuickActionForm] = useState<QuickActionForm>(blankQuickActionForm);
  const [quickActionSubmitting, setQuickActionSubmitting] = useState(false);
  const [quickActionMessage, setQuickActionMessage] = useState<string | null>(null);

  const loadSection = useCallback(async () => {
    if (churchLoading) return;

    if (!selectedChurch) {
      setPayload(null);
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<NextLevelPayload>(config.endpoint);
      setPayload(data);
      setItems(unwrapArray(data, config.itemKeys));
    } catch (loadError) {
      console.error(`No se pudo cargar ${config.title}:`, loadError);
      setPayload(null);
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar esta sección.");
    } finally {
      setLoading(false);
    }
  }, [churchLoading, config.endpoint, config.itemKeys, config.title, fetchApi, selectedChurch]);

  useEffect(() => {
    loadSection();
  }, [loadSection]);

  useEffect(() => {
    setQuickActionForm(blankQuickActionForm);
    setQuickActionMessage(null);
  }, [config.id]);

  const handleQuickAction = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (config.action === "none") return;

      setQuickActionSubmitting(true);
      setQuickActionMessage(null);
      try {
        const created = await fetchApi<NextLevelItem>(config.actionEndpoint ?? config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildActionPayload(config, quickActionForm)),
        });
        setItems((current) => [isRecord(created) ? created : buildActionPayload(config, quickActionForm), ...current]);
        setQuickActionForm(blankQuickActionForm);
        setQuickActionMessage("Guardado correctamente.");
      } catch (createError) {
        console.error(`No se pudo guardar ${config.title}:`, createError);
        setQuickActionMessage(createError instanceof Error ? createError.message : "No se pudo guardar. Intenta de nuevo.");
      } finally {
        setQuickActionSubmitting(false);
      }
    },
    [config, fetchApi, quickActionForm]
  );

  const Icon = config.icon;

  if (churchLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!selectedChurch) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Card className="w-full max-w-md border-dashed bg-white">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <Users className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="text-xl font-bold">Selecciona una iglesia</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Necesitas una iglesia activa para cargar Next Level.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <section className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm">
        <div className={cn("h-2 bg-gradient-to-r", config.accent)} />
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">{config.eyebrow}</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">{config.title}</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{config.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {config.featureTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="rounded-full border-zinc-200 bg-zinc-50 text-zinc-700">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br text-white shadow-sm", config.accent)}>
              <Icon className="h-7 w-7" />
            </div>
          </div>
        </div>
      </section>

      <SectionSwitcher activeId={config.id} />
      <ModuleGrid activeId={config.id} />

      <ConfigurableState config={config} />

      <QuickActionCard
        config={config}
        form={quickActionForm}
        submitting={quickActionSubmitting}
        message={quickActionMessage}
        onChange={setQuickActionForm}
        onSubmit={handleQuickAction}
      />

      <MetricStrip payload={payload} count={items.length} />

      {error ? (
        <Card className={cn(config.configurable ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50")}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertCircle className={cn("mt-0.5 h-5 w-5 shrink-0", config.configurable ? "text-amber-700" : "text-red-600")} />
              <div>
                <p className={cn("font-semibold", config.configurable ? "text-amber-950" : "text-red-900")}>
                  {config.configurable ? "Pendiente de configuración" : `No se pudo cargar ${config.title.toLowerCase()}`}
                </p>
                <p className={cn("text-sm", config.configurable ? "text-amber-800" : "text-red-700")}>{error}</p>
              </div>
            </div>
            <Button variant="outline" className="bg-white" onClick={loadSection}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {config.id === "pastoral" ? <PastoralCapabilityGrid /> : null}

      {loading ? (
        <LoadingState />
      ) : !error && items.length === 0 ? (
        <EmptyState config={config} />
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <ItemCard key={getId(item, index)} config={config} item={item} index={index} />
          ))}
        </div>
      )}

      {!loading && !error && items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-zinc-200 bg-white/90">
            <CardContent className="flex items-center gap-3 p-4">
              <CalendarClock className="h-5 w-5 text-zinc-500" />
              <p className="text-sm text-zinc-600">Actualizado con la información más reciente del equipo.</p>
            </CardContent>
          </Card>
          <Card className="border-zinc-200 bg-white/90">
            <CardContent className="flex items-center gap-3 p-4">
              <ClipboardList className="h-5 w-5 text-zinc-500" />
              <p className="text-sm text-zinc-600">Diseñado para revisar prioridades desde el teléfono.</p>
            </CardContent>
          </Card>
          <Card className="border-zinc-200 bg-white/90">
            <CardContent className="flex items-center gap-3 p-4">
              <MapPin className="h-5 w-5 text-zinc-500" />
              <p className="text-sm text-zinc-600">Cada tarjeta muestra lo esencial primero.</p>
              <ChevronRight className="ml-auto h-4 w-4 text-zinc-400" />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {config.id === "insights" && !loading && !error ? (
        <Card className="border-zinc-200 bg-zinc-950 text-white">
          <CardContent className="flex gap-3 p-4">
            <Sparkles className="h-5 w-5 shrink-0 text-amber-300" />
            <p className="text-sm leading-relaxed text-zinc-200">
              Usa estos datos como señales rápidas. Para decisiones importantes, confirma el contexto con el equipo pastoral.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {config.id === "marketplace" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-zinc-200 bg-white">
            <CardContent className="flex gap-3 p-4">
              <HelpCircle className="h-5 w-5 text-zinc-500" />
              <p className="text-sm text-zinc-600">Ayuda contextual y guías rápidas para líderes.</p>
            </CardContent>
          </Card>
          <Card className="border-zinc-200 bg-white">
            <CardContent className="flex gap-3 p-4">
              <MessageSquareText className="h-5 w-5 text-zinc-500" />
              <p className="text-sm text-zinc-600">Stories y ejemplos de iglesias para inspirar adopción.</p>
            </CardContent>
          </Card>
          <Card className="border-zinc-200 bg-white">
            <CardContent className="flex gap-3 p-4">
              <Home className="h-5 w-5 text-zinc-500" />
              <p className="text-sm text-zinc-600">Plantillas listas para campus, grupos y voluntarios.</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {config.id === "checkin" ? (
        <Card className="border-zinc-200 bg-zinc-950 text-white">
          <CardContent className="flex gap-3 p-4">
            <ClipboardCheck className="h-5 w-5 shrink-0 text-cyan-300" />
            <p className="text-sm leading-relaxed text-zinc-200">
              El check-in manual usa el mismo endpoint móvil para no bloquear al equipo cuando el lector QR o la cámara no estén disponibles.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
