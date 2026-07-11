import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCheck, ChevronDown, ExternalLink, Loader2, MessageCircle, RefreshCw, Send, Wifi, X } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { API_BASE } from "@/lib/apiConfig";
import {
  buildMessagesRealtimeUrl,
  formatMessageTime,
  normalizeChannels,
  normalizeMessage,
  normalizeMessages,
  parseMessagesRealtimeFrame,
  upsertMessage,
  type MessageChannel,
  type MessageRecord,
  type PresenceParticipant,
  type RealtimeTokenResponse,
  type TypingParticipant,
} from "@/lib/messages";
import {
  OPEN_CHAT_DOCK_EVENT,
  getChatDockBottomCss,
  readChatDockPreference,
  writeChatDockPreference,
  type OpenChatDockDetail,
} from "@/lib/chatDock";
import { useChurch } from "@/providers/ChurchProvider";

function clientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `dock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const copy = {
  es: {
    sendError: "No se pudo enviar el mensaje.", miniChat: "Mini chat", channel: "Canal", typing: "está escribiendo…",
    online: "en línea", updating: "Actualizando", openFull: "Abrir chat completo", close: "Cerrar mini chat",
    empty: "Inicia una conversación clara con tu equipo.", failedRetry: "No se envió · Reintentar", readOnly: "Este canal es solo de lectura.",
    placeholder: "Escribe un mensaje…", send: "Enviar mensaje", chat: "Chat", open: "Abrir chat", unread: "mensajes sin leer", newMessage: "nuevo",
    me: "Tú",
  },
  en: {
    sendError: "The message could not be sent.", miniChat: "Mini chat", channel: "Channel", typing: "is typing…",
    online: "online", updating: "Updating", openFull: "Open full chat", close: "Close mini chat",
    empty: "Start a clear conversation with your team.", failedRetry: "Not sent · Retry", readOnly: "This channel is read-only.",
    placeholder: "Write a message…", send: "Send message", chat: "Chat", open: "Open chat", unread: "unread messages", newMessage: "new",
    me: "You",
  },
} as const;

type FailedMessage = { channelId: string; content: string; clientId: string; temporaryId: string };

export function ChatDock({ keyboardOpen = false, hasBottomNav = false }: { keyboardOpen?: boolean; hasBottomNav?: boolean }) {
  const { fetchApi } = useApi();
  const { selectedChurch } = useChurch();
  const location = useLocation();
  const navigate = useNavigate();
  const churchId = selectedChurch?.id || null;
  const locale = localStorage.getItem("tchurch_language") === "en" ? "en" : "es";
  const t = copy[locale];
  const errorText = (error: unknown) => error instanceof Error ? error.message : t.sendError;
  const initialPreference = useMemo(() => readChatDockPreference(churchId), [churchId]);
  const [open, setOpen] = useState(initialPreference.open);
  const [channels, setChannels] = useState<MessageChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(initialPreference.channelId);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [composer, setComposer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [realtime, setRealtime] = useState(false);
  const [typing, setTyping] = useState<TypingParticipant[]>([]);
  const [presence, setPresence] = useState<Record<string, PresenceParticipant>>({});
  const [newBelow, setNewBelow] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const nearBottomRef = useRef(true);
  const previousCountRef = useRef(0);
  const typingStopRef = useRef<number | null>(null);
  const typingStartedRef = useRef(0);
  const failedRef = useRef(new Map<string, FailedMessage>());
  const requestedTargetRef = useRef<OpenChatDockDetail | null>(null);

  const hidden = location.pathname === "/app/messages";
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) || null;
  const unreadCount = channels.reduce((sum, channel) => sum + channel.unreadCount, 0);
  const onlineCount = Object.values(presence).filter((participant) => participant.status === "online").length;

  const loadChannels = useCallback(async (silent = false) => {
    if (!silent) setError("");
    try {
      const data = normalizeChannels(await fetchApi<unknown>("/channels"));
      setChannels(data);
      setSelectedChannelId((current) => data.some((channel) => channel.id === current)
        ? current
        : data.find((channel) => channel.unreadCount > 0)?.id || data[0]?.id || null);
    } catch (loadError) {
      if (!silent) setError(errorText(loadError));
    }
  }, [fetchApi]);

  const loadMessages = useCallback(async (channelId: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchApi<unknown>(`/channels/${encodeURIComponent(channelId)}/messages?limit=40`);
      setMessages(normalizeMessages(data));
      if (!silent) requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    } catch (loadError) {
      if (!silent) setError(errorText(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    const preference = readChatDockPreference(churchId);
    setOpen(preference.open);
    setSelectedChannelId(preference.channelId);
    setMessages([]);
    void loadChannels();
  }, [churchId, loadChannels]);

  useEffect(() => {
    writeChatDockPreference(churchId, { open, channelId: selectedChannelId });
  }, [churchId, open, selectedChannelId]);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<OpenChatDockDetail>).detail || {};
      requestedTargetRef.current = detail;
      setOpen(true);
      setSelectedChannelId((current) => {
        if (detail.channelId && channels.some((channel) => channel.id === detail.channelId)) return detail.channelId;
        if (detail.ministryId) return channels.find((channel) => channel.ministryId === detail.ministryId)?.id || current;
        return current || channels[0]?.id || null;
      });
    }
    window.addEventListener(OPEN_CHAT_DOCK_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_CHAT_DOCK_EVENT, handleOpen);
  }, [channels]);

  useEffect(() => {
    const detail = requestedTargetRef.current;
    if (!detail || channels.length === 0) return;
    const requested = detail.channelId
      ? channels.find((channel) => channel.id === detail.channelId)
      : detail.ministryId
        ? channels.find((channel) => channel.ministryId === detail.ministryId)
        : null;
    if (requested) setSelectedChannelId(requested.id);
    requestedTargetRef.current = null;
  }, [channels]);

  useEffect(() => {
    if (!open || !selectedChannelId || hidden) return;
    previousCountRef.current = 0;
    nearBottomRef.current = true;
    setNewBelow(0);
    void loadMessages(selectedChannelId);
    void fetchApi(`/channels/${encodeURIComponent(selectedChannelId)}/read`, { method: "PUT" }).catch(() => {});
  }, [fetchApi, hidden, loadMessages, open, selectedChannelId]);

  useEffect(() => {
    if (!open || !selectedChannelId || hidden) return;
    const previous = previousCountRef.current;
    previousCountRef.current = messages.length;
    const added = Math.max(0, messages.length - previous);
    const latest = messages[messages.length - 1];
    requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (nearBottomRef.current || latest?.isMine || latest?.deliveryStatus === "sending") {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: previous === 0 ? "auto" : "smooth" });
        setNewBelow(0);
      } else if (added > 0) {
        setNewBelow((count) => count + added);
      }
    });
  }, [hidden, messages, open, selectedChannelId]);

  useEffect(() => {
    if (!open || !selectedChannelId || hidden) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let pollingTimer: number | null = null;

    const poll = () => {
      setRealtime(false);
      if (pollingTimer === null) pollingTimer = window.setInterval(() => {
        void loadMessages(selectedChannelId, true);
        void loadChannels(true);
      }, 12000);
    };
    const connect = async () => {
      try {
        const token = await fetchApi<RealtimeTokenResponse>(`/messages/realtime-token?channelId=${encodeURIComponent(selectedChannelId)}`);
        const url = buildMessagesRealtimeUrl(API_BASE, token, selectedChannelId);
        if (!url || stopped) return poll();
        socket = new WebSocket(url);
        websocketRef.current = socket;
        socket.onopen = () => {
          if (pollingTimer !== null) window.clearInterval(pollingTimer);
          pollingTimer = null;
          setRealtime(true);
          socket?.send(JSON.stringify({ type: "subscribe", channelId: selectedChannelId }));
          socket?.send(JSON.stringify({ type: "presence.heartbeat" }));
          heartbeatTimer = window.setInterval(() => {
            socket?.send(JSON.stringify({ type: "presence.heartbeat" }));
            socket?.send(JSON.stringify({ type: "ping" }));
          }, 20000);
        };
        socket.onmessage = (event) => {
          const frame = parseMessagesRealtimeFrame(String(event.data));
          if (frame.kind === "message-event") {
            void loadChannels(true);
            if (frame.channelId === selectedChannelId && frame.eventType !== "channel.read") void loadMessages(frame.channelId, true);
          } else if (frame.kind === "typing" && frame.channelId === selectedChannelId) {
            setTyping((current) => {
              const withoutUser = current.filter((person) => person.userId !== frame.participant.userId);
              return frame.isTyping ? [...withoutUser, frame.participant] : withoutUser;
            });
          } else if (frame.kind === "presence-snapshot") {
            setPresence(Object.fromEntries(frame.participants.map((person) => [person.userId, person])));
          } else if (frame.kind === "presence-updated") {
            setPresence((current) => ({ ...current, [frame.participant.userId]: frame.participant }));
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          websocketRef.current = null;
          setRealtime(false);
          if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          if (!stopped) {
            poll();
            reconnectTimer = window.setTimeout(connect, 2500);
          }
        };
      } catch {
        poll();
      }
    };
    void connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (pollingTimer !== null) window.clearInterval(pollingTimer);
      if (typingStopRef.current !== null) window.clearTimeout(typingStopRef.current);
      socket?.close();
      websocketRef.current = null;
    };
  }, [fetchApi, hidden, loadChannels, loadMessages, open, selectedChannelId]);

  async function deliver(pending: FailedMessage) {
    try {
      const result = await fetchApi<unknown>(`/channels/${encodeURIComponent(pending.channelId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: pending.content, clientId: pending.clientId }),
      });
      const created = normalizeMessage({ ...(result as object), channelId: pending.channelId, deliveryStatus: "sent" });
      setMessages((current) => upsertMessage(current.filter((message) => message.id !== pending.temporaryId), created));
      failedRef.current.delete(pending.temporaryId);
      void loadChannels(true);
    } catch (sendError) {
      failedRef.current.set(pending.temporaryId, pending);
      setMessages((current) => current.map((message) => message.id === pending.temporaryId ? { ...message, deliveryStatus: "failed" } : message));
      setError(errorText(sendError));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const content = composer.trim();
    if (!selectedChannel || !selectedChannel.canPost || !content) return;
    const nextClientId = clientId();
    const temporaryId = `pending-${nextClientId}`;
    const pending = { channelId: selectedChannel.id, content, clientId: nextClientId, temporaryId };
    setMessages((current) => upsertMessage(current, normalizeMessage({
      id: temporaryId,
      clientId: nextClientId,
      channelId: selectedChannel.id,
      content,
      authorName: t.me,
      createdAt: new Date().toISOString(),
      isMine: true,
      deliveryStatus: "sending",
    })));
    setComposer("");
    websocketRef.current?.send(JSON.stringify({ type: "typing.stop", channelId: selectedChannel.id }));
    void deliver(pending);
  }

  function updateComposer(value: string) {
    setComposer(value);
    const socket = websocketRef.current;
    if (!selectedChannelId || socket?.readyState !== WebSocket.OPEN) return;
    if (!value.trim()) {
      socket.send(JSON.stringify({ type: "typing.stop", channelId: selectedChannelId }));
      return;
    }
    if (Date.now() - typingStartedRef.current > 2500) {
      socket.send(JSON.stringify({ type: "typing.start", channelId: selectedChannelId }));
      typingStartedRef.current = Date.now();
    }
    if (typingStopRef.current !== null) window.clearTimeout(typingStopRef.current);
    typingStopRef.current = window.setTimeout(() => websocketRef.current?.send(JSON.stringify({ type: "typing.stop", channelId: selectedChannelId })), 1400);
  }

  if (hidden || channels.length === 0) return null;

  const dockBottom = getChatDockBottomCss({ keyboardOpen, hasBottomNav });

  return (
    <div className="fixed right-3 z-40 sm:right-5" style={{ bottom: dockBottom }}>
      {open ? (
        <section
          className="flex h-[min(36rem,calc(var(--app-visual-height,100dvh)-8.5rem))] w-[calc(100vw-1.5rem)] max-w-[24rem] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_24px_70px_rgba(24,24,27,0.24)]"
          aria-label={t.miniChat}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-[#fbfaf8] px-3 py-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="dock-channel">{t.channel}</label>
              <select
                id="dock-channel"
                value={selectedChannelId || ""}
                onChange={(event) => setSelectedChannelId(event.target.value)}
                className="h-7 w-full truncate border-0 bg-transparent p-0 text-sm font-semibold text-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                <span className={`h-1.5 w-1.5 rounded-full ${realtime ? "bg-emerald-500" : "bg-amber-500"}`} />
                {typing.length > 0 ? `${typing[0].displayName} ${t.typing}` : realtime ? `${onlineCount || 1} ${t.online}` : t.updating}
              </p>
            </div>
            <button type="button" onClick={() => navigate(`/app/messages?channelId=${encodeURIComponent(selectedChannelId || "")}`)} className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100" aria-label={t.openFull}>
              <ExternalLink className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100" aria-label={t.close}>
              <X className="h-4 w-4" />
            </button>
          </header>

          <div
            ref={viewportRef}
            onScroll={(event) => {
              const target = event.currentTarget;
              nearBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight <= 72;
              if (nearBottomRef.current) setNewBelow(0);
            }}
            className="relative min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[#f8f7f5] px-3 py-3"
          >
            {loading ? <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : null}
            {!loading && messages.length === 0 ? <div className="flex h-full items-center justify-center px-5 text-center text-sm leading-6 text-zinc-500">{t.empty}</div> : null}
            {!loading && messages.slice(-40).map((message) => (
              <div key={message.id} className={`flex ${message.isMine ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[82%]">
                  {!message.isMine && <p className="mb-1 px-1 text-[11px] font-semibold text-zinc-500">{message.authorName}</p>}
                  <div className={`rounded-2xl px-3 py-2 text-sm leading-5 ${message.isMine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-zinc-200 bg-white text-zinc-800"}`}>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${message.isMine ? "text-primary-foreground/70" : "text-zinc-400"}`}>
                      {formatMessageTime(message.createdAt, locale)}
                      {message.deliveryStatus === "sending" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {message.deliveryStatus === "sent" && message.isMine && <CheckCheck className="h-3 w-3" />}
                    </p>
                  </div>
                  {message.deliveryStatus === "failed" && (
                    <button type="button" onClick={() => {
                      const pending = failedRef.current.get(message.id);
                      if (pending) {
                        setMessages((current) => current.map((item) => item.id === message.id ? { ...item, deliveryStatus: "sending" } : item));
                        void deliver(pending);
                      }
                    }} className="mt-1 min-h-11 text-xs font-semibold text-rose-700">
                      {t.failedRetry}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {newBelow > 0 && (
              <button type="button" onClick={() => {
                viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
                setNewBelow(0);
              }} className="sticky bottom-1 mx-auto flex min-h-10 items-center gap-1.5 rounded-full bg-zinc-950 px-3 text-xs font-semibold text-white shadow-lg">
                <ChevronDown className="h-3.5 w-3.5" /> {newBelow} {t.newMessage}{newBelow === 1 || locale === "en" ? "" : "s"}
              </button>
            )}
          </div>

          {error && <div className="flex items-center gap-2 border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700"><RefreshCw className="h-3.5 w-3.5" /><span className="line-clamp-1 flex-1">{error}</span></div>}
          <form onSubmit={submit} className="shrink-0 border-t border-zinc-200 bg-white p-2.5 pb-[max(0.625rem,var(--app-safe-area-bottom,0px))]">
            {selectedChannel?.canPost ? (
              <div className="flex items-end gap-2">
                <textarea value={composer} onChange={(event) => updateComposer(event.target.value)} rows={1} maxLength={4000} placeholder={t.placeholder} className="min-h-11 max-h-28 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base leading-6 outline-none focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20" />
                <button type="submit" disabled={!composer.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40" aria-label={t.send}><Send className="h-4 w-4" /></button>
              </div>
            ) : <p className="px-2 py-2 text-center text-xs font-medium text-zinc-500">{t.readOnly}</p>}
          </form>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative flex h-14 min-w-14 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-4 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(24,24,27,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-label={unreadCount ? `${t.open}, ${unreadCount} ${t.unread}` : t.open}
        >
          <MessageCircle className="h-5 w-5" /><span className="hidden sm:inline">{t.chat}</span>
          {unreadCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold ring-2 ring-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
          {realtime && <Wifi className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 text-emerald-300" />}
        </button>
      )}
    </div>
  );
}
