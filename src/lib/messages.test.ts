import { describe, expect, it } from "vitest";
import {
  buildMessagesRealtimeUrl,
  formatLastActivity,
  getChannelPreview,
  isMessageEdited,
  markMessageDeleted,
  normalizeChannel,
  normalizeMessage,
  parseMessagesRealtimeFrame,
  shouldStickToMessageBottom,
  upsertMessage,
  withLocalReaction,
} from "./messages";

describe("messages helpers", () => {
  it("normalizes planned channel fields and preview fallbacks", () => {
    const channel = normalizeChannel({
      id: "channel-1",
      name: "Announcements",
      type: "announcement",
      latestMessage: { content: "Tonight's rehearsal moved", createdAt: "2026-06-24T15:00:00.000Z" },
      unreadMessageCount: 3,
      canPost: false,
      canModerate: true,
    });

    expect(channel.type).toBe("announcement");
    expect(channel.lastPreview).toBe("Tonight's rehearsal moved");
    expect(channel.lastMessageAt).toBe("2026-06-24T15:00:00.000Z");
    expect(channel.unreadCount).toBe(3);
    expect(channel.canPost).toBe(false);
    expect(channel.canModerate).toBe(true);
    expect(channel.readOnlyReason).toContain("admins");
  });

  it("uses readable channel preview defaults", () => {
    expect(
      getChannelPreview(
        normalizeChannel({
          id: "general",
          name: "General",
          type: "church",
        }),
      ),
    ).toBe("Open the conversation.");
  });

  it("normalizes reactions and edited state", () => {
    const message = normalizeMessage({
      id: "message-1",
      content: "Updated",
      userId: "user-1",
      authorName: "Ada Lovelace",
      createdAt: "2026-06-24T14:00:00.000Z",
      updatedAt: "2026-06-24T14:01:03.000Z",
      isMine: true,
      attachments: [{ id: "att-1", fileName: "schedule.pdf", mimeType: "application/pdf", sizeBytes: 2048 }],
      reactions: { "🙏": 2 },
    });

    expect(message.canEdit).toBe(true);
    expect(message.attachments[0]).toMatchObject({
      id: "att-1",
      name: "schedule.pdf",
      contentType: "application/pdf",
      size: 2048,
    });
    expect(message.reactions).toEqual([{ emoji: "🙏", count: 2, reactedByMe: false }]);
    expect(isMessageEdited(message)).toBe(true);
  });

  it("upserts and sorts messages by creation time", () => {
    const first = normalizeMessage({ id: "2", content: "Second", createdAt: "2026-06-24T16:00:00.000Z" });
    const second = normalizeMessage({ id: "1", content: "First", createdAt: "2026-06-24T15:00:00.000Z" });

    expect(upsertMessage([first], second).map((message) => message.id)).toEqual(["1", "2"]);
  });

  it("marks deleted messages as tombstones", () => {
    const message = normalizeMessage({
      id: "message-1",
      content: "Remove me",
      createdAt: "2026-06-24T14:00:00.000Z",
      isMine: true,
    });

    const [deleted] = markMessageDeleted([message], "message-1", "2026-06-24T14:05:00.000Z");
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.content).toBe("");
    expect(deleted.canDelete).toBe(false);
  });

  it("applies local reaction toggles", () => {
    const message = normalizeMessage({ id: "message-1", createdAt: "2026-06-24T14:00:00.000Z" });
    const reacted = withLocalReaction(message, "❤️", true);
    const removed = withLocalReaction(reacted, "❤️", false);

    expect(reacted.reactions).toEqual([{ emoji: "❤️", count: 1, reactedByMe: true }]);
    expect(removed.reactions).toEqual([]);
  });

  it("formats relative activity", () => {
    const now = new Date("2026-06-24T16:30:00.000Z");
    expect(formatLastActivity("2026-06-24T16:25:00.000Z", now)).toBe("5m ago");
    expect(formatLastActivity("2026-06-24T14:20:00.000Z", now, "es")).toBe("Hace 2 h");
  });

  it("builds websocket urls from explicit urls or token responses", () => {
    expect(
      buildMessagesRealtimeUrl("https://www.tchurchapp.com/api", { wsUrl: "/api/realtime/messages?token=abc" }, "channel-1"),
    ).toBe("wss://www.tchurchapp.com/api/realtime/messages?token=abc&channelId=channel-1");

    expect(
      buildMessagesRealtimeUrl("https://www.tchurchapp.com/api", { websocketUrl: "https://worker.example/realtime/messages", token: "signed" }, "channel-1"),
    ).toBe("wss://worker.example/realtime/messages?token=signed&channelId=channel-1");

    expect(
      buildMessagesRealtimeUrl("http://localhost:3000/api", { token: "abc" }, "channel-1"),
    ).toBe("ws://localhost:3000/api/realtime/messages?token=abc&channelId=channel-1");

    expect(
      buildMessagesRealtimeUrl("http://localhost:3000/api", { enabled: false, token: "abc" }, "channel-1"),
    ).toBeNull();
  });

  it("parses nested worker message events", () => {
    expect(parseMessagesRealtimeFrame(JSON.stringify({
      type: "message.event",
      event: {
        type: "message.created",
        channelId: "channel-1",
        messageId: "message-1",
        actorUserId: "user-2",
      },
    }))).toEqual({
      kind: "message-event",
      channelId: "channel-1",
      eventType: "message.created",
      messageId: "message-1",
      actorUserId: "user-2",
    });
  });

  it("parses typing and presence frames without persisting them as messages", () => {
    expect(parseMessagesRealtimeFrame({
      type: "typing.updated",
      channelId: "channel-1",
      userId: "user-2",
      displayName: "Ana",
      isTyping: true,
      expiresAt: "2026-07-11T12:00:06.000Z",
    })).toMatchObject({ kind: "typing", channelId: "channel-1", isTyping: true });

    expect(parseMessagesRealtimeFrame({
      type: "presence.snapshot",
      users: [{ userId: "user-2", displayName: "Ana", status: "online" }],
    })).toMatchObject({ kind: "presence-snapshot", participants: [{ userId: "user-2", status: "online" }] });
  });

  it("sticks only for initial loads, outgoing messages, or a reader already near the bottom", () => {
    expect(shouldStickToMessageBottom({ distanceFromBottom: 400, isInitialLoad: true })).toBe(true);
    expect(shouldStickToMessageBottom({ distanceFromBottom: 400, outgoing: true })).toBe(true);
    expect(shouldStickToMessageBottom({ distanceFromBottom: 72 })).toBe(true);
    expect(shouldStickToMessageBottom({ distanceFromBottom: 240 })).toBe(false);
  });
});
