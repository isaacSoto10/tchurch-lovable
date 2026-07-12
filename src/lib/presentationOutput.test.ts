import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_STAGE_LAYOUTS,
  DEFAULT_PRESENTATION_THEME,
  formatAudienceCountdown,
  normalizePresentationAudienceEnvelope,
  normalizePresentationOutputConfig,
  normalizePresentationOutputLinkCreated,
  normalizePresentationTheme,
  presentationColorContrast,
  projectPresentationCountdownSeconds,
  presentationStageRoleForViewer,
  projectPresentationPlaybackPosition,
  resolvePresentationAudienceSlide,
  resolvePresentationAnnouncementSlide,
  resolvePresentationStageLayout,
  sanitizeAudienceLyricLine,
} from "./presentationOutput";
import type { PresentationStageRole } from "./presentationOutput";

const timestamp = "2026-07-12T12:00:00.000Z";

function layoutRecord(role: PresentationStageRole) {
  return {
    ...DEFAULT_PRESENTATION_STAGE_LAYOUTS[role],
    churchId: "church-1",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function envelope() {
  return {
    schemaVersion: 3,
    serverNow: "2026-07-12T12:00:00.000Z",
    package: {
      schemaVersion: 3,
      packageId: `sha256:${"a".repeat(64)}`,
      generatedAt: "2026-07-12T11:59:50.000Z",
      serviceVersion: "2026-07-12T11:59:45.000Z",
      contentVersion: `sha256:${"b".repeat(64)}`,
      service: { id: "service-1", title: "Domingo", date: "2026-07-12T15:00:00.000Z" },
      theme: {
        fontFamily: "serif",
        fontWeight: 700,
        textColor: "#ffffff",
        accentColor: "#c4b5fd",
        background: { type: "image", color: "#07070b", imageUrl: "https://cdn.example.com/background.jpg", overlayColor: "#000000", overlayOpacity: 0.4 },
        placement: "center",
        logo: { url: "https://cdn.example.com/logo.png", position: "top_left" },
        copyright: { visible: true, position: "bottom_right" },
      },
      slides: [
        {
          id: "lyrics-1",
          itemId: "song-1",
          itemIndex: 0,
          kind: "lyrics",
          title: "Santo",
          durationSeconds: 240,
          sectionLabel: "Coro",
          lines: ["[G]Santo, [C]Santo", "{c: Coro}", "Dios poderoso"],
          part: 1,
          totalParts: 2,
          copyright: { text: "Autor", ccliNumber: "123" },
        },
        {
          id: "scripture-1",
          itemId: "scripture-item",
          itemIndex: 1,
          kind: "scripture",
          title: "Juan 3:16",
          durationSeconds: 60,
          part: 1,
          totalParts: 1,
          passage: {
            source: "youversion",
            reference: "Juan 3:16",
            passageUsfm: "JHN.3.16",
            version: { id: "149", name: "Reina-Valera 1960", abbreviation: "RVR1960", language: "es" },
            verses: [{ number: "16", text: "Porque de tal manera amó Dios al mundo…" }],
            copyright: "Texto bíblico",
            promotionalContent: null,
          },
        },
      ],
      checksum: `sha256:${"a".repeat(64)}`,
    },
    snapshot: {
      schemaVersion: 3,
      serviceId: "service-1",
      sessionId: "session-1",
      status: "live",
      revision: 4,
      cursor: { itemId: "song-1", itemIndex: 0, stepId: "chorus-1", stepIndex: 0, sectionAnchorId: "chorus", partIndex: 0, slideId: "lyrics-1" },
      display: { blackout: false },
      playback: null,
      countdown: null,
    },
  };
}

describe("presentation output v3 contract", () => {
  it("sanitizes audience lyric content without adding private fields", () => {
    const normalized = normalizePresentationAudienceEnvelope(envelope());
    const serialized = JSON.stringify(normalized);
    expect(normalized.package?.slides[0]).toMatchObject({ kind: "lyrics", lines: ["Santo, Santo", "Dios poderoso"] });
    expect(serialized).not.toContain("chords");
  });

  it("rejects unknown and private keys at every public DTO boundary", () => {
    const source = envelope();
    expect(() => normalizePresentationAudienceEnvelope({ ...source, roles: ["private"] })).toThrow(/no permitido/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, controller: { clientId: "private" } } })).toThrow(/no permitido/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, theme: { ...source.package.theme, notes: [] } } })).toThrow(/no permitido/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, slides: [{ ...source.package.slides[0], chords: ["G"] }] } })).toThrow(/no permitido/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, presence: [] } })).toThrow(/no permitido/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, display: { ...source.snapshot.display, chordsVisible: true } } })).toThrow(/no permitido/i);
  });

  it("rejects omitted canonical keys even when their value may be null", () => {
    const source = envelope();
    const { package: _package, ...withoutPackage } = source;
    const { playback: _playback, ...withoutPlayback } = source.snapshot;
    const { sectionLabel: _sectionLabel, ...withoutSectionLabel } = source.package.slides[0];
    const { url: _logoUrl, ...withoutLogoUrl } = source.package.theme.logo;
    expect(() => normalizePresentationAudienceEnvelope(withoutPackage)).toThrow(/obligatorio/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: withoutPlayback })).toThrow(/obligatorio/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, slides: [withoutSectionLabel, source.package.slides[1]] } })).toThrow(/obligatorio/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, theme: { ...source.package.theme, logo: withoutLogoUrl } } })).toThrow(/obligatorio/i);
  });

  it("accepts 204-style and empty-service packages, then fails closed on incompatible content", () => {
    const source = envelope();
    expect(normalizePresentationAudienceEnvelope({ ...source, package: null }).package).toBeNull();
    expect(normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, slides: [] }, snapshot: { ...source.snapshot, cursor: { ...source.snapshot.cursor, slideId: null } } }).package?.slides).toEqual([]);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, slides: [{ ...source.package.slides[0], lines: [] }] } })).toThrow(/diapositiva inválida/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, schemaVersion: 2 })).toThrow(/incompatible/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, checksum: `sha256:${"b".repeat(64)}` } })).toThrow(/firma/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, contentVersion: "content-version-1" } })).toThrow(/firma/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, serviceVersion: "service-version-1" } })).toThrow(/fecha/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, package: { ...source.package, slides: [source.package.slides[0], source.package.slides[0]] } })).toThrow(/duplicados/i);
  });

  it("requires cursor and playback anchors to resolve inside the same public package", () => {
    const source = envelope();
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, cursor: { ...source.snapshot.cursor, slideId: "missing" } } })).toThrow(/cursor/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, cursor: { ...source.snapshot.cursor, itemId: "other" } } })).toThrow(/cursor/i);
    expect(() => normalizePresentationAudienceEnvelope({
      ...source,
      snapshot: {
        ...source.snapshot,
        playback: { itemId: "song-1", slideId: "lyrics-1", kind: "audio", status: "paused", positionMs: 0, startedAt: null, rate: 1, loop: false },
      },
    })).toThrow(/reproducción/i);
  });

  it("resolves only the exact authoritative slide and matching item", () => {
    const normalized = normalizePresentationAudienceEnvelope(envelope());
    expect(resolvePresentationAudienceSlide(normalized.package, normalized.snapshot)?.id).toBe("lyrics-1");
    const wrongItem = { ...normalized.snapshot, cursor: { ...normalized.snapshot.cursor, itemId: "other" } };
    expect(resolvePresentationAudienceSlide(normalized.package, wrongItem)).toBeNull();
    expect(resolvePresentationAudienceSlide(normalized.package, { ...normalized.snapshot, status: "ended" })).toBeNull();
    expect(resolvePresentationAudienceSlide(normalized.package, { ...normalized.snapshot, status: "idle" })).toBeNull();
  });

  it("requires the canonical idle/live/ended lifecycle", () => {
    const source = envelope();
    expect(normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, status: "idle", sessionId: null } }).snapshot.status).toBe("idle");
    expect(normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, status: "ended" } }).snapshot.status).toBe("ended");
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, status: "idle" } })).toThrow(/cursores/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, status: "live", sessionId: null } })).toThrow(/cursores/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, status: "finished" } })).toThrow(/ciclo/i);
  });

  it("rejects permissive cursor, display and playback coercions", () => {
    const source = envelope();
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, revision: "4" } })).toThrow(/cursores/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, cursor: { ...source.snapshot.cursor, stepIndex: -1 } } })).toThrow(/cursores/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, cursor: { ...source.snapshot.cursor, slideId: 42 } } })).toThrow(/cursores/i);
    expect(() => normalizePresentationAudienceEnvelope({ ...source, snapshot: { ...source.snapshot, display: { blackout: 1 } } })).toThrow(/controles/i);
    expect(() => normalizePresentationAudienceEnvelope({
      ...source,
      snapshot: {
        ...source.snapshot,
        playback: { itemId: "song-1", slideId: "lyrics-1", kind: "audio", status: "playing", positionMs: 0, startedAt: null, rate: 1, loop: false },
      },
    })).toThrow(/reproducción/i);
  });

  it("matches web defaults, preserves valid chosen colors and rejects unsafe assets", () => {
    const theme = normalizePresentationTheme({
      fontFamily: "comic-sans",
      fontWeight: 765,
      textColor: "#777777",
      accentColor: "#abcdef",
      background: { type: "image", color: "#777777", imageUrl: "javascript:alert(1)", overlayColor: "red", overlayOpacity: 4 },
      logo: { url: "http://insecure.example/logo.png", position: "middle" },
    });
    expect(theme).toMatchObject({
      fontFamily: DEFAULT_PRESENTATION_THEME.fontFamily,
      fontWeight: 700,
      textColor: "#777777",
      accentColor: "#abcdef",
      background: { type: "color", imageUrl: null, overlayOpacity: 1 },
      logo: { url: null, position: DEFAULT_PRESENTATION_THEME.logo.position },
    });
    expect(presentationColorContrast(theme.textColor, theme.background.color)).toBeLessThan(4.5);
    expect(normalizePresentationTheme({})).toEqual(DEFAULT_PRESENTATION_THEME);
  });

  it("normalizes role layouts and follows the frozen priority", () => {
    const config = normalizePresentationOutputConfig({
      schemaVersion: 3,
      serviceId: "service-1",
      version: 2,
      activeThemeId: null,
      themeOverrides: {},
      roleLayoutIds: { worship_leader: null, musicians: null, preacher: "preacher-large", production: null },
      themes: [],
      roleLayouts: [{
        id: "preacher-large",
        churchId: "church-1",
        name: "Predicador grande",
        targetRole: "preacher",
        mode: "speaker",
        fontScale: 2,
        show: { current: true, next: true, notes: true, chords: false, clock: true, serviceTimer: true, itemTimer: true, messages: true },
        isDefault: false,
        version: 1,
        createdAt: "2026-07-12T12:00:00.000Z",
        updatedAt: "2026-07-12T12:00:00.000Z",
      }],
      resolvedTheme: DEFAULT_PRESENTATION_THEME,
      resolvedRoleLayouts: {
        worship_leader: layoutRecord("worship_leader"),
        musicians: layoutRecord("musicians"),
        preacher: { ...layoutRecord("preacher"), id: "preacher-large", name: "Predicador grande", isDefault: false },
        production: layoutRecord("production"),
      },
    });
    expect(config.roleLayouts[0].fontScale).toBe(1.5);
    expect(presentationStageRoleForViewer(["band", "operator", "speaker", "worship_leader"])).toBe("worship_leader");
    expect(presentationStageRoleForViewer(["band", "operator", "speaker"])).toBe("preacher");
    expect(resolvePresentationStageLayout(config.roleLayouts, ["speaker"]).id).toBe("preacher-large");
    expect(resolvePresentationStageLayout(config.roleLayouts, ["band"], "preacher-large").targetRole).toBe("musicians");
  });

  it("projects canonical playback without trusting the device clock for paused media", () => {
    const playback = { itemId: "item", slideId: "slide", kind: "video" as const, status: "playing" as const, positionMs: 2_000, startedAt: "2026-07-12T11:59:58.000Z", rate: 1 as const, loop: false };
    const receivedAtMs = Date.parse("2026-07-12T18:00:00.000Z");
    const nowMs = receivedAtMs + 3_000;
    expect(projectPresentationPlaybackPosition(playback, "2026-07-12T12:00:00.000Z", receivedAtMs, nowMs)).toBe(7_000);
    expect(projectPresentationPlaybackPosition({ ...playback, status: "paused" }, "2026-07-12T12:00:00.000Z", receivedAtMs, nowMs)).toBe(2_000);
    expect(projectPresentationPlaybackPosition({ ...playback, startedAt: null }, "2026-07-12T12:00:00.000Z", receivedAtMs, nowMs)).toBe(2_000);
  });

  it("projects countdowns from the authoritative target across clock skew and reconnects", () => {
    const receivedAtMs = Date.parse("2026-07-12T18:00:00.000Z");
    const countdown = { durationSeconds: 65, targetAt: "2026-07-12T12:01:05.000Z" };
    expect(projectPresentationCountdownSeconds(countdown, "2026-07-12T12:00:00.000Z", receivedAtMs, receivedAtMs)).toBe(65);
    expect(projectPresentationCountdownSeconds(countdown, "2026-07-12T12:00:40.000Z", receivedAtMs + 40_000, receivedAtMs + 45_000)).toBe(20);
  });

  it("rotates announcement pages from the canonical anchor across boundaries, cycles, pause and reconnect", () => {
    const normalized = normalizePresentationAudienceEnvelope(envelope());
    const announcementSlides = [
      { id: "announcement-1", itemId: "announcement-item", itemIndex: 2, kind: "announcement" as const, title: "Avisos", durationSeconds: 3, body: ["Uno"], mediaSrc: null, mediaType: null, loop: true },
      { id: "announcement-2", itemId: "announcement-item", itemIndex: 2, kind: "announcement" as const, title: "Avisos", durationSeconds: 5, body: ["Dos"], mediaSrc: null, mediaType: null, loop: true },
    ];
    const presentationPackage = { ...normalized.package!, slides: [...normalized.package!.slides, ...announcementSlides] };
    const playback = { itemId: "announcement-item", slideId: "announcement-1", kind: "announcement" as const, status: "playing" as const, positionMs: 0, startedAt: "2026-07-12T12:00:00.000Z", rate: 1 as const, loop: true };
    const snapshot = { ...normalized.snapshot, cursor: { ...normalized.snapshot.cursor, itemId: "announcement-item", slideId: "announcement-1" }, playback };
    const receivedAt = Date.parse("2026-07-12T18:00:00.000Z");
    expect(resolvePresentationAnnouncementSlide(presentationPackage, snapshot, "2026-07-12T12:00:00.000Z", receivedAt, receivedAt)?.id).toBe("announcement-1");
    expect(resolvePresentationAnnouncementSlide(presentationPackage, snapshot, "2026-07-12T12:00:00.000Z", receivedAt, receivedAt + 3_000)?.id).toBe("announcement-2");
    expect(resolvePresentationAnnouncementSlide(presentationPackage, snapshot, "2026-07-12T12:00:00.000Z", receivedAt, receivedAt + 16_000)?.id).toBe("announcement-1");
    expect(resolvePresentationAnnouncementSlide(presentationPackage, { ...snapshot, display: { blackout: true } }, "2026-07-12T12:00:00.000Z", receivedAt, receivedAt + 19_000)?.id).toBe("announcement-2");
    expect(resolvePresentationAnnouncementSlide(presentationPackage, { ...snapshot, playback: { ...playback, status: "paused", positionMs: 3_000 } }, "2026-07-12T12:00:30.000Z", receivedAt + 30_000, receivedAt + 90_000)?.id).toBe("announcement-2");
    expect(resolvePresentationAnnouncementSlide(presentationPackage, { ...snapshot, playback: { ...playback, positionMs: 6_000, startedAt: "2026-07-12T12:00:10.000Z" } }, "2026-07-12T12:00:10.000Z", receivedAt, receivedAt)?.id).toBe("announcement-2");
    expect(resolvePresentationAnnouncementSlide(presentationPackage, { ...snapshot, playback: { ...playback, loop: false } }, "2026-07-12T12:01:00.000Z", receivedAt, receivedAt)?.id).toBe("announcement-2");
  });

  it("formats countdowns and removes common ChordPro without erasing normal brackets", () => {
    expect(formatAudienceCountdown(65)).toBe("01:05");
    expect(formatAudienceCountdown(-4)).toBe("00:00");
    expect(sanitizeAudienceLyricLine("[F#m7]Grande es Dios {c: Todos}")).toBe("Grande es Dios");
    expect(sanitizeAudienceLyricLine("[Todos] cantan")).toBe("[Todos] cantan");
  });

  it("accepts only a trusted one-time /present fragment URL", () => {
    const link = { id: "link-1", serviceId: "service-1", label: "Santuario", createdAt: timestamp, expiresAt: "2026-07-13T12:00:00.000Z", revokedAt: null, lastUsedAt: null };
    const token = "aB_9-".repeat(9);
    expect(normalizePresentationOutputLinkCreated({ schemaVersion: 3, link, shareUrl: `https://tchurchapp.com/present#${token}` }).shareUrl).toContain(token);
    expect(normalizePresentationOutputLinkCreated({ schemaVersion: 3, link, shareUrl: `https://tchurch.vercel.app/present#${token}` }).shareUrl).toContain(token);
    for (const shareUrl of [
      `https://evil.example/present#${token}`,
      `https://tchurch-preview-123.vercel.app/present#${token}`,
      `https://tchurchapp.com/present?leak=1#${token}`,
      `https://user:pass@tchurchapp.com/present#${token}`,
      "https://tchurchapp.com/present#short",
      `https://tchurchapp.com/app/present#${token}`,
    ]) expect(() => normalizePresentationOutputLinkCreated({ schemaVersion: 3, link, shareUrl })).toThrow(/inválido/i);
  });
});
