import { apiFetch } from "@/lib/api";
import {
  PRESENTATION_OUTPUT_SCHEMA_VERSION,
  normalizePresentationLayouts,
  normalizePresentationOutputConfig,
  normalizePresentationOutputLinkCreated,
  normalizePresentationOutputLinks,
  normalizePresentationStageLayout,
  normalizePresentationResolvedScripture,
  normalizePresentationTheme,
  normalizePresentationThemePreset,
  normalizePresentationThemes,
  type PresentationLayoutsResponse,
  type PresentationOutputConfig,
  type PresentationOutputLink,
  type PresentationOutputLinkCreatedResponse,
  type PresentationOutputLinksResponse,
  type PresentationResolvedTheme,
  type PresentationRoleMap,
  type PresentationStageLayout,
  type PresentationStageLayoutDefinition,
  type PresentationStageRole,
  type PresentationThemeOverrides,
  type PresentationThemePreset,
  type PresentationThemesResponse,
  type PresentationResolvedScripture,
} from "@/lib/presentationOutput";

export type PresentationOutputConfigUpdate = {
  schemaVersion: 3;
  expectedVersion: number;
  activeThemeId: string | null;
  themeOverrides: PresentationThemeOverrides | null;
  roleLayoutIds: Partial<PresentationRoleMap<string | null>>;
};

export type PresentationThemeMutationResponse = {
  schemaVersion: 3;
  theme: PresentationThemePreset;
  defaultThemeId: string | null;
};

export type PresentationLayoutMutationResponse = {
  schemaVersion: 3;
  layout: PresentationStageLayout;
  defaultLayoutIds: PresentationRoleMap<string | null>;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleIdMap(value: unknown): PresentationRoleMap<string | null> {
  const raw = recordValue(value);
  return {
    worship_leader: nullableId(raw?.worship_leader),
    musicians: nullableId(raw?.musicians),
    preacher: nullableId(raw?.preacher),
    production: nullableId(raw?.production),
  };
}

function normalizeThemeMutation(value: unknown): PresentationThemeMutationResponse {
  const raw = recordValue(value);
  const theme = normalizePresentationThemePreset(raw?.theme);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !theme) throw new Error("El servidor devolvió un tema inválido.");
  return { schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, theme, defaultThemeId: nullableId(raw.defaultThemeId) };
}

function normalizeLayoutMutation(value: unknown): PresentationLayoutMutationResponse {
  const raw = recordValue(value);
  const layout = normalizePresentationStageLayout(raw?.layout);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !layout) throw new Error("El servidor devolvió una vista de escenario inválida.");
  return { schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, layout, defaultLayoutIds: roleIdMap(raw.defaultLayoutIds) };
}

export async function fetchPresentationOutputConfig(serviceId: string): Promise<PresentationOutputConfig> {
  const value = await apiFetch(`/services/${encodeURIComponent(serviceId)}/presentation-output-config`, { cache: "no-store" });
  return normalizePresentationOutputConfig(value);
}

export async function updatePresentationOutputConfig(serviceId: string, input: Omit<PresentationOutputConfigUpdate, "schemaVersion">) {
  const value = await apiFetch(`/services/${encodeURIComponent(serviceId)}/presentation-output-config`, {
    method: "PUT",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, ...input } satisfies PresentationOutputConfigUpdate),
  });
  return normalizePresentationOutputConfig(value);
}

export async function fetchPresentationThemes(): Promise<PresentationThemesResponse> {
  return normalizePresentationThemes(await apiFetch("/presentation-themes", { cache: "no-store" }));
}

export async function createPresentationTheme(input: { name: string; isDefault: boolean; theme: PresentationResolvedTheme }) {
  const value = await apiFetch("/presentation-themes", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, name: input.name, isDefault: input.isDefault, theme: normalizePresentationTheme(input.theme) }),
  });
  return normalizeThemeMutation(value);
}

export async function updatePresentationTheme(themeId: string, input: { expectedVersion: number; name: string; isDefault: boolean; theme: PresentationResolvedTheme }) {
  const value = await apiFetch(`/presentation-themes/${encodeURIComponent(themeId)}`, {
    method: "PUT",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, ...input, theme: normalizePresentationTheme(input.theme) }),
  });
  return normalizeThemeMutation(value);
}

export async function deletePresentationTheme(themeId: string, expectedVersion: number) {
  return apiFetch(`/presentation-themes/${encodeURIComponent(themeId)}`, {
    method: "DELETE",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, expectedVersion }),
  });
}

export async function fetchPresentationLayouts(): Promise<PresentationLayoutsResponse> {
  return normalizePresentationLayouts(await apiFetch("/presentation-layouts", { cache: "no-store" }));
}

export async function createPresentationLayout(input: { name: string; targetRole: PresentationStageRole; isDefault: boolean; layout: Pick<PresentationStageLayoutDefinition, "mode" | "fontScale" | "show"> }) {
  const value = await apiFetch("/presentation-layouts", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, ...input }),
  });
  return normalizeLayoutMutation(value);
}

export async function updatePresentationLayout(layoutId: string, input: { expectedVersion: number; name: string; targetRole: PresentationStageRole; isDefault: boolean; layout: Pick<PresentationStageLayoutDefinition, "mode" | "fontScale" | "show"> }) {
  const value = await apiFetch(`/presentation-layouts/${encodeURIComponent(layoutId)}`, {
    method: "PUT",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, ...input }),
  });
  return normalizeLayoutMutation(value);
}

export async function deletePresentationLayout(layoutId: string, expectedVersion: number) {
  return apiFetch(`/presentation-layouts/${encodeURIComponent(layoutId)}`, {
    method: "DELETE",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, expectedVersion }),
  });
}

export async function fetchPresentationOutputLinks(serviceId: string): Promise<PresentationOutputLinksResponse> {
  const value = await apiFetch(`/services/${encodeURIComponent(serviceId)}/presentation-links`, { cache: "no-store" });
  return normalizePresentationOutputLinks(value);
}

export async function createPresentationOutputLink(serviceId: string, input: { label: string; ttlHours?: number }): Promise<PresentationOutputLinkCreatedResponse> {
  const value = await apiFetch(`/services/${encodeURIComponent(serviceId)}/presentation-links`, {
    method: "POST",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, label: input.label, ...(input.ttlHours === undefined ? {} : { ttlHours: input.ttlHours }) }),
  });
  return normalizePresentationOutputLinkCreated(value);
}

export async function revokePresentationOutputLink(serviceId: string, linkId: string): Promise<PresentationOutputLink> {
  const value = await apiFetch(`/services/${encodeURIComponent(serviceId)}/presentation-links`, {
    method: "DELETE",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, linkId }),
  });
  const raw = recordValue(value);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION) throw new Error("El servidor devolvió una respuesta de revocación inválida.");
  const normalized = normalizePresentationOutputLinks({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, links: [raw.link] });
  const link = normalized.links[0];
  if (!link) throw new Error("El servidor devolvió un enlace revocado inválido.");
  return link;
}

export async function resolvePresentationScripture(input: {
  reference: string;
  passageUsfm?: string | null;
  bibleId?: string | null;
  language?: string | null;
  manualText?: string | null;
  versionName?: string | null;
  versionAbbreviation?: string | null;
  copyright?: string | null;
  promotionalContent?: string | null;
}): Promise<PresentationResolvedScripture> {
  const value = await apiFetch("/presentation-scripture/resolve", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, ...input }),
  });
  const raw = recordValue(value);
  const passage = normalizePresentationResolvedScripture(raw?.passage);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !passage) throw new Error("El servidor no devolvió un pasaje bíblico válido.");
  return passage;
}
