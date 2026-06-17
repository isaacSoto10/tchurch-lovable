import { describe, expect, it } from "vitest";
import {
  buildSongNotesWithYoutubeUrl,
  normalizeYouTubeUrlInput,
  updateSongYoutubeUrlInServiceItems,
} from "./songYoutube";
import type { SongLike } from "./songDisplay";

describe("song YouTube helpers", () => {
  it("normalizes common YouTube URL inputs", () => {
    expect(normalizeYouTubeUrlInput("youtube.com/watch?v=abc123")).toEqual({
      url: "https://youtube.com/watch?v=abc123",
    });
    expect(normalizeYouTubeUrlInput("http://youtu.be/abc123")).toEqual({
      url: "https://youtu.be/abc123",
    });
  });

  it("rejects non-YouTube links", () => {
    expect(normalizeYouTubeUrlInput("https://example.com/watch?v=abc123")).toEqual({
      error: "Pega un enlace válido de YouTube.",
    });
  });

  it("preserves song note metadata while replacing the YouTube link", () => {
    const notes = buildSongNotesWithYoutubeUrl(
      {
        id: "song-1",
        title: "Santo",
        notes: JSON.stringify({
          youtubeUrl: "https://youtube.com/watch?v=old",
          notes: "Capo 2",
          sourceUrl: "https://lacuerda.net/example",
          needsLicensedChart: true,
        }),
      },
      "https://youtu.be/new",
    );

    expect(JSON.parse(notes || "{}")).toEqual({
      youtubeUrl: "https://youtu.be/new",
      notes: "Capo 2",
      sourceUrl: "https://lacuerda.net/example",
      needsLicensedChart: true,
    });
  });

  it("updates matching service item song rows locally", () => {
    const items: Array<{ id: string; song: SongLike }> = [
      { id: "item-1", song: { id: "song-1", title: "Santo", notes: null } },
      { id: "item-2", song: { id: "song-2", title: "Al Rey", notes: null } },
    ];

    const updated = updateSongYoutubeUrlInServiceItems(items, "song-1", "https://youtu.be/abc123");

    expect(updated[0].song?.youtubeUrl).toBe("https://youtu.be/abc123");
    expect(JSON.parse(updated[0].song?.notes || "{}")).toEqual({
      youtubeUrl: "https://youtu.be/abc123",
    });
    expect(updated[1]).toBe(items[1]);
  });
});
