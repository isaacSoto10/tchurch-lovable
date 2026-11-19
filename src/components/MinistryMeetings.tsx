import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";

export type MinistryMeeting = {
  id: string;
  title: string;
  date: string;
  location: string | null;
  requiresCheckIn: boolean;
  upcoming: boolean;
};

export type MinistryMeetingSchedule = {
  dayOfWeek?: string | null;
  time?: string | null;
  location?: string | null;
};

function formatMeetingDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-US", { dateStyle: "long", timeStyle: "short" });
}

export function MinistryMeetings({ meetings = [], schedule, canCheckIn = false }: {
  meetings?: MinistryMeeting[];
  schedule?: MinistryMeetingSchedule | null;
  canCheckIn?: boolean;
}) {
  const nextMeeting = meetings.find((meeting) => meeting.upcoming);
  const regularSchedule = [schedule?.dayOfWeek, schedule?.time, schedule?.location].filter(Boolean).join(" · ");
  const otherMeetings = canCheckIn
    ? meetings.filter((meeting) => meeting.id !== nextMeeting?.id && meeting.requiresCheckIn)
    : [];

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground" aria-label="Reuniones del ministerio">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{nextMeeting || !regularSchedule ? "Próxima reunión" : "Horario habitual"}</h2>
            {nextMeeting ? (
              <>
                <p className="mt-1 break-words text-sm font-medium">{nextMeeting.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[formatMeetingDate(nextMeeting.date), nextMeeting.location].filter(Boolean).join(" · ")}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{regularSchedule || "Aún no hay reuniones programadas."}</p>
            )}
          </div>
        </div>
        {canCheckIn && nextMeeting?.requiresCheckIn && (
          <AttendanceLink meeting={nextMeeting} text="Registrar asistencia" />
        )}
      </div>

      {otherMeetings.length > 0 && (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Asistencia de otras reuniones</summary>
          <ul className="mt-2 space-y-2">
            {otherMeetings.map((meeting) => (
              <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{meeting.title}</p>
                  <p className="text-xs text-muted-foreground">{formatMeetingDate(meeting.date)}</p>
                </div>
                <AttendanceLink meeting={meeting} text="Asistencia" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function AttendanceLink({ meeting, text }: { meeting: MinistryMeeting; text: string }) {
  return (
    <Link
      to={`/app/events/${encodeURIComponent(meeting.id)}/check-in`}
      aria-label={`${text} de ${meeting.title}`}
      className="inline-flex min-h-11 items-center rounded-lg border border-primary/20 px-3 text-sm font-semibold text-primary hover:bg-secondary"
    >
      {text}
    </Link>
  );
}
