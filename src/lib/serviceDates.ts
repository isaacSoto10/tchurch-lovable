const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_MIDNIGHT_RE = /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.000)?)?(?:Z|\+00:00)$/;

function fromParts(year: string, month: string, day: string, hours = 0, minutes = 0) {
  return new Date(Number(year), Number(month) - 1, Number(day), hours, minutes, 0, 0);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function parseServiceDate(value?: string | null) {
  if (!value) return null;

  const dateOnly = value.match(DATE_ONLY_RE);
  if (dateOnly) {
    return fromParts(dateOnly[1], dateOnly[2], dateOnly[3]);
  }

  const utcMidnight = value.match(UTC_MIDNIGHT_RE);
  if (utcMidnight) {
    return fromParts(utcMidnight[1], utcMidnight[2], utcMidnight[3]);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatServiceDate(
  value?: string | null,
  locale = "es-US",
  options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" },
) {
  const date = parseServiceDate(value);
  return date ? date.toLocaleDateString(locale, options) : "";
}

export function formatServiceTime(
  value?: string | null,
  locale = "es-US",
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" },
) {
  const date = parseServiceDate(value);
  return date ? date.toLocaleTimeString(locale, options) : "";
}

export function getServiceDateKey(value?: string | null) {
  const date = parseServiceDate(value);
  if (!date) return "";

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toServiceDatetimeLocalValue(value?: string | null) {
  const date = parseServiceDate(value);
  if (!date) return "";

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
