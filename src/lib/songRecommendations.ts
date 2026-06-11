export type SongRecommendationFields = {
  useCount?: number | string | null;
  daysSinceLastUsed?: number | null;
  recommendationBucket?: string | null;
  recommendationReason?: string | null;
  recommendationBadges?: unknown;
};

export type SongRecommendationLike = {
  id: string;
  title: string;
  lastUsedAt?: string | null;
} & SongRecommendationFields;

type ServiceSongRef = {
  songId?: string | null;
  song?: { id?: string | null } | null;
};

function normalizeCount(value: number | string | null | undefined) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(parsed) && Number(parsed) > 0 ? Number(parsed) : 0;
}

function pluralize(value: number, singular: string, plural: string) {
  return value === 1 ? singular : plural;
}

function formatRestLabel(days: number) {
  if (days < 7) return `No usada hace ${days} ${pluralize(days, "día", "días")}`;
  const weeks = Math.max(1, Math.round(days / 7));
  return `No usada hace ${weeks} ${pluralize(weeks, "semana", "semanas")}`;
}

function getResponseList<TSong>(value: unknown): TSong[] {
  if (Array.isArray(value)) return value as TSong[];
  if (!value || typeof value !== "object") return [];

  const record = value as {
    items?: unknown;
    data?: unknown;
    recommendations?: unknown;
    songs?: unknown;
  };
  const candidate = record.items || record.data || record.recommendations || record.songs;
  return Array.isArray(candidate) ? candidate as TSong[] : [];
}

export function normalizeSongRecommendationResponse<TSong>(value: unknown) {
  return getResponseList<TSong>(value);
}

export function getExistingServiceSongIds(items: ServiceSongRef[] | null | undefined) {
  return new Set(
    (items || [])
      .map((item) => item.songId || item.song?.id || "")
      .filter(Boolean),
  );
}

export function filterExistingSongRecommendations<TSong extends { id?: string | null }>(
  songs: TSong[],
  existingSongIds: Iterable<string>,
) {
  const existing = new Set(existingSongIds);
  return songs.filter((song) => song.id && !existing.has(song.id));
}

export function getSongRecommendationBadges(song: SongRecommendationFields) {
  if (Array.isArray(song.recommendationBadges)) {
    return song.recommendationBadges
      .filter((badge): badge is string => typeof badge === "string" && badge.trim().length > 0)
      .slice(0, 3);
  }

  if (typeof song.recommendationReason === "string" && song.recommendationReason.trim()) {
    return song.recommendationReason
      .split(" · ")
      .map((badge) => badge.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  const hasRecommendationMetadata =
    Boolean(song.recommendationBucket) ||
    song.useCount !== undefined ||
    typeof song.daysSinceLastUsed === "number";
  if (!hasRecommendationMetadata) return [];

  const useCount = normalizeCount(song.useCount);
  if (song.recommendationBucket === "new_rotation" || useCount === 0) return ["Nueva en rotación"];

  const badges: string[] = [];
  if (song.recommendationBucket === "rested_favorite") badges.push("Favorita descansada");
  if (typeof song.daysSinceLastUsed === "number") badges.push(formatRestLabel(song.daysSinceLastUsed));
  if (useCount > 0) badges.push(`Usada ${useCount} ${pluralize(useCount, "vez", "veces")}`);
  return badges.slice(0, 3);
}
