import { describe, expect, it } from "vitest";
import { eventCollectionPath, eventCrudRequest, eventDetailPath } from "./api";

describe("event CRUD API routes", () => {
  it("builds the same create/read/update/delete routes the iPhone app calls", () => {
    const payload = { title: "Dia de parque", date: "2026-06-20T14:00:00.000Z" };

    expect(eventCollectionPath("limit=200")).toBe("/events?limit=200");
    expect(eventDetailPath("event 1")).toBe("/events/event%201");
    expect(eventCrudRequest("create", payload)).toEqual({
      path: "/events",
      options: { method: "POST", body: JSON.stringify(payload) },
    });
    expect(eventCrudRequest("read", "event 1")).toEqual({
      path: "/events/event%201",
      options: {},
    });
    expect(eventCrudRequest("update", "event 1", { title: "Updated" })).toEqual({
      path: "/events/event%201",
      options: { method: "PUT", body: JSON.stringify({ title: "Updated" }) },
    });
    expect(eventCrudRequest("delete", "event 1")).toEqual({
      path: "/events/event%201",
      options: { method: "DELETE" },
    });
  });
});
