import { describe, expect, it } from "vitest";
import {
  mergePresentationChatMessages,
  normalizePlanningCenterConnect,
  parsePlanningCenterMobileRelay,
  planningCenterRelayErrorNotice,
  normalizePlanningCenterCatalog,
  normalizePlanningCenterImport,
  normalizePresentationAutomationAcknowledgement,
  normalizePresentationAutomationDispatch,
  normalizePresentationAutomationEnvelope,
  normalizePresentationAutomationPending,
  normalizePresentationBroadcastEnvelope,
  normalizePresentationBroadcastLinkCreated,
  normalizePresentationChatEnvelope,
  normalizePresentationIntegrationSummary,
  normalizePresentationServiceReport,
  type PresentationChatMessage,
} from "./presentationProduction";

const now = "2026-07-12T13:00:00.000Z";

function chatMessage(overrides: Partial<PresentationChatMessage> = {}): PresentationChatMessage {
  return {
    id: "msg-00000001",
    clientMessageId: "client-msg-00000001",
    channel: "production",
    body: "Cámara dos lista",
    sender: { id: "user-00000001", displayName: "Producción" },
    sentAt: now,
    ...overrides,
  };
}

describe("presentation production v4 contracts", () => {
  it("deduplicates reconnect chat by sender/client id and keeps total sentAt/id order", () => {
    const original = chatMessage();
    const retried = chatMessage({ id: "msg-00000003", body: "Cámara dos confirmada" });
    const earlier = chatMessage({ id: "msg-00000002", clientMessageId: "client-msg-00000002", sentAt: "2026-07-12T12:59:59.000Z" });
    expect(mergePresentationChatMessages([original], [retried, earlier]).map((message) => message.id)).toEqual(["msg-00000002", "msg-00000003"]);
    expect(normalizePresentationChatEnvelope({ schemaVersion: 4, serviceId: "service-0001", mode: "live", serverNow: now, messages: [original, original], nextCursor: "cursor-1" }).messages).toHaveLength(1);
  });

  it("keeps chat private by rejecting audience/public fields and unknown sender data", () => {
    const base = { schemaVersion: 4, serviceId: "service-0001", mode: "live", serverNow: now, messages: [chatMessage()], nextCursor: null };
    expect(() => normalizePresentationChatEnvelope({ ...base, audience: true })).toThrow(/no está permitido/i);
    expect(() => normalizePresentationChatEnvelope({ ...base, messages: [{ ...chatMessage(), sender: { ...chatMessage().sender, email: "private@example.com" } }] })).toThrow(/no está permitido/i);
  });

  it("parses bounded automation rules and rejects extra executable fields", () => {
    const envelope = normalizePresentationAutomationEnvelope({
      schemaVersion: 4,
      serviceId: "service-0001",
      revision: 3,
      rules: [{
        id: "rule-00000001",
        name: "Avisar al entrar en coro",
        enabled: true,
        modes: { live: true, rehearsal: true },
        priority: 10,
        trigger: { type: "slide_entered", slideKinds: ["lyrics"] },
        actions: [{ type: "stage_message", body: "Coro", tone: "info", roles: ["band"], lifetimeSeconds: 20 }],
        version: 1,
        updatedAt: now,
      }],
    });
    expect(envelope.rules[0].trigger).toEqual({ type: "slide_entered", slideKinds: ["lyrics"] });
    const stageMessage = { type: "stage_message" as const, body: "Coro", tone: "info" as const, roles: ["band" as const], lifetimeSeconds: 120 };
    expect(normalizePresentationAutomationEnvelope({ ...envelope, rules: [{ ...envelope.rules[0], actions: [stageMessage] }] }).rules[0].actions[0]).toMatchObject({ lifetimeSeconds: 120 });
    expect(() => normalizePresentationAutomationEnvelope({ ...envelope, rules: [{ ...envelope.rules[0], actions: [{ ...stageMessage, lifetimeSeconds: 121 }] }] })).toThrow(/lifetimeSeconds es inválido/i);
    expect(() => normalizePresentationAutomationEnvelope({ ...envelope, rules: [{ ...envelope.rules[0], actions: [{ type: "obs_scene", sceneName: "Cam 1", startStream: true }] }] })).toThrow(/no está permitido/i);
  });

  it("requires rehearsal automation dispatches to remain simulated", () => {
    const action = { deliveryId: "delivery-0001", ruleId: "rule-00000001", type: "obs_scene", payload: { sceneName: "Wide" } };
    expect(normalizePresentationAutomationDispatch({ schemaVersion: 4, serviceId: "service-0001", mode: "rehearsal", idempotent: false, simulated: true, actions: [action] }).simulated).toBe(true);
    expect(() => normalizePresentationAutomationDispatch({ schemaVersion: 4, serviceId: "service-0001", mode: "rehearsal", idempotent: false, simulated: false, actions: [action] })).toThrow(/nunca puede ejecutar/i);
    expect(() => normalizePresentationAutomationDispatch({ schemaVersion: 4, serviceId: "service-0001", mode: "live", idempotent: false, simulated: false, actions: [{ ...action, payload: { type: "set_blackout", enabled: true } }] })).toThrow(/redefinir/i);
    expect(normalizePresentationAutomationPending({ schemaVersion: 4, serviceId: "service-0001", mode: "live", idempotent: false, simulated: false, actions: [], leaseExpiresAt: null }).actions).toEqual([]);
    expect(normalizePresentationAutomationAcknowledgement({ schemaVersion: 4, deliveryId: "delivery-0001", status: "applied", idempotent: true }).idempotent).toBe(true);
  });

  it("accepts only aggregate live reports with all privacy flags false", () => {
    const report = {
      schemaVersion: 4,
      generatedAt: now,
      service: { id: "service-0001", title: "Domingo", date: "2026-07-12T15:00:00.000Z" },
      status: "completed",
      session: { id: "session-0001", startedAt: "2026-07-12T15:00:00.000Z", endedAt: "2026-07-12T16:00:00.000Z", durationSeconds: 3600 },
      timing: { plannedSeconds: 3300, actualSeconds: 3600, overrunSeconds: 300 },
      activity: { commands: 80, navigations: 42, blackoutChanges: 2, mediaPlays: 3, stageMessages: 4, chatMessages: 9, automationEvents: 8, automationApplied: 7, automationFailed: 1 },
      operators: { uniqueCount: 2 },
      privacy: { containsMessageBodies: false, containsTokens: false, containsNotes: false, containsUserEmails: false },
    } as const;
    expect(normalizePresentationServiceReport(report).activity.chatMessages).toBe(9);
    expect(() => normalizePresentationServiceReport({ ...report, messageBodies: ["private"] })).toThrow(/no está permitido/i);
    expect(() => normalizePresentationServiceReport({ ...report, privacy: { ...report.privacy, containsNotes: true } })).toThrow(/información privada/i);
  });

  it("parses honest integration capabilities and rejects native NDI claims", () => {
    const summary = normalizePresentationIntegrationSummary({
      schemaVersion: 4,
      integrations: [
        { provider: "planning_center", status: "connected", externalOrganization: { id: "org-00000001", name: "Tchurch" }, scopes: ["services"], connectedAt: now, lastSyncAt: null },
        { provider: "propresenter", status: "local_only", capabilities: ["text_export", "local_api"] },
        { provider: "obs", status: "local_only", capabilities: ["browser_source", "obs_websocket_5"] },
        { provider: "ndi_bridge", status: "requires_tchurch_studio", capabilities: ["frame_feed"] },
      ],
    });
    expect(summary.integrations).toHaveLength(4);
    expect(() => normalizePresentationIntegrationSummary({ schemaVersion: 4, integrations: [{ provider: "ndi_bridge", status: "native", capabilities: ["ndi_sdk"] }] })).toThrow();
  });

  it("parses Planning Center preview/import without accepting hidden credentials", () => {
    const authorize = new URL("https://api.planningcenteronline.com/oauth/authorize");
    authorize.searchParams.set("client_id", "client_00000001");
    authorize.searchParams.set("redirect_uri", "https://www.tchurchapp.com/api/presentation-integrations/planning-center/callback");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", "services");
    authorize.searchParams.set("state", "s".repeat(43));
    authorize.searchParams.set("code_challenge", "c".repeat(43));
    authorize.searchParams.set("code_challenge_method", "S256");
    expect(normalizePlanningCenterConnect({ schemaVersion: 4, provider: "planning_center", authorizeUrl: authorize.toString(), expiresAt: now }).provider).toBe("planning_center");
    const duplicate = new URL(authorize);
    duplicate.searchParams.append("state", "x".repeat(43));
    expect(() => normalizePlanningCenterConnect({ schemaVersion: 4, provider: "planning_center", authorizeUrl: duplicate.toString(), expiresAt: now })).toThrow(/OAuth inválida/i);
    const wrongRedirect = new URL(authorize);
    wrongRedirect.searchParams.set("redirect_uri", "https://evil.example/callback");
    expect(() => normalizePlanningCenterConnect({ schemaVersion: 4, provider: "planning_center", authorizeUrl: wrongRedirect.toString(), expiresAt: now })).toThrow(/OAuth inválida/i);
    expect(normalizePlanningCenterCatalog({ schemaVersion: 4, provider: "planning_center", resource: "service_types", items: [{ id: "type-00000001", name: "Domingo" }], nextOffset: null }).resource).toBe("service_types");
    const preview = { schemaVersion: 4, provider: "planning_center", operation: "preview", source: { serviceTypeId: "type-00000001", planId: "plan-00000001", title: "Domingo", dates: "12 jul" }, changes: { create: 3, update: 1, unchanged: 4, reorderedLocal: 2 }, applied: false, syncedAt: null } as const;
    expect(normalizePlanningCenterImport(preview).applied).toBe(false);
    expect(normalizePlanningCenterImport(preview).changes.reorderedLocal).toBe(2);
    expect(() => normalizePlanningCenterImport({ ...preview, accessToken: "secret" })).toThrow(/no está permitido/i);
    expect(() => normalizePlanningCenterImport({ ...preview, applied: true })).toThrow(/vista previa/i);
  });

  it("accepts the bounded catalog values emitted by the canonical Planning Center server contract", () => {
    const longText = "x".repeat(500);
    const plans = normalizePlanningCenterCatalog({
      schemaVersion: 4,
      provider: "planning_center",
      resource: "plans",
      serviceTypeId: "type-00000001",
      items: [{ id: "plan-00000001", title: longText, dates: "", sortDate: "2026-07-12" }],
      nextOffset: 25,
    });
    expect(plans).toMatchObject({ resource: "plans", nextOffset: 25, items: [{ sortDate: "2026-07-12", title: longText }] });

    const plan = normalizePlanningCenterCatalog({
      schemaVersion: 4,
      provider: "planning_center",
      resource: "plan",
      serviceTypeId: "type-00000001",
      plan: { id: "plan-00000001", title: "Domingo", dates: "12 jul", sortDate: "2026-07-12" },
      items: [{ id: "item-00000001", title: longText, itemType: longText, lengthSeconds: 172_800, sequence: -1, keyName: longText }],
    });
    expect(plan).toMatchObject({ resource: "plan", plan: { sortDate: "2026-07-12" }, items: [{ lengthSeconds: 172_800, sequence: -1, keyName: longText }] });
    expect(() => normalizePlanningCenterCatalog({ schemaVersion: 4, provider: "planning_center", resource: "plans", serviceTypeId: "type-00000001", items: [{ id: "plan-1", title: "Domingo", dates: "", sortDate: "bad\u0000date" }], nextOffset: null })).toThrow(/sortDate es inválido/i);
    expect(() => normalizePlanningCenterCatalog({ schemaVersion: 4, provider: "planning_center", resource: "service_types", items: Array.from({ length: 101 }, (_, index) => ({ id: `type-${index}`, name: "Domingo" })), nextOffset: null })).toThrow(/demasiados elementos/i);
  });

  it("parses the one-use mobile Planning Center relay without carrying it into the clean route", () => {
    const handoff = "h".repeat(43);
    const complete = parsePlanningCenterMobileRelay(`tchurchapp://tchurchapp.com/#/app/services/service-0001/presentation?planningCenter=complete&handoff=${handoff}`);
    expect(complete).toMatchObject({ serviceId: "service-0001", route: "/app/services/service-0001/presentation", outcome: "complete", handoff });
    expect(complete?.route).not.toContain(handoff);
    expect(parsePlanningCenterMobileRelay(`tchurchapp://tchurchapp.com/#/app/services/service-0001/presentation?planningCenter=complete&handoff=${handoff}&code=leak`)).toBeNull();
    expect(parsePlanningCenterMobileRelay("tchurchapp://tchurchapp.com/#/app/services/service-0001/presentation?planningCenter=error&code=OAUTH_DECLINED")).toMatchObject({ outcome: "error", code: "OAUTH_DECLINED" });
    expect(parsePlanningCenterMobileRelay("tchurchapp://tchurchapp.com/#/app/services/service-0001/presentation?planningCenter=error&code=OAUTH_STATE_INVALID")).toMatchObject({ outcome: "error", code: "OAUTH_CALLBACK_ERROR" });
    expect(parsePlanningCenterMobileRelay("tchurchapp://tchurchapp.com/#/app/services/service-0001/presentation?planningCenter=error&code=%3Cimg%20src%3Dx%3E")).toBeNull();
    expect(planningCenterRelayErrorNotice("<img src=x>")).toBe("No se pudo completar la conexión con Planning Center. Intenta conectar otra vez.");
    expect(planningCenterRelayErrorNotice("<img src=x>")).not.toContain("<img");
    expect(parsePlanningCenterMobileRelay("https://evil.example/#/app/services/service-0001/presentation?planningCenter=complete&handoff=" + handoff)).toBeNull();
  });

  it("requires a separate one-time browser-source fragment token", () => {
    const link = { id: "broadcast-link-0001", label: "OBS", scope: "browser_source", expiresAt: "2026-07-13T13:00:00.000Z", revokedAt: null, lastUsedAt: null, createdAt: now };
    const token = "opaque_token_with_more_than_32_chars_000001";
    const created = normalizePresentationBroadcastLinkCreated({ schemaVersion: 4, link, token, url: `https://www.tchurchapp.com/broadcast#${token}` });
    expect(created.url).toContain("/broadcast#");
    expect(() => normalizePresentationBroadcastLinkCreated({ schemaVersion: 4, link, token, url: `https://www.tchurchapp.com/broadcast?token=${token}` })).toThrow(/fragment/i);
    expect(() => normalizePresentationBroadcastLinkCreated({ schemaVersion: 4, link, token, url: `https://evil.example/broadcast#${token}` })).toThrow(/fragment/i);
    expect(() => normalizePresentationBroadcastLinkCreated({ schemaVersion: 4, link, token: "short", url: "https://www.tchurchapp.com/broadcast#short" })).toThrow(/entropía/i);
    expect(() => normalizePresentationBroadcastLinkCreated({ schemaVersion: 4, link, token: `${token}x`, url: `https://www.tchurchapp.com/broadcast#${token}x` })).toThrow(/entropía/i);
    expect(() => normalizePresentationBroadcastLinkCreated({ schemaVersion: 4, link, token, url: `https://www.tchurchapp.com:444/broadcast#${token}` })).toThrow(/fragment/i);
  });

  it("rejects private fields from the minimal broadcast feed", () => {
    const theme = {
      fontFamily: "sans",
      fontWeight: 700,
      textColor: "#ffffff",
      accentColor: "#f4c95d",
      background: { type: "color", color: "#000000", imageUrl: null, overlayColor: "#000000", overlayOpacity: 0.5 },
      placement: "center",
      logo: { url: null, position: "none" },
      copyright: { visible: false, position: "bottom_right" },
    };
    const feed = {
      schemaVersion: 4,
      serverNow: now,
      serviceId: "service-0001",
      status: "live",
      revision: 5,
      contentVersion: `sha256:${"a".repeat(64)}`,
      frame: { visible: true, blackout: false, current: { id: "slide-1", kind: "lyrics", title: "Coro", lines: ["Santo"], media: null }, next: null, theme, playback: null, countdown: null },
    };
    expect(normalizePresentationBroadcastEnvelope(feed).frame.current?.title).toBe("Coro");
    expect(() => normalizePresentationBroadcastEnvelope({ ...feed, frame: { ...feed.frame, chat: [chatMessage()] } })).toThrow(/no está permitido/i);
    expect(() => normalizePresentationBroadcastEnvelope({ ...feed, notes: ["private"] })).toThrow(/no está permitido/i);
  });
});
