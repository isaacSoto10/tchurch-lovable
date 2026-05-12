import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const clerkDistDir = join(process.cwd(), "node_modules", "@clerk", "clerk-js", "dist");
const appDistDir = join(process.cwd(), "dist");

if (!existsSync(clerkDistDir)) {
  throw new Error(`Clerk JS dist directory not found: ${clerkDistDir}`);
}

if (!existsSync(appDistDir)) {
  mkdirSync(appDistDir, { recursive: true });
}

const clerkHeadlessAssets = readdirSync(clerkDistDir).filter((fileName) =>
  /(^clerk\.headless\.js$|_clerk\.headless_[^/]+\.js$)/.test(fileName),
);

for (const fileName of clerkHeadlessAssets) {
  copyFileSync(join(clerkDistDir, fileName), join(appDistDir, basename(fileName)));
}

console.log(`Copied ${clerkHeadlessAssets.length} Clerk native asset(s) to dist.`);
