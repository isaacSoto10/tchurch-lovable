import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const clerkPackageJson = require.resolve("@clerk/clerk-js/package.json");
const clerkDist = join(dirname(clerkPackageJson), "dist");
const appDist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

if (!existsSync(appDist)) {
  throw new Error("dist folder does not exist. Run Vite before copying Clerk native assets.");
}

mkdirSync(appDist, { recursive: true });

const files = readdirSync(clerkDist).filter((file) => {
  return file === "clerk.headless.browser.js" || /_clerk\.headless\.browser_.*\.js$/.test(file);
});

for (const file of files) {
  copyFileSync(join(clerkDist, file), join(appDist, file));
}

console.log(`Copied ${files.length} Clerk native auth assets into dist.`);
