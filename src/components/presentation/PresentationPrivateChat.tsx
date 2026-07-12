import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  fetchPresentationChat,
  mergePresentationChatMessages,
  sendPresentationChatMessage,
  type PresentationChatChannel,
  type PresentationChatMessage,
  type PresentationRunMode,
} from "@/lib/presentationProduction";

type PresentationPrivateChatProps = {
  serviceId: string;
  mode: PresentationRunMode;
  channels: PresentationChatChannel[];
  privacyScope: string;
};

const CHANNEL_LABELS: Record<PresentationChatChannel, string> = {
  all: "Todo el equipo",
  worship: "Alabanza",
  production: "Producción",
};

function newMessageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function chatTime(value: string) {
  return new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function PresentationPrivateChat({ serviceId, mode, channels, privacyScope }: PresentationPrivateChatProps) {
  const channelsKey = [...new Set(channels)].sort().join(",");
  const [messages, setMessages] = useState<PresentationChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [channel, setChannel] = useState<PresentationChatChannel | null>(channels[0] || null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"loading" | "online" | "reconnecting">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const identity = `${privacyScope}::${serviceId}::${mode}::${channelsKey || "no-channels"}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    if (!channel || !channels.includes(channel)) setChannel(channels[0] || null);
    setMessages((current) => {
      const filtered = current.filter((message) => channels.includes(message.channel));
      return filtered.length === current.length ? current : filtered;
    });
    // channelsKey prevents equivalent inline arrays from retriggering this privacy gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, channelsKey]);

  useEffect(() => {
    if (!channelsKey) {
      setMessages([]);
      setCursor(null);
      setSending(false);
      setNotice("Tu asignación actual no incluye canales privados.");
      setState("online");
      return undefined;
    }
    let cancelled = false;
    let timeout: number | undefined;
    let nextCursor: string | null = null;
    let failures = 0;
    setMessages([]);
    setCursor(null);
    setSending(false);
    setNotice(null);
    setState("loading");
    const allowedChannels = new Set(channelsKey.split(",") as PresentationChatChannel[]);

    const poll = async (initial = false) => {
      try {
        const response = await fetchPresentationChat(serviceId, mode, initial ? null : nextCursor, initial ? 50 : 100);
        if (cancelled) return;
        if (response.serviceId !== serviceId || response.mode !== mode) throw new Error("El chat respondió para otra sesión.");
        setMessages((current) => mergePresentationChatMessages(current, response.messages.filter((message) => allowedChannels.has(message.channel))));
        nextCursor = response.nextCursor || nextCursor;
        setCursor(nextCursor);
        failures = 0;
        setState("online");
        setNotice(null);
      } catch (error) {
        if (cancelled) return;
        failures = Math.min(5, failures + 1);
        setState("reconnecting");
        setNotice(error instanceof Error ? error.message : "Reconectando el chat privado…");
      }
      const backgroundDelay = document.visibilityState === "hidden" ? 8_000 : 0;
      if (!cancelled) timeout = window.setTimeout(() => void poll(false), Math.max(backgroundDelay, Math.min(8_000, 1_500 * 2 ** failures)));
    };

    void poll(true);
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [channelsKey, mode, privacyScope, serviceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || body.length > 500 || sending || !channel || !channels.includes(channel)) return;
    const clientMessageId = newMessageId();
    if (!clientMessageId) {
      setNotice("Este dispositivo no puede generar un id criptográficamente seguro; no se envió el mensaje.");
      return;
    }
    setSending(true);
    setNotice(null);
    const requestIdentity = identity;
    try {
      const response = await sendPresentationChatMessage(serviceId, { mode, channel, body, clientMessageId });
      if (identityRef.current !== requestIdentity) return;
      if (response.serviceId !== serviceId || response.mode !== mode) throw new Error("El chat respondió para otra sesión.");
      const allowedChannels = new Set(channels);
      setMessages((current) => mergePresentationChatMessages(current, response.messages.filter((message) => allowedChannels.has(message.channel))));
      setCursor(response.nextCursor || cursor);
      setDraft("");
      setState("online");
    } catch (error) {
      if (identityRef.current !== requestIdentity) return;
      setState("reconnecting");
      setNotice(error instanceof Error ? error.message : "No se pudo enviar el mensaje privado.");
    } finally {
      if (identityRef.current === requestIdentity) setSending(false);
    }
  }

  return (
    <section className="grid min-h-[28rem] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1118] md:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="flex min-h-0 flex-col">
        <div className="flex min-h-12 items-center gap-3 border-b border-white/10 px-4">
          <span className={`h-2 w-2 rounded-full ${state === "online" ? "bg-emerald-400" : state === "loading" ? "bg-slate-500" : "bg-amber-300"}`} />
          <div className="min-w-0 flex-1"><p className="text-xs font-black text-white">Chat privado · {mode === "live" ? "En vivo" : "Ensayo"}</p><p className="text-[10px] text-slate-500">Nunca aparece en la salida congregacional.</p></div>
          {state !== "online" ? <RefreshCw aria-label="Reconectando" className="h-4 w-4 animate-spin text-amber-200" /> : null}
        </div>
        <div className="min-h-[18rem] flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {state === "loading" && !messages.length ? <div className="flex h-full min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div> : null}
          {!messages.length && state !== "loading" ? <div className="flex min-h-40 flex-col items-center justify-center text-center"><MessageCircle className="h-8 w-8 text-slate-700" /><p className="mt-3 text-sm font-bold text-slate-300">Sin mensajes todavía</p><p className="mt-1 text-xs text-slate-500">Coordina cambios sin distraer a la congregación.</p></div> : null}
          {messages.map((message) => (
            <article key={message.id} className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-3">
              <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-xs font-black text-slate-200">{message.sender.displayName}</p><span className="rounded-md bg-white/[0.06] px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{CHANNEL_LABELS[message.channel]}</span><time className="text-[10px] tabular-nums text-slate-600">{chatTime(message.sentAt)}</time></div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-5 text-slate-300">{message.body}</p>
            </article>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-white/10 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {notice ? <p className="mb-2 text-xs font-semibold text-amber-200" role="status">{notice}</p> : null}
          <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_3rem]">
            <Select value={channel || undefined} disabled={!channels.length} onValueChange={(value) => setChannel(value as PresentationChatChannel)}><SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/[0.05] text-xs text-white"><SelectValue placeholder="Sin canal" /></SelectTrigger><SelectContent>{channels.map((option) => <SelectItem key={option} value={option}>{CHANNEL_LABELS[option]}</SelectItem>)}</SelectContent></Select>
            <Input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} placeholder="Mensaje al equipo…" className="h-11 rounded-xl border-white/10 bg-white/[0.05] text-white" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
            <Button aria-label="Enviar mensaje" className="h-11 w-11 rounded-xl bg-emerald-500 text-white hover:bg-emerald-400" disabled={!draft.trim() || sending || !channel} onClick={() => void send()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
          </div>
        </div>
      </div>
      <aside className="hidden border-l border-white/10 bg-black/20 p-4 md:block"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">Canales visibles</p><div className="mt-3 space-y-2">{channels.map((option) => <div key={option} className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-300">{CHANNEL_LABELS[option]}</div>)}</div><p className="mt-4 text-[11px] leading-5 text-slate-500">Los permisos del servidor filtran cada canal según tu asignación. El historial no se guarda en este dispositivo.</p></aside>
    </section>
  );
}
