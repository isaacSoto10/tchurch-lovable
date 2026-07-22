import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sermon theme", () => {
  it("keeps the sermon canvas white with dark readable text", () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, "utf8");
    const canvasRule = css.match(/\.sermons-canvas\s*\{([\s\S]*?)\}/)?.[1] || "";

    expect(canvasRule).toContain("background: #ffffff");
    expect(canvasRule).toContain("color: #18181b");
    expect(canvasRule).not.toContain("background: #0b0a10");
  });
});
