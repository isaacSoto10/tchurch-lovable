import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const clerkDist = join(root, "node_modules", "@clerk", "clerk-js", "dist");
const outDir = join(root, "dist");

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const runtimeFiles = readdirSync(clerkDist).filter(
  (file) => /_clerk\.browser_[^/]+_6\.\d+\.\d+\.js$/.test(file) || file === "clerk.browser.js",
);

for (const file of runtimeFiles) {
  copyFileSync(join(clerkDist, file), join(outDir, file));
}

console.log(`Copied ${runtimeFiles.length} Clerk browser runtime files.`);
