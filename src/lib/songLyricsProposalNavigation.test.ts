import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("song lyrics proposal navigation", () => {
  it("registers the static inbox route before the dynamic song detail route", () => {
    const app = readFileSync(`${process.cwd()}/src/App.tsx`, "utf8");
    expect(app.indexOf('path="songs/proposals"')).toBeGreaterThanOrEqual(0);
    expect(app.indexOf('path="songs/proposals"')).toBeLessThan(app.indexOf('path="songs/:id"'));
  });

  it("preloads the inbox before the generic /songs/* detail matcher", () => {
    const preloaders = readFileSync(`${process.cwd()}/src/lib/appRoutePreloaders.ts`, "utf8");
    expect(preloaders.indexOf('path === "/app/songs/proposals"')).toBeGreaterThanOrEqual(0);
    expect(preloaders.indexOf('path === "/app/songs/proposals"')).toBeLessThan(preloaders.indexOf('path.startsWith("/app/songs/")'));
  });
});
