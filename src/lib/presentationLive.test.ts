import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  MAX_OFFLINE_PRESENTATION_COMMANDS,
  PRESENTATION_POLL_MS,
  activatePresentationCacheIdentity,
  applyOfflinePresentationCommand,
  buildOfflineReconcileCommand,
  buildPresentationCommand,
  canonicalPresentationPackageJson,
  computePresentationPackageDigest,
  createPresentationOfflineState,
  formatPresentationUuidV4,
  getPresentationApiErrorCode,
  getPresentationClientId,
  getPresentationConflictSnapshot,
  loadLatestPresentationPackageForIdentity,
  loadPresentationOfflineState,
  loadPresentationPackage,
  normalizePresentationLiveSnapshot,
  normalizePresentationPackage,
  presentationPackageMatchesLiveViewer,
  presentationPackageCacheKey,
  presentationRoleFingerprint,
  presentationSessionPath,
  presentationWorkspaceMatchesLiveViewer,
  projectPresentationTiming,
  purgePresentationCacheForViewerDowngrade,
  queueOfflinePresentationCommand,
  resolvePresentationCursorIndex,
  savePresentationPackage,
  savePresentationOfflineState,
  isPresentationAuthorizationError,
  presentationRehearsalSessionPath,
  verifyPresentationPackageIntegrity,
  type CachedPresentationPackage,
  type PresentationLiveSnapshot,
  type PresentationOfflineContext,
  type PresentationOfflineState,
  type PresentationPackage,
  type PresentationQueuedCommand,
} from "./presentationLive";

const serverNow = "2026-07-11T18:30:00.000Z";

function snapshotRaw(view: "operator" | "stage" | "remote" | "audience" = "stage") {
  return {
    schemaVersion: 2,
    serviceId: "service-1",
    serviceVersion: "svc-v2",
    viewerVersion: "sha256:viewer-operator",
    controllerVersion: "sha256:controller-present",
    serverNow,
    viewer: view === "audience" ? {
      view,
      roles: ["operator"],
      canEdit: true,
      canStart: true,
      canControl: true,
      canForceTakeover: true,
    } : {
      view,
      roles: view === "stage" ? ["worship_leader"] : ["operator"],
      canEdit: view === "operator",
      canStart: view === "operator",
      canControl: true,
      canForceTakeover: view === "operator",
    },
    viewerLayout: {
      schemaVersion: 3,
      id: view === "stage" ? "layout-worship" : "layout-production",
      name: view === "stage" ? "Worship leader" : "Production",
      targetRole: view === "stage" ? "worship_leader" : "production",
      mode: view === "stage" ? "confidence" : "production",
      fontScale: view === "stage" ? 1.08 : 0.92,
      show: { current: true, next: true, notes: true, chords: view === "stage", clock: true, serviceTimer: true, itemTimer: true, messages: true },
      version: 2,
      churchId: "must-not-survive",
      createdAt: serverNow,
    },
    session: {
      id: "session-1",
      mode: "live",
      status: "live",
      revision: 14,
      startedAt: "2026-07-11T18:00:00.000Z",
      endedAt: null,
      controller: {
        clientId: "client-1",
        displayName: "Booth iPad",
        leaseExpiresAt: "2026-07-11T18:30:30.000Z",
        ownedByViewer: true,
      },
      presence: [{
        clientId: "remote-1",
        displayName: "Pastor iPhone",
        view: "remote",
        lastSeenAt: "2026-07-11T18:29:59.000Z",
        controlRequestedAt: null,
      }],
      cursor: {
        itemId: "item-1",
        itemIndex: 0,
        stepId: "step-1",
        stepIndex: 0,
        partIndex: 0,
        sectionAnchorId: "section-1",
      },
      display: { blackout: false, chordsVisible: true, broadcastVisible: true },
      playback: null,
      timing: {
        service: {
          status: "running",
          plannedSeconds: 3_600,
          elapsedSeconds: 1_800,
          remainingSeconds: 1_800,
          overrunSeconds: 0,
          projectedEndAt: "2026-07-11T19:00:00.000Z",
          startedAt: "2026-07-11T18:00:00.000Z",
          pausedAt: null,
          accumulatedPausedMs: 0,
        },
        item: {
          itemId: "item-1",
          status: "running",
          plannedSeconds: 300,
          elapsedSeconds: 120,
          overrunSeconds: 0,
          startedAt: "2026-07-11T18:28:00.000Z",
          pausedAt: null,
          accumulatedPausedMs: 0,
        },
        countdown: {
          durationSeconds: 60,
          targetAt: "2026-07-11T18:30:30.000Z",
          remainingSeconds: 30,
        },
      },
      messages: [
        {
          id: "visible",
          body: "Repite el coro",
          tone: "urgent",
          roles: ["worship_leader"],
          sentAt: "2026-07-11T18:29:55.000Z",
          expiresAt: "2026-07-11T18:30:40.000Z",
        },
        {
          id: "wrong-role",
          body: "Baja luces",
          tone: "info",
          roles: ["av"],
          sentAt: "2026-07-11T18:29:55.000Z",
          expiresAt: "2026-07-11T18:30:40.000Z",
        },
        {
          id: "expired",
          body: "Ya pasó",
          tone: "info",
          roles: ["all"],
          sentAt: "2026-07-11T18:20:00.000Z",
          expiresAt: "2026-07-11T18:29:59.000Z",
        },
      ],
      lastCommand: { id: "command-1", type: "next", at: "2026-07-11T18:29:58.000Z" },
    },
  };
}

function liveSnapshot(view: "operator" | "stage" | "remote" = "operator") {
  return normalizePresentationLiveSnapshot(snapshotRaw(view), view, "client-1", Date.parse(serverNow));
}

const offlineContext: PresentationOfflineContext = {
  steps: [
    { itemId: "item-1", stepId: "step-1", partIndex: 0, sectionAnchorId: "section-1" },
    { itemId: "item-1", stepId: "step-2", partIndex: 0, sectionAnchorId: "section-2" },
    { itemId: "item-2", stepId: null, partIndex: 0, sectionAnchorId: null },
  ],
  plannedTiming: { serviceSeconds: 3_600, itemSecondsById: { "item-1": 300, "item-2": 180 } },
};

function cachedPackage(): CachedPresentationPackage {
  return {
    key: "account::church::service::operator::operator",
    accountId: "account-1",
    churchId: "church-1",
    serviceId: "service-1",
    view: "operator",
    roleFingerprint: "operator",
    savedAt: serverNow,
    package: {
      schemaVersion: 2,
      packageId: "sha256:package",
      checksum: "sha256:checksum",
      generatedAt: serverNow,
      scope: { accountId: "account-1", churchId: "church-1", view: "operator", roleFingerprint: "operator" },
      serviceVersion: "svc-v2",
      service: { id: "service-1", title: "Domingo", date: serverNow, type: "service", notes: null, items: [] },
      presentation: {
        schemaVersion: 1,
        serviceId: "service-1",
        serviceVersion: "svc-v2",
        viewer: { view: "operator", churchRole: "PLANNER", roles: ["operator"], canEdit: false },
        items: [],
        legacyNotes: [],
        source: "api",
      },
      plannedTiming: offlineContext.plannedTiming,
      liveSeed: {
        cursor: liveSnapshot().session!.cursor,
        display: liveSnapshot().session!.display,
        timing: liveSnapshot().session!.timing,
        countdown: liveSnapshot().session!.timing.countdown,
      },
    } satisfies PresentationPackage,
  };
}

describe("Tchurch Live Stage 2 contract", () => {
  beforeEach(() => localStorage.clear());

  it("keeps one installation client ID while every command gets a fresh ID", () => {
    const firstClient = getPresentationClientId();
    const secondClient = getPresentationClientId();
    const first = buildPresentationCommand(firstClient, "Tchurch iPad", "next", {}, 14);
    const second = buildPresentationCommand(firstClient, "Tchurch iPad", "next", {}, 15);

    expect(firstClient).toBe(secondClient);
    expect(first.commandId).not.toBe(second.commandId);
    expect(first).toMatchObject({ schemaVersion: 2, clientId: firstClient, expectedRevision: 14, type: "next", payload: {} });
  });

  it("uses an RFC 4122 v4 UUID even when randomUUID is unavailable", () => {
    const fallback = formatPresentationUuidV4(new Uint8Array(16).fill(0xab));
    expect(fallback).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fallback).toBe("abababab-abab-4bab-abab-abababababab");
  });

  it("keeps active follower polling close to one second", () => {
    expect(PRESENTATION_POLL_MS).toBeGreaterThanOrEqual(1_000);
    expect(PRESENTATION_POLL_MS).toBeLessThanOrEqual(1_250);
  });

  it("round-trips independent viewer and controller versions while accepting legacy snapshots", () => {
    const versioned = presentationSessionPath(
      "service-1",
      "stage",
      "client-1",
      14,
      "sha256:viewer-stage",
      "sha256:controller-stage",
    );
    expect(versioned).toContain("sinceRevision=14");
    expect(versioned).toContain("viewerVersion=sha256%3Aviewer-stage");
    expect(versioned).toContain("controllerVersion=sha256%3Acontroller-stage");
    const rehearsal = presentationRehearsalSessionPath(
      "service-1",
      "remote",
      "client-1",
      14,
      "sha256:viewer-remote",
      "sha256:controller-remote",
    );
    expect(rehearsal).toContain("viewerVersion=sha256%3Aviewer-remote");
    expect(rehearsal).toContain("controllerVersion=sha256%3Acontroller-remote");

    const legacyPath = presentationSessionPath("service-1", "stage", "client-1", 14, "", "");
    expect(legacyPath).not.toContain("viewerVersion");
    expect(legacyPath).not.toContain("controllerVersion");

    const legacy = snapshotRaw("stage");
    delete (legacy as { viewerVersion?: string }).viewerVersion;
    delete (legacy as { controllerVersion?: string }).controllerVersion;
    const normalized = normalizePresentationLiveSnapshot(legacy, "stage", "client-1");
    expect(normalized.viewerVersion).toBe("");
    expect(normalized.controllerVersion).toBe("");
  });

  it("fails closed when a live or rehearsal route returns the other session mode", () => {
    const rehearsal = snapshotRaw("operator");
    rehearsal.session.mode = "rehearsal";
    expect(normalizePresentationLiveSnapshot(rehearsal, "operator", "client-1", Date.now(), "rehearsal").session?.mode).toBe("rehearsal");
    expect(() => normalizePresentationLiveSnapshot(rehearsal, "operator", "client-1", Date.now(), "live")).toThrow(/SESSION_MODE_MISMATCH/);
    const missing = snapshotRaw("operator");
    delete (missing.session as { mode?: string }).mode;
    expect(() => normalizePresentationLiveSnapshot(missing, "operator", "client-1", Date.now(), "rehearsal")).toThrow(/SESSION_MODE_MISMATCH/);
  });

  it("treats the server viewer as authoritative and removes audience-only secrets", () => {
    const normalized = normalizePresentationLiveSnapshot(snapshotRaw("audience"), "operator", "client-1");

    expect(normalized.viewer).toEqual({
      view: "audience",
      canEdit: false,
      canStart: false,
      canControl: false,
      canForceTakeover: false,
    });
    expect(normalized.viewer).not.toHaveProperty("roles");
    expect(normalized.session?.controller).toBeNull();
    expect(normalized.session?.messages).toEqual([]);
    expect(normalized.session).not.toHaveProperty("presence");
    expect(normalized.viewerLayout).toBeNull();
  });

  it("keeps only the scoped viewer layout and rejects a layout for another role", () => {
    const normalized = normalizePresentationLiveSnapshot(snapshotRaw("stage"), "stage", "client-1");
    expect(normalized.viewerLayout).toEqual({
      schemaVersion: 3,
      id: "layout-worship",
      name: "Worship leader",
      targetRole: "worship_leader",
      mode: "confidence",
      fontScale: 1.08,
      show: { current: true, next: true, notes: true, chords: true, clock: true, serviceTimer: true, itemTimer: true, messages: true },
      version: 2,
    });
    expect(normalized.viewerLayout).not.toHaveProperty("churchId");
    const wrong = snapshotRaw("stage");
    wrong.viewerLayout.targetRole = "production";
    expect(normalizePresentationLiveSnapshot(wrong, "stage", "client-1").viewerLayout).toBeNull();
  });

  it("normalizes authoritative media playback and keeps media commands online-only", () => {
    const raw = snapshotRaw("operator");
    raw.session.playback = { itemId: "video-item", slideId: "video-item:video:0", kind: "video", status: "playing", positionMs: 2_000, startedAt: "2026-07-11T18:29:58.000Z", rate: 1, loop: false };
    const normalized = normalizePresentationLiveSnapshot(raw, "operator", "client-1");
    expect(normalized.session?.playback).toMatchObject({ kind: "video", status: "playing", positionMs: 2_000, rate: 1 });
    expect(buildPresentationCommand("client", "iPad", "media_seek", { positionMs: 4_000 }, 15)).toMatchObject({ type: "media_seek", payload: { positionMs: 4_000 }, expectedRevision: 15 });
    const state = createPresentationOfflineState(cachedPackage(), liveSnapshot());
    expect(() => queueOfflinePresentationCommand(state, { commandId: "media", type: "media_seek" as never, payload: { positionMs: 4_000 } as never }, offlineContext)).toThrow();
  });

  it("never infers controller ownership from a matching installation client ID", () => {
    const raw = snapshotRaw("operator");
    raw.session.controller.ownedByViewer = false;
    raw.session.controller.clientId = "client-1";

    const normalized = normalizePresentationLiveSnapshot(raw, "operator", "client-1");
    expect(normalized.session?.controller).toMatchObject({ clientId: "client-1", ownedByViewer: false });
  });

  it("defensively removes expired and wrong-role stage messages", () => {
    const normalized = liveSnapshot("stage");
    expect(normalized.session?.messages.map((message) => message.id)).toEqual(["visible"]);
    expect(normalized.session).not.toHaveProperty("presence");
  });

  it("exposes presence only to operator and remote views", () => {
    expect(liveSnapshot("operator").session?.presence).toHaveLength(1);
    expect(liveSnapshot("remote").session?.presence).toHaveLength(1);
    expect(liveSnapshot("stage").session).not.toHaveProperty("presence");
  });

  it("projects persisted service, item and countdown anchors after a 204-equivalent quiet poll", () => {
    const snapshot = liveSnapshot("operator");
    const projected = projectPresentationTiming(snapshot, Date.parse(serverNow) + 10_000)!;

    expect(projected.service.elapsedSeconds).toBe(1_810);
    expect(projected.service.remainingSeconds).toBe(1_790);
    expect(projected.item.elapsedSeconds).toBe(130);
    expect(projected.countdown?.remainingSeconds).toBe(20);
    expect(projected.service.projectedEndAt).toBe("2026-07-11T19:00:00.000Z");
  });

  it("preserves the server-derived projected end instead of rebuilding it from total duration", () => {
    const raw = snapshotRaw("operator");
    raw.session.timing.service.projectedEndAt = "2026-07-11T19:07:30.000Z";
    const snapshot = normalizePresentationLiveSnapshot(raw, "operator", "client-1", Date.parse(serverNow));
    expect(projectPresentationTiming(snapshot, Date.parse(serverNow) + 15_000)?.service.projectedEndAt).toBe("2026-07-11T19:07:30.000Z");
  });

  it("moves projected end only by new current-item overrun since the snapshot", () => {
    const raw = snapshotRaw("operator");
    raw.session.timing.item.startedAt = "2026-07-11T18:24:00.000Z";
    raw.session.timing.item.elapsedSeconds = 360;
    raw.session.timing.item.overrunSeconds = 60;
    raw.session.timing.service.projectedEndAt = "2026-07-11T19:07:30.000Z";
    const snapshot = normalizePresentationLiveSnapshot(raw, "operator", "client-1", Date.parse(serverNow));

    expect(projectPresentationTiming(snapshot, Date.parse(serverNow) + 15_000)?.service.projectedEndAt).toBe("2026-07-11T19:07:45.000Z");
  });

  it("does not advance paused clocks", () => {
    const raw = snapshotRaw("stage");
    raw.session.timing.service.status = "paused";
    raw.session.timing.service.pausedAt = "2026-07-11T18:20:00.000Z";
    raw.session.timing.service.accumulatedPausedMs = 60_000;
    const snapshot = normalizePresentationLiveSnapshot(raw, "stage", "client-1", Date.parse(serverNow));
    const timing = projectPresentationTiming(snapshot, Date.parse(serverNow) + 60_000)!;

    expect(timing.service.elapsedSeconds).toBe(1_140);
  });

  it("uses exact controller, display, timer, message and countdown payloads", () => {
    expect(buildPresentationCommand("c", "iPad", "handoff_control", { targetClientId: "target" }, 2).payload).toEqual({ targetClientId: "target" });
    expect(buildPresentationCommand("c", "iPad", "set_blackout", { blackout: true }, 2).payload).toEqual({ blackout: true });
    expect(buildPresentationCommand("c", "iPad", "set_chords", { chordsVisible: false }, 2).payload).toEqual({ chordsVisible: false });
    expect(buildPresentationCommand("c", "iPad", "timer_pause", { scope: "item" }, 2).payload).toEqual({ scope: "item" });
    expect(buildPresentationCommand("c", "iPad", "countdown_set", { durationSeconds: 300 }, 2).payload).toEqual({ durationSeconds: 300 });
    expect(buildPresentationCommand("c", "iPad", "stage_message_send", {
      body: "Puente una vez",
      tone: "urgent",
      lifetimeSeconds: 20,
      roles: ["band"],
    }, 2).payload).toMatchObject({ tone: "urgent", lifetimeSeconds: 20, roles: ["band"] });
  });

  it("keys private packages by account, church, service, view and canonical role fingerprint", () => {
    const first = presentationPackageCacheKey({
      accountId: "user-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "operator",
      roles: ["all", "operator"],
    });
    const reordered = presentationPackageCacheKey({
      accountId: "user-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "operator",
      roles: ["operator", "all", "operator"],
    });

    expect(first).toBe(reordered);
    expect(presentationRoleFingerprint(["operator", "all", "operator"])).toBe("all,operator");
    expect(first).not.toBe(presentationPackageCacheKey({
      accountId: "user-2",
      churchId: "church-1",
      serviceId: "service-1",
      view: "operator",
      roles: ["all", "operator"],
    }));
  });

  it("normalizes packages before private content can enter the offline cache", () => {
    const source = cachedPackage().package;
    const normalized = normalizePresentationPackage({
      ...source,
      plannedTiming: { serviceSeconds: 3_600, itemSecondsById: { "item-1": 300, invalid: "300" } },
      liveSeed: { ...source.liveSeed, countdown: source.liveSeed.timing.countdown },
    }, "operator");

    expect(normalized.packageId).toBe("sha256:package");
    expect(normalized.plannedTiming.itemSecondsById).toEqual({ "item-1": 300 });
    expect(normalized.presentation.viewer.view).toBe("operator");
    expect(() => normalizePresentationPackage({ ...source, checksum: "not-a-checksum" }, "operator")).toThrow(/paquete offline inválido/);
  });

  it("uses the frozen canonical object and refuses a checksum mismatch or missing WebCrypto", async () => {
    const source = cachedPackage().package;
    const canonical = canonicalPresentationPackageJson(source);
    expect(canonical).toContain('"scope":{"accountId":"account-1","churchId":"church-1","roleFingerprint":"operator","view":"operator"}');
    expect(canonical).not.toContain("generatedAt");
    expect(canonical).not.toContain("packageId");
    expect(canonical).not.toContain("checksum");
    expect(await verifyPresentationPackageIntegrity(source)).toBe(false);

    const digest = await computePresentationPackageDigest(source);
    if (digest) {
      const valid = { ...source, packageId: digest, checksum: digest };
      expect(await verifyPresentationPackageIntegrity(valid)).toBe(true);
    } else {
      expect(await verifyPresentationPackageIntegrity(source)).toBe(false);
    }
  });

  it("invalidates the active package identity when account or church changes", async () => {
    localStorage.setItem("tchurch_live_packages_v1", JSON.stringify([{ key: "private" }]));
    await activatePresentationCacheIdentity("account-1", "church-1");
    expect(localStorage.getItem("tchurch_live_packages_v1")).not.toBeNull();
    await activatePresentationCacheIdentity("account-2", "church-1");
    expect(localStorage.getItem("tchurch_live_packages_v1")).toBeNull();
  });

  it("rejects a cryptographically valid package when cached metadata and signed scope disagree", async () => {
    const source = cachedPackage().package;
    const digest = await computePresentationPackageDigest(source);
    expect(digest).toBeTruthy();
    if (!digest) return;
    const valid = { ...source, packageId: digest, checksum: digest };
    await savePresentationPackage({
      accountId: "account-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "operator",
      roles: ["operator"],
    }, valid);

    const crossScopeSource = {
      ...source,
      scope: { ...source.scope, churchId: "church-2" },
    };
    const crossScopeDigest = await computePresentationPackageDigest(crossScopeSource);
    expect(crossScopeDigest).toBeTruthy();
    if (!crossScopeDigest) return;
    const records = JSON.parse(localStorage.getItem("tchurch_live_packages_v1") || "[]");
    records[0].rawPackage = {
      ...crossScopeSource,
      packageId: crossScopeDigest,
      checksum: crossScopeDigest,
    };
    localStorage.setItem("tchurch_live_packages_v1", JSON.stringify(records));

    expect(await loadLatestPresentationPackageForIdentity(
      "account-1",
      "church-1",
      "service-1",
      ["operator"],
      "operator",
    )).toBeNull();
  });

  it("uses a trusted expected role fingerprint when restoring an offline package", async () => {
    const source = cachedPackage().package;
    const digest = await computePresentationPackageDigest(source);
    expect(digest).toBeTruthy();
    if (!digest) return;
    await savePresentationPackage({
      accountId: "account-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "operator",
      roles: ["operator"],
    }, { ...source, packageId: digest, checksum: digest });

    expect(await loadLatestPresentationPackageForIdentity(
      "account-1",
      "church-1",
      "service-1",
      ["operator"],
      "worship_leader",
    )).toBeNull();
    expect(await loadLatestPresentationPackageForIdentity(
      "account-1",
      "church-1",
      "service-1",
      ["operator"],
      "operator",
    )).not.toBeNull();
  });

  it("purges editor caches and offline drafts before saving an assigned-view downgrade", async () => {
    const editorSource = cachedPackage().package;
    const editorDigest = await computePresentationPackageDigest(editorSource);
    expect(editorDigest).toBeTruthy();
    if (!editorDigest) return;
    const editorCached = await savePresentationPackage({
      accountId: "account-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "operator",
      roles: ["operator"],
    }, { ...editorSource, packageId: editorDigest, checksum: editorDigest });
    await savePresentationOfflineState(createPresentationOfflineState(editorCached, liveSnapshot("operator")));

    const assignedRoles = ["stage", "worship_leader"] as const;
    await purgePresentationCacheForViewerDowngrade({
      accountId: "account-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "remote",
      roles: [...assignedRoles],
    });
    expect(await loadPresentationPackage({
      accountId: "account-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "operator",
      roles: ["operator"],
    })).toBeNull();
    expect(await loadPresentationOfflineState(editorCached.key)).toBeNull();

    const assignedSource = {
      ...editorSource,
      scope: {
        ...editorSource.scope,
        view: "remote" as const,
        roleFingerprint: presentationRoleFingerprint([...assignedRoles]),
      },
      presentation: {
        ...editorSource.presentation,
        viewer: {
          ...editorSource.presentation.viewer,
          view: "stage" as const,
          churchRole: "MUSICIAN",
          roles: [...assignedRoles],
          canEdit: false,
        },
      },
    };
    const assignedDigest = await computePresentationPackageDigest(assignedSource);
    expect(assignedDigest).toBeTruthy();
    if (!assignedDigest) return;
    await savePresentationPackage({
      accountId: "account-1",
      churchId: "church-1",
      serviceId: "service-1",
      view: "remote",
      roles: [...assignedRoles],
    }, { ...assignedSource, packageId: assignedDigest, checksum: assignedDigest });
    expect(await loadLatestPresentationPackageForIdentity(
      "account-1",
      "church-1",
      "service-1",
      ["operator", "remote", "stage"],
      presentationRoleFingerprint([...assignedRoles]),
    )).toMatchObject({ view: "remote", roleFingerprint: "stage,worship_leader" });
  });

  it("fails closed on a role change even when the session revision is unchanged", () => {
    const previous = liveSnapshot("operator");
    const changedRaw = snapshotRaw("remote");
    changedRaw.session.revision = previous.session!.revision;
    changedRaw.viewerVersion = "sha256:viewer-assigned";
    changedRaw.controllerVersion = previous.controllerVersion;
    changedRaw.viewer.roles = ["stage", "worship_leader"];
    changedRaw.viewer.canEdit = false;
    changedRaw.viewer.canStart = false;
    changedRaw.viewer.canForceTakeover = false;
    const changed = normalizePresentationLiveSnapshot(changedRaw, "remote", "client-1");
    const editorWorkspace = cachedPackage().package.presentation;

    expect(changed.session?.revision).toBe(previous.session?.revision);
    expect(changed.viewerVersion).not.toBe(previous.viewerVersion);
    expect(changed.controllerVersion).toBe(previous.controllerVersion);
    expect(presentationWorkspaceMatchesLiveViewer(editorWorkspace, changed.viewer)).toBe(false);
    expect(presentationPackageMatchesLiveViewer(cachedPackage().package, changed.viewer, {
      accountId: "account-1",
      churchId: "church-1",
      serviceId: "service-1",
    })).toBe(false);
  });

  it("continues navigation, display, timers and countdown locally without claiming cloud sync", () => {
    const snapshot = liveSnapshot("operator");
    const next = applyOfflinePresentationCommand(snapshot, {
      commandId: "offline-next",
      type: "next",
      payload: {},
    }, offlineContext, Date.parse(serverNow) + 5_000);
    const blackout = applyOfflinePresentationCommand(next, {
      commandId: "offline-blackout",
      type: "set_blackout",
      payload: { blackout: true },
    }, offlineContext, Date.parse(serverNow) + 6_000);
    const paused = applyOfflinePresentationCommand(blackout, {
      commandId: "offline-pause",
      type: "timer_pause",
      payload: { scope: "item" },
    }, offlineContext, Date.parse(serverNow) + 7_000);

    expect(next.session?.cursor).toMatchObject({ stepId: "step-2", stepIndex: 1 });
    expect(blackout.session?.display.blackout).toBe(true);
    expect(paused.session?.timing.item).toMatchObject({ status: "paused", pausedAt: "2026-07-11T18:30:07.000Z" });
    expect(paused.session?.revision).toBe(14);
  });

  it("resets item timing when an offline jump enters another service item", () => {
    const jumped = applyOfflinePresentationCommand(liveSnapshot("operator"), {
      commandId: "offline-jump",
      type: "jump",
      payload: { itemId: "item-2", stepId: null },
    }, offlineContext, Date.parse(serverNow) + 2_000);

    expect(jumped.session?.cursor).toMatchObject({ itemId: "item-2", stepId: null, stepIndex: 0, partIndex: 0 });
    expect(jumped.session?.timing.item).toMatchObject({ itemId: "item-2", plannedSeconds: 180, elapsedSeconds: 0 });
  });

  it("queues original command IDs and builds one conflict-safe reconcile", () => {
    const cache = cachedPackage();
    let state = createPresentationOfflineState(cache, liveSnapshot("operator"));
    state = queueOfflinePresentationCommand(state, {
      commandId: "original-next",
      type: "next",
      payload: {},
    }, offlineContext, Date.parse(serverNow) + 1_000);
    state = queueOfflinePresentationCommand(state, {
      commandId: "original-blackout",
      type: "set_blackout",
      payload: { blackout: true },
    }, offlineContext, Date.parse(serverNow) + 2_000);
    const reconcile = buildOfflineReconcileCommand(state, "client-1", "Tchurch iPad");

    expect(state.baseRevision).toBe(14);
    expect(state.commands.map((command) => command.commandId)).toEqual(["original-next", "original-blackout"]);
    expect(reconcile).toMatchObject({
      type: "offline_reconcile",
      expectedRevision: 14,
      payload: { baseRevision: 14, commands: state.commands },
    });
    expect(reconcile.commandId).not.toBe("original-next");
  });

  it("refuses local continuation without controller ownership or beyond 100 actions", () => {
    const cache = cachedPackage();
    const withoutControl = liveSnapshot("operator");
    withoutControl.session!.controller!.ownedByViewer = false;
    const state = createPresentationOfflineState(cache, withoutControl);
    expect(() => queueOfflinePresentationCommand(state, { commandId: "x", type: "next", payload: {} }, offlineContext)).toThrow(/no tenía el control/);

    const controlled = createPresentationOfflineState(cache, liveSnapshot("operator"));
    controlled.commands = Array.from({ length: MAX_OFFLINE_PRESENTATION_COMMANDS }, (_, index) => ({
      commandId: `command-${index}`,
      type: "next",
      payload: {},
    })) as PresentationQueuedCommand[];
    expect(() => queueOfflinePresentationCommand(controlled, { commandId: "overflow", type: "next", payload: {} }, offlineContext)).toThrow(/100 acciones/);
  });

  it("surfaces OFFLINE_DIVERGED and accepts the server-filtered current snapshot", () => {
    const current = snapshotRaw("stage");
    current.session.revision = 22;
    const error = new ApiError("Diverged", 409, { error: "OFFLINE_DIVERGED", current });
    const conflict = getPresentationConflictSnapshot(error, "stage", "client-1");

    expect(getPresentationApiErrorCode(error)).toBe("OFFLINE_DIVERGED");
    expect(conflict?.session?.revision).toBe(22);
    expect(conflict?.session?.messages.map((message) => message.id)).toEqual(["visible"]);
  });

  it("treats 401/403 as authoritative revocation rather than offline continuity", () => {
    expect(isPresentationAuthorizationError(new ApiError("Unauthorized", 401, { error: "UNAUTHENTICATED" }))).toBe(true);
    expect(isPresentationAuthorizationError(new ApiError("Forbidden", 403, { error: "FORBIDDEN" }))).toBe(true);
    expect(isPresentationAuthorizationError(new ApiError("Offline", 0, { error: "OFFLINE" }))).toBe(false);
    expect(isPresentationAuthorizationError(new ApiError("Conflict", 409, { error: "REVISION_CONFLICT" }))).toBe(false);
  });

  it("allows an inactive authoritative session without fabricating local state", () => {
    const raw = snapshotRaw("remote");
    raw.session = null as never;
    const snapshot = normalizePresentationLiveSnapshot(raw, "remote", "client-1");
    expect(snapshot.session).toBeNull();
    expect(snapshot.viewer).toMatchObject({ view: "remote", canControl: true });
  });

  it("resolves an item-local cursor by item, step and page part instead of trusting stepIndex globally", () => {
    const steps = [
      { itemId: "item-1", stepId: "verse-1", partIndex: 0, sectionAnchorId: "verse" },
      { itemId: "item-1", stepId: "verse-1", partIndex: 1, sectionAnchorId: "verse" },
      { itemId: "item-2", stepId: "chorus-1", partIndex: 0, sectionAnchorId: "chorus" },
    ];
    expect(resolvePresentationCursorIndex({ itemId: "item-1", itemIndex: 0, stepId: "verse-1", stepIndex: 0, partIndex: 1, sectionAnchorId: "verse" }, steps)).toBe(1);
    expect(resolvePresentationCursorIndex({ itemId: "item-1", itemIndex: 0, stepId: "verse-1", stepIndex: 0, partIndex: 99, sectionAnchorId: "verse" }, steps)).toBe(1);
    expect(resolvePresentationCursorIndex({ itemId: "item-2", itemIndex: 1, stepId: "missing", stepIndex: 0, partIndex: 0, sectionAnchorId: "chorus" }, steps)).toBe(2);
  });

  it("uses the exact rendered part as the offline next/previous origin", () => {
    const context: PresentationOfflineContext = {
      steps: [
        { itemId: "item-1", stepId: "verse-1", partIndex: 0, sectionAnchorId: "verse" },
        { itemId: "item-1", stepId: "verse-1", partIndex: 1, sectionAnchorId: "verse" },
        { itemId: "item-1", stepId: "chorus-1", partIndex: 0, sectionAnchorId: "chorus" },
        { itemId: "item-2", stepId: null, partIndex: 0, sectionAnchorId: null },
      ],
      plannedTiming: offlineContext.plannedTiming,
    };
    const raw = snapshotRaw("operator");
    raw.session.cursor = {
      itemId: "item-1",
      itemIndex: 0,
      stepId: "verse-1",
      stepIndex: 0,
      partIndex: 1,
      sectionAnchorId: "verse",
    };
    const snapshot = normalizePresentationLiveSnapshot(raw, "operator", "client-1", Date.parse(serverNow));
    const next = applyOfflinePresentationCommand(snapshot, { commandId: "next-part", type: "next", payload: {} }, context);
    expect(next.session?.cursor).toMatchObject({ itemId: "item-1", stepId: "chorus-1", stepIndex: 1, partIndex: 0 });

    const cueRaw = snapshotRaw("operator");
    cueRaw.session.cursor = {
      itemId: "item-2",
      itemIndex: 1,
      stepId: null,
      stepIndex: 0,
      partIndex: 0,
      sectionAnchorId: null,
    };
    const cue = normalizePresentationLiveSnapshot(cueRaw, "operator", "client-1", Date.parse(serverNow));
    const previous = applyOfflinePresentationCommand(cue, { commandId: "previous-part", type: "previous", payload: {} }, context);
    expect(previous.session?.cursor).toMatchObject({ itemId: "item-1", stepId: "chorus-1", stepIndex: 1, partIndex: 0 });
  });
});
