import type { PresentationTargetRole } from "@/lib/presentationWorkspace";

export const PRESENTATION_OUTPUT_SCHEMA_VERSION = 3 as const;

export type PresentationOutputFont = "sans" | "serif" | "condensed" | "rounded";
export type PresentationOutputFontWeight = 400 | 500 | 600 | 700 | 800;
export type PresentationOutputPlacement = "center" | "lower_third";
export type PresentationOutputLogoPosition = "none" | "top_left" | "top_right" | "bottom_left" | "bottom_right";
export type PresentationOutputCopyrightPosition = "bottom_left" | "bottom_center" | "bottom_right";
export type PresentationStageRole = "worship_leader" | "musicians" | "preacher" | "production";
export type PresentationStageMode = "confidence" | "lyrics" | "speaker" | "production";
export type PresentationPlaybackStatus = "idle" | "playing" | "paused" | "ended";
export type PresentationAudienceSessionStatus = "idle" | "live" | "ended";

export type PresentationResolvedTheme = {
  fontFamily: PresentationOutputFont;
  fontWeight: PresentationOutputFontWeight;
  textColor: string;
  accentColor: string;
  background: {
    type: "color" | "image";
    color: string;
    imageUrl: string | null;
    overlayColor: string;
    overlayOpacity: number;
  };
  placement: PresentationOutputPlacement;
  logo: {
    url: string | null;
    position: PresentationOutputLogoPosition;
  };
  copyright: {
    visible: boolean;
    position: PresentationOutputCopyrightPosition;
  };
};

export const DEFAULT_PRESENTATION_THEME: PresentationResolvedTheme = {
  fontFamily: "sans",
  fontWeight: 700,
  textColor: "#f8fafc",
  accentColor: "#f4c95d",
  background: {
    type: "color",
    color: "#090b10",
    imageUrl: null,
    overlayColor: "#05070a",
    overlayOpacity: 0.48,
  },
  placement: "center",
  logo: { url: null, position: "none" },
  copyright: { visible: true, position: "bottom_right" },
};

export type PresentationResolvedScripture = {
  source: "youversion" | "manual";
  reference: string;
  passageUsfm: string | null;
  version: {
    id: string | null;
    name: string;
    abbreviation: string;
    language: string;
  };
  verses: Array<{ number: string; text: string }>;
  copyright: string;
  promotionalContent: string | null;
};

export type PresentationAudienceSlideBase = {
  id: string;
  itemId: string;
  itemIndex: number;
  title: string;
  durationSeconds: number | null;
};

export type PresentationAudienceSlide =
  | (PresentationAudienceSlideBase & {
      kind: "lyrics";
      sectionLabel: string | null;
      lines: string[];
      part: number;
      totalParts: number;
      copyright: { text: string; ccliNumber: string | null } | null;
    })
  | (PresentationAudienceSlideBase & {
      kind: "scripture";
      passage: PresentationResolvedScripture;
      part: number;
      totalParts: number;
    })
  | (PresentationAudienceSlideBase & {
      kind: "image";
      src: string;
      alt: string;
      fit: "contain" | "cover";
    })
  | (PresentationAudienceSlideBase & {
      kind: "video";
      src: string;
      posterSrc: string | null;
      muted: boolean;
      autoplay: boolean;
      loop: boolean;
      durationMs: number | null;
    })
  | (PresentationAudienceSlideBase & {
      kind: "audio";
      src: string;
      artist: string | null;
      autoplay: boolean;
      loop: boolean;
      durationMs: number | null;
    })
  | (PresentationAudienceSlideBase & {
      kind: "countdown";
      label: string;
      durationSeconds: number;
    })
  | (PresentationAudienceSlideBase & {
      kind: "sermon";
      subtitle: string | null;
      speaker: string | null;
      body: string[];
      mediaSrc: string | null;
      mediaType: "image" | null;
    })
  | (PresentationAudienceSlideBase & {
      kind: "announcement";
      body: string[];
      mediaSrc: string | null;
      mediaType: "image" | null;
      durationSeconds: number;
      loop: boolean;
    })
  | (PresentationAudienceSlideBase & {
      kind: "blank";
      tone: "black" | "transparent";
    });

export type PresentationItemContent =
  | {
      kind: "scripture";
      reference: string;
      passageUsfm: string | null;
      bibleId: string | null;
      language: string | null;
      manualText: string | null;
      versionName: string | null;
      versionAbbreviation: string | null;
      copyright: string | null;
      promotionalContent: string | null;
      resolvedPassage: PresentationResolvedScripture | null;
    }
  | { kind: "image"; src: string; alt: string; fit: "contain" | "cover" }
  | { kind: "video"; src: string; posterSrc: string | null; mimeType: string | null; muted: boolean; autoplay: boolean; loop: boolean; durationMs: number | null }
  | { kind: "audio"; src: string; artist: string | null; mimeType: string | null; autoplay: boolean; loop: boolean; durationMs: number | null }
  | { kind: "countdown"; label: string; durationSeconds: number }
  | { kind: "sermon"; subtitle: string | null; speaker: string | null; body: string[]; mediaSrc: string | null; mediaMimeType: string | null }
  | { kind: "announcement"; body: string[]; mediaSrc: string | null; mediaMimeType: string | null; durationSeconds: number; loop: boolean }
  | { kind: "blank"; tone: "black" | "transparent" };

export type PresentationAudiencePackage = {
  schemaVersion: 3;
  packageId: string;
  generatedAt: string;
  serviceVersion: string;
  contentVersion: string;
  service: {
    id: string;
    title: string;
    date: string;
  };
  theme: PresentationResolvedTheme;
  slides: PresentationAudienceSlide[];
  checksum: string;
};

export type PresentationMediaPlayback = {
  itemId: string;
  slideId: string;
  kind: "video" | "audio" | "announcement";
  status: PresentationPlaybackStatus;
  positionMs: number;
  startedAt: string | null;
  rate: 1;
  loop: boolean;
};

export type PresentationCountdownState = {
  durationSeconds: number;
  targetAt: string;
};

export type PresentationAudienceSnapshot = {
  schemaVersion: 3;
  serviceId: string;
  sessionId: string | null;
  status: PresentationAudienceSessionStatus;
  revision: number;
  cursor: {
    itemId: string | null;
    itemIndex: number;
    stepId: string | null;
    stepIndex: number;
    sectionAnchorId: string | null;
    partIndex: number;
    slideId: string | null;
  };
  display: { blackout: boolean };
  playback: PresentationMediaPlayback | null;
  countdown: PresentationCountdownState | null;
};

export type PresentationAudienceEnvelope = {
  schemaVersion: 3;
  serverNow: string;
  package: PresentationAudiencePackage | null;
  snapshot: PresentationAudienceSnapshot;
};

export type PresentationStageLayoutDefinition = {
  id: string;
  name: string;
  targetRole: PresentationStageRole;
  mode: PresentationStageMode;
  fontScale: number;
  show: {
    current: boolean;
    next: boolean;
    notes: boolean;
    chords: boolean;
    clock: boolean;
    serviceTimer: boolean;
    itemTimer: boolean;
    messages: boolean;
  };
  isDefault: boolean;
  version: number;
};

export type PresentationStageLayout = PresentationStageLayoutDefinition & {
  churchId: string;
  createdAt: string;
  updatedAt: string;
};

export type PresentationThemePreset = PresentationResolvedTheme & {
  id: string;
  churchId: string;
  name: string;
  version: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PresentationRoleMap<T> = Record<PresentationStageRole, T>;

export type PresentationThemeOverrides = Partial<Pick<PresentationResolvedTheme,
  "fontFamily" | "fontWeight" | "textColor" | "accentColor" | "placement"
>> & {
  background?: Partial<PresentationResolvedTheme["background"]>;
  logo?: Partial<PresentationResolvedTheme["logo"]>;
  copyright?: Partial<PresentationResolvedTheme["copyright"]>;
};

export type PresentationOutputConfig = {
  schemaVersion: 3;
  serviceId: string;
  version: number;
  activeThemeId: string | null;
  themeOverrides: PresentationThemeOverrides | null;
  roleLayoutIds: PresentationRoleMap<string | null>;
  themes: PresentationThemePreset[];
  roleLayouts: PresentationStageLayout[];
  resolvedTheme: PresentationResolvedTheme;
  resolvedRoleLayouts: PresentationRoleMap<PresentationStageLayout>;
};

export type PresentationOutputLink = {
  id: string;
  serviceId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type PresentationOutputLinksResponse = {
  schemaVersion: 3;
  links: PresentationOutputLink[];
};

export type PresentationOutputLinkCreatedResponse = {
  schemaVersion: 3;
  link: PresentationOutputLink;
  /** One-time secret-bearing fragment URL. Never persist or log this value. */
  shareUrl: string;
};

export type PresentationThemesResponse = {
  schemaVersion: 3;
  churchId: string;
  themes: PresentationThemePreset[];
  defaultThemeId: string | null;
};

export type PresentationLayoutsResponse = {
  schemaVersion: 3;
  churchId: string;
  layouts: PresentationStageLayout[];
  defaultLayoutIds: PresentationRoleMap<string | null>;
};

export const DEFAULT_PRESENTATION_STAGE_LAYOUTS: PresentationRoleMap<PresentationStageLayoutDefinition> = {
  worship_leader: {
    id: "default-worship-leader",
    name: "Worship leader",
    targetRole: "worship_leader",
    mode: "confidence",
    fontScale: 1.08,
    show: { current: true, next: true, notes: true, chords: true, clock: true, serviceTimer: true, itemTimer: true, messages: true },
    isDefault: true,
    version: 1,
  },
  musicians: {
    id: "default-musicians",
    name: "Musicians",
    targetRole: "musicians",
    mode: "lyrics",
    fontScale: 1,
    show: { current: true, next: true, notes: true, chords: true, clock: false, serviceTimer: false, itemTimer: true, messages: true },
    isDefault: true,
    version: 1,
  },
  preacher: {
    id: "default-preacher",
    name: "Preacher",
    targetRole: "preacher",
    mode: "speaker",
    fontScale: 1.16,
    show: { current: true, next: true, notes: true, chords: false, clock: true, serviceTimer: true, itemTimer: true, messages: true },
    isDefault: true,
    version: 1,
  },
  production: {
    id: "default-production",
    name: "Production",
    targetRole: "production",
    mode: "production",
    fontScale: 0.92,
    show: { current: true, next: true, notes: true, chords: false, clock: true, serviceTimer: true, itemTimer: true, messages: true },
    isDefault: true,
    version: 1,
  },
};

const OUTPUT_FONTS = new Set<PresentationOutputFont>(["sans", "serif", "condensed", "rounded"]);
const OUTPUT_FONT_WEIGHTS = new Set<PresentationOutputFontWeight>([400, 500, 600, 700, 800]);
const OUTPUT_PLACEMENTS = new Set<PresentationOutputPlacement>(["center", "lower_third"]);
const LOGO_POSITIONS = new Set<PresentationOutputLogoPosition>(["none", "top_left", "top_right", "bottom_left", "bottom_right"]);
const COPYRIGHT_POSITIONS = new Set<PresentationOutputCopyrightPosition>(["bottom_left", "bottom_center", "bottom_right"]);
const SLIDE_KINDS = new Set<PresentationAudienceSlide["kind"]>(["lyrics", "scripture", "image", "video", "audio", "countdown", "sermon", "announcement", "blank"]);
const STAGE_ROLES = new Set<PresentationStageRole>(["worship_leader", "musicians", "preacher", "production"]);
const STAGE_MODES = new Set<PresentationStageMode>(["confidence", "lyrics", "speaker", "production"]);
const PLAYBACK_STATUSES = new Set<PresentationPlaybackStatus>(["idle", "playing", "paused", "ended"]);
const AUDIENCE_SESSION_STATUSES = new Set<PresentationAudienceSessionStatus>(["idle", "live", "ended"]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function assertOnlyKeys(raw: Record<string, unknown>, allowed: readonly string[], label: string) {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(raw).find((key) => !allowedKeys.has(key));
  if (unexpected) throw new Error(`La salida pública contiene un campo no permitido en ${label}: ${unexpected}.`);
  const missing = allowed.find((key) => !Object.prototype.hasOwnProperty.call(raw, key));
  if (missing) throw new Error(`La salida pública no incluye el campo obligatorio ${label}.${missing}.`);
}

function stringValue(value: unknown, maxLength = 4_000): string | null {
  if (typeof value !== "string") return null;
  const normalized = [...value.trim()].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function requiredString(value: unknown, label: string, maxLength = 4_000) {
  const normalized = stringValue(value, maxLength);
  if (!normalized) throw new Error(`La salida de audiencia no incluye ${label}.`);
  return normalized;
}

function integerValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? Math.max(0, parsed) : fallback;
}

function canonicalNonNegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function canonicalNullableString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return stringValue(value, maxLength) || undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function isoValue(value: unknown, required = false) {
  const text = stringValue(value, 40);
  const canonicalIso = Boolean(text && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text));
  if (!text || !canonicalIso || !Number.isFinite(Date.parse(text))) {
    if (required) throw new Error("La salida de audiencia contiene una fecha inválida.");
    return null;
  }
  return new Date(text).toISOString();
}

function colorValue(value: unknown, fallback: string) {
  const color = stringValue(value, 7);
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function hexRgb(value: string) {
  const normalized = value.slice(1, 7);
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
}

function relativeLuminance(value: string) {
  const channels = hexRgb(value).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function presentationColorContrast(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const brightest = Math.max(foregroundLuminance, backgroundLuminance);
  const darkest = Math.min(foregroundLuminance, backgroundLuminance);
  return (brightest + 0.05) / (darkest + 0.05);
}

export function safePresentationAssetUrl(value: unknown, kind: "image" | "media" = "image") {
  const raw = stringValue(value, 2_048);
  if (!raw) return null;
  void kind;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizePresentationTheme(value: unknown): PresentationResolvedTheme {
  const raw = recordValue(value);
  const background = recordValue(raw?.background);
  const logo = recordValue(raw?.logo);
  const copyright = recordValue(raw?.copyright);
  const fontFamily = stringValue(raw?.fontFamily, 32) as PresentationOutputFont | null;
  const placement = stringValue(raw?.placement, 24) as PresentationOutputPlacement | null;
  const logoPosition = stringValue(logo?.position, 24) as PresentationOutputLogoPosition | null;
  const copyrightPosition = stringValue(copyright?.position, 24) as PresentationOutputCopyrightPosition | null;
  const backgroundColor = colorValue(background?.color, DEFAULT_PRESENTATION_THEME.background.color);
  const textColor = colorValue(raw?.textColor, DEFAULT_PRESENTATION_THEME.textColor);
  const imageUrl = safePresentationAssetUrl(background?.imageUrl);
  const backgroundType = background?.type === "image" && imageUrl ? "image" : "color";
  const requestedWeight = typeof raw?.fontWeight === "number" ? raw.fontWeight as PresentationOutputFontWeight : null;

  return {
    fontFamily: fontFamily && OUTPUT_FONTS.has(fontFamily) ? fontFamily : DEFAULT_PRESENTATION_THEME.fontFamily,
    fontWeight: requestedWeight && OUTPUT_FONT_WEIGHTS.has(requestedWeight) ? requestedWeight : DEFAULT_PRESENTATION_THEME.fontWeight,
    textColor,
    accentColor: colorValue(raw?.accentColor, DEFAULT_PRESENTATION_THEME.accentColor),
    background: {
      type: backgroundType,
      color: backgroundColor,
      imageUrl: backgroundType === "image" ? imageUrl : null,
      overlayColor: colorValue(background?.overlayColor, DEFAULT_PRESENTATION_THEME.background.overlayColor),
      overlayOpacity: boundedNumber(background?.overlayOpacity, DEFAULT_PRESENTATION_THEME.background.overlayOpacity, 0, 1),
    },
    placement: placement && OUTPUT_PLACEMENTS.has(placement) ? placement : DEFAULT_PRESENTATION_THEME.placement,
    logo: {
      url: safePresentationAssetUrl(logo?.url),
      position: logoPosition && LOGO_POSITIONS.has(logoPosition) ? logoPosition : DEFAULT_PRESENTATION_THEME.logo.position,
    },
    copyright: {
      visible: copyright?.visible !== false,
      position: copyrightPosition && COPYRIGHT_POSITIONS.has(copyrightPosition) ? copyrightPosition : DEFAULT_PRESENTATION_THEME.copyright.position,
    },
  };
}

function assertCanonicalAudienceTheme(value: unknown) {
  const raw = recordValue(value);
  const background = recordValue(raw?.background);
  const logo = recordValue(raw?.logo);
  const copyright = recordValue(raw?.copyright);
  if (!raw || !background || !logo || !copyright) throw new Error("La salida pública contiene un tema inválido.");
  assertOnlyKeys(raw, ["fontFamily", "fontWeight", "textColor", "accentColor", "background", "placement", "logo", "copyright"], "theme");
  assertOnlyKeys(background, ["type", "color", "imageUrl", "overlayColor", "overlayOpacity"], "theme.background");
  assertOnlyKeys(logo, ["url", "position"], "theme.logo");
  assertOnlyKeys(copyright, ["visible", "position"], "theme.copyright");
  const fontFamily = raw.fontFamily as PresentationOutputFont;
  const fontWeight = raw.fontWeight as PresentationOutputFontWeight;
  const placement = raw.placement as PresentationOutputPlacement;
  const logoPosition = logo.position as PresentationOutputLogoPosition;
  const copyrightPosition = copyright.position as PresentationOutputCopyrightPosition;
  const backgroundImageUrl = background.imageUrl === null ? null : safePresentationAssetUrl(background.imageUrl);
  const logoUrl = logo.url === null ? null : safePresentationAssetUrl(logo.url);
  if (
    !OUTPUT_FONTS.has(fontFamily) || !OUTPUT_FONT_WEIGHTS.has(fontWeight) || !OUTPUT_PLACEMENTS.has(placement) ||
    !LOGO_POSITIONS.has(logoPosition) || !COPYRIGHT_POSITIONS.has(copyrightPosition) ||
    typeof raw.textColor !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.textColor) ||
    typeof raw.accentColor !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.accentColor) ||
    (background.type !== "color" && background.type !== "image") ||
    typeof background.color !== "string" || !/^#[0-9a-f]{6}$/i.test(background.color) ||
    typeof background.overlayColor !== "string" || !/^#[0-9a-f]{6}$/i.test(background.overlayColor) ||
    typeof background.overlayOpacity !== "number" || !Number.isFinite(background.overlayOpacity) || background.overlayOpacity < 0 || background.overlayOpacity > 1 ||
    (background.imageUrl !== null && !backgroundImageUrl) || (background.type === "image" && !backgroundImageUrl) ||
    (logo.url !== null && !logoUrl) || typeof copyright.visible !== "boolean"
  ) throw new Error("La salida pública contiene un tema inválido.");
}

const CHORD_TOKEN = /\[(?:[A-G](?:#|b)?(?:(?:maj|min|dim|aug|sus|add|m)?\d*)?(?:\/[A-G](?:#|b)?)?|N\.?C\.?)\]/gi;
const CHORDPRO_DIRECTIVE = /\{(?:title|artist|key|tempo|time|comment|c|start_of_[^}:]+|end_of_[^}:]+|so[a-z]+|eo[a-z]+)(?::[^}]*)?\}/gi;

export function sanitizeAudienceLyricLine(value: unknown) {
  const line = stringValue(value, 600);
  if (!line) return null;
  const sanitized = line.replace(CHORD_TOKEN, "").replace(CHORDPRO_DIRECTIVE, "").replace(/\s{2,}/g, " ").trim();
  return sanitized || null;
}

export function normalizePresentationResolvedScripture(value: unknown, strict = false): PresentationResolvedScripture | null {
  const raw = recordValue(value);
  const version = recordValue(raw?.version);
  const source = raw?.source === "youversion" ? "youversion" : raw?.source === "manual" ? "manual" : null;
  const reference = stringValue(raw?.reference, 160);
  const passageUsfm = stringValue(raw?.passageUsfm, 120);
  const versionId = stringValue(version?.id, 80);
  const versionName = stringValue(version?.name, 120);
  const abbreviation = stringValue(version?.abbreviation, 40);
  const language = stringValue(version?.language, 40);
  const verses = Array.isArray(raw?.verses)
    ? raw.verses.flatMap((candidate) => {
        const verse = recordValue(candidate);
        const number = stringValue(verse?.number, 16);
        const text = stringValue(verse?.text, 1_200);
        return number && text ? [{ number, text }] : [];
      }).slice(0, 80)
    : [];
  if (strict) {
    if (!raw || !version) return null;
    assertOnlyKeys(raw, ["source", "reference", "passageUsfm", "version", "verses", "copyright", "promotionalContent"], "slide.passage");
    assertOnlyKeys(version, ["id", "name", "abbreviation", "language"], "slide.passage.version");
    if (Array.isArray(raw.verses)) {
      raw.verses.forEach((candidate, index) => {
        const verse = recordValue(candidate);
        if (verse) assertOnlyKeys(verse, ["number", "text"], `slide.passage.verses[${index}]`);
      });
    }
    const passageUsfmValue = canonicalNullableString(raw?.passageUsfm, 120);
    const versionIdValue = canonicalNullableString(version?.id, 80);
    const promotionalContentValue = canonicalNullableString(raw?.promotionalContent, 500);
    const versesAreCanonical = Array.isArray(raw?.verses) && raw.verses.length > 0 && raw.verses.every((candidate) => {
      const verse = recordValue(candidate);
      return Boolean(verse && typeof verse.number === "string" && stringValue(verse.number, 16) && typeof verse.text === "string" && stringValue(verse.text, 1_200));
    });
    if (
      passageUsfmValue === undefined || versionIdValue === undefined || promotionalContentValue === undefined ||
      typeof raw?.copyright !== "string" || !versesAreCanonical
    ) return null;
  }
  if (!source || !reference || !versionName || !abbreviation || !language || !verses.length) return null;
  return {
    source,
    reference,
    passageUsfm,
    version: { id: versionId, name: versionName, abbreviation, language },
    verses,
    copyright: stringValue(raw?.copyright, 1_000) || "",
    promotionalContent: stringValue(raw?.promotionalContent, 500),
  };
}

const PRESENTATION_MIME_TYPES = {
  image: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  video: new Set(["video/mp4", "video/webm"]),
  audio: new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg"]),
};

function normalizePresentationMime(value: unknown, kind: keyof typeof PRESENTATION_MIME_TYPES) {
  const mime = stringValue(value, 100)?.toLowerCase().split(";", 1)[0].trim() || null;
  return mime && PRESENTATION_MIME_TYPES[kind].has(mime) ? mime : null;
}

function normalizeItemTextLines(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n+/) : [];
  return source.map((line) => stringValue(line, 500)).filter((line): line is string => Boolean(line)).slice(0, 24);
}

export function normalizePresentationItemContent(value: unknown): PresentationItemContent | null {
  const raw = recordValue(value);
  const kind = stringValue(raw?.kind, 24);
  if (!raw || !kind || kind === "lyrics") return null;

  if (kind === "scripture") {
    const reference = stringValue(raw.reference, 160);
    if (!reference) return null;
    return {
      kind,
      reference,
      passageUsfm: stringValue(raw.passageUsfm, 160),
      bibleId: stringValue(raw.bibleId, 120),
      language: stringValue(raw.language, 20),
      manualText: stringValue(raw.manualText, 20_000),
      versionName: stringValue(raw.versionName, 160),
      versionAbbreviation: stringValue(raw.versionAbbreviation, 40),
      copyright: stringValue(raw.copyright, 1_000),
      promotionalContent: stringValue(raw.promotionalContent, 2_000),
      resolvedPassage: normalizePresentationResolvedScripture(raw.resolvedPassage),
    };
  }

  if (kind === "image") {
    const src = safePresentationAssetUrl(raw.src);
    const alt = stringValue(raw.alt, 240);
    if (!src || !alt) return null;
    return { kind, src, alt, fit: raw.fit === "contain" ? "contain" : "cover" };
  }

  if (kind === "video") {
    const src = safePresentationAssetUrl(raw.src, "media");
    if (!src || typeof raw.muted !== "boolean" || typeof raw.autoplay !== "boolean" || typeof raw.loop !== "boolean") return null;
    const mimeType = normalizePresentationMime(raw.mimeType, "video");
    if (raw.mimeType !== null && raw.mimeType !== undefined && !mimeType) return null;
    const durationMs = raw.durationMs === null || raw.durationMs === undefined ? null : raw.durationMs;
    if (durationMs !== null && (!Number.isInteger(durationMs) || Number(durationMs) < 1 || Number(durationMs) > 86_400_000)) return null;
    return {
      kind,
      src,
      posterSrc: safePresentationAssetUrl(raw.posterSrc),
      mimeType,
      muted: raw.muted !== false,
      autoplay: raw.autoplay !== false,
      loop: raw.loop === true,
      durationMs: durationMs === null ? null : Number(durationMs),
    };
  }

  if (kind === "audio") {
    const src = safePresentationAssetUrl(raw.src, "media");
    if (!src || typeof raw.autoplay !== "boolean" || typeof raw.loop !== "boolean") return null;
    const mimeType = normalizePresentationMime(raw.mimeType, "audio");
    if (raw.mimeType !== null && raw.mimeType !== undefined && !mimeType) return null;
    const durationMs = raw.durationMs === null || raw.durationMs === undefined ? null : raw.durationMs;
    if (durationMs !== null && (!Number.isInteger(durationMs) || Number(durationMs) < 1 || Number(durationMs) > 86_400_000)) return null;
    return {
      kind,
      src,
      artist: stringValue(raw.artist, 160),
      mimeType,
      autoplay: raw.autoplay !== false,
      loop: raw.loop === true,
      durationMs: durationMs === null ? null : Number(durationMs),
    };
  }

  if (kind === "countdown") {
    const durationSeconds = raw.durationSeconds;
    const label = stringValue(raw.label, 120);
    if (!Number.isInteger(durationSeconds) || Number(durationSeconds) < 5 || Number(durationSeconds) > 86_400 || !label) return null;
    return { kind, label, durationSeconds: Number(durationSeconds) };
  }

  if (kind === "sermon") {
    const body = normalizeItemTextLines(raw.body);
    if (!body.length) return null;
    const mediaSrc = safePresentationAssetUrl(raw.mediaSrc);
    const mediaMimeType = normalizePresentationMime(raw.mediaMimeType, "image");
    if ((mediaSrc && !mediaMimeType) || (!mediaSrc && mediaMimeType)) return null;
    return { kind, subtitle: stringValue(raw.subtitle, 240), speaker: stringValue(raw.speaker, 160), body, mediaSrc, mediaMimeType };
  }

  if (kind === "announcement") {
    const body = normalizeItemTextLines(raw.body);
    if (!body.length) return null;
    const durationSeconds = raw.durationSeconds;
    const mediaSrc = safePresentationAssetUrl(raw.mediaSrc);
    const mediaMimeType = normalizePresentationMime(raw.mediaMimeType, "image");
    if (!Number.isInteger(durationSeconds) || Number(durationSeconds) < 3 || Number(durationSeconds) > 3_600 || typeof raw.loop !== "boolean" || (mediaSrc && !mediaMimeType) || (!mediaSrc && mediaMimeType)) return null;
    return { kind, body, mediaSrc, mediaMimeType, durationSeconds: Number(durationSeconds), loop: raw.loop };
  }

  if (kind === "blank") return { kind, tone: raw.tone === "transparent" ? "transparent" : "black" };
  return null;
}

function normalizeBaseSlide(raw: Record<string, unknown>): PresentationAudienceSlideBase | null {
  const id = stringValue(raw.id, 500);
  const itemId = stringValue(raw.itemId, 200);
  const itemIndex = canonicalNonNegativeInteger(raw.itemIndex);
  const durationSeconds = raw.durationSeconds === null ? null : canonicalNonNegativeInteger(raw.durationSeconds, 86_400);
  if (!id || !itemId || itemIndex === null || (raw.durationSeconds !== null && durationSeconds === null)) return null;
  return {
    id,
    itemId,
    itemIndex,
    title: requiredString(raw.title, "slide.title", 500),
    durationSeconds,
  };
}

function normalizeBody(value: unknown, limit = 24) {
  return Array.isArray(value)
    ? value.map((line) => stringValue(line, 800)).filter((line): line is string => Boolean(line)).slice(0, limit)
    : [];
}

function normalizeAudienceSlide(value: unknown): PresentationAudienceSlide | null {
  const raw = recordValue(value);
  const kind = stringValue(raw?.kind, 24) as PresentationAudienceSlide["kind"] | null;
  if (!raw || !kind || !SLIDE_KINDS.has(kind)) return null;
  const baseKeys = ["id", "itemId", "itemIndex", "kind", "title", "durationSeconds"];
  const kindKeys: Record<PresentationAudienceSlide["kind"], string[]> = {
    lyrics: ["sectionLabel", "lines", "part", "totalParts", "copyright"],
    scripture: ["passage", "part", "totalParts"],
    image: ["src", "alt", "fit"],
    video: ["src", "posterSrc", "muted", "autoplay", "loop", "durationMs"],
    audio: ["src", "artist", "autoplay", "loop", "durationMs"],
    countdown: ["label"],
    sermon: ["subtitle", "speaker", "body", "mediaSrc", "mediaType"],
    announcement: ["body", "mediaSrc", "mediaType", "loop"],
    blank: ["tone"],
  };
  assertOnlyKeys(raw, [...baseKeys, ...kindKeys[kind]], `slide.${kind}`);
  const base = normalizeBaseSlide(raw);
  if (!base) return null;

  if (kind === "lyrics") {
    const copyright = recordValue(raw.copyright);
    if (!Array.isArray(raw.lines) || raw.lines.some((line) => typeof line !== "string")) return null;
    const lines = Array.isArray(raw.lines)
      ? raw.lines.map(sanitizeAudienceLyricLine).filter((line): line is string => Boolean(line)).slice(0, 24)
      : [];
    if (!lines.length) return null;
    const part = canonicalNonNegativeInteger(raw.part);
    const totalParts = canonicalNonNegativeInteger(raw.totalParts);
    const sectionLabel = canonicalNullableString(raw.sectionLabel, 100);
    if (!part || !totalParts || part > totalParts || sectionLabel === undefined) return null;
    if (raw.copyright !== null) {
      const ccliNumber = canonicalNullableString(copyright?.ccliNumber, 80);
      if (!copyright || typeof copyright.text !== "string" || !stringValue(copyright.text, 240) || ccliNumber === undefined) return null;
      assertOnlyKeys(copyright, ["text", "ccliNumber"], "slide.lyrics.copyright");
    }
    return {
      ...base,
      kind,
      sectionLabel,
      lines,
      part,
      totalParts,
      copyright: copyright && stringValue(copyright.text, 240)
        ? { text: stringValue(copyright.text, 240)!, ccliNumber: stringValue(copyright.ccliNumber, 80) }
        : null,
    };
  }

  if (kind === "scripture") {
    const passage = normalizePresentationResolvedScripture(raw.passage, true);
    if (!passage) return null;
    const part = canonicalNonNegativeInteger(raw.part);
    const totalParts = canonicalNonNegativeInteger(raw.totalParts);
    if (!part || !totalParts || part > totalParts) return null;
    return { ...base, kind, passage, part, totalParts };
  }

  if (kind === "image") {
    const src = safePresentationAssetUrl(raw.src);
    const alt = stringValue(raw.alt, 240);
    if (!src || !alt || (raw.fit !== "contain" && raw.fit !== "cover")) return null;
    return { ...base, kind, src, alt, fit: raw.fit };
  }

  if (kind === "video") {
    const src = safePresentationAssetUrl(raw.src, "media");
    const posterSrc = safePresentationAssetUrl(raw.posterSrc);
    const durationMs = raw.durationMs;
    if (!src || typeof raw.muted !== "boolean" || typeof raw.autoplay !== "boolean" || typeof raw.loop !== "boolean" || (raw.posterSrc !== null && !posterSrc) || (durationMs !== null && (!Number.isInteger(durationMs) || Number(durationMs) < 1 || Number(durationMs) > 86_400_000))) return null;
    return {
      ...base,
      kind,
      src,
      posterSrc,
      muted: raw.muted,
      autoplay: raw.autoplay,
      loop: raw.loop,
      durationMs: durationMs === null ? null : Number(durationMs),
    };
  }

  if (kind === "audio") {
    const src = safePresentationAssetUrl(raw.src, "media");
    const durationMs = raw.durationMs;
    const artist = canonicalNullableString(raw.artist, 160);
    if (!src || artist === undefined || typeof raw.autoplay !== "boolean" || typeof raw.loop !== "boolean" || (durationMs !== null && (!Number.isInteger(durationMs) || Number(durationMs) < 1 || Number(durationMs) > 86_400_000))) return null;
    return { ...base, kind, src, artist, autoplay: raw.autoplay, loop: raw.loop, durationMs: durationMs === null ? null : Number(durationMs) };
  }

  if (kind === "countdown") {
    const durationSeconds = raw.durationSeconds;
    const label = stringValue(raw.label, 120);
    if (!Number.isInteger(durationSeconds) || Number(durationSeconds) < 5 || Number(durationSeconds) > 86_400 || !label) return null;
    return { ...base, kind, durationSeconds: Number(durationSeconds), label };
  }

  if (kind === "sermon") {
    const mediaSrc = safePresentationAssetUrl(raw.mediaSrc);
    const body = normalizeBody(raw.body);
    const subtitle = canonicalNullableString(raw.subtitle, 240);
    const speaker = canonicalNullableString(raw.speaker, 120);
    if (!Array.isArray(raw.body) || raw.body.some((line) => typeof line !== "string" || !stringValue(line, 800)) || !body.length || subtitle === undefined || speaker === undefined || (mediaSrc && raw.mediaType !== "image") || (!mediaSrc && (raw.mediaSrc !== null || raw.mediaType !== null))) return null;
    return {
      ...base,
      kind,
      subtitle,
      speaker,
      body,
      mediaSrc,
      mediaType: mediaSrc && raw.mediaType === "image" ? "image" : null,
    };
  }

  if (kind === "announcement") {
    const durationSeconds = raw.durationSeconds;
    const body = normalizeBody(raw.body);
    if (!Number.isInteger(durationSeconds) || Number(durationSeconds) < 3 || Number(durationSeconds) > 3_600 || !Array.isArray(raw.body) || raw.body.some((line) => typeof line !== "string" || !stringValue(line, 800)) || !body.length || typeof raw.loop !== "boolean") return null;
    const mediaSrc = safePresentationAssetUrl(raw.mediaSrc);
    if ((mediaSrc && raw.mediaType !== "image") || (!mediaSrc && (raw.mediaSrc !== null || raw.mediaType !== null))) return null;
    return { ...base, kind, body, mediaSrc, mediaType: mediaSrc ? "image" : null, durationSeconds: Number(durationSeconds), loop: raw.loop };
  }

  if (raw.tone !== "black" && raw.tone !== "transparent") return null;
  return { ...base, kind: "blank", tone: raw.tone };
}

function normalizeAudiencePackage(value: unknown): PresentationAudiencePackage | null {
  if (value === null || value === undefined) return null;
  const raw = recordValue(value);
  const service = recordValue(raw?.service);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !service) throw new Error("La salida de audiencia devolvió un paquete inválido.");
  assertOnlyKeys(raw, ["schemaVersion", "packageId", "generatedAt", "serviceVersion", "contentVersion", "service", "theme", "slides", "checksum"], "package");
  assertOnlyKeys(service, ["id", "title", "date"], "package.service");
  assertCanonicalAudienceTheme(raw.theme);
  if (!Array.isArray(raw.slides)) throw new Error("La salida de audiencia no incluye una lista de diapositivas válida.");
  const normalizedSlides = raw.slides.map(normalizeAudienceSlide);
  if (normalizedSlides.some((slide) => !slide)) {
    throw new Error("La salida de audiencia contiene una diapositiva inválida.");
  }
  const slides = normalizedSlides as PresentationAudienceSlide[];
  if (new Set(slides.map((slide) => slide.id)).size !== slides.length) {
    throw new Error("La salida de audiencia contiene identificadores de diapositiva duplicados.");
  }
  const generatedAt = isoValue(raw.generatedAt, true)!;
  const serviceVersion = isoValue(raw.serviceVersion, true)!;
  const date = isoValue(service.date, true)!;
  const packageId = requiredString(raw.packageId, "packageId", 160);
  const checksum = requiredString(raw.checksum, "checksum", 160);
  const contentVersion = requiredString(raw.contentVersion, "contentVersion", 160);
  if (!/^sha256:[0-9a-f]{64}$/.test(packageId) || !/^sha256:[0-9a-f]{64}$/.test(contentVersion) || checksum !== packageId) {
    throw new Error("La salida de audiencia contiene una firma de paquete inválida.");
  }
  return {
    schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION,
    packageId,
    generatedAt,
    serviceVersion,
    contentVersion,
    service: { id: requiredString(service.id, "service.id", 200), title: requiredString(service.title, "service.title", 500), date },
    theme: normalizePresentationTheme(raw.theme),
    slides,
    checksum,
  };
}

function normalizePlayback(value: unknown): PresentationMediaPlayback | null {
  if (value === null || value === undefined) return null;
  const raw = recordValue(value);
  if (raw) assertOnlyKeys(raw, ["itemId", "slideId", "kind", "status", "positionMs", "startedAt", "rate", "loop"], "snapshot.playback");
  const kind = stringValue(raw?.kind, 24);
  const status = stringValue(raw?.status, 24) as PresentationPlaybackStatus | null;
  const startedAt = raw?.startedAt === null ? null : isoValue(raw?.startedAt);
  if (!raw || (kind !== "video" && kind !== "audio" && kind !== "announcement") || !status || !PLAYBACK_STATUSES.has(status) || raw.rate !== 1 || typeof raw.loop !== "boolean" || canonicalNonNegativeInteger(raw.positionMs, 86_400_000) === null || (raw.startedAt !== null && !startedAt) || (status === "playing" && !startedAt)) {
    throw new Error("La salida de audiencia devolvió una reproducción inválida.");
  }
  return {
    itemId: requiredString(raw.itemId, "playback.itemId", 200),
    slideId: requiredString(raw.slideId, "playback.slideId", 500),
    kind,
    status,
    positionMs: Number(raw.positionMs),
    startedAt,
    rate: 1,
    loop: raw.loop,
  };
}

function normalizeCountdown(value: unknown): PresentationCountdownState | null {
  if (value === null || value === undefined) return null;
  const raw = recordValue(value);
  if (raw) assertOnlyKeys(raw, ["durationSeconds", "targetAt"], "snapshot.countdown");
  const durationSeconds = raw?.durationSeconds;
  const targetAt = isoValue(raw?.targetAt, true);
  if (!raw || !Number.isInteger(durationSeconds) || Number(durationSeconds) < 5 || Number(durationSeconds) > 86_400 || !targetAt) {
    throw new Error("La salida de audiencia devolvió una cuenta regresiva inválida.");
  }
  return { durationSeconds: Number(durationSeconds), targetAt };
}

function normalizeAudienceSnapshot(value: unknown): PresentationAudienceSnapshot {
  const raw = recordValue(value);
  const cursor = recordValue(raw?.cursor);
  const display = recordValue(raw?.display);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !cursor || !display) {
    throw new Error("La salida de audiencia devolvió un estado inválido.");
  }
  assertOnlyKeys(raw, ["schemaVersion", "serviceId", "sessionId", "status", "revision", "cursor", "display", "playback", "countdown"], "snapshot");
  assertOnlyKeys(cursor, ["itemId", "itemIndex", "stepId", "stepIndex", "sectionAnchorId", "partIndex", "slideId"], "snapshot.cursor");
  assertOnlyKeys(display, ["blackout"], "snapshot.display");
  const status = stringValue(raw.status, 16) as PresentationAudienceSessionStatus | null;
  if (!status || !AUDIENCE_SESSION_STATUSES.has(status)) {
    throw new Error("La salida de audiencia devolvió un ciclo de sesión inválido.");
  }
  const sessionId = canonicalNullableString(raw.sessionId, 200);
  const itemId = canonicalNullableString(cursor.itemId, 200);
  const stepId = canonicalNullableString(cursor.stepId, 200);
  const sectionAnchorId = canonicalNullableString(cursor.sectionAnchorId, 200);
  const slideId = canonicalNullableString(cursor.slideId, 500);
  const revision = canonicalNonNegativeInteger(raw.revision);
  const itemIndex = canonicalNonNegativeInteger(cursor.itemIndex, 100_000);
  const stepIndex = canonicalNonNegativeInteger(cursor.stepIndex, 100_000);
  const partIndex = canonicalNonNegativeInteger(cursor.partIndex, 10_000);
  if (
    sessionId === undefined || itemId === undefined || stepId === undefined || sectionAnchorId === undefined || slideId === undefined ||
    revision === null || itemIndex === null || stepIndex === null || partIndex === null || typeof display.blackout !== "boolean" ||
    (status === "idle") !== (sessionId === null)
  ) throw new Error("La salida de audiencia contiene cursores o controles inválidos.");
  return {
    schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION,
    serviceId: requiredString(raw.serviceId, "snapshot.serviceId", 200),
    sessionId,
    status,
    revision,
    cursor: {
      itemId,
      itemIndex,
      stepId,
      stepIndex,
      sectionAnchorId,
      partIndex,
      slideId,
    },
    display: { blackout: display.blackout },
    playback: normalizePlayback(raw.playback),
    countdown: normalizeCountdown(raw.countdown),
  };
}

export function normalizePresentationAudienceEnvelope(value: unknown): PresentationAudienceEnvelope {
  const raw = recordValue(value);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION) {
    throw new Error("La salida de audiencia devolvió una respuesta incompatible.");
  }
  assertOnlyKeys(raw, ["schemaVersion", "serverNow", "package", "snapshot"], "envelope");
  const serverNow = isoValue(raw.serverNow, true)!;
  const presentationPackage = normalizeAudiencePackage(raw.package);
  const snapshot = normalizeAudienceSnapshot(raw.snapshot);
  if (presentationPackage && presentationPackage.service.id !== snapshot.serviceId) {
    throw new Error("El paquete y la sesión de audiencia pertenecen a servicios distintos.");
  }
  if (presentationPackage && snapshot.cursor.slideId) {
    const cursorSlide = presentationPackage.slides.find((slide) => slide.id === snapshot.cursor.slideId);
    if (!cursorSlide || cursorSlide.itemId !== snapshot.cursor.itemId) {
      throw new Error("El cursor de audiencia no coincide con el paquete público.");
    }
  }
  if (presentationPackage && snapshot.playback) {
    const playbackSlide = presentationPackage.slides.find((slide) => slide.id === snapshot.playback?.slideId);
    if (!playbackSlide || playbackSlide.itemId !== snapshot.playback.itemId || playbackSlide.kind !== snapshot.playback.kind) {
      throw new Error("La reproducción de audiencia no coincide con el paquete público.");
    }
  }
  return { schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, serverNow, package: presentationPackage, snapshot };
}

export function resolvePresentationAudienceSlide(
  presentationPackage: PresentationAudiencePackage | null | undefined,
  snapshot: PresentationAudienceSnapshot | null | undefined,
) {
  if (!presentationPackage || snapshot?.status !== "live" || !snapshot.cursor.slideId) return null;
  return presentationPackage.slides.find((slide) => slide.id === snapshot.cursor.slideId && slide.itemId === snapshot.cursor.itemId) || null;
}

export function resolvePresentationAnnouncementSlide(
  presentationPackage: PresentationAudiencePackage | null | undefined,
  snapshot: PresentationAudienceSnapshot | null | undefined,
  serverNow: string,
  receivedAtMs: number,
  nowMs: number,
) {
  const fallback = resolvePresentationAudienceSlide(presentationPackage, snapshot);
  const playback = snapshot?.playback;
  if (
    !presentationPackage || !snapshot || snapshot.status !== "live" || !playback || playback.kind !== "announcement" ||
    (playback.status !== "playing" && playback.status !== "paused" && playback.status !== "ended") ||
    snapshot.cursor.itemId !== playback.itemId
  ) return fallback;
  const slideId = resolvePresentationAnnouncementSlideId(presentationPackage.slides, playback, serverNow, receivedAtMs, nowMs, snapshot.cursor.itemId);
  return slideId ? presentationPackage.slides.find((slide) => slide.id === slideId) || fallback : fallback;
}

export function resolvePresentationAnnouncementSlideId(
  sourceSlides: readonly PresentationAudienceSlide[],
  playback: PresentationMediaPlayback | null,
  serverNow: string,
  receivedAtMs: number,
  nowMs: number,
  cursorItemId?: string | null,
) {
  if (!playback || playback.kind !== "announcement" || (playback.status !== "playing" && playback.status !== "paused" && playback.status !== "ended")) return null;
  if (cursorItemId !== undefined && cursorItemId !== playback.itemId) return null;
  const slides = sourceSlides.filter((slide): slide is Extract<PresentationAudienceSlide, { kind: "announcement" }> => slide.kind === "announcement" && slide.itemId === playback.itemId);
  const startIndex = slides.findIndex((slide) => slide.id === playback.slideId);
  if (startIndex < 0 || !slides.length) return null;
  let remainingMs = projectPresentationPlaybackPosition(playback, serverNow, receivedAtMs, nowMs);
  if (playback.loop) {
    const cycleMs = slides.reduce((total, slide) => total + slide.durationSeconds * 1_000, 0);
    remainingMs %= Math.max(1, cycleMs);
  }
  let index = startIndex;
  while (true) {
    const durationMs = slides[index].durationSeconds * 1_000;
    if (remainingMs < durationMs) return slides[index].id;
    remainingMs -= durationMs;
    if (index === slides.length - 1) {
      if (!playback.loop) return slides[index].id;
      index = 0;
    } else {
      index += 1;
    }
  }
}

function normalizeStageLayoutDefinition(value: unknown): PresentationStageLayoutDefinition | null {
  const raw = recordValue(value);
  const show = recordValue(raw?.show);
  const targetRole = stringValue(raw?.targetRole, 32) as PresentationStageRole | null;
  const mode = stringValue(raw?.mode, 32) as PresentationStageMode | null;
  const id = stringValue(raw?.id, 160);
  const name = stringValue(raw?.name, 100);
  if (!raw || !show || !id || !name || !targetRole || !STAGE_ROLES.has(targetRole) || !mode || !STAGE_MODES.has(mode)) return null;
  return {
    id,
    name,
    targetRole,
    mode,
    fontScale: boundedNumber(raw.fontScale, 1, 0.7, 1.5),
    show: {
      current: show.current !== false,
      next: show.next !== false,
      notes: show.notes !== false,
      chords: show.chords !== false,
      clock: show.clock !== false,
      serviceTimer: show.serviceTimer !== false,
      itemTimer: show.itemTimer !== false,
      messages: show.messages !== false,
    },
    isDefault: raw.isDefault === true,
    version: integerValue(raw.version),
  };
}

export function normalizePresentationStageLayout(value: unknown): PresentationStageLayout | null {
  const raw = recordValue(value);
  const definition = normalizeStageLayoutDefinition(value);
  const churchId = stringValue(raw?.churchId, 160);
  const createdAt = isoValue(raw?.createdAt);
  const updatedAt = isoValue(raw?.updatedAt);
  if (!raw || !definition || !churchId || !createdAt || !updatedAt) return null;
  return {
    ...definition,
    churchId,
    createdAt,
    updatedAt,
  };
}

export function normalizePresentationThemePreset(value: unknown): PresentationThemePreset | null {
  const raw = recordValue(value);
  const id = stringValue(raw?.id, 160);
  const churchId = stringValue(raw?.churchId, 160);
  const name = stringValue(raw?.name, 100);
  const createdAt = isoValue(raw?.createdAt);
  const updatedAt = isoValue(raw?.updatedAt);
  if (!raw || !id || !churchId || !name || !createdAt || !updatedAt) return null;
  return {
    ...normalizePresentationTheme(raw),
    id,
    churchId,
    name,
    version: integerValue(raw.version),
    isDefault: raw.isDefault === true,
    createdAt,
    updatedAt,
  };
}

function normalizeRoleIdMap(value: unknown): PresentationRoleMap<string | null> {
  const raw = recordValue(value);
  return {
    worship_leader: stringValue(raw?.worship_leader, 160),
    musicians: stringValue(raw?.musicians, 160),
    preacher: stringValue(raw?.preacher, 160),
    production: stringValue(raw?.production, 160),
  };
}

function normalizeResolvedRoleLayouts(value: unknown): PresentationRoleMap<PresentationStageLayout> {
  const raw = recordValue(value);
  const result: Partial<PresentationRoleMap<PresentationStageLayout>> = {};
  for (const role of STAGE_ROLES) {
    const candidate = normalizePresentationStageLayout(raw?.[role]);
    if (!candidate || candidate.targetRole !== role) {
      throw new Error(`La configuración no incluye una vista válida para ${role}.`);
    }
    result[role] = candidate;
  }
  return result as PresentationRoleMap<PresentationStageLayout>;
}

function normalizeThemeOverrides(value: unknown): PresentationThemeOverrides {
  const raw = recordValue(value);
  if (!raw) return {};
  const overrides: PresentationThemeOverrides = {};
  const fontFamily = stringValue(raw.fontFamily, 32) as PresentationOutputFont | null;
  const placement = stringValue(raw.placement, 24) as PresentationOutputPlacement | null;
  if (fontFamily && OUTPUT_FONTS.has(fontFamily)) overrides.fontFamily = fontFamily;
  if (typeof raw.fontWeight === "number" && OUTPUT_FONT_WEIGHTS.has(raw.fontWeight as PresentationOutputFontWeight)) {
    overrides.fontWeight = raw.fontWeight as PresentationOutputFontWeight;
  }
  const textColor = stringValue(raw.textColor, 9);
  const accentColor = stringValue(raw.accentColor, 9);
  if (textColor && /^#[0-9a-f]{6}$/i.test(textColor)) overrides.textColor = textColor.toLowerCase();
  if (accentColor && /^#[0-9a-f]{6}$/i.test(accentColor)) overrides.accentColor = accentColor.toLowerCase();
  if (placement && OUTPUT_PLACEMENTS.has(placement)) overrides.placement = placement;

  const background = recordValue(raw.background);
  if (background) {
    const next: NonNullable<PresentationThemeOverrides["background"]> = {};
    if (background.type === "color" || background.type === "image") next.type = background.type;
    const color = stringValue(background.color, 9);
    const overlayColor = stringValue(background.overlayColor, 9);
    if (color && /^#[0-9a-f]{6}$/i.test(color)) next.color = color.toLowerCase();
    if (overlayColor && /^#[0-9a-f]{6}$/i.test(overlayColor)) next.overlayColor = overlayColor.toLowerCase();
    if (background.imageUrl !== undefined) next.imageUrl = safePresentationAssetUrl(background.imageUrl);
    if (background.overlayOpacity !== undefined) next.overlayOpacity = boundedNumber(background.overlayOpacity, 0.48, 0, 1);
    if (Object.keys(next).length) overrides.background = next;
  }

  const logo = recordValue(raw.logo);
  if (logo) {
    const next: NonNullable<PresentationThemeOverrides["logo"]> = {};
    if (logo.url !== undefined) next.url = safePresentationAssetUrl(logo.url);
    const position = stringValue(logo.position, 24) as PresentationOutputLogoPosition | null;
    if (position && LOGO_POSITIONS.has(position)) next.position = position;
    if (Object.keys(next).length) overrides.logo = next;
  }

  const copyright = recordValue(raw.copyright);
  if (copyright) {
    const next: NonNullable<PresentationThemeOverrides["copyright"]> = {};
    if (copyright.visible !== undefined) next.visible = copyright.visible === true;
    const position = stringValue(copyright.position, 24) as PresentationOutputCopyrightPosition | null;
    if (position && COPYRIGHT_POSITIONS.has(position)) next.position = position;
    if (Object.keys(next).length) overrides.copyright = next;
  }
  return overrides;
}

export function normalizePresentationOutputConfig(value: unknown): PresentationOutputConfig {
  const raw = recordValue(value);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION) throw new Error("La configuración de salida es incompatible.");
  return {
    schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION,
    serviceId: requiredString(raw.serviceId, "config.serviceId", 160),
    version: integerValue(raw.version),
    activeThemeId: stringValue(raw.activeThemeId, 160),
    themeOverrides: raw.themeOverrides === null || raw.themeOverrides === undefined ? null : normalizeThemeOverrides(raw.themeOverrides),
    roleLayoutIds: normalizeRoleIdMap(raw.roleLayoutIds),
    themes: Array.isArray(raw.themes) ? raw.themes.map(normalizePresentationThemePreset).filter((theme): theme is PresentationThemePreset => Boolean(theme)) : [],
    roleLayouts: Array.isArray(raw.roleLayouts) ? raw.roleLayouts.map(normalizePresentationStageLayout).filter((layout): layout is PresentationStageLayout => Boolean(layout)) : [],
    resolvedTheme: normalizePresentationTheme(raw.resolvedTheme),
    resolvedRoleLayouts: normalizeResolvedRoleLayouts(raw.resolvedRoleLayouts),
  };
}

function normalizeOutputLink(value: unknown): PresentationOutputLink | null {
  const raw = recordValue(value);
  const id = stringValue(raw?.id, 160);
  const serviceId = stringValue(raw?.serviceId, 160);
  const label = stringValue(raw?.label, 100);
  const createdAt = isoValue(raw?.createdAt);
  const expiresAt = isoValue(raw?.expiresAt);
  if (!raw || !id || !serviceId || !label || !createdAt || !expiresAt) return null;
  return {
    id,
    serviceId,
    label,
    createdAt,
    expiresAt,
    revokedAt: isoValue(raw.revokedAt),
    lastUsedAt: isoValue(raw.lastUsedAt),
  };
}

export function normalizePresentationOutputLinks(value: unknown): PresentationOutputLinksResponse {
  const raw = recordValue(value);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION) throw new Error("La lista de pantallas vinculadas es incompatible.");
  return {
    schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION,
    links: Array.isArray(raw.links) ? raw.links.map(normalizeOutputLink).filter((link): link is PresentationOutputLink => Boolean(link)) : [],
  };
}

export function normalizePresentationOutputLinkCreated(value: unknown): PresentationOutputLinkCreatedResponse {
  const raw = recordValue(value);
  const link = normalizeOutputLink(raw?.link);
  const shareUrl = stringValue(raw?.shareUrl, 2_048);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !link || !shareUrl) {
    throw new Error("No se pudo crear el enlace de audiencia.");
  }
  try {
    const url = new URL(shareUrl);
    const trustedOrigins = new Set(["https://tchurchapp.com", "https://www.tchurchapp.com"]);
    const token = url.hash.slice(1);
    if (!trustedOrigins.has(url.origin) || url.username || url.password || url.pathname !== "/present" || url.search || !/^[A-Za-z0-9_-]{40,200}$/.test(token)) throw new Error("invalid");
  } catch {
    throw new Error("El servidor devolvió un enlace de audiencia inválido.");
  }
  return { schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION, link, shareUrl };
}

export function normalizePresentationThemes(value: unknown): PresentationThemesResponse {
  const raw = recordValue(value);
  const churchId = stringValue(raw?.churchId, 160);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !churchId) throw new Error("La biblioteca de temas es incompatible.");
  return {
    schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION,
    churchId,
    themes: Array.isArray(raw.themes) ? raw.themes.map(normalizePresentationThemePreset).filter((theme): theme is PresentationThemePreset => Boolean(theme)) : [],
    defaultThemeId: stringValue(raw.defaultThemeId, 160),
  };
}

export function normalizePresentationLayouts(value: unknown): PresentationLayoutsResponse {
  const raw = recordValue(value);
  const churchId = stringValue(raw?.churchId, 160);
  if (!raw || raw.schemaVersion !== PRESENTATION_OUTPUT_SCHEMA_VERSION || !churchId) throw new Error("La biblioteca de vistas de escenario es incompatible.");
  return {
    schemaVersion: PRESENTATION_OUTPUT_SCHEMA_VERSION,
    churchId,
    layouts: Array.isArray(raw.layouts) ? raw.layouts.map(normalizePresentationStageLayout).filter((layout): layout is PresentationStageLayout => Boolean(layout)) : [],
    defaultLayoutIds: normalizeRoleIdMap(raw.defaultLayoutIds),
  };
}

export function presentationStageRoleForViewer(roles: PresentationTargetRole[], canEdit = false): PresentationStageRole {
  if (roles.includes("worship_leader")) return "worship_leader";
  if (roles.includes("speaker")) return "preacher";
  if (roles.includes("operator") || roles.includes("av") || canEdit) return "production";
  return "musicians";
}

export function resolvePresentationStageLayout(
  layouts: PresentationStageLayoutDefinition[],
  roles: PresentationTargetRole[],
  requestedId?: string | null,
  canEdit = false,
) {
  const targetRole = presentationStageRoleForViewer(roles, canEdit);
  const allowed = layouts.filter((layout) => layout.targetRole === targetRole);
  if (requestedId) {
    const requested = allowed.find((layout) => layout.id === requestedId);
    if (requested) return requested;
  }
  return allowed[0] || DEFAULT_PRESENTATION_STAGE_LAYOUTS[targetRole];
}

export function projectPresentationServerNow(serverNow: string, receivedAtMs: number, nowMs: number) {
  return Date.parse(serverNow) + Math.max(0, nowMs - receivedAtMs);
}

export function projectPresentationPlaybackPosition(
  playback: PresentationMediaPlayback | null,
  serverNow: string,
  receivedAtMs: number,
  nowMs: number,
) {
  if (!playback) return 0;
  if (playback.status !== "playing" || !playback.startedAt) return playback.positionMs;
  const projectedServerNow = projectPresentationServerNow(serverNow, receivedAtMs, nowMs);
  return Math.max(0, playback.positionMs + Math.max(0, projectedServerNow - Date.parse(playback.startedAt)) * playback.rate);
}

export function projectPresentationCountdownSeconds(
  countdown: PresentationCountdownState | null,
  serverNow: string,
  receivedAtMs: number,
  nowMs: number,
) {
  if (!countdown) return 0;
  const projectedServerNow = projectPresentationServerNow(serverNow, receivedAtMs, nowMs);
  return Math.max(0, (Date.parse(countdown.targetAt) - projectedServerNow) / 1_000);
}

export function formatAudienceCountdown(remainingSeconds: number) {
  const clamped = Math.max(0, Math.ceil(remainingSeconds));
  const hours = Math.floor(clamped / 3_600);
  const minutes = Math.floor((clamped % 3_600) / 60);
  const seconds = clamped % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function splitPresentationTextPages(text: string, maximumCharacters = 360, maximumLines = 7) {
  const normalized = text.trim().replace(/\r\n?/g, "\n");
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).flatMap((paragraph) => paragraph.split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ0-9])/));
  const pages: string[][] = [];
  let page: string[] = [];
  let length = 0;
  for (const raw of paragraphs) {
    const sentence = raw.replace(/\s+/g, " ").trim();
    if (!sentence) continue;
    if (page.length && (page.length >= maximumLines || length + sentence.length + 1 > maximumCharacters)) {
      pages.push(page);
      page = [];
      length = 0;
    }
    if (sentence.length <= maximumCharacters) {
      page.push(sentence);
      length += sentence.length + 1;
      continue;
    }
    const words = sentence.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line && line.length + word.length + 1 > maximumCharacters) {
        page.push(line);
        if (page.length >= maximumLines) {
          pages.push(page);
          page = [];
        }
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) page.push(line);
    length = page.join(" ").length;
  }
  if (page.length) pages.push(page);
  return pages;
}

export function paginateResolvedScripture(passage: PresentationResolvedScripture, maximumCharacters = 420) {
  const pages: Array<PresentationResolvedScripture["verses"]> = [];
  let page: PresentationResolvedScripture["verses"] = [];
  let length = 0;
  const fittedVerses = passage.verses.flatMap((verse) => {
    const allowance = Math.max(80, maximumCharacters - verse.number.length - 2);
    if (verse.text.length <= allowance) return [verse];
    const words = verse.text.split(/\s+/);
    const chunks: string[] = [];
    let chunk = "";
    for (const word of words) {
      if (chunk && chunk.length + word.length + 1 > allowance) {
        chunks.push(chunk);
        chunk = word;
      } else {
        chunk = chunk ? `${chunk} ${word}` : word;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks.map((text, index) => ({ number: index === 0 ? verse.number : "…", text }));
  });
  for (const verse of fittedVerses) {
    const nextLength = verse.number.length + verse.text.length + 2;
    if (page.length && length + nextLength > maximumCharacters) {
      pages.push(page);
      page = [];
      length = 0;
    }
    page.push(verse);
    length += nextLength;
  }
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}
