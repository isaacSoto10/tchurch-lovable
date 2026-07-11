export type MessageChannelType = "church" | "announcement" | "team";

export type MessageAttachment = {
  id: string;
  name: string;
  url: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string | null;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export type MessageDeliveryStatus = "sending" | "sent" | "failed";

export type MessageRecord = {
  id: string;
  channelId: string | null;
  content: string;
  userId: string;
  authorId: string;
  authorName: string;
  authorImageUrl: string | null;
  createdAt: string;
  updatedAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  isDeleted: boolean;
  isMine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
  clientId: string | null;
  deliveryStatus: MessageDeliveryStatus;
};

export type TypingParticipant = {
  userId: string;
  displayName: string;
  imageUrl: string | null;
  expiresAt: string | null;
};

export type PresenceParticipant = {
  userId: string;
  displayName: string;
  imageUrl: string | null;
  status: "online" | "offline";
  lastSeenAt: string | null;
};

export type MessagesRealtimeFrame =
  | { kind: "ready" }
  | { kind: "subscribed" }
  | { kind: "pong" }
  | { kind: "message-event"; channelId: string; eventType: string; messageId: string | null; actorUserId: string | null }
  | { kind: "typing"; channelId: string; participant: TypingParticipant; isTyping: boolean }
  | { kind: "presence-snapshot"; participants: PresenceParticipant[] }
  | { kind: "presence-updated"; participant: PresenceParticipant }
  | { kind: "unknown" };

export type MessageChannel = {
  id: string;
  name: string;
  description: string | null;
  type: MessageChannelType;
  ministryId: string | null;
  ministryName: string | null;
  lastMessageAt: string | null;
  lastPreview: string | null;
  messageCount: number;
  unreadCount: number;
  canPost: boolean;
  canModerate: boolean;
  readOnlyReason: string | null;
  quickStarters: string[];
};

export type RealtimeTokenResponse = {
  enabled?: unknown;
  token?: unknown;
  url?: unknown;
  wsUrl?: unknown;
  websocketUrl?: unknown;
};

const DEFAULT_QUICK_STARTERS = [
  "Please confirm your availability for this week.",
  "Reminder: check the schedule and arrive prepared.",
  "Does anyone need help or prayer before serving?",
];

const ANNOUNCEMENT_QUICK_STARTERS = [
  "Important update for this week:",
  "Reminder for everyone serving this Sunday:",
  "Please read this before the next service:",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeChannelType(value: unknown): MessageChannelType {
  if (value === "announcement" || value === "team" || value === "church") return value;
  return "church";
}

function normalizeAttachment(value: unknown): MessageAttachment {
  const raw = asRecord(value);
  const fallbackName = asString(raw.fileName, asString(raw.name, "Attachment"));
  const rawSize = raw.size ?? raw.sizeBytes;

  return {
    id: asString(raw.id, asString(raw.url, fallbackName)),
    name: asString(raw.name, fallbackName),
    url: asNullableString(raw.url),
    contentType: asNullableString(raw.contentType) || asNullableString(raw.mimeType),
    size: rawSize === null || rawSize === undefined ? null : asNumber(rawSize, 0),
    createdAt: asNullableString(raw.createdAt),
  };
}

function normalizeReactions(value: unknown): MessageReaction[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const raw = asRecord(item);
        const emoji = asString(raw.emoji);
        if (!emoji) return null;
        return {
          emoji,
          count: Math.max(0, asNumber(raw.count, 1)),
          reactedByMe: asBoolean(raw.reactedByMe, asBoolean(raw.mine, false)),
        };
      })
      .filter((item): item is MessageReaction => Boolean(item));
  }

  const raw = asRecord(value);
  return Object.entries(raw)
    .map(([emoji, count]) => ({
      emoji,
      count: Math.max(0, asNumber(count, 0)),
      reactedByMe: false,
    }))
    .filter((reaction) => reaction.count > 0);
}

export function normalizeChannel(value: unknown): MessageChannel {
  const raw = asRecord(value);
  const latestMessage = asRecord(raw.latestMessage || raw.lastMessage);
  const type = normalizeChannelType(raw.type);
  const explicitCanPost = raw.canPost;
  const canPost = typeof explicitCanPost === "boolean" ? explicitCanPost : true;
  const quickStarters = Array.isArray(raw.quickStarters)
    ? raw.quickStarters.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : type === "announcement"
      ? ANNOUNCEMENT_QUICK_STARTERS
      : DEFAULT_QUICK_STARTERS;

  return {
    id: asString(raw.id),
    name: asString(raw.name, "Channel"),
    description: asNullableString(raw.description),
    type,
    ministryId: asNullableString(raw.ministryId),
    ministryName: asNullableString(raw.ministryName),
    lastMessageAt:
      asNullableString(raw.lastMessageAt) ||
      asNullableString(raw.lastActivityAt) ||
      asNullableString(latestMessage.createdAt),
    lastPreview:
      asNullableString(raw.lastPreview) ||
      asNullableString(raw.lastMessagePreview) ||
      asNullableString(raw.preview) ||
      asNullableString(latestMessage.content),
    messageCount: Math.max(0, asNumber(raw.messageCount ?? raw.messagesCount ?? raw.count, 0)),
    unreadCount: Math.max(0, asNumber(raw.unreadCount ?? raw.unreadMessageCount ?? raw.unreadMessages, 0)),
    canPost,
    canModerate: asBoolean(raw.canModerate, false),
    readOnlyReason: asNullableString(raw.readOnlyReason) || (!canPost && type === "announcement" ? "Only admins and planners can post in announcements." : null),
    quickStarters,
  };
}

export function normalizeChannels(value: unknown): MessageChannel[] {
  return Array.isArray(value) ? value.map(normalizeChannel).filter((channel) => channel.id) : [];
}

export function normalizeMessage(value: unknown): MessageRecord {
  const raw = asRecord(value);
  const author = asRecord(raw.author);
  const firstName = asString(raw.firstName);
  const lastName = asString(raw.lastName);
  const authorName =
    asString(raw.authorName) ||
    asString(author.name) ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    asString(raw.email) ||
    "User";
  const isMine = asBoolean(raw.isMine, false);
  const deletedAt = asNullableString(raw.deletedAt);
  const isDeleted = asBoolean(raw.isDeleted, asBoolean(raw.deleted, Boolean(deletedAt)));

  return {
    id: asString(raw.id),
    channelId: asNullableString(raw.channelId),
    content: asString(raw.content),
    userId: asString(raw.userId, asString(raw.authorId)),
    authorId: asString(raw.authorId, asString(raw.userId)),
    authorName,
    authorImageUrl: asNullableString(raw.authorImageUrl) || asNullableString(author.imageUrl),
    createdAt: asString(raw.createdAt, new Date(0).toISOString()),
    updatedAt: asNullableString(raw.updatedAt),
    editedAt: asNullableString(raw.editedAt),
    deletedAt,
    isDeleted,
    isMine,
    canEdit: asBoolean(raw.canEdit, isMine && !isDeleted),
    canDelete: asBoolean(raw.canDelete, isMine && !isDeleted),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(normalizeAttachment) : [],
    reactions: normalizeReactions(raw.reactions),
    clientId: asNullableString(raw.clientId),
    deliveryStatus:
      raw.deliveryStatus === "sending" || raw.deliveryStatus === "failed"
        ? raw.deliveryStatus
        : "sent",
  };
}

function normalizePresenceParticipant(value: unknown): PresenceParticipant | null {
  const raw = asRecord(value);
  const userId = asString(raw.userId);
  if (!userId) return null;
  return {
    userId,
    displayName: asString(raw.displayName, "Member"),
    imageUrl: asNullableString(raw.imageUrl),
    status: raw.status === "offline" ? "offline" : "online",
    lastSeenAt: asNullableString(raw.lastSeenAt),
  };
}

export function parseMessagesRealtimeFrame(value: unknown): MessagesRealtimeFrame {
  const raw = typeof value === "string"
    ? (() => {
        try {
          return asRecord(JSON.parse(value));
        } catch {
          return {};
        }
      })()
    : asRecord(value);
  const type = asString(raw.type);

  if (type === "ready") return { kind: "ready" };
  if (type === "subscribed") return { kind: "subscribed" };
  if (type === "pong") return { kind: "pong" };

  if (type === "message.event") {
    const event = asRecord(raw.event);
    const channelId = asString(event.channelId);
    if (!channelId) return { kind: "unknown" };
    return {
      kind: "message-event",
      channelId,
      eventType: asString(event.type),
      messageId: asNullableString(event.messageId),
      actorUserId: asNullableString(event.actorUserId),
    };
  }

  if (type === "typing.updated") {
    const channelId = asString(raw.channelId);
    const userId = asString(raw.userId);
    if (!channelId || !userId) return { kind: "unknown" };
    return {
      kind: "typing",
      channelId,
      isTyping: asBoolean(raw.isTyping),
      participant: {
        userId,
        displayName: asString(raw.displayName, "Member"),
        imageUrl: asNullableString(raw.imageUrl),
        expiresAt: asNullableString(raw.expiresAt),
      },
    };
  }

  if (type === "presence.snapshot") {
    const users = Array.isArray(raw.users) ? raw.users : [];
    return {
      kind: "presence-snapshot",
      participants: users.map(normalizePresenceParticipant).filter((item): item is PresenceParticipant => Boolean(item)),
    };
  }

  if (type === "presence.updated") {
    const participant = normalizePresenceParticipant(raw.user || raw);
    return participant ? { kind: "presence-updated", participant } : { kind: "unknown" };
  }

  return { kind: "unknown" };
}

export function shouldStickToMessageBottom(options: {
  distanceFromBottom: number;
  isInitialLoad?: boolean;
  outgoing?: boolean;
}) {
  return Boolean(options.isInitialLoad || options.outgoing || options.distanceFromBottom <= 96);
}

export function normalizeMessages(value: unknown): MessageRecord[] {
  return Array.isArray(value) ? sortMessages(value.map(normalizeMessage).filter((message) => message.id)) : [];
}

export function sortMessages(messages: MessageRecord[]): MessageRecord[] {
  return [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function upsertMessage(messages: MessageRecord[], nextMessage: MessageRecord): MessageRecord[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const previous = byId.get(nextMessage.id);
  byId.set(nextMessage.id, { ...previous, ...nextMessage });
  return sortMessages([...byId.values()]);
}

export function markMessageDeleted(messages: MessageRecord[], messageId: string, deletedAt = new Date().toISOString()): MessageRecord[] {
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content: "",
          deletedAt,
          isDeleted: true,
          canEdit: false,
          canDelete: false,
          attachments: [],
          reactions: [],
        }
      : message
  );
}

export function withLocalReaction(message: MessageRecord, emoji: string, reactedByMe: boolean): MessageRecord {
  const reactions = [...message.reactions];
  const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
  const current = index >= 0 ? reactions[index] : { emoji, count: 0, reactedByMe: false };
  const nextCount = Math.max(0, current.count + (reactedByMe ? 1 : -1));
  const nextReaction = { emoji, count: nextCount, reactedByMe };

  if (index >= 0) {
    if (nextCount === 0) {
      reactions.splice(index, 1);
    } else {
      reactions[index] = nextReaction;
    }
  } else if (nextCount > 0) {
    reactions.push(nextReaction);
  }

  return { ...message, reactions };
}

export function isMessageEdited(message: MessageRecord): boolean {
  if (message.isDeleted) return false;
  if (message.editedAt) return true;
  if (!message.updatedAt) return false;
  return new Date(message.updatedAt).getTime() - new Date(message.createdAt).getTime() > 1000;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.trim()[0]?.toUpperCase() || "?";
}

export function getChannelPreview(channel: MessageChannel): string {
  if (channel.lastPreview) return channel.lastPreview;
  if (channel.description) return channel.description;
  if (channel.type === "announcement") return channel.canPost ? "Post important church-wide updates." : "Read-only announcements from church leaders.";
  if (channel.type === "team") return "Coordinate with this ministry team.";
  return "Open the conversation.";
}

export function formatLastActivity(value: string | null, now = new Date(), locale: "en" | "es" = "en"): string {
  if (!value) return locale === "es" ? "Sin mensajes" : "No messages";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === "es" ? "Sin mensajes" : "No messages";

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return locale === "es" ? "Ahora" : "Now";
  if (minutes < 60) return locale === "es" ? `Hace ${minutes} min` : `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "es" ? `Hace ${hours} h` : `${hours}h ago`;

  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatMessageTime(value: string, locale: "en" | "es" = "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function buildMessagesRealtimeUrl(
  apiBase: string,
  tokenResponse: RealtimeTokenResponse,
  channelId: string
): string | null {
  if (tokenResponse.enabled === false) return null;

  const explicitUrl =
    asString(tokenResponse.websocketUrl) ||
    asString(tokenResponse.wsUrl) ||
    asString(tokenResponse.url);

  if (explicitUrl) {
    const url = new URL(explicitUrl, apiBase.replace(/\/api\/?$/, "/"));
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    const token = asString(tokenResponse.token);
    if (token && !url.searchParams.has("token")) url.searchParams.set("token", token);
    if (channelId && !url.searchParams.has("channelId")) {
      url.searchParams.set("channelId", channelId);
    }
    return url.toString();
  }

  const token = asString(tokenResponse.token);
  if (!token) return null;

  const appBase = apiBase.replace(/\/api\/?$/, "");
  const url = new URL("/api/realtime/messages", appBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  url.searchParams.set("channelId", channelId);
  return url.toString();
}
