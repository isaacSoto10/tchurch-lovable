export const PRODUCTION_API_BASE = "https://www.tchurchapp.com/api";

const ACCEPTED_API_BASES = new Set([
  PRODUCTION_API_BASE,
  "https://www.tchurchapp.com/api/",
  "https://tchurchapp.com/api",
  "https://tchurchapp.com/api/",
]);

export class ApiBaseConfigurationError extends Error {
  constructor() {
    super(
      "VITE_API_URL must be the Tchurch production API (https://www.tchurchapp.com/api) or its apex alias; other hosts, schemes, paths, credentials, queries, and fragments are not allowed.",
    );
    this.name = "ApiBaseConfigurationError";
  }
}

/**
 * Resolves the only API origins the mobile/web client is allowed to use.
 *
 * The resolver is intentionally pure so configuration can be tested without
 * mutating Vite's environment or making a network request.
 */
export function resolveApiBaseUrl(configuredApiBase?: string | null): string {
  if (configuredApiBase === undefined || configuredApiBase === null || configuredApiBase === "") {
    return PRODUCTION_API_BASE;
  }

  if (!ACCEPTED_API_BASES.has(configuredApiBase)) {
    throw new ApiBaseConfigurationError();
  }

  return PRODUCTION_API_BASE;
}

export const API_BASE = resolveApiBaseUrl(import.meta.env.VITE_API_URL);
