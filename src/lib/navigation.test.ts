import { describe, expect, it } from "vitest";
import {
  areAppRoutesEquivalent,
  normalizeAppRoute,
  routeFromAppUrl,
  routeFromNotificationData,
  shouldApplyNativeLaunchRoute,
} from "@/lib/navigation";

describe("mobile app navigation helpers", () => {
  it("normalizes app-relative routes", () => {
    expect(normalizeAppRoute("/events/event-1")).toBe("/app/events/event-1");
    expect(normalizeAppRoute("/app/events/event-1/qr")).toBe("/app/events/event-1/qr");
    expect(normalizeAppRoute("#/app/events/event-1")).toBe("/app/events/event-1");
    expect(normalizeAppRoute("/events/event-1?tab=registration")).toBe("/app/events/event-1/rsvp");
    expect(normalizeAppRoute("/app/events/event-1?tab=rsvp")).toBe("/app/events/event-1/rsvp");
  });

  it("resolves supported deep link URL shapes to event routes", () => {
    expect(routeFromAppUrl("https://tchurchapp.com/app/events/event-1")).toBe("/app/events/event-1");
    expect(routeFromAppUrl("https://tchurchapp.com/events/event-1?tab=registration")).toBe("/app/events/event-1/rsvp");
    expect(routeFromAppUrl("tchurchapp://app/events/event-1/qr")).toBe("/app/events/event-1/qr");
    expect(routeFromAppUrl("tchurchapp://events/event-1/scanner")).toBe("/app/events/event-1/scanner");
  });

  it("resolves supported ministry deep links", () => {
    expect(routeFromAppUrl("https://tchurchapp.com/app/ministries/ministry-1")).toBe("/app/ministries/ministry-1");
    expect(routeFromAppUrl("tchurchapp://app/ministries/ministry-1")).toBe("/app/ministries/ministry-1");
    expect(routeFromAppUrl("tchurchapp://ministries/ministry-1")).toBe("/app/ministries/ministry-1");
  });

  it("preserves church invite query deep links", () => {
    expect(routeFromAppUrl("tchurchapp://tchurchapp.com?code=ABC12345")).toBe("/join-church?code=ABC12345");
    expect(routeFromAppUrl("https://www.tchurchapp.com?code=ABC12345")).toBe("/join-church?code=ABC12345");
  });

  it("builds event routes from push notification payloads", () => {
    expect(routeFromNotificationData({ eventId: "event-1" })).toBe("/app/events/event-1");
    expect(routeFromNotificationData({ event_id: "event-1", action: "scanner" })).toBe("/app/events/event-1/scanner");
    expect(routeFromNotificationData({ event: { id: "event-1" }, tab: "admin" })).toBe("/app/events/event-1/admin");
    expect(routeFromNotificationData({ route: "/events/event-1/qr" })).toBe("/app/events/event-1/qr");
    expect(routeFromNotificationData("events/event-1/participation")).toBe("/app/events/event-1/participation");
  });

  it("resolves event routes from iOS/APNs-style nested push data", () => {
    expect(routeFromNotificationData({
      aps: { alert: { title: "Evento" } },
      data: { eventId: "event-2", screen: "check-in" },
    })).toBe("/app/events/event-2/check-in");

    expect(routeFromNotificationData({
      aps: { alert: "Scanner" },
      payload: JSON.stringify({ event_id: "event-3", action: "scanner" }),
    })).toBe("/app/events/event-3/scanner");

    expect(routeFromNotificationData({
      data: { route: "/events/event-4/qr" },
    })).toBe("/app/events/event-4/qr");
  });

  it("supports Android push aliases for event navigation", () => {
    expect(routeFromNotificationData({ eventID: "event-5", tab: "myQr" })).toBe("/app/events/event-5/qr");
    expect(routeFromNotificationData({ eventId: "event-6", click_action: "event_check_in" })).toBe("/app/events/event-6/check-in");
    expect(routeFromNotificationData({ metadata: { targetUrl: "events/event-7/scanner" } })).toBe("/app/events/event-7/scanner");
    expect(routeFromNotificationData({ notification: { event_id: "event-8", view: "signup_items" } })).toBe("/app/events/event-8/participation");
    expect(routeFromNotificationData({ customData: JSON.stringify({ event_id: "event-9", type: "event_qr" }) })).toBe("/app/events/event-9/qr");
  });

  it("guards native launch routes from overriding in-app navigation", () => {
    expect(areAppRoutesEquivalent("/app", "/app/")).toBe(true);
    expect(shouldApplyNativeLaunchRoute("/app/ministries", "/app", "/app")).toBe(true);
    expect(shouldApplyNativeLaunchRoute("/app/ministries", "/app/ministries", "/app/ministries/ministry-1")).toBe(false);
    expect(shouldApplyNativeLaunchRoute("/app/ministries", "/app/ministries", "/app/ministries")).toBe(false);
  });
});
