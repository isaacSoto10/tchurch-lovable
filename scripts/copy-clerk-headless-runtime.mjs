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
  (file) => /_clerk\.headless_[^/]+_5\.\d+\.\d+\.js$/.test(file) || file === "clerk.headless.js",
);

for (const file of runtimeFiles) {
  copyFileSync(join(clerkDist, file), join(outDir, file));
}

console.log(`Copied ${runtimeFiles.length} Clerk headless runtime files.`);
