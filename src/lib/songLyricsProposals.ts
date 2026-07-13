import { Capacitor } from "@capacitor/core";
import { z } from "zod";

import { ApiError, apiFetch } from "@/lib/api";

export const SONG_LYRICS_PROPOSAL_MAX_BYTES = 64 * 1024;

const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,299}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHECKSUM_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type SongLyricsProposalTargetType = "SONG" | "ARRANGEMENT";
export type SongLyricsProposalSourceType = "WEB" | "IOS" | "ANDROID" | "MAC_STUDIO" | "IMPORT";
export type SongLyricsProposalStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
export type SongLyricsProposalDecision = "ACCEPTED" | "REJECTED";

export type SongLyricsProposalTargetInput = {
  type: SongLyricsProposalTargetType;
  songId: string;
  arrangementId: string | null;
};

export type SongLyricsProposalSubmissionV1 = {
  schemaVersion: 1;
  target: SongLyricsProposalTargetInput;
  source: { type: SongLyricsProposalSourceType; ref: string | null };
  format: "CHORDPRO";
  lyrics: string;
  checksum: string;
  baseChecksum: string;
  idempotencyKey: string;
  requestChecksum: string;
};

export type SongLyricsProposalDecisionV1 = {
  schemaVersion: 1;
  status: SongLyricsProposalDecision;
  decisionReason: string | null;
  decisionIdempotencyKey: string;
  decisionRequestChecksum: string;
};

export type SongLyricsProposalSummaryV1 = {
  id: string;
  status: SongLyricsProposalStatus;
  target: {
    type: SongLyricsProposalTargetType;
    song: { id: string; title: string };
    arrangement: { id: string; name: string } | null;
  };
  source: { type: SongLyricsProposalSourceType; ref: string | null };
  format: "CHORDPRO";
  checksum: string;
  baseChecksum: string;
  version: number;
  submittedBy: { id: string; displayName: string };
  reviewedBy: { id: string; displayName: string } | null;
  decisionReason: string | null;
  acceptedTargetUpdatedAt: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SongLyricsProposalDetailV1 = SongLyricsProposalSummaryV1 & { lyrics: string };

export type SongLyricsProposalDetailEnvelopeV1 = {
  schemaVersion: 1;
  proposal: SongLyricsProposalDetailV1;
  permissions: { canManageLyrics: boolean };
};

export type SongLyricsProposalListEnvelopeV1 = {
  schemaVersion: 1;
  proposals: SongLyricsProposalSummaryV1[];
  pagination: { nextCursor: string | null; hasMore: boolean };
  permissions: { canManageLyrics: boolean };
};

export type SongLyricsProposalApiCode =
  | "LYRICS_BASE_STALE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "LYRICS_UNCHANGED"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_NOT_PENDING"
  | "TARGET_NOT_FOUND"
  | "INVALID_LYRICS_PROPOSAL";

export type SongLyricsProposalApiFailure = {
  status: number;
  code: SongLyricsProposalApiCode | null;
  message: string;
  currentChecksum: string | null;
  currentUpdatedAt: string | null;
};

export class SongLyricsProposalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongLyricsProposalValidationError";
  }
}

function hasForbiddenControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x08 || codePoint === 0x0b || codePoint === 0x0c || (codePoint >= 0x0e && codePoint <= 0x1f) || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

const chordTokenPattern =
  /^(?:Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:#|b)?(?:(?:maj|min|m|dim|aug|sus|add|no)?\d*(?:[#b]\d+)*)?(?:\([^)]*\))?(?:\/(?:Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:#|b)?)?$/i;
const ignoredChordLineTokenPattern = /^(?:[|:.,/\\()[\]{}-]+|x\d+|n\.?c\.?)$/i;

function cleanChordToken(value: string) {
  return value
    .replace(/^[|:.,/\\()[\]{}]+/g, "")
    .replace(/[|:.,/\\()[\]{}]+$/g, "")
    .trim();
}

function isChordOnlyLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  let chordCount = 0;

  for (const rawToken of trimmed.split(/\s+/).filter(Boolean)) {
    // Capturing separators is equivalent to lookbehind splitting but works on iOS 15 WKWebView.
    for (const part of rawToken.split(/([|:])/).filter((candidate) => candidate.trim())) {
      const candidate = part.trim();
      if (ignoredChordLineTokenPattern.test(candidate)) continue;
      const cleaned = cleanChordToken(candidate);
      if (!cleaned || !chordTokenPattern.test(cleaned)) return false;
      chordCount += 1;
    }
  }
  return chordCount > 0;
}

function parseChordLine(line: string) {
  const tokens: Array<{ chord: string; index: number }> = [];
  for (const match of line.matchAll(/\S+/g)) {
    const rawToken = match[0];
    const rawIndex = match.index ?? 0;
    if (ignoredChordLineTokenPattern.test(rawToken.trim())) continue;
    const segments = rawToken.split(/([|:])/);
    let offset = 0;
    for (const segment of segments) {
      if (!segment) continue;
      const segmentIndex = rawIndex + offset;
      offset += segment.length;
      if (ignoredChordLineTokenPattern.test(segment.trim())) continue;
      const cleaned = cleanChordToken(segment);
      if (!cleaned || !chordTokenPattern.test(cleaned)) continue;
      tokens.push({ chord: cleaned, index: segmentIndex + Math.max(segment.indexOf(cleaned), 0) });
    }
  }
  return tokens;
}

function insertChordsIntoLyricLine(lyricLine: string, chords: Array<{ chord: string; index: number }>) {
  const byIndex = new Map<number, string[]>();
  chords.forEach((token) => {
    const index = Math.max(0, Math.min(token.index, lyricLine.length));
    byIndex.set(index, [...(byIndex.get(index) || []), token.chord]);
  });
  let output = "";
  for (let index = 0; index <= lyricLine.length; index += 1) {
    const atIndex = byIndex.get(index);
    if (atIndex) output += atIndex.map((chord) => `[${chord}]`).join("");
    if (index < lyricLine.length) output += lyricLine[index];
  }
  return output.trimEnd();
}

export function convertStackedChordsToChordPro(input: string) {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (isChordOnlyLine(current) && typeof next === "string" && next.trim() && !isChordOnlyLine(next)) {
      output.push(insertChordsIntoLyricLine(next, parseChordLine(current)));
      index += 1;
    } else if (isChordOnlyLine(current)) {
      const chordOnly = parseChordLine(current).map((token) => `[${token.chord}]`).join(" ");
      output.push(chordOnly || current);
    } else {
      output.push(current);
    }
  }
  return output.join("\n").trim();
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value);
}

export function canonicalizeChordPro(value: unknown) {
  if (typeof value !== "string") throw new SongLyricsProposalValidationError("Las letras deben ser texto.");
  if (utf8Bytes(value).byteLength > SONG_LYRICS_PROPOSAL_MAX_BYTES) {
    throw new SongLyricsProposalValidationError("Las letras superan el límite de 64 KiB.");
  }
  const normalized = (value.startsWith("\uFEFF") ? value.slice(1) : value).normalize("NFC");
  if (hasForbiddenControlCharacter(normalized)) {
    throw new SongLyricsProposalValidationError("Las letras contienen un carácter no compatible.");
  }
  const canonical = convertStackedChordsToChordPro(normalized).normalize("NFC");
  if (utf8Bytes(canonical).byteLength > SONG_LYRICS_PROPOSAL_MAX_BYTES) {
    throw new SongLyricsProposalValidationError("Las letras normalizadas superan el límite de 64 KiB.");
  }
  return canonical;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string) {
  if (!globalThis.crypto?.subtle) throw new SongLyricsProposalValidationError("Este dispositivo no puede firmar la propuesta de forma segura.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", utf8Bytes(value));
  return `sha256:${hex(new Uint8Array(digest))}`;
}

export async function chordProChecksum(value: unknown) {
  return sha256(canonicalizeChordPro(value));
}

export function secureUuidV4() {
  if (!globalThis.crypto?.getRandomValues) throw new SongLyricsProposalValidationError("Este dispositivo no puede crear una clave segura.");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = hex(bytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function proposalSourceType(): SongLyricsProposalSourceType {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") return "IOS";
  if (platform === "android") return "ANDROID";
  return "WEB";
}

function validateTarget(target: SongLyricsProposalTargetInput) {
  if (!RESOURCE_ID_PATTERN.test(target.songId)) throw new SongLyricsProposalValidationError("La canción no tiene un identificador compatible.");
  if (target.type === "SONG" && target.arrangementId !== null) throw new SongLyricsProposalValidationError("La canción principal no puede incluir un arreglo.");
  if (target.type === "ARRANGEMENT" && (!target.arrangementId || !RESOURCE_ID_PATTERN.test(target.arrangementId))) {
    throw new SongLyricsProposalValidationError("Selecciona un arreglo válido.");
  }
}

export async function buildSongLyricsProposalSubmission(input: {
  target: SongLyricsProposalTargetInput;
  lyrics: string;
  baseLyrics: string;
  sourceType?: SongLyricsProposalSourceType;
  sourceRef?: string | null;
  idempotencyKey?: string;
}): Promise<SongLyricsProposalSubmissionV1> {
  validateTarget(input.target);
  const lyrics = canonicalizeChordPro(input.lyrics);
  const checksum = await sha256(lyrics);
  const baseChecksum = await chordProChecksum(input.baseLyrics);
  const idempotencyKey = input.idempotencyKey || secureUuidV4();
  if (!UUID_PATTERN.test(idempotencyKey)) throw new SongLyricsProposalValidationError("La clave de reintento no es válida.");
  const request = {
    schemaVersion: 1 as const,
    target: input.target,
    source: { type: input.sourceType || proposalSourceType(), ref: input.sourceRef ?? null },
    format: "CHORDPRO" as const,
    lyrics,
    checksum,
    baseChecksum,
    idempotencyKey,
  };
  return { ...request, requestChecksum: await sha256(JSON.stringify(request)) };
}

export async function buildSongLyricsProposalDecision(input: {
  status: SongLyricsProposalDecision;
  decisionReason?: string | null;
  decisionIdempotencyKey?: string;
}): Promise<SongLyricsProposalDecisionV1> {
  const decisionReason = input.decisionReason?.trim() || null;
  if (decisionReason && decisionReason.length > 500) throw new SongLyricsProposalValidationError("La nota de revisión debe tener 500 caracteres o menos.");
  const decisionIdempotencyKey = input.decisionIdempotencyKey || secureUuidV4();
  const request = { schemaVersion: 1 as const, status: input.status, decisionReason, decisionIdempotencyKey };
  return { ...request, decisionRequestChecksum: await sha256(JSON.stringify(request)) };
}

const personSchema = z.object({ id: z.string().uuid(), displayName: z.string().min(1).max(200) }).strict();
const summaryObjectSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "SUPERSEDED"]),
  target: z.object({
    type: z.enum(["SONG", "ARRANGEMENT"]),
    song: z.object({ id: z.string().regex(RESOURCE_ID_PATTERN), title: z.string().min(1).max(300) }).strict(),
    arrangement: z.object({ id: z.string().regex(RESOURCE_ID_PATTERN), name: z.string().min(1).max(200) }).strict().nullable(),
  }).strict(),
  source: z.object({ type: z.enum(["WEB", "IOS", "ANDROID", "MAC_STUDIO", "IMPORT"]), ref: z.string().min(1).max(500).nullable() }).strict(),
  format: z.literal("CHORDPRO"), checksum: z.string().regex(CHECKSUM_PATTERN), baseChecksum: z.string().regex(CHECKSUM_PATTERN),
  version: z.number().int().positive(), submittedBy: personSchema, reviewedBy: personSchema.nullable(),
  decisionReason: z.string().min(1).max(500).nullable(), acceptedTargetUpdatedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime(), reviewedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();

function refineProposalLifecycle(proposal: z.infer<typeof summaryObjectSchema>, context: z.RefinementCtx) {
  if ((proposal.target.type === "SONG") !== (proposal.target.arrangement === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "El destino público de la propuesta no es consistente." });
  }
  if (proposal.status === "PENDING" && (proposal.reviewedBy || proposal.reviewedAt || proposal.decisionReason || proposal.acceptedTargetUpdatedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Una propuesta pendiente no puede incluir una decisión." });
  }
  if (proposal.status !== "PENDING" && (!proposal.reviewedBy || !proposal.reviewedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Una propuesta final requiere datos de revisión." });
  }
  if ((proposal.status === "ACCEPTED") !== Boolean(proposal.acceptedTargetUpdatedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "La fecha de publicación no coincide con el estado." });
  }
}
const summarySchema = summaryObjectSchema.superRefine(refineProposalLifecycle);
const permissionsSchema = z.object({ canManageLyrics: z.boolean() }).strict();
const detailEnvelopeSchema = z.object({
  schemaVersion: z.literal(1), proposal: summaryObjectSchema.extend({ lyrics: z.string() }).strict().superRefine(refineProposalLifecycle), permissions: permissionsSchema,
}).strict();
const listEnvelopeSchema = z.object({
  schemaVersion: z.literal(1), proposals: z.array(summarySchema).max(200),
  pagination: z.object({ nextCursor: z.string().min(1).max(2000).nullable(), hasMore: z.boolean() }).strict(), permissions: permissionsSchema,
}).strict();

async function detailEnvelope(value: unknown) {
  const parsed = detailEnvelopeSchema.parse(value);
  const lyrics = canonicalizeChordPro(parsed.proposal.lyrics);
  if (lyrics !== parsed.proposal.lyrics || await sha256(lyrics) !== parsed.proposal.checksum) {
    throw new SongLyricsProposalValidationError("La respuesta de letras no coincide con su firma.");
  }
  return parsed as SongLyricsProposalDetailEnvelopeV1;
}

function listEnvelope(value: unknown) {
  return listEnvelopeSchema.parse(value) as SongLyricsProposalListEnvelopeV1;
}

export function songLyricsProposalFailure(error: unknown): SongLyricsProposalApiFailure {
  const apiError = error instanceof ApiError ? error : null;
  const body = apiError?.body && typeof apiError.body === "object" ? apiError.body as Record<string, unknown> : {};
  const details = body.details && typeof body.details === "object" ? body.details as Record<string, unknown> : body;
  const knownCodes: SongLyricsProposalApiCode[] = [
    "LYRICS_BASE_STALE",
    "IDEMPOTENCY_KEY_REUSED",
    "LYRICS_UNCHANGED",
    "PROPOSAL_NOT_FOUND",
    "PROPOSAL_NOT_PENDING",
    "TARGET_NOT_FOUND",
    "INVALID_LYRICS_PROPOSAL",
  ];
  const code = typeof body.code === "string" && knownCodes.includes(body.code as SongLyricsProposalApiCode)
    ? body.code as SongLyricsProposalApiCode
    : null;
  return {
    status: apiError?.status || 0,
    code,
    message: error instanceof Error ? error.message : "No se pudo completar la solicitud.",
    currentChecksum: typeof details.currentChecksum === "string" && CHECKSUM_PATTERN.test(details.currentChecksum) ? details.currentChecksum : null,
    currentUpdatedAt: typeof details.currentUpdatedAt === "string" ? details.currentUpdatedAt : null,
  };
}

export async function createSongLyricsProposal(body: SongLyricsProposalSubmissionV1, token?: string | null) {
  return detailEnvelope(await apiFetch("/song-lyrics-proposals", {
    method: "POST", body: JSON.stringify(body), sensitiveBody: true,
  }, token));
}

export async function listSongLyricsProposals(params: {
  status?: SongLyricsProposalStatus;
  songId?: string;
  arrangementId?: string | null;
  cursor?: string | null;
  limit?: number;
} = {}, token?: string | null) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.songId) query.set("songId", params.songId);
  if (params.arrangementId) query.set("arrangementId", params.arrangementId);
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(Math.min(100, Math.max(1, params.limit || 30))));
  return listEnvelope(await apiFetch(`/song-lyrics-proposals?${query}`, { cache: "no-store" }, token));
}

export async function getSongLyricsProposal(id: string, token?: string | null) {
  return detailEnvelope(await apiFetch(`/song-lyrics-proposals/${encodeURIComponent(id)}`, { cache: "no-store" }, token));
}

export async function decideSongLyricsProposal(id: string, body: SongLyricsProposalDecisionV1, token?: string | null) {
  const action = body.status === "ACCEPTED" ? "accept" : "reject";
  return detailEnvelope(await apiFetch(`/song-lyrics-proposals/${encodeURIComponent(id)}/${action}`, {
    method: "POST", body: JSON.stringify(body), sensitiveBody: true,
  }, token));
}
