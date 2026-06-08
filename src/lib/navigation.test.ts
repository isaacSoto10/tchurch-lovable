import { describe, expect, it } from "vitest";
import { normalizeAppRoute, routeFromAppUrl, routeFromNotificationData } from "@/lib/navigation";

describe("mobile app navigation helpers", () => {
  it("normalizes app-relative routes", () => {
    expect(normalizeAppRoute("/events/event-1")).toBe("/app/events/event-1");
    expect(normalizeAppRoute("/app/events/event-1/qr")).toBe("/app/events/event-1/qr");
    expect(normalizeAppRoute("#/app/events/event-1")).toBe("/app/events/event-1");
  });

  it("resolves supported deep link URL shapes to event routes", () => {
    expect(routeFromAppUrl("https://tchurchapp.com/app/events/event-1")).toBe("/app/events/event-1");
    expect(routeFromAppUrl("tchurchapp://app/events/event-1/qr")).toBe("/app/events/event-1/qr");
    expect(routeFromAppUrl("tchurchapp://events/event-1/scanner")).toBe("/app/events/event-1/scanner");
  });

  it("builds event routes from push notification payloads", () => {
    expect(routeFromNotificationData({ eventId: "event-1" })).toBe("/app/events/event-1");
    expect(routeFromNotificationData({ event_id: "event-1", action: "scanner" })).toBe("/app/events/event-1/scanner");
    expect(routeFromNotificationData({ event: { id: "event-1" }, tab: "admin" })).toBe("/app/events/event-1/admin");
    expect(routeFromNotificationData({ route: "/events/event-1/qr" })).toBe("/app/events/event-1/qr");
  });
});
