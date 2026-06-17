export type SongUsageLike = {
  title?: string | null;
  name?: string | null;
  lastUsedAt?: string | null;
  createdAt?: string | null;
};

const DAY_MS = 86_400_000;

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function getSongUsageTime(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getSongUsageTitle(song: SongUsageLike) {
  return song.title || song.name || "";
}

export function compareSongsByLastUsedDesc<TSong extends SongUsageLike>(a: TSong, b: TSong) {
  const usageDiff = getSongUsageTime(b.lastUsedAt) - getSongUsageTime(a.lastUsedAt);
  if (usageDiff !== 0) return usageDiff;
  return getSongUsageTitle(a).localeCompare(getSongUsageTitle(b));
}

export function sortSongsByLastUsedDesc<TSong extends SongUsageLike>(songs: TSong[]) {
  return [...songs].sort(compareSongsByLastUsedDesc);
}

export function compareSongsByDateAddedDesc<TSong extends SongUsageLike>(a: TSong, b: TSong) {
  const createdDiff = getSongUsageTime(b.createdAt) - getSongUsageTime(a.createdAt);
  if (createdDiff !== 0) return createdDiff;
  return getSongUsageTitle(a).localeCompare(getSongUsageTitle(b));
}

export function sortSongsByDateAddedDesc<TSong extends SongUsageLike>(songs: TSong[]) {
  return [...songs].sort(compareSongsByDateAddedDesc);
}

export function formatSongLastUsedLabel(value?: string | null, now = new Date()) {
  const usedTime = getSongUsageTime(value);
  if (!usedTime) return "Nunca usada";

  const days = Math.max(0, Math.floor((startOfDay(now) - startOfDay(new Date(usedTime))) / DAY_MS));
  if (days === 0) return "Última vez hoy";
  if (days === 1) return "Última vez ayer";
  if (days < 7) return `Última vez hace ${days} días`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `Última vez hace ${weeks} semana${weeks === 1 ? "" : "s"}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `Última vez hace ${months} mes${months === 1 ? "" : "es"}`;

  const years = Math.floor(days / 365);
  return `Última vez hace ${years} año${years === 1 ? "" : "s"}`;
}
