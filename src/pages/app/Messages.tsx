import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCheck,
  ChevronDown,
  Clock3,
  Download,
  Edit3,
  FileText,
  Hash,
  Loader2,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  SmilePlus,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useApi } from "@/hooks/useApi";
import { ApiError, getChurchId } from "@/lib/api";
import { API_BASE } from "@/lib/apiConfig";
import {
  buildMessagesRealtimeUrl,
  formatLastActivity,
  formatMessageTime,
  getChannelPreview,
  getInitials,
  isMessageEdited,
  normalizeChannel,
  normalizeChannels,
  normalizeMessage,
  normalizeMessages,
  parseMessagesRealtimeFrame,
  shouldStickToMessageBottom,
  upsertMessage,
  withLocalReaction,
  type MessageAttachment,
  type MessageChannel,
  type MessageChannelType,
  type MessageRecord,
  type RealtimeTokenResponse,
  type PresenceParticipant,
  type TypingParticipant,
} from "@/lib/messages";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";
import { useChurch } from "@/providers/ChurchProvider";

type RealtimeStatus = "idle" | "connecting" | "live" | "polling";
type RegisteredAttachment = {
  id: string;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
};

const REACTION_CHOICES = ["🙏", "❤️", "👍"];
const DEFAULT_READ_ONLY_REASON = "Only admins and planners can post in announcement channels.";
const MESSAGES_SNAPSHOT_PREFIX = "tchurch_ios_messages_snapshot_v1";

type MessagesSnapshot = {
  channels: MessageChannel[];
  selectedChannelId: string | null;
};

function optionalEndpointUnavailable(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

function errorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  return error instanceof Error ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isMessagesSnapshot(data: unknown): data is MessagesSnapshot {
  if (!data || typeof data !== "object") return false;
  const snapshot = data as Partial<MessagesSnapshot>;
  return Array.isArray(snapshot.channels) && "selectedChannelId" in snapshot;
}

function selectedLocale(): "en" | "es" {
  return localStorage.getItem("tchurch_language") === "en" ? "en" : "es";
}

function resolveRequestedChannelId(
  channels: MessageChannel[],
  current: string | null,
  requested: string | null,
  requestedMinistry: string | null,
) {
  if (current && channels.some((channel) => channel.id === current)) return current;
  if (!requested && !requestedMinistry) return null;

  if (requestedMinistry) {
    const ministryMatch = channels.find((channel) => channel.ministryId === requestedMinistry);
    if (ministryMatch) return ministryMatch.id;
  }

  const requestedLower = requested?.toLowerCase() || "";
  const match = requestedLower === "first"
    ? channels[0]
    : channels.find((channel) => channel.id === requested || channel.name.toLowerCase() === requestedLower);

  return match?.id || null;
}

function channelIcon(type: MessageChannelType) {
  if (type === "announcement") return Megaphone;
  if (type === "team") return Users;
  return Hash;
}

function channelTone(type: MessageChannelType) {
  if (type === "announcement") return "border-amber-200 bg-amber-50 text-amber-800";
  if (type === "team") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-indigo-200 bg-indigo-50 text-indigo-800";
}

function channelLabel(type: MessageChannelType) {
  if (type === "announcement") return "Announcement";
  if (type === "team") return "Ministry";
  return "Church";
}

function fileSizeLabel(size: number | null) {
  if (!size || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function createClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestedParamFromLocation(name: string) {
  const query = window.location.hash.split("?")[1] || window.location.search.replace(/^\?/, "");
  const requested = new URLSearchParams(query).get(name);
  return requested?.trim() || null;
}

function messagePayloadFromResponse(result: unknown) {
  if (isRecord(result) && isRecord(result.message)) return result.message;
  return isRecord(result) ? result : {};
}

function attachmentFromRegistration(attachment: RegisteredAttachment): MessageAttachment {
  return {
    id: attachment.id,
    name: attachment.fileName || "Attachment",
    url: attachment.url || null,
    contentType: attachment.mimeType || null,
    size: attachment.sizeBytes ?? null,
    createdAt: attachment.createdAt || null,
  };
}

function updateChannelFromMessage(channel: MessageChannel, message: MessageRecord, incrementCount: boolean): MessageChannel {
  const preview = message.deletedAt ? channel.lastPreview : message.content.trim() || (message.attachments.length ? "Attachment" : channel.lastPreview);
  return {
    ...channel,
    lastMessageAt: message.createdAt || channel.lastMessageAt,
    lastPreview: preview || channel.lastPreview,
    messageCount: incrementCount ? channel.messageCount + 1 : channel.messageCount,
  };
}

export default function Messages() {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const requestedChannelId = searchParams.get("channelId");
  const requestedMinistryId = searchParams.get("ministryId");
  const locale = useMemo(selectedLocale, []);
  const [channels, setChannels] = useState<MessageChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, MessageRecord[]>>({});
  const [composer, setComposer] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingMessage, setEditingMessage] = useState<MessageRecord | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
  const [typingByChannel, setTypingByChannel] = useState<Record<string, TypingParticipant[]>>({});
  const [presenceByUser, setPresenceByUser] = useState<Record<string, PresenceParticipant>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [newChannelType, setNewChannelType] = useState<"church" | "announcement">("church");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const wasNearBottomRef = useRef(true);
  const initialLoadChannelRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const typingStopTimerRef = useRef<number | null>(null);
  const typingStartedAtRef = useRef(0);
  const failedMessagesRef = useRef(new Map<string, { channelId: string; content: string; files: File[]; clientId: string }>());
  const requestedChannelRef = useRef<string | null>(
    requestedChannelId || requestedParamFromLocation("channelId") || requestedParamFromLocation("channel")
  );
  const requestedMinistryRef = useRef<string | null>(
    requestedMinistryId || requestedParamFromLocation("ministryId")
  );
  const snapshotKey = sessionSnapshotKey(MESSAGES_SNAPSHOT_PREFIX, selectedChurch?.id || getChurchId());

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) || null,
    [channels, selectedChannelId],
  );
  const messages = selectedChannelId ? messagesByChannel[selectedChannelId] || [] : [];
  const typingParticipants = selectedChannelId
    ? (typingByChannel[selectedChannelId] || []).filter((participant) => participant.userId !== currentUserId)
    : [];
  const onlineCount = Object.values(presenceByUser).filter((participant) => participant.status === "online").length;
  const canCreateChannels = selectedChurch?.role === "ADMIN";
  const canModerateSelected = Boolean(selectedChannel?.canModerate || selectedChurch?.role === "ADMIN");
  const composerIsReadOnly = Boolean(selectedChannel && !selectedChannel.canPost && !editingMessage);
  const canSubmit = Boolean(
    selectedChannel &&
      !sending &&
      !composerIsReadOnly &&
      (composer.trim() || (!editingMessage && pendingFiles.length > 0)),
  );

  const setMessagesForChannel = useCallback((channelId: string, updater: (current: MessageRecord[]) => MessageRecord[]) => {
    setMessagesByChannel((current) => ({ ...current, [channelId]: updater(current[channelId] || []) }));
  }, []);

  const mergeChannel = useCallback((channel: MessageChannel) => {
    setChannels((current) => {
      const index = current.findIndex((item) => item.id === channel.id);
      if (index < 0) return [channel, ...current];
      const next = [...current];
      next[index] = { ...next[index], ...channel };
      return next;
    });
  }, []);

  const applyMessagesSnapshot = useCallback((snapshot: MessagesSnapshot) => {
    setChannels(snapshot.channels);
    setSelectedChannelId((current) => current || snapshot.selectedChannelId || snapshot.channels[0]?.id || null);
  }, []);

  const loadChannels = useCallback(
    async (silent = false) => {
      if (!silent) {
        const snapshot = readSessionSnapshot<MessagesSnapshot>(snapshotKey, { validate: isMessagesSnapshot });
        if (snapshot) {
          applyMessagesSnapshot(snapshot.data);
          setLoadingChannels(false);
        } else {
          setLoadingChannels(true);
        }
        setChannelError("");
      }

      try {
        const data = await fetchApi<unknown>("/channels");
        const nextChannels = normalizeChannels(data);
        setChannels(nextChannels);
        setSelectedChannelId((current) => {
          return resolveRequestedChannelId(
            nextChannels,
            current,
            requestedChannelRef.current,
            requestedMinistryRef.current,
          );
        });
        writeSessionSnapshot(snapshotKey, {
          channels: nextChannels,
          selectedChannelId: resolveRequestedChannelId(
            nextChannels,
            null,
            requestedChannelRef.current,
            requestedMinistryRef.current,
          ),
        });
      } catch (error) {
        if (!silent) {
          setChannelError(errorMessage(error));
          setChannels([]);
          setSelectedChannelId(null);
        }
      } finally {
        if (!silent) setLoadingChannels(false);
      }
    },
    [applyMessagesSnapshot, fetchApi, snapshotKey],
  );

  const loadMessages = useCallback(
    async (channelId: string, silent = false) => {
      if (!silent) {
        setLoadingMessages(true);
        setMessageError("");
      }

      try {
        const data = await fetchApi<unknown>(`/channels/${encodeURIComponent(channelId)}/messages?limit=50`);
        setMessagesByChannel((current) => ({ ...current, [channelId]: normalizeMessages(data) }));
      } catch (error) {
        if (!silent) setMessageError(errorMessage(error));
      } finally {
        if (!silent) setLoadingMessages(false);
      }
    },
    [fetchApi],
  );

  const markChannelRead = useCallback(
    async (channelId: string) => {
      setChannels((current) => current.map((channel) => (channel.id === channelId ? { ...channel, unreadCount: 0 } : channel)));
      try {
        await fetchApi(`/channels/${encodeURIComponent(channelId)}/read`, { method: "PUT" });
      } catch (error) {
        if (!optionalEndpointUnavailable(error)) console.warn("Failed to mark channel read:", error);
      }
    },
    [fetchApi],
  );

  const fetchRealtimeToken = useCallback(
    async (channelId: string): Promise<RealtimeTokenResponse> => {
      return fetchApi<RealtimeTokenResponse>(
        `/messages/realtime-token?channelId=${encodeURIComponent(channelId)}`,
      );
    },
    [fetchApi],
  );

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    fetchApi<{ id?: string }>("/users/me")
      .then((user) => setCurrentUserId(user?.id || null))
      .catch(() => setCurrentUserId(null));
  }, [fetchApi]);

  useEffect(() => {
    if (!selectedChannelId) return;
    setComposer("");
    setPendingFiles([]);
    setEditingMessage(null);
    setNewMessagesBelow(0);
    wasNearBottomRef.current = true;
    initialLoadChannelRef.current = selectedChannelId;
    previousMessageCountRef.current = 0;
    loadMessages(selectedChannelId);
    markChannelRead(selectedChannelId);
  }, [loadMessages, markChannelRead, selectedChannelId]);

  useEffect(() => {
    if (loadingMessages) return;
    const scrollport = messageScrollRef.current;
    if (!scrollport) return;
    const previousCount = previousMessageCountRef.current;
    const addedCount = Math.max(0, messages.length - previousCount);
    previousMessageCountRef.current = messages.length;
    if (!messages.length) return;
    const distanceFromBottom = scrollport.scrollHeight - scrollport.scrollTop - scrollport.clientHeight;
    const latest = messages[messages.length - 1];
    const isInitialLoad = initialLoadChannelRef.current === selectedChannelId;
    const shouldStick = shouldStickToMessageBottom({
      distanceFromBottom,
      isInitialLoad,
      outgoing: latest?.isMine || latest?.deliveryStatus === "sending",
    });
    const frameId = window.requestAnimationFrame(() => {
      if (shouldStick) {
        scrollport.scrollTo({ top: scrollport.scrollHeight, behavior: isInitialLoad ? "auto" : "smooth" });
        wasNearBottomRef.current = true;
        setNewMessagesBelow(0);
      } else if (addedCount > 0) {
        setNewMessagesBelow((count) => count + addedCount);
      }
      initialLoadChannelRef.current = null;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [loadingMessages, messages, selectedChannelId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingByChannel((current) => {
        let changed = false;
        const next = Object.fromEntries(Object.entries(current).map(([channelId, participants]) => {
          const active = participants.filter((participant) => !participant.expiresAt || new Date(participant.expiresAt).getTime() > now);
          if (active.length !== participants.length) changed = true;
          return [channelId, active];
        }));
        return changed ? next : current;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const applyRealtimePayload = useCallback(
    (rawPayload: string, fallbackChannelId: string) => {
      const frame = parseMessagesRealtimeFrame(rawPayload);
      if (frame.kind === "message-event") {
        loadChannels(true);
        if (frame.channelId === fallbackChannelId && frame.eventType !== "channel.read") {
          loadMessages(frame.channelId, true);
        }
        return;
      }
      if (frame.kind === "typing") {
        setTypingByChannel((current) => {
          const participants = current[frame.channelId] || [];
          const withoutUser = participants.filter((participant) => participant.userId !== frame.participant.userId);
          return {
            ...current,
            [frame.channelId]: frame.isTyping ? [...withoutUser, frame.participant] : withoutUser,
          };
        });
        return;
      }
      if (frame.kind === "presence-snapshot") {
        setPresenceByUser(Object.fromEntries(frame.participants.map((participant) => [participant.userId, participant])));
        return;
      }
      if (frame.kind === "presence-updated") {
        setPresenceByUser((current) => ({ ...current, [frame.participant.userId]: frame.participant }));
      }
    },
    [loadChannels, loadMessages],
  );

  useEffect(() => {
    if (!selectedChannelId) {
      setRealtimeStatus("idle");
      return undefined;
    }

    let stopped = false;
    let socket: WebSocket | null = null;
    let pollId: number | null = null;
    let timeoutId: number | null = null;
    let reconnectId: number | null = null;
    let heartbeatId: number | null = null;

    const stopPolling = () => {
      if (pollId !== null) {
        window.clearInterval(pollId);
        pollId = null;
      }
    };

    const startPolling = () => {
      if (stopped || pollId !== null) return;
      setRealtimeStatus("polling");
      pollId = window.setInterval(() => {
        loadMessages(selectedChannelId, true);
        loadChannels(true);
      }, 12000);
    };

    async function connectRealtime() {
      if (typeof WebSocket === "undefined") {
        startPolling();
        return;
      }

      setRealtimeStatus("connecting");
      try {
        const tokenResponse = await fetchRealtimeToken(selectedChannelId);
        const url = buildMessagesRealtimeUrl(API_BASE, tokenResponse, selectedChannelId);
        if (!url) {
          startPolling();
          return;
        }

        socket = new WebSocket(url);
        websocketRef.current = socket;
        timeoutId = window.setTimeout(() => {
          if (socket && socket.readyState !== WebSocket.OPEN) {
            socket.close();
            startPolling();
          }
        }, 6000);

        socket.onopen = () => {
          if (stopped) return;
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          stopPolling();
          setRealtimeStatus("live");
          socket?.send(JSON.stringify({ type: "subscribe", channelId: selectedChannelId }));
          socket?.send(JSON.stringify({ type: "presence.heartbeat" }));
          heartbeatId = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "presence.heartbeat" }));
              socket.send(JSON.stringify({ type: "ping" }));
            }
          }, 20000);
        };
        socket.onmessage = (event) => applyRealtimePayload(String(event.data), selectedChannelId);
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          websocketRef.current = null;
          if (heartbeatId !== null) window.clearInterval(heartbeatId);
          heartbeatId = null;
          if (!stopped) {
            startPolling();
            reconnectId = window.setTimeout(connectRealtime, 2500);
          }
        };
      } catch {
        startPolling();
      }
    }

    connectRealtime();

    return () => {
      stopped = true;
      stopPolling();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (reconnectId !== null) window.clearTimeout(reconnectId);
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
      if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
      socket?.close();
      websocketRef.current = null;
    };
  }, [applyRealtimePayload, fetchRealtimeToken, loadChannels, loadMessages, selectedChannelId]);

  const notifyTyping = useCallback((value: string) => {
    setComposer(value);
    if (!selectedChannelId || editingMessage) return;
    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (!value.trim()) {
      socket.send(JSON.stringify({ type: "typing.stop", channelId: selectedChannelId }));
      if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
      return;
    }

    const now = Date.now();
    if (now - typingStartedAtRef.current > 2500) {
      socket.send(JSON.stringify({ type: "typing.start", channelId: selectedChannelId }));
      typingStartedAtRef.current = now;
    }
    if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => {
      if (websocketRef.current?.readyState === WebSocket.OPEN) {
        websocketRef.current.send(JSON.stringify({ type: "typing.stop", channelId: selectedChannelId }));
      }
    }, 1400);
  }, [editingMessage, selectedChannelId]);

  async function handleCreateChannel() {
    if (!newChannelName.trim() || creatingChannel) return;
    setCreatingChannel(true);
    setChannelError("");

    try {
      const data = await fetchApi<unknown>("/channels", {
        method: "POST",
        body: JSON.stringify({
          name: newChannelName.trim(),
          description: newChannelDesc.trim() || undefined,
          type: newChannelType,
        }),
      });
      const channel = normalizeChannel(data);
      mergeChannel(channel);
      setSelectedChannelId(channel.id);
      setNewChannelName("");
      setNewChannelDesc("");
      setNewChannelType("church");
      setNewChannelOpen(false);
      toast({ title: "Channel created" });
    } catch (error) {
      toast({ title: errorMessage(error, "Failed to create channel"), variant: "destructive" });
    } finally {
      setCreatingChannel(false);
    }
  }

  function handleSelectChannel(channel: MessageChannel) {
    setSelectedChannelId(channel.id);
    writeSessionSnapshot(snapshotKey, { channels, selectedChannelId: channel.id });
    setMessageError("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setPendingFiles((current) => [...current, ...files].slice(0, 6));
    event.target.value = "";
  }

  async function registerAttachments(channelId: string, files: File[]): Promise<RegisteredAttachment[]> {
    const attachments: RegisteredAttachment[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      const attachment = await fetchApi<RegisteredAttachment>(
        `/channels/${encodeURIComponent(channelId)}/attachments`,
        { method: "POST", body: formData },
      );
      if (!attachment?.id) throw new Error("Attachment upload did not return an id.");
      attachments.push(attachment);
    }
    return attachments;
  }

  async function deliverPendingMessage(pending: {
    channelId: string;
    content: string;
    files: File[];
    clientId: string;
    temporaryId: string;
  }) {
    setSending(true);
    setMessageError("");
    setMessagesForChannel(pending.channelId, (current) =>
      current.map((message) => message.id === pending.temporaryId ? { ...message, deliveryStatus: "sending" } : message),
    );

    try {
      const registeredAttachments = await registerAttachments(pending.channelId, pending.files);
      const result = await fetchApi<unknown>(`/channels/${encodeURIComponent(pending.channelId)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: pending.content,
          clientId: pending.clientId,
          attachments: registeredAttachments.map((attachment) => attachment.id),
        }),
      });
      const payload = messagePayloadFromResponse(result);
      const created = normalizeMessage({
        ...payload,
        channelId: pending.channelId,
        deliveryStatus: "sent",
        attachments: Array.isArray(payload.attachments) ? payload.attachments : registeredAttachments.map(attachmentFromRegistration),
      });
      setMessagesForChannel(pending.channelId, (current) =>
        upsertMessage(current.filter((message) => message.id !== pending.temporaryId), created),
      );
      setChannels((current) =>
        current.map((channel) => (channel.id === pending.channelId ? updateChannelFromMessage(channel, created, true) : channel)),
      );
      failedMessagesRef.current.delete(pending.temporaryId);
    } catch (error) {
      failedMessagesRef.current.set(pending.temporaryId, pending);
      setMessagesForChannel(pending.channelId, (current) =>
        current.map((message) => message.id === pending.temporaryId ? { ...message, deliveryStatus: "failed" } : message),
      );
      setMessageError(errorMessage(error, "Failed to send message"));
    } finally {
      setSending(false);
    }
  }

  function retryMessage(message: MessageRecord) {
    const pending = failedMessagesRef.current.get(message.id);
    if (!pending || sending) return;
    void deliverPendingMessage({ ...pending, temporaryId: message.id });
  }

  async function handleComposerSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedChannel || !canSubmit) return;

    const content = composer.trim();
    const files = pendingFiles;
    setMessageError("");

    try {
      if (editingMessage) {
        setSending(true);
        const result = await fetchApi<unknown>(
          `/channels/${encodeURIComponent(selectedChannel.id)}/messages/${encodeURIComponent(editingMessage.id)}`,
          { method: "PATCH", body: JSON.stringify({ content }) },
        );
        const updated = normalizeMessage({
          ...editingMessage,
          ...messagePayloadFromResponse(result),
          content,
          updatedAt: new Date().toISOString(),
          channelId: selectedChannel.id,
        });
        setMessagesForChannel(selectedChannel.id, (current) => upsertMessage(current, updated));
        setEditingMessage(null);
        setComposer("");
        toast({ title: "Message updated" });
        return;
      }
      const clientId = createClientId();
      const temporaryId = `pending-${clientId}`;
      const optimistic = normalizeMessage({
        id: temporaryId,
        clientId,
        channelId: selectedChannel.id,
        content,
        userId: currentUserId || "me",
        authorName: "Tú",
        createdAt: new Date().toISOString(),
        isMine: true,
        canEdit: false,
        canDelete: false,
        deliveryStatus: "sending",
        attachments: files.map((file, index) => ({
          id: `${temporaryId}-attachment-${index}`,
          name: file.name,
          contentType: file.type,
          size: file.size,
        })),
      });
      setMessagesForChannel(selectedChannel.id, (current) => upsertMessage(current, optimistic));
      setComposer("");
      setPendingFiles([]);
      websocketRef.current?.send(JSON.stringify({ type: "typing.stop", channelId: selectedChannel.id }));
      void deliverPendingMessage({ channelId: selectedChannel.id, content, files, clientId, temporaryId });
    } catch (error) {
      if (optionalEndpointUnavailable(error) && editingMessage) {
        setMessageError("Editing messages is not available from the API yet.");
      } else {
        setMessageError(errorMessage(error, "Failed to send message"));
      }
    } finally {
      if (editingMessage) setSending(false);
    }
  }

  function startEditing(message: MessageRecord) {
    setEditingMessage(message);
    setComposer(message.content);
    setPendingFiles([]);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function handleDeleteMessage(message: MessageRecord) {
    if (!selectedChannel || message.deletedAt) return;
    try {
      await fetchApi(`/channels/${encodeURIComponent(selectedChannel.id)}/messages/${encodeURIComponent(message.id)}`, {
        method: "DELETE",
      });
      await loadMessages(selectedChannel.id, true);
      toast({ title: "Message deleted" });
    } catch (error) {
      toast({ title: errorMessage(error, "Failed to delete message"), variant: "destructive" });
    }
  }

  async function handleReaction(message: MessageRecord, emoji: string) {
    if (!selectedChannel || message.deletedAt) return;
    const currentReaction = message.reactions.find((reaction) => reaction.emoji === emoji);
    const nextReactedByMe = !currentReaction?.reactedByMe;

    try {
      const result = await fetchApi<unknown>(
        `/channels/${encodeURIComponent(selectedChannel.id)}/messages/${encodeURIComponent(message.id)}/reactions`,
        { method: nextReactedByMe ? "POST" : "DELETE", body: JSON.stringify({ emoji }) },
      );
      const payload = messagePayloadFromResponse(result);
      if (Object.keys(payload).length > 0) {
        setMessagesForChannel(selectedChannel.id, (current) =>
          upsertMessage(current, normalizeMessage({ ...payload, channelId: selectedChannel.id })),
        );
      } else {
        setMessagesForChannel(selectedChannel.id, (current) =>
          current.map((item) => (item.id === message.id ? withLocalReaction(item, emoji, nextReactedByMe) : item)),
        );
      }
    } catch (error) {
      if (optionalEndpointUnavailable(error)) {
        toast({ title: "Reactions are not available from the API yet." });
      } else {
        toast({ title: errorMessage(error, "Failed to update reaction"), variant: "destructive" });
      }
    }
  }

  async function handleSetupMessaging() {
    setLoadingChannels(true);
    setChannelError("");
    try {
      await fetchApi("/setup-messaging", { method: "POST" });
      await loadChannels();
      toast({ title: "Messaging channels prepared" });
    } catch (error) {
      setChannelError(errorMessage(error, "Failed to prepare channels"));
    } finally {
      setLoadingChannels(false);
    }
  }

  const readOnlyReason = selectedChannel?.readOnlyReason || DEFAULT_READ_ONLY_REASON;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-3 lg:gap-4">
      <header className="hidden flex-wrap items-start justify-between gap-3 lg:flex">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <MessageCircle className="h-4 w-4 text-primary" />
            Team communication
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">Messages</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Church-wide updates, ministry coordination, and quick team conversations in one mobile-friendly inbox.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RealtimeBadge status={realtimeStatus} />
          {canCreateChannels && (
            <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="min-h-11 gap-2">
                  <Plus className="h-4 w-4" />
                  New
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create channel</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Name</span>
                    <Input value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} maxLength={80} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Description</span>
                    <Textarea value={newChannelDesc} onChange={(event) => setNewChannelDesc(event.target.value)} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["church", "announcement"] as const).map((type) => {
                      const Icon = channelIcon(type);
                      const active = newChannelType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setNewChannelType(type)}
                          className={[
                            "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition",
                            active ? "border-primary bg-primary text-primary-foreground" : "border-zinc-200 bg-white text-zinc-700",
                          ].join(" ")}
                        >
                          <Icon className="h-4 w-4" />
                          {channelLabel(type)}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setNewChannelOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreateChannel} disabled={!newChannelName.trim() || creatingChannel}>
                      {creatingChannel ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </header>

      {channelError && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Could not load channels</p>
            <p>{channelError}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadChannels()}>Retry</Button>
        </div>
      )}

      <section className="grid min-h-0 flex-1 overflow-hidden border-zinc-200 bg-white lg:grid-cols-[21rem_minmax(0,1fr)] lg:rounded-2xl lg:border lg:shadow-sm">
        <aside className={selectedChannel ? "hidden border-r border-zinc-200 bg-zinc-50/70 lg:block" : "block border-r border-zinc-200 bg-zinc-50/70"}>
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-bold text-zinc-950">Channels</h2>
            <Badge variant="secondary">{channels.length}</Badge>
          </div>
          <ChannelList
            channels={channels}
            selectedChannelId={selectedChannelId}
            loading={loadingChannels}
            locale={locale}
            onSelect={handleSelectChannel}
            canSetup={canCreateChannels}
            onSetup={handleSetupMessaging}
          />
        </aside>

        <main className={selectedChannel ? "flex min-h-0 min-w-0 flex-col" : "hidden min-w-0 lg:flex lg:flex-col"}>
          {selectedChannel ? (
            <>
              <ThreadHeader
                channel={selectedChannel}
                canModerate={canModerateSelected}
                locale={locale}
                onlineCount={onlineCount}
                typingNames={typingParticipants.map((participant) => participant.displayName)}
                onBack={() => setSelectedChannelId(null)}
              />
              {selectedChannel.type === "announcement" && !selectedChannel.canPost && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  <LockKeyhole className="mr-2 inline h-4 w-4" />
                  {readOnlyReason}
                </div>
              )}
              <div
                ref={messageScrollRef}
                onScroll={(event) => {
                  const scrollport = event.currentTarget;
                  const distance = scrollport.scrollHeight - scrollport.scrollTop - scrollport.clientHeight;
                  wasNearBottomRef.current = distance <= 96;
                  if (wasNearBottomRef.current) setNewMessagesBelow(0);
                }}
                className="relative min-h-0 flex-1 scroll-pb-6 overflow-y-auto overscroll-y-contain bg-[#f8f7f5] px-3 py-4 sm:px-4"
              >
                {messageError && (
                  <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
                    {messageError}
                  </div>
                )}
                {loadingMessages ? (
                  <MessageSkeleton />
                ) : messages.length ? (
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        locale={locale}
                        canModerate={canModerateSelected}
                        onEdit={startEditing}
                        onDelete={handleDeleteMessage}
                        onReact={handleReaction}
                        onRetry={retryMessage}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyThread canPost={selectedChannel.canPost} />
                )}
                {newMessagesBelow > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      messageScrollRef.current?.scrollTo({ top: messageScrollRef.current.scrollHeight, behavior: "smooth" });
                      setNewMessagesBelow(0);
                    }}
                    className="sticky bottom-2 left-1/2 z-10 mx-auto mt-3 flex min-h-11 -translate-x-0 items-center gap-2 rounded-full bg-zinc-950 px-4 text-xs font-semibold text-white shadow-lg"
                  >
                    <ChevronDown className="h-4 w-4" />
                    {newMessagesBelow} {newMessagesBelow === 1 ? "mensaje nuevo" : "mensajes nuevos"}
                  </button>
                )}
              </div>
              {typingParticipants.length > 0 && (
                <div className="flex min-h-8 items-center gap-2 border-t border-zinc-100 bg-white px-4 text-xs font-medium text-zinc-500" role="status" aria-live="polite">
                  <span className="flex gap-1" aria-hidden="true"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" /></span>
                  {typingParticipants.length === 1 ? `${typingParticipants[0].displayName} está escribiendo…` : `${typingParticipants.length} personas están escribiendo…`}
                </div>
              )}
              <Composer
                channel={selectedChannel}
                composer={composer}
                editingMessage={editingMessage}
                pendingFiles={pendingFiles}
                sending={sending}
                canSubmit={canSubmit}
                isReadOnly={composerIsReadOnly}
                readOnlyReason={readOnlyReason}
                composerRef={composerRef}
                fileInputRef={fileInputRef}
                onSubmit={handleComposerSubmit}
                onChange={notifyTyping}
                onFileChange={handleFileChange}
                onRemoveFile={(index) => setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                onCancelEdit={() => {
                  setEditingMessage(null);
                  setComposer("");
                }}
              />
            </>
          ) : (
            <EmptySelection />
          )}
        </main>
      </section>
    </div>
  );
}

function RealtimeBadge({ status }: { status: RealtimeStatus }) {
  const live = status === "live";
  const polling = status === "polling";
  const connecting = status === "connecting";
  return (
    <Badge
      variant="outline"
      className={[
        "hidden min-h-9 items-center gap-1.5 border px-2.5 text-xs sm:inline-flex",
        live ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-white text-zinc-600",
      ].join(" ")}
    >
      {live ? <Wifi className="h-3.5 w-3.5" /> : polling ? <WifiOff className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
      {live ? "Live" : polling ? "Polling" : connecting ? "Connecting" : "Ready"}
    </Badge>
  );
}

function ChannelList({
  channels,
  selectedChannelId,
  loading,
  locale,
  onSelect,
  canSetup,
  onSetup,
}: {
  channels: MessageChannel[];
  selectedChannelId: string | null;
  loading: boolean;
  locale: "en" | "es";
  onSelect: (channel: MessageChannel) => void;
  canSetup: boolean;
  onSetup: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-white" />)}
      </div>
    );
  }

  if (!channels.length) {
    return (
      <div className="p-5 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
          <MessageCircle className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-sm font-bold text-zinc-950">No channels yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">Prepare the default church and ministry channels to start messaging.</p>
        {canSetup && <Button type="button" size="sm" className="mt-4" onClick={onSetup}>Prepare channels</Button>}
      </div>
    );
  }

  return (
    <div className="max-h-[calc(100svh-14rem)] space-y-2 overflow-y-auto p-3 lg:max-h-none">
      {channels.map((channel) => {
        const Icon = channelIcon(channel.type);
        const active = channel.id === selectedChannelId;
        return (
          <button
            key={channel.id}
            type="button"
            onClick={() => onSelect(channel)}
            className={[
              "w-full rounded-lg border p-3 text-left transition",
              active ? "border-primary bg-white shadow-sm" : "border-transparent bg-white/70 hover:border-zinc-200 hover:bg-white",
            ].join(" ")}
          >
            <div className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${channelTone(channel.type)}`}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-bold text-zinc-950">{channel.name}</p>
                  {channel.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                      {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{getChannelPreview(channel)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
              <span className={`rounded-full border px-2 py-0.5 ${channelTone(channel.type)}`}>{channelLabel(channel.type)}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{channel.messageCount} messages</span>
              {!channel.canPost && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Read only</span>}
              {channel.canModerate && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">Moderate</span>}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-zinc-500">
              <span className="truncate">{channel.ministryName || (channel.type === "team" ? "Ministry team" : "Approved members")}</span>
              <span className="shrink-0">{formatLastActivity(channel.lastMessageAt, new Date(), locale)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ThreadHeader({
  channel,
  canModerate,
  locale,
  onlineCount,
  typingNames,
  onBack,
}: {
  channel: MessageChannel;
  canModerate: boolean;
  locale: "en" | "es";
  onlineCount: number;
  typingNames: string[];
  onBack: () => void;
}) {
  const Icon = channelIcon(channel.type);
  return (
    <header className="border-b border-zinc-200 bg-white px-3 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 lg:hidden" onClick={onBack} aria-label="Back to channels">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${channelTone(channel.type)}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={channelTone(channel.type)}>{channelLabel(channel.type)}</Badge>
            {channel.canPost ? (
              <Badge variant="secondary" className="gap-1"><Send className="h-3 w-3" />Can post</Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-800">
                <LockKeyhole className="h-3 w-3" />Read only
              </Badge>
            )}
            {canModerate && (
              <Badge variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-sky-800">
                <ShieldCheck className="h-3 w-3" />Moderate
              </Badge>
            )}
          </div>
          <h2 className="mt-1 truncate text-lg font-bold text-zinc-950">{channel.name}</h2>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{channel.description || getChannelPreview(channel)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
            <span className={`h-2 w-2 rounded-full ${onlineCount > 0 ? "bg-emerald-500" : "bg-zinc-300"}`} />
            {typingNames.length > 0
              ? `${typingNames[0]} está escribiendo…`
              : onlineCount > 0
                ? `${onlineCount} en línea`
                : `${channel.messageCount} mensajes · ${formatLastActivity(channel.lastMessageAt, new Date(), locale)}`}
          </p>
        </div>
      </div>
    </header>
  );
}

function Composer({
  channel,
  composer,
  editingMessage,
  pendingFiles,
  sending,
  canSubmit,
  isReadOnly,
  readOnlyReason,
  composerRef,
  fileInputRef,
  onSubmit,
  onChange,
  onFileChange,
  onRemoveFile,
  onCancelEdit,
}: {
  channel: MessageChannel;
  composer: string;
  editingMessage: MessageRecord | null;
  pendingFiles: File[];
  sending: boolean;
  canSubmit: boolean;
  isReadOnly: boolean;
  readOnlyReason: string;
  composerRef: RefObject<HTMLTextAreaElement>;
  fileInputRef: RefObject<HTMLInputElement>;
  onSubmit: (event: FormEvent) => void;
  onChange: (value: string) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
  onCancelEdit: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-zinc-200 bg-white/95 p-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] shadow-[0_-10px_24px_rgba(15,23,42,0.05)] backdrop-blur lg:pb-3 lg:shadow-none">
      {isReadOnly ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-900">
          <LockKeyhole className="mr-2 inline h-4 w-4" />
          {readOnlyReason}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          {editingMessage ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
              <span className="font-semibold">Editing message</span>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} className="h-8">Cancel</Button>
            </div>
          ) : (
            <QuickStarters starters={channel.quickStarters} disabled={sending} onPick={(text) => onChange(text)} />
          )}
          {!editingMessage && pendingFiles.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pendingFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="max-w-40 truncate">{file.name}</span>
                  <button type="button" onClick={() => onRemoveFile(index)} aria-label={`Remove ${file.name}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={onFileChange} />
            {!editingMessage && (
              <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={sending} aria-label="Attach files">
                <Paperclip className="h-4 w-4" />
              </Button>
            )}
            <Textarea
              ref={composerRef}
              value={composer}
              onChange={(event) => onChange(event.target.value)}
              placeholder={editingMessage ? "Update your message..." : "Type a message..."}
              maxLength={4000}
              rows={1}
              disabled={sending}
              className="min-h-11 resize-none rounded-xl bg-zinc-50 text-base leading-6 focus:bg-white"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!canSubmit} aria-label={editingMessage ? "Save message" : "Send message"}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      )}
    </footer>
  );
}

function QuickStarters({ starters, disabled, onPick }: { starters: string[]; disabled: boolean; onPick: (text: string) => void }) {
  if (!starters.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <span className="flex shrink-0 items-center rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-500">Quick starters</span>
      {starters.map((starter) => (
        <button
          key={starter}
          type="button"
          disabled={disabled}
          onClick={() => onPick(starter)}
          className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
        >
          {starter}
        </button>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  locale,
  canModerate,
  onEdit,
  onDelete,
  onReact,
  onRetry,
}: {
  message: MessageRecord;
  locale: "en" | "es";
  canModerate: boolean;
  onEdit: (message: MessageRecord) => void;
  onDelete: (message: MessageRecord) => void;
  onReact: (message: MessageRecord, emoji: string) => void;
  onRetry: (message: MessageRecord) => void;
}) {
  const mine = message.isMine;
  const deleted = Boolean(message.deletedAt);
  const canEdit = !deleted && (message.canEdit || message.isMine);
  const canDelete = !deleted && (message.canDelete || message.isMine || canModerate);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const selectReaction = (emoji: string) => {
    setReactionPickerOpen(false);
    onReact(message, emoji);
  };

  return (
    <div className={`flex gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && (
        <Avatar className="h-9 w-9 rounded-lg">
          {message.authorImageUrl && <AvatarImage src={message.authorImageUrl} alt="" />}
          <AvatarFallback className="rounded-lg bg-indigo-50 text-xs font-bold text-indigo-700">{getInitials(message.authorName)}</AvatarFallback>
        </Avatar>
      )}
      <div className={`max-w-[min(40rem,84%)] ${mine ? "text-right" : "text-left"}`}>
        <div className={`mb-1 flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
          <span className="truncate text-xs font-bold text-zinc-700">{message.authorName}</span>
          <span className="shrink-0 text-[11px] font-medium text-zinc-500">{formatMessageTime(message.createdAt, locale)}</span>
          {isMessageEdited(message) && <span className="text-[11px] font-medium text-zinc-400">Edited</span>}
          {mine && message.deliveryStatus === "sending" && <span className="text-[11px] font-medium text-zinc-400">Enviando…</span>}
          {mine && message.deliveryStatus === "sent" && <CheckCheck className="h-3.5 w-3.5 text-primary/70" aria-label="Enviado" />}
        </div>
        <div className={`flex items-start gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
          <div
            className={[
              "rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm",
              mine ? "rounded-tr-md bg-primary text-primary-foreground" : "rounded-tl-md border border-zinc-200 bg-white text-zinc-800",
              deleted ? "border-dashed bg-zinc-100 text-zinc-500 shadow-none" : "",
            ].join(" ")}
          >
            {deleted ? (
              <p className="italic">This message was deleted.</p>
            ) : (
              <>
                {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                {message.attachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.attachments.map((attachment) => <AttachmentLink key={attachment.id} attachment={attachment} mine={mine} />)}
                  </div>
                )}
              </>
            )}
          </div>
          {(canEdit || canDelete) && (
            <div className="flex shrink-0 flex-col gap-1">
              {canEdit && (
                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-70" onClick={() => onEdit(message)} aria-label="Edit message">
                  <Edit3 className="h-4 w-4" />
                </Button>
              )}
              {canDelete && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 opacity-70" onClick={() => onDelete(message)} aria-label="Delete message">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
        {!deleted && (
          <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => onReact(message, reaction.emoji)}
                className={[
                  "min-h-8 rounded-full border px-2 text-xs font-bold transition",
                  reaction.reactedByMe ? "border-primary/30 bg-primary/10 text-primary" : "border-zinc-200 bg-white text-zinc-600",
                ].join(" ")}
              >
                {reaction.emoji} {reaction.count}
              </button>
            ))}
            <div className="relative">
              <button
                type="button"
                onClick={() => setReactionPickerOpen((open) => !open)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-xs font-bold text-zinc-500 transition hover:border-primary/30 hover:text-primary"
                aria-label="Add reaction"
                aria-expanded={reactionPickerOpen}
              >
                <SmilePlus className="h-3.5 w-3.5" />
              </button>
              {reactionPickerOpen && (
                <div
                  className={[
                    "absolute bottom-full z-20 mb-1 flex min-h-12 items-center gap-1 rounded-full border border-zinc-200 bg-white p-1 shadow-lg",
                    mine ? "right-0" : "left-0",
                  ].join(" ")}
                  role="menu"
                  aria-label="Choose reaction"
                >
                  {REACTION_CHOICES.map((emoji) => {
                    const reacted = message.reactions.some((reaction) => reaction.emoji === emoji && reaction.reactedByMe);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => selectReaction(emoji)}
                        className={[
                          "flex h-10 w-10 items-center justify-center rounded-full text-base transition",
                          reacted ? "bg-primary/10" : "hover:bg-zinc-100",
                        ].join(" ")}
                        role="menuitemcheckbox"
                        aria-label={`React ${emoji}`}
                        aria-checked={reacted}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        {message.deliveryStatus === "failed" && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className={`mt-1 min-h-11 rounded-lg px-2 text-xs font-semibold text-rose-700 underline-offset-2 hover:underline ${mine ? "ml-auto" : "mr-auto"}`}
          >
            No se envió · Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

function AttachmentLink({ attachment, mine }: { attachment: MessageAttachment; mine: boolean }) {
  const label = fileSizeLabel(attachment.size);
  const isImage = Boolean(attachment.url && attachment.contentType?.startsWith("image/"));
  if (isImage) {
    return (
      <a href={attachment.url || "#"} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-white/20">
        <img src={attachment.url || ""} alt={attachment.name} className="max-h-56 w-full object-cover" />
      </a>
    );
  }
  return (
    <a
      href={attachment.url || "#"}
      target="_blank"
      rel="noreferrer"
      className={[
        "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold",
        mine ? "border-white/20 bg-white/10 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-700",
      ].join(" ")}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{attachment.name}</span>
        {label && <span className="block text-[11px] opacity-75">{label}</span>}
      </span>
      {attachment.url && <Download className="h-4 w-4 shrink-0 opacity-80" />}
    </a>
  );
}

function MessageSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className={`flex gap-2 ${item % 2 === 0 ? "justify-end" : "justify-start"}`}>
          <div className="h-16 w-64 max-w-[75%] animate-pulse rounded-2xl bg-zinc-200" />
        </div>
      ))}
    </div>
  );
}

function EmptyThread({ canPost }: { canPost: boolean }) {
  return (
    <div className="flex min-h-80 items-center justify-center text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
          <MessageCircle className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-lg font-bold text-zinc-950">No messages yet</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {canPost ? "Start with a quick update, reminder, or question for this group." : "Messages from church leaders will appear here."}
        </p>
      </div>
    </div>
  );
}

function EmptySelection() {
  return (
    <div className="flex min-h-[34rem] items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
          <MessageCircle className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-xl font-bold text-zinc-950">Choose a channel</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Pick a church, announcement, or ministry channel to read the thread and send updates.
        </p>
      </div>
    </div>
  );
}
