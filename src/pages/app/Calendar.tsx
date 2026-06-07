import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useNavigate } from "react-router-dom";
import { formatServiceDate, formatServiceTime, getServiceDateKey } from "@/lib/serviceDates";
import { useIsMobile } from "@/hooks/use-mobile";

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

interface CalendarItem {
  id: string;
  title: string;
  date: string;
  type: "service" | "event";
  typeLabel: string | null;
  location: string | null;
  status: string | null;
}

export default function Calendar() {
  const { fetchApi } = useApi();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0);
  const startOfWeek = new Date(startOfMonth);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const endOfWeek = new Date(endOfMonth);
  endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay()));

  useEffect(() => {
    const loadCalendar = async () => {
      setLoading(true);
      try {
        const start = startOfWeek.toISOString();
        const end = endOfWeek.toISOString();
        const data = await fetchApi(`/calendar?start=${start}&end=${end}`) as { events?: CalendarEvent[]; services?: CalendarService[] };
        
        const calendarItems: CalendarItem[] = [];
        
        if (data?.events) {
          for (const e of data.events) {
            calendarItems.push({
              id: e.id,
              title: e.title,
              date: e.date,
              type: "event",
              typeLabel: e.type,
              location: e.location,
              status: null,
            });
          }
        }
        
        if (data?.services) {
          for (const s of data.services) {
            calendarItems.push({
              id: s.id,
              title: s.title,
              date: s.date,
              type: "service",
              typeLabel: s.status,
              location: null,
              status: s.status,
            });
          }
        }
        
        setItems(calendarItems);
      } catch (e) {
        console.error("Failed to load calendar:", e);
      } finally {
        setLoading(false);
      }
    };
    
    loadCalendar();
  }, [fetchApi, year, month]);

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const getDaysInMonth = () => {
    const days: (Date | null)[] = [];
    
    const day = new Date(startOfWeek);
    while (day <= endOfWeek) {
      if (day.getMonth() === month) {
        days.push(new Date(day));
      } else {
        days.push(null);
      }
      day.setDate(day.getDate() + 1);
    }
    
    return days;
  };

  const getItemsForDay = (date: Date) => {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return items.filter(item => {
      const itemDateStr = item.type === "service"
        ? getServiceDateKey(item.date)
        : getLocalDateKey(item.date);
      return itemDateStr === dateStr;
    });
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isCurrentMonth = (date: Date) => {
    return date.getMonth() === month;
  };

  const formatTime = (item: CalendarItem) => {
    if (item.type === "service") return formatServiceTime(item.date, "en-US");

    return new Date(item.date).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getLocalDateKey = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const days = getDaysInMonth();
  const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "confirmed":
        return "bg-green-500";
      case "completed":
        return "bg-gray-400";
      default:
        return "bg-green-500";
    }
  };

  const getStatusLabel = (status: string | null) => {
    if (status === "completed") return "completado";
    return "confirmado";
  };

  if (isMobile) {
    const mobileDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Calendar</h1>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="icon" onClick={prevMonth}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <h2 className="text-lg font-semibold">
                {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <Button variant="ghost" size="icon" onClick={nextMonth}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {mobileDayNames.map((name) => (
                <div key={name} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {name}
                </div>
              ))}

              {days.map((day, idx) => (
                <div
                  key={idx}
                  className={`min-h-20 border rounded p-1 ${
                    day ? (isCurrentMonth(day) ? "bg-background" : "bg-muted/30") : "bg-muted/10"
                  }`}
                >
                  {day && (
                    <>
                      <div className={`text-xs font-medium p-1 ${
                        isToday(day) ? "bg-primary text-primary-foreground rounded w-6 h-6 flex items-center justify-center" : ""
                      }`}>
                        {day.getDate()}
                      </div>
                      <div className="space-y-0.5 mt-1">
                        {getItemsForDay(day).slice(0, 3).map((item) => (
                          <button
                            key={item.id}
                            onClick={() => navigate(item.type === "service" ? "/app/services" : "/app/events")}
                            className={`w-full text-left text-xs px-1 py-0.5 rounded truncate text-white ${item.type === "service" ? getStatusColor(item.status) : "bg-indigo-500"}`}
                          >
                            {item.title}
                          </button>
                        ))}
                        {getItemsForDay(day).length > 3 && (
                          <div className="text-xs text-muted-foreground text-center">
                            +{getItemsForDay(day).length - 3} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Upcoming This Month
        </h3>
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-center">
                <CalendarDays className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No events or services this month</p>
              </CardContent>
            </Card>
          ) : (
            items.slice(0, 10).map((item) => (
              <Card
                key={`${item.type}-${item.id}`}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(item.type === "service" ? "/app/services" : "/app/events")}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-1 h-10 rounded ${item.type === "service" ? "bg-primary" : "bg-indigo-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.type === "service"
                        ? formatServiceDate(item.date, "en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : new Date(item.date).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}{" "}
                      · {formatTime(item)}
                      {item.location && ` · ${item.location}`}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded text-white ${item.type === "service" ? getStatusColor(item.status) : "bg-indigo-500"}`}>
                    {item.type === "service" ? getStatusLabel(item.status) : (item.typeLabel || "event")}
                  </span>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-5">
      <div className="app-card-soft p-4 md:p-5">
        <p className="mobile-section-title">Agenda</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-950">Calendario</h1>
            <p className="mt-1 text-sm text-muted-foreground">Servicios y eventos del mes en una sola vista.</p>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm sm:justify-start">
            <Button className="h-10 w-10 rounded-xl" variant="ghost" size="icon" onClick={prevMonth} aria-label="Mes anterior">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h2 className="min-w-40 text-center text-base font-bold">
              {currentDate.toLocaleDateString("es-US", { month: "long", year: "numeric" })}
            </h2>
            <Button className="h-10 w-10 rounded-xl" variant="ghost" size="icon" onClick={nextMonth} aria-label="Mes siguiente">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.38fr)]">
        <Card className="app-card min-w-0">
          <CardContent className="p-2 sm:p-4">
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {dayNames.map((name) => (
                <div key={name} className="py-2 text-center text-xs font-bold text-muted-foreground">
                  {name}
                </div>
              ))}

              {days.map((day, idx) => {
                const dayItems = day ? getItemsForDay(day) : [];
                return (
                  <div
                    key={idx}
                    className={`min-h-[5.25rem] rounded-xl border p-1.5 sm:min-h-28 sm:p-2 lg:min-h-32 ${
                      day ? (isCurrentMonth(day) ? "bg-background" : "bg-muted/30") : "bg-muted/10"
                    }`}
                  >
                    {day && (
                      <>
                        <div className={`flex h-7 w-7 items-center justify-center text-xs font-bold ${
                          isToday(day) ? "rounded-full bg-primary text-primary-foreground" : "text-zinc-700"
                        }`}>
                          {day.getDate()}
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {dayItems.slice(0, 3).map((item) => (
                            <button
                              key={item.id}
                              onClick={() => navigate(item.type === "service" ? "/app/services" : "/app/events")}
                              className={`min-h-7 w-full truncate rounded-lg px-1.5 py-1 text-left text-[11px] font-semibold leading-tight text-white ${item.type === "service" ? getStatusColor(item.status) : "bg-indigo-500"}`}
                            >
                              {item.title}
                            </button>
                          ))}
                          {dayItems.length > 3 && (
                            <div className="text-center text-[11px] font-semibold text-muted-foreground">
                              +{dayItems.length - 3} más
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <aside className="min-w-0 space-y-3 lg:sticky lg:top-[calc(env(safe-area-inset-top)+1rem)] lg:self-start">
          <h3 className="mobile-section-title">Próximos este mes</h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : items.length === 0 ? (
            <Card className="app-card">
              <CardContent className="p-5 text-center">
                <CalendarDays className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No hay eventos o servicios este mes</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {items.slice(0, 12).map((item) => (
                <Card
                  key={`${item.type}-${item.id}`}
                  className="app-card cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                  onClick={() => navigate(item.type === "service" ? "/app/services" : "/app/events")}
                >
                  <CardContent className="flex min-w-0 items-center gap-3 p-3">
                    <div className={`h-11 w-1.5 shrink-0 rounded ${item.type === "service" ? "bg-primary" : "bg-indigo-500"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.type === "service"
                          ? formatServiceDate(item.date, "es-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })
                          : new Date(item.date).toLocaleDateString("es-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}{" "}
                        · {formatTime(item)}
                        {item.location && ` · ${item.location}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold text-white ${item.type === "service" ? getStatusColor(item.status) : "bg-indigo-500"}`}>
                      {item.type === "service" ? getStatusLabel(item.status) : (item.typeLabel || "evento")}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
