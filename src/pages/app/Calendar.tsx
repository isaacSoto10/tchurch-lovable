import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ListFilter, MapPin, RotateCw } from "lucide-react";
import { SectionNav } from "@/components/SectionNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useResponsiveLayout } from "@/hooks/use-mobile";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import { formatServiceDate, formatServiceTime, getServiceDateKey } from "@/lib/serviceDates";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import { getEventTypeLabel } from "@/types/events";

type AgendaFilter = "all" | "service" | "event";

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: string | null;
  location: string | null;
}

interface CalendarService {
  id: string;
  title: string;
  date: string;
  status: string | null;
}

interface AgendaItem {
  id: string;
  title: string;
  date: string;
  kind: "service" | "event";
  typeLabel: string | null;
  location: string | null;
  status: string | null;
}

type CalendarSnapshot = { items: AgendaItem[] };
const CALENDAR_SNAPSHOT_PREFIX = "tchurch_ios_calendar_snapshot_v2";

function isCalendarSnapshot(value: unknown): value is CalendarSnapshot {
  return Boolean(value && typeof value === "object" && Array.isArray((value as CalendarSnapshot).items));
}

function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function itemDateKey(item: AgendaItem) {
  return item.kind === "service" ? getServiceDateKey(item.date) : localDateKey(item.date);
}

function itemHref(item: AgendaItem) {
  return item.kind === "service" ? `/app/services/${item.id}` : `/app/events/${item.id}`;
}

function formatItemDate(item: AgendaItem, options?: Intl.DateTimeFormatOptions) {
  if (item.kind === "service") return formatServiceDate(item.date, "es-US", options);
  return new Date(item.date).toLocaleDateString("es-US", options);
}

function formatItemTime(item: AgendaItem) {
  if (item.kind === "service") return formatServiceTime(item.date, "es-US");
  return new Date(item.date).toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" });
}

function monthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setDate(end.getDate() + (6 - end.getDay()));
  return { start, end };
}

function monthDays(date: Date) {
  const { start, end } = monthRange(date);
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function AgendaRow({ item, onOpen }: { item: AgendaItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-16 w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={`mt-1 h-10 w-1 shrink-0 rounded-full ${item.kind === "service" ? "bg-primary" : "bg-blue-500"}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-foreground">{item.title}</span>
          <Badge variant="secondary" className="shrink-0 text-[11px]">
            {item.kind === "service" ? "Servicio" : getEventTypeLabel(item.typeLabel)}
          </Badge>
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatItemTime(item)}</span>
          {item.location && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5" /><span className="truncate">{item.location}</span></span>}
        </span>
      </span>
      <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export default function Calendar() {
  const { fetchApi } = useApi();
  const navigate = useNavigate();
  const responsive = useResponsiveLayout();
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [filter, setFilter] = useState<AgendaFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const range = useMemo(() => monthRange(currentMonth), [currentMonth]);
  const days = useMemo(() => monthDays(currentMonth), [currentMonth]);
  const snapshotKey = sessionSnapshotKey(CALENDAR_SNAPSHOT_PREFIX, `${getChurchId() || "default"}:${year}-${month}`);

  const loadAgenda = useCallback(async (preferSnapshot = true) => {
    const snapshot = preferSnapshot
      ? readSessionSnapshot<CalendarSnapshot>(snapshotKey, { validate: isCalendarSnapshot })
      : null;
    if (snapshot) {
      setItems(snapshot.data.items);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await fetchApi<{ events?: CalendarEvent[]; services?: CalendarService[] }>(
        `/calendar?start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`,
      );
      const nextItems: AgendaItem[] = [
        ...(data.events || []).map((event): AgendaItem => ({
          id: event.id,
          title: event.title,
          date: event.date,
          kind: "event",
          typeLabel: event.type,
          location: event.location,
          status: null,
        })),
        ...(data.services || []).map((service): AgendaItem => ({
          id: service.id,
          title: service.title,
          date: service.date,
          kind: "service",
          typeLabel: service.status,
          location: null,
          status: service.status,
        })),
      ].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
      setItems(nextItems);
      writeSessionSnapshot(snapshotKey, { items: nextItems });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar la agenda.");
    } finally {
      setLoading(false);
    }
  }, [fetchApi, range.end, range.start, snapshotKey]);

  useEffect(() => {
    void loadAgenda();
  }, [loadAgenda]);

  const filteredItems = useMemo(
    () => filter === "all" ? items : items.filter((item) => item.kind === filter),
    [filter, items],
  );
  const groupedItems = useMemo(() => {
    const groups = new Map<string, AgendaItem[]>();
    for (const item of filteredItems) {
      const key = itemDateKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return [...groups.entries()];
  }, [filteredItems]);
  const selectedItems = filteredItems.filter((item) => itemDateKey(item) === localDateKey(selectedDate));

  function changeMonth(offset: number) {
    const next = new Date(year, month + offset, 1);
    setCurrentMonth(next);
    setSelectedDate(next);
  }

  return (
    <div className="mobile-page mx-auto max-w-6xl space-y-5">
      <SectionNav section="agenda" label="Agenda" />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mobile-section-title">Agenda</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Agenda de la iglesia</h1>
          <p className="mt-1 text-sm text-muted-foreground">Servicios y eventos organizados por fecha.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <p className="min-w-40 text-center text-sm font-semibold capitalize text-foreground">
            {currentMonth.toLocaleDateString("es-US", { month: "long", year: "numeric" })}
          </p>
          <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </header>

      <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Filtrar agenda">
        <ListFilter className="h-4 w-4 shrink-0 text-muted-foreground" />
        {([
          ["all", "Todo"],
          ["service", "Servicios"],
          ["event", "Eventos"],
        ] as const).map(([value, label]) => (
          <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{label}</Button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p className="font-semibold">No pudimos cargar la agenda.</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-3 border-red-200 bg-white text-red-700" onClick={() => loadAgenda(false)}>
            <RotateCw className="h-4 w-4" /> Reintentar
          </Button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Cargando agenda">
          {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      ) : !responsive.isPhone ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <Card className="app-card min-w-0">
            <CardContent className="p-3">
              <div className="grid grid-cols-7 gap-1">
                {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((name) => (
                  <div key={name} className="py-2 text-center text-xs font-semibold text-muted-foreground">{name}</div>
                ))}
                {days.map((day) => {
                  const dayItems = filteredItems.filter((item) => itemDateKey(item) === localDateKey(day));
                  const selected = localDateKey(day) === localDateKey(selectedDate);
                  const inMonth = day.getMonth() === month;
                  const today = localDateKey(day) === localDateKey(new Date());
                  return (
                    <button
                      type="button"
                      key={day.toISOString()}
                      onClick={() => setSelectedDate(day)}
                      aria-label={`${day.toLocaleDateString("es-US", { month: "long", day: "numeric" })}, ${dayItems.length} elementos`}
                      className={[
                        "min-h-24 rounded-xl border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-28",
                        selected ? "border-primary bg-secondary" : "border-border bg-card hover:border-primary/30",
                        inMonth ? "" : "opacity-45",
                      ].join(" ")}
                    >
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-[10px] text-xs font-semibold ${today ? "bg-primary text-white" : "text-foreground"}`}>{day.getDate()}</span>
                      <span className="mt-2 block space-y-1">
                        {dayItems.slice(0, 2).map((item) => (
                          <span key={`${item.kind}-${item.id}`} className="block truncate text-[11px] font-medium text-foreground">
                            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${item.kind === "service" ? "bg-primary" : "bg-blue-500"}`} />
                            {item.title}
                          </span>
                        ))}
                        {dayItems.length > 2 && <span className="block text-[11px] text-muted-foreground">+{dayItems.length - 2} más</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <aside className="space-y-3 md:sticky md:top-4 md:self-start">
            <div>
              <p className="mobile-section-title">Día seleccionado</p>
              <h2 className="mt-1 text-lg font-semibold capitalize text-foreground">
                {selectedDate.toLocaleDateString("es-US", { weekday: "long", month: "long", day: "numeric" })}
              </h2>
            </div>
            {selectedItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card p-5 text-center text-sm text-muted-foreground">No hay actividades este día.</div>
            ) : selectedItems.map((item) => <AgendaRow key={`${item.kind}-${item.id}`} item={item} onOpen={() => navigate(itemHref(item))} />)}
          </aside>
        </div>
      ) : groupedItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <CalendarDays className="mx-auto h-9 w-9 text-primary" />
          <p className="mt-3 font-semibold text-foreground">No hay actividades este mes</p>
          <p className="mt-1 text-sm text-muted-foreground">Prueba otro mes o cambia el filtro.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedItems.map(([dateKey, dayItems]) => {
            const first = dayItems[0];
            return (
              <section key={dateKey} className="space-y-2">
                <h2 className="text-sm font-semibold capitalize text-foreground">
                  {formatItemDate(first, { weekday: "long", month: "long", day: "numeric" })}
                </h2>
                <div className="space-y-2">
                  {dayItems.map((item) => <AgendaRow key={`${item.kind}-${item.id}`} item={item} onOpen={() => navigate(itemHref(item))} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
