import { describe, expect, it } from "vitest";
import {
  filterExistingSongRecommendations,
  getExistingServiceSongIds,
  getSongRecommendationBadges,
  normalizeSongRecommendationResponse,
} from "./songRecommendations";

describe("song recommendation helpers", () => {
  it("normalizes supported response shapes", () => {
    const items = [{ id: "song-1", title: "Uno" }];

    expect(normalizeSongRecommendationResponse({ items })).toEqual(items);
    expect(normalizeSongRecommendationResponse({ data: items })).toEqual(items);
    expect(normalizeSongRecommendationResponse({ recommendations: items })).toEqual(items);
    expect(normalizeSongRecommendationResponse(items)).toEqual(items);
    expect(normalizeSongRecommendationResponse(null)).toEqual([]);
  });

  it("filters songs already in the current service", () => {
    const existing = getExistingServiceSongIds([
      { songId: "song-1" },
      { song: { id: "song-3" } },
    ]);
    const filtered = filterExistingSongRecommendations(
      [
        { id: "song-1", title: "Uno" },
        { id: "song-2", title: "Dos" },
        { id: "song-3", title: "Tres" },
      ],
      existing,
    );

    expect(filtered.map((song) => song.id)).toEqual(["song-2"]);
  });

  it("builds short display badges from recommendation metadata", () => {
    expect(getSongRecommendationBadges({ recommendationBadges: ["Favorita descansada", "No usada hace 8 semanas"] })).toEqual([
      "Favorita descansada",
      "No usada hace 8 semanas",
    ]);
    expect(getSongRecommendationBadges({ recommendationReason: "Favorita descansada · No usada hace 8 semanas · Usada 12 veces" })).toEqual([
      "Favorita descansada",
      "No usada hace 8 semanas",
      "Usada 12 veces",
    ]);
    expect(getSongRecommendationBadges({ recommendationBucket: "new_rotation", useCount: 0 })).toEqual(["Nueva en rotación"]);
    expect(getSongRecommendationBadges({})).toEqual([]);
  });
});
