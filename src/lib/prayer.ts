export type PrayerPrivacy = "name" | "anonymous" | "private";

export type PrayerRequest = {
  id: string;
  content: string;
  authorName: string;
  prayedCount: number;
  answeredAt: string | null;
  createdAt: string;
  isMine: boolean;
  isPrivate: boolean;
  isAnonymous: boolean;
  hasPrayed: boolean;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizePrayerRequest(value: unknown): PrayerRequest | null {
  const record = recordOf(value);
  const id = stringValue(record?.id).trim();
  const content = stringValue(record?.content).trim();
  if (!record || !id || !content) return null;

  return {
    id,
    content,
    authorName: stringValue(record.authorName || record.userFullName, "Alguien").trim() || "Alguien",
    prayedCount: numberValue(record.prayedCount ?? record.prayCount),
    answeredAt: stringValue(record.answeredAt).trim() || null,
    createdAt: stringValue(record.createdAt, new Date(0).toISOString()),
    isMine: Boolean(record.isMine),
    isPrivate: Boolean(record.isPrivate),
    isAnonymous: Boolean(record.isAnonymous),
    hasPrayed: Boolean(record.hasPrayed),
  };
}

export function normalizePrayerRequests(value: unknown): PrayerRequest[] {
  const record = recordOf(value);
  const rows = Array.isArray(value) ? value : Array.isArray(record?.requests) ? record.requests : [];
  return rows.map(normalizePrayerRequest).filter((request): request is PrayerRequest => Boolean(request));
}

export function getPrayerAuthorLabel(request: PrayerRequest) {
  if (request.isPrivate) return request.isMine ? "Solo tú" : "Petición privada";
  if (request.isAnonymous) return "Anónima";
  return request.authorName || "Alguien";
}
