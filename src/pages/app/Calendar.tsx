import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useNavigate } from "react-router-dom";

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
    
    let day = new Date(startOfWeek);
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
    const dateStr = date.toDateString();
    return items.filter(item => {
      const itemDate = new Date(item.date);
      return itemDate.toDateString() === dateStr;
    });
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isCurrentMonth = (date: Date) => {
    return date.getMonth() === month;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const days = getDaysInMonth();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "confirmed":
        return "bg-green-500";
      case "completed":
        return "bg-gray-400";
      default:
        return "bg-amber-500";
    }
  };

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
            {dayNames.map((name) => (
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
                    {new Date(item.date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {formatDate(item.date)}
                    {item.location && ` · ${item.location}`}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded text-white ${item.type === "service" ? getStatusColor(item.status) : "bg-indigo-500"}`}>
                  {item.type === "service" ? (item.status || "service") : (item.typeLabel || "event")}
                </span>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}