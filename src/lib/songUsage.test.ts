import { describe, expect, it } from "vitest";
import { formatSongLastUsedLabel, sortSongsByDateAddedDesc, sortSongsByLastUsedDesc } from "./songUsage";

describe("song usage helpers", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");

  it("formats last-used labels for today, days, weeks, and never used", () => {
    expect(formatSongLastUsedLabel("2026-06-10T12:00:00.000Z", now)).toBe("Última vez hoy");
    expect(formatSongLastUsedLabel("2026-06-09T12:00:00.000Z", now)).toBe("Última vez ayer");
    expect(formatSongLastUsedLabel("2026-06-07T12:00:00.000Z", now)).toBe("Última vez hace 3 días");
    expect(formatSongLastUsedLabel("2026-05-27T12:00:00.000Z", now)).toBe("Última vez hace 2 semanas");
    expect(formatSongLastUsedLabel(null, now)).toBe("Nunca usada");
  });

  it("sorts recently used songs before older and never-used songs", () => {
    const sorted = sortSongsByLastUsedDesc([
      { title: "Nunca", lastUsedAt: null },
      { title: "Antigua", lastUsedAt: "2026-04-01T00:00:00.000Z" },
      { title: "Reciente", lastUsedAt: "2026-06-01T00:00:00.000Z" },
    ]);

    expect(sorted.map((song) => song.title)).toEqual(["Reciente", "Antigua", "Nunca"]);
  });

  it("sorts newly added songs before older and undated songs", () => {
    const sorted = sortSongsByDateAddedDesc([
      { title: "Sin fecha", createdAt: null },
      { title: "Antigua", createdAt: "2026-04-01T00:00:00.000Z" },
      { title: "Nueva", createdAt: "2026-06-01T00:00:00.000Z" },
      { title: "Alfa", createdAt: "bad-date" },
      { title: "Beta", createdAt: "bad-date" },
    ]);

    expect(sorted.map((song) => song.title)).toEqual(["Nueva", "Antigua", "Alfa", "Beta", "Sin fecha"]);
  });
});
