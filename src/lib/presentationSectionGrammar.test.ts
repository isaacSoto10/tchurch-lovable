import { describe, expect, it } from "vitest";
import { derivePresentationSections } from "./presentationWorkspace";

describe("presentation section grammar", () => {
  it("matches backend ChordPro environments, comments, and explicit ordinals", () => {
    const sections = derivePresentationSections("item-1", "arr-1", [
      "{c: Band in quietly}",
      "{sov}",
      "[G]Primera estrofa",
      "{eov}",
      "{soc}",
      "[C]Coro",
      "{eoc}",
      "{start_of_section: Pre-Coro 2}",
      "[Am]Antes del coro",
      "{end_of_section}",
      "{start_of_bridge: label=\"Bridge 2\"}",
      "[F]Segundo puente",
      "{end_of_bridge}",
    ].join("\n"));

    expect(sections.map((section) => [section.semanticKey, section.ordinal])).toEqual([
      ["verse", 1],
      ["chorus", 1],
      ["pre_chorus", 2],
      ["bridge", 2],
    ]);
    expect(sections.some((section) => section.preview.includes("Band in"))).toBe(false);
  });
});
