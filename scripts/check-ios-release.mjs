import { readFile } from "node:fs/promises";

const EXPECTED_MARKETING_VERSION = "4.0.11";
const EXPECTED_BUILD_NUMBER = "210";
const projectPaths = [
  "ios/App/App.xcodeproj/project.pbxproj",
  "ios/App/Tchurch.xcodeproj/project.pbxproj",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function valuesFor(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
assert(packageJson.version === EXPECTED_MARKETING_VERSION, `package.json must remain ${EXPECTED_MARKETING_VERSION}.`);
assert(packageLock.version === EXPECTED_MARKETING_VERSION, `package-lock.json must remain ${EXPECTED_MARKETING_VERSION}.`);
assert(packageLock.packages?.[""]?.version === EXPECTED_MARKETING_VERSION, `package-lock root must remain ${EXPECTED_MARKETING_VERSION}.`);

for (const projectPath of projectPaths) {
  const source = await readFile(projectPath, "utf8");
  const buildNumbers = valuesFor(source, /CURRENT_PROJECT_VERSION = ([^;]+);/g);
  const marketingVersions = valuesFor(source, /MARKETING_VERSION = ([^;]+);/g);
  assert(buildNumbers.length === 2, `${projectPath} must define exactly two build numbers.`);
  assert(buildNumbers.every((value) => value === EXPECTED_BUILD_NUMBER), `${projectPath} must use build ${EXPECTED_BUILD_NUMBER}.`);
  assert(marketingVersions.length === 2, `${projectPath} must define exactly two marketing versions.`);
  assert(marketingVersions.every((value) => value === EXPECTED_MARKETING_VERSION), `${projectPath} must use marketing version ${EXPECTED_MARKETING_VERSION}.`);
}

const workflow = await readFile(".github/workflows/ios-appstore-agent.yml", "utf8");
assert(valuesFor(workflow, /ASC_TARGET_BUILD_NUMBER:\s*"([^"]+)"/g).join(",") === EXPECTED_BUILD_NUMBER, "App Store workflow build pin is inconsistent.");
assert(valuesFor(workflow, /ASC_TARGET_MARKETING_VERSION:\s*"([^"]+)"/g).join(",") === EXPECTED_MARKETING_VERSION, "App Store workflow marketing pin is inconsistent.");

const postClone = await readFile("ios/App/ci_scripts/ci_post_clone.sh", "utf8");
assert(
  postClone.includes('BUILD_NUMBER="${CI_BUILD_NUMBER:-${XCODE_CLOUD_BUILD_NUMBER:-}}"'),
  "ci_post_clone.sh must continue reading Xcode Cloud's CI_BUILD_NUMBER.",
);

console.log(`iOS release is consistent: ${EXPECTED_MARKETING_VERSION} (${EXPECTED_BUILD_NUMBER}).`);
console.log(`Xcode Cloud must run with CI_BUILD_NUMBER=${EXPECTED_BUILD_NUMBER}.`);
