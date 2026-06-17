import {
  getSongYoutubeUrl,
  type SongLike,
} from "@/lib/songDisplay";

type YoutubeUrlResult =
  | { url: string | null; error?: never }
  | { url?: never; error: string };

type ServiceItemWithSong = {
  song?: SongLike | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseNotesObject(notes: string | null | undefined) {
  if (!notes) return null;

  try {
    const parsed = JSON.parse(notes);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isYoutubeHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

export function normalizeYouTubeUrlInput(value: string): YoutubeUrlResult {
  const trimmed = value.trim();
  if (!trimmed) return { url: null };

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (!isYoutubeHost(url.hostname)) {
      return { error: "Pega un enlace válido de YouTube." };
    }
    url.protocol = "https:";
    return { url: url.toString() };
  } catch {
    return { error: "Pega un enlace válido de YouTube." };
  }
}

export function buildSongNotesWithYoutubeUrl(song: SongLike, youtubeUrl: string | null) {
  const parsedNotes = parseNotesObject(song.notes);
  const nextNotes: Record<string, unknown> = parsedNotes ? { ...parsedNotes } : {};

  if (!parsedNotes && song.notes?.trim()) {
    nextNotes.notes = song.notes;
  }

  if (youtubeUrl) {
    nextNotes.youtubeUrl = youtubeUrl;
  } else {
    delete nextNotes.youtubeUrl;
  }

  for (const [key, value] of Object.entries(nextNotes)) {
    if (value === null || value === undefined || value === "") {
      delete nextNotes[key];
    }
  }

  return Object.keys(nextNotes).length > 0 ? JSON.stringify(nextNotes) : null;
}

export function withSongYoutubeUrl<TSong extends SongLike>(song: TSong, youtubeUrl: string | null): TSong {
  return {
    ...song,
    youtubeUrl,
    notes: buildSongNotesWithYoutubeUrl(song, youtubeUrl),
  };
}

export function updateSongYoutubeUrlInServiceItems<TItem extends ServiceItemWithSong>(
  items: TItem[],
  songId: string,
  youtubeUrl: string | null,
) {
  return items.map((item) =>
    item.song?.id === songId
      ? { ...item, song: withSongYoutubeUrl(item.song, youtubeUrl) }
      : item
  );
}

export function getSongYoutubeDraft(song: SongLike | null | undefined) {
  return getSongYoutubeUrl(song) || "";
}
