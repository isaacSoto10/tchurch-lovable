#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const API_ROOT = "https://api.appstoreconnect.apple.com/v1";

const EDITABLE_OR_REPLACEABLE_STATES = new Set([
  "DEVELOPER_REJECTED",
  "INVALID_BINARY",
  "METADATA_REJECTED",
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
  "REJECTED",
  "WAITING_FOR_REVIEW",
]);

const REVIEW_LOCKED_STATES = new Set([
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_APP_STORE",
  "READY_FOR_DISTRIBUTION",
]);

const DEFAULT_FIELDS = {
  build:
    "version,uploadedDate,expired,processingState,usesNonExemptEncryption,preReleaseVersion,appStoreVersion,betaAppReviewSubmission",
  preReleaseVersion: "version,platform",
  appStoreVersion:
    "versionString,appStoreState,appVersionState,platform,build,appStoreVersionSubmission",
  appStoreVersionSubmission: "appStoreVersion",
  betaAppReviewSubmission: "betaReviewState,submittedDate,build",
};

function arg(name) {
  const flag = `--${name}`;
  const match = process.argv.find((value) => value === flag || value.startsWith(`${flag}=`));
  if (!match) return undefined;
  if (match === flag) return "true";
  return match.slice(flag.length + 1);
}

function env(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

function bool(name, fallback = false) {
  const value = arg(kebab(name)) ?? env(name);
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function kebab(value) {
  return value.toLowerCase().replace(/^asc_/, "").replaceAll("_", "-");
}

function required(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadPrivateKey() {
  const inline = env("ASC_PRIVATE_KEY");
  const path = env("ASC_PRIVATE_KEY_PATH");
  if (!inline && !path) {
    throw new Error("Missing ASC_PRIVATE_KEY or ASC_PRIVATE_KEY_PATH.");
  }
  const raw = inline ?? readFileSync(path, "utf8");
  return raw.replaceAll("\\n", "\n");
}

function base64url(value) {
  let normalized;
  if (value instanceof ArrayBuffer) {
    normalized = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    normalized = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (typeof value === "string" || Buffer.isBuffer(value)) {
    normalized = value;
  } else {
    normalized = JSON.stringify(value);
  }
  return Buffer.from(normalized)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function privateKeyDer(privateKey) {
  return Buffer.from(privateKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
}

let signingKey;

async function getSigningKey(privateKey) {
  signingKey ??= await webcrypto.subtle.importKey(
    "pkcs8",
    privateKeyDer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return signingKey;
}

async function createJwt({ keyId, issuerId, privateKey }) {
  const header = { kid: keyId, typ: "JWT", alg: "ES256" };
  const payload = {
    aud: "appstoreconnect-v1",
    iss: issuerId,
    exp: Date.now() / 1000 + 5 * 60,
  };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const key = await getSigningKey(privateKey);
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(encoded),
  );
  return `${encoded}.${base64url(signature)}`;
}

const config = {
  appId: required("ASC_APP_ID"),
  keyId: required("ASC_KEY_ID"),
  issuerId: required("ASC_ISSUER_ID"),
  privateKey: loadPrivateKey(),
  platform: env("ASC_PLATFORM", "IOS"),
  buildLookback: Number(env("ASC_BUILD_LOOKBACK", "20")),
  dryRun: bool("ASC_DRY_RUN", false),
  replaceInReview: bool("ASC_REPLACE_IN_REVIEW", true),
  submitForReview: bool("ASC_SUBMIT_FOR_REVIEW", true),
  betaReview: bool("ASC_BETA_REVIEW", true),
  expireSupersededBetaBuild: bool("ASC_EXPIRE_SUPERSEDED_BETA_BUILD", true),
  targetMarketingVersion: env("ASC_TARGET_MARKETING_VERSION", "").trim(),
  targetBuildNumber: env("ASC_TARGET_BUILD_NUMBER", "").trim(),
  force: bool("ASC_FORCE", false),
};

let token = await createJwt(config);

async function refreshToken() {
  token = await createJwt(config);
}

function params(input) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  return search.toString();
}

async function request(method, path, body = undefined, options = {}) {
  const url = path.startsWith("http") ? path : `${API_ROOT}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !options.retried) {
    await refreshToken();
    return request(method, path, body, { ...options, retried: true });
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(formatApiError(method, url, response.status, payload));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function formatApiError(method, url, status, payload) {
  const first = payload?.errors?.[0];
  const detail = first
    ? `${first.code ?? first.title ?? "API_ERROR"}: ${first.detail ?? first.title}`
    : "Unknown App Store Connect API error";
  return `${method} ${url} failed with ${status}. ${detail}`;
}

function includeIndex(payload) {
  const index = new Map();
  for (const item of payload?.included ?? []) {
    index.set(`${item.type}:${item.id}`, item);
  }
  return index;
}

function relationship(resource, name) {
  return resource?.relationships?.[name]?.data ?? null;
}

function relationshipId(resource, name) {
  return relationship(resource, name)?.id ?? null;
}

function shortBuild(build, included = new Map()) {
  const preReleaseId = relationshipId(build, "preReleaseVersion");
  const preRelease = preReleaseId
    ? included.get(`preReleaseVersions:${preReleaseId}`)
    : null;
  return {
    id: build.id,
    buildNumber: build.attributes?.version,
    uploadedDate: build.attributes?.uploadedDate,
    expired: build.attributes?.expired,
    processingState: build.attributes?.processingState,
    marketingVersion: preRelease?.attributes?.version ?? null,
    preReleaseId,
    appStoreVersionId: relationshipId(build, "appStoreVersion"),
    betaReviewId: relationshipId(build, "betaAppReviewSubmission"),
  };
}

function numericBuildNumber(build) {
  const value = Number(build?.buildNumber);
  return Number.isFinite(value) ? value : null;
}

function compareBuildsForRelease(a, b) {
  const aNumber = numericBuildNumber(a);
  const bNumber = numericBuildNumber(b);

  if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
    return bNumber - aNumber;
  }

  return String(b.uploadedDate ?? "").localeCompare(String(a.uploadedDate ?? ""));
}

async function getLatestValidBuild() {
  const query = params({
    "filter[app]": config.appId,
    "filter[expired]": "false",
    "filter[processingState]": "VALID",
    sort: "-uploadedDate",
    limit: config.buildLookback,
    include: "preReleaseVersion,appStoreVersion,betaAppReviewSubmission",
    "fields[builds]": DEFAULT_FIELDS.build,
    "fields[preReleaseVersions]": DEFAULT_FIELDS.preReleaseVersion,
    "fields[appStoreVersions]": DEFAULT_FIELDS.appStoreVersion,
    "fields[betaAppReviewSubmissions]": DEFAULT_FIELDS.betaAppReviewSubmission,
  });
  const payload = await request("GET", `/builds?${query}`);
  const included = includeIndex(payload);
  const candidates = (payload.data ?? [])
    .map((candidate) => ({ raw: candidate, ...shortBuild(candidate, included) }))
    .filter((summary) => {
      return (
        summary.processingState === "VALID" &&
        summary.expired === false &&
        summary.marketingVersion &&
        (!config.targetMarketingVersion ||
          summary.marketingVersion === config.targetMarketingVersion) &&
        (!config.targetBuildNumber || summary.buildNumber === config.targetBuildNumber)
      );
    })
    .sort(compareBuildsForRelease);

  const build = candidates[0];

  if (!build) return null;
  return build;
}

async function getVersionByString(versionString) {
  const query = params({
    "filter[platform]": config.platform,
    "filter[versionString]": versionString,
    include: "build,appStoreVersionSubmission",
    "fields[appStoreVersions]": DEFAULT_FIELDS.appStoreVersion,
    "fields[builds]": DEFAULT_FIELDS.build,
    "fields[appStoreVersionSubmissions]": DEFAULT_FIELDS.appStoreVersionSubmission,
  });
  const payload = await request(
    "GET",
    `/apps/${config.appId}/appStoreVersions?${query}`,
  );
  const version = payload.data?.[0] ?? null;
  return version ? { raw: version, included: includeIndex(payload) } : null;
}

async function createVersion(versionString) {
  const body = {
    data: {
      type: "appStoreVersions",
      attributes: {
        platform: config.platform,
        versionString,
      },
      relationships: {
        app: {
          data: {
            type: "apps",
            id: config.appId,
          },
        },
      },
    },
  };

  if (config.dryRun) {
    log(`DRY RUN: would create App Store version ${versionString}.`);
    return null;
  }

  const payload = await request("POST", "/appStoreVersions", body);
  return { raw: payload.data, included: includeIndex(payload) };
}

async function deleteSubmission(submissionId) {
  if (config.dryRun) {
    log(`DRY RUN: would delete review submission ${submissionId}.`);
    return;
  }

  await request("DELETE", `/appStoreVersionSubmissions/${submissionId}`);
  await wait(5000);
}

async function setVersionBuild(versionId, buildId) {
  if (config.dryRun) {
    log(`DRY RUN: would attach build ${buildId} to App Store version ${versionId}.`);
    return;
  }

  await request("PATCH", `/appStoreVersions/${versionId}/relationships/build`, {
    data: {
      type: "builds",
      id: buildId,
    },
  });
}

async function submitForReview(versionId) {
  if (!config.submitForReview) {
    log("ASC_SUBMIT_FOR_REVIEW=false; leaving version ready for manual review.");
    return;
  }

  if (config.dryRun) {
    log(`DRY RUN: would attempt App Store review submission for ${versionId}.`);
    return;
  }

  try {
    await request("POST", "/appStoreVersionSubmissions", {
      data: {
        type: "appStoreVersionSubmissions",
        relationships: {
          appStoreVersion: {
            data: {
              type: "appStoreVersions",
              id: versionId,
            },
          },
        },
      },
    });
    log("App Store review submission created through the public API.");
  } catch (error) {
    if (error.status === 403) {
      log(
        "App Store Connect did not allow public-API final submission. The version is attached to the latest build; submit the ready draft in the App Store Connect UI if this account keeps CREATE disabled.",
      );
      return;
    }
    throw error;
  }
}

async function ensureAppStoreDeployment(build) {
  let version = await getVersionByString(build.marketingVersion);

  if (!version) {
    log(`No App Store version exists for ${build.marketingVersion}.`);
    version = await createVersion(build.marketingVersion);
    if (!version) {
      return {
        state: "dry-run",
        versionId: null,
      };
    }
  }

  const versionId = version.raw.id;
  const state =
    version.raw.attributes?.appStoreState ?? version.raw.attributes?.appVersionState;
  const assignedBuildId = relationshipId(version.raw, "build");
  const submissionId = relationshipId(version.raw, "appStoreVersionSubmission");

  if (assignedBuildId === build.id && !config.force) {
    log(
      `No-op: App Store version ${build.marketingVersion} already points to build ${build.buildNumber}.`,
    );
    return { state: "already-current", versionId };
  }

  if (REVIEW_LOCKED_STATES.has(state)) {
    throw new Error(
      `App Store version ${build.marketingVersion} is locked in state ${state}; not replacing build ${assignedBuildId ?? "(none)"}.`,
    );
  }

  if (!EDITABLE_OR_REPLACEABLE_STATES.has(state)) {
    log(`Version state is ${state}; attempting build assignment cautiously.`);
  }

  if (submissionId && assignedBuildId !== build.id) {
    if (!config.replaceInReview) {
      throw new Error(
        `Version ${build.marketingVersion} is already submitted with build ${assignedBuildId}. Set ASC_REPLACE_IN_REVIEW=true to replace it.`,
      );
    }
    log(
      `Deleting existing review submission ${submissionId} so build ${build.buildNumber} can replace ${assignedBuildId}.`,
    );
    await deleteSubmission(submissionId);
  }

  log(`Attaching build ${build.buildNumber} to App Store version ${build.marketingVersion}.`);
  await setVersionBuild(versionId, build.id);
  await submitForReview(versionId);
  return { state: "updated", versionId };
}

async function getBetaSubmissionForBuild(buildId) {
  const query = params({
    "filter[build]": buildId,
    include: "build",
    "fields[betaAppReviewSubmissions]": DEFAULT_FIELDS.betaAppReviewSubmission,
    "fields[builds]": DEFAULT_FIELDS.build,
  });
  const payload = await request("GET", `/betaAppReviewSubmissions?${query}`);
  return payload.data?.[0] ?? null;
}

async function expireBuild(buildId) {
  if (config.dryRun) {
    log(`DRY RUN: would expire superseded beta build ${buildId}.`);
    return;
  }

  await request("PATCH", `/builds/${buildId}`, {
    data: {
      type: "builds",
      id: buildId,
      attributes: {
        expired: true,
      },
    },
  });
}

async function expireSupersededBetaBuilds(latestBuild) {
  if (!latestBuild.preReleaseId) return 0;

  const query = params({
    "filter[preReleaseVersion]": latestBuild.preReleaseId,
    "filter[expired]": "false",
    include: "betaAppReviewSubmission",
    sort: "-uploadedDate",
    limit: config.buildLookback,
    "fields[builds]": DEFAULT_FIELDS.build,
    "fields[betaAppReviewSubmissions]": DEFAULT_FIELDS.betaAppReviewSubmission,
  });
  const payload = await request("GET", `/builds?${query}`);
  const included = includeIndex(payload);
  let expiredCount = 0;

  for (const candidate of payload.data ?? []) {
    if (candidate.id === latestBuild.id) continue;
    const betaReviewId = relationshipId(candidate, "betaAppReviewSubmission");
    if (!betaReviewId) continue;

    const betaReview = included.get(`betaAppReviewSubmissions:${betaReviewId}`);
    const betaState = betaReview?.attributes?.betaReviewState;
    if (betaState !== "WAITING_FOR_REVIEW") continue;

    const summary = shortBuild(candidate, included);
    log(
      `Expiring superseded beta build ${summary.buildNumber} (${candidate.id}) to unblock ${latestBuild.buildNumber}.`,
    );
    await expireBuild(candidate.id);
    expiredCount += 1;
  }

  return expiredCount;
}

async function submitBetaReview(build) {
  if (!config.betaReview) {
    log("ASC_BETA_REVIEW=false; skipping beta review automation.");
    return;
  }

  const existing = await getBetaSubmissionForBuild(build.id);
  if (existing) {
    log(
      `No-op: beta review for build ${build.buildNumber} is already ${existing.attributes?.betaReviewState}.`,
    );
    return;
  }

  if (config.dryRun) {
    log(`DRY RUN: would submit build ${build.buildNumber} for beta review.`);
    return;
  }

  try {
    await createBetaReviewSubmission(build.id);
    log(`Submitted build ${build.buildNumber} for beta review.`);
  } catch (error) {
    const code = error.payload?.errors?.[0]?.code;
    if (
      code === "ENTITY_UNPROCESSABLE.ANOTHER_BUILD_IN_REVIEW" &&
      config.expireSupersededBetaBuild
    ) {
      const expiredCount = await expireSupersededBetaBuilds(build);
      if (expiredCount > 0) {
        await createBetaReviewSubmission(build.id);
        log(`Submitted build ${build.buildNumber} for beta review after expiring ${expiredCount} superseded build(s).`);
        return;
      }
    }
    throw error;
  }
}

async function createBetaReviewSubmission(buildId) {
  await request("POST", "/betaAppReviewSubmissions", {
    data: {
      type: "betaAppReviewSubmissions",
      relationships: {
        build: {
          data: {
            type: "builds",
            id: buildId,
          },
        },
      },
    },
  });
}

function log(message) {
  console.log(`[ios-appstore-agent] ${message}`);
}

async function main() {
  log(
    `Starting. dryRun=${config.dryRun}; platform=${config.platform}; app=${config.appId}; targetVersion=${config.targetMarketingVersion || "latest"}; targetBuild=${config.targetBuildNumber || "latest"}.`,
  );
  const latestBuild = await getLatestValidBuild();

  if (!latestBuild) {
    log(
      config.targetMarketingVersion
        ? `No valid, unexpired iOS build found for ${config.targetMarketingVersion}. Nothing to deploy.`
        : "No valid, unexpired iOS build found. Nothing to deploy.",
    );
    return;
  }

  log(
    `Latest valid build: ${latestBuild.marketingVersion} (${latestBuild.buildNumber}), uploaded ${latestBuild.uploadedDate}.`,
  );

  const appStoreResult = await ensureAppStoreDeployment(latestBuild);
  await submitBetaReview(latestBuild);

  log(
    `Done. appStoreResult=${appStoreResult.state}; versionId=${appStoreResult.versionId ?? "none"}; build=${latestBuild.buildNumber}.`,
  );
}

main().catch((error) => {
  console.error(`[ios-appstore-agent] ${error.message}`);
  process.exitCode = 1;
});
