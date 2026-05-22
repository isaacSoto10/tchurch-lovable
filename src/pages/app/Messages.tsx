import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Hash, MessageCircle, Plus, Send, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Channel {
  id: string;
  name: string;
  description?: string;
}

interface Message {
  id: string;
  content: string;
  userId: string;
  authorName?: string;
  createdAt: string;
  updatedAt?: string | null;
  isMine?: boolean;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Messages() {
  const { fetchApi } = useApi();
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchApi("/channels")
      .then((data) => setChannels(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load channels:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  useEffect(() => {
    if (!selectedChannel) return;

    setLoadingMessages(true);
    fetchApi(`/channels/${selectedChannel.id}/messages`)
      .then((data) => setMessages(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load messages:", e))
      .finally(() => setLoadingMessages(false));
  }, [selectedChannel, fetchApi]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChannel) return;

    try {
      await fetchApi(`/channels/${selectedChannel.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: newMessage }),
      });
      setNewMessage("");
      const data = await fetchApi<Message[]>(`/channels/${selectedChannel.id}/messages`);
      setMessages(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return;
    setCreating(true);
    try {
      const result = await fetchApi<Channel>("/channels", {
        method: "POST",
        body: JSON.stringify({ name: newChannelName, description: newChannelDesc }),
      });
      setChannels([...channels, result]);
      setNewChannelOpen(false);
      setNewChannelName("");
      setNewChannelDesc("");
      toast({ title: "Canal creado" });
    } catch (e) {
      toast({ title: "No se pudo crear el canal", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedChannel) return;
    try {
      await fetchApi(`/channels/${selectedChannel.id}/messages/${messageId}`, { method: "DELETE" });
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "No se pudo eliminar el mensaje",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="app-page space-y-5">
      <div className="app-page-header p-4 sm:p-5">
        <div className="app-page-header-grid">
          <div className="min-w-0">
            <p className="app-page-kicker">Conversaciones</p>
            <h1 className="app-page-title">Mensajes</h1>
            <p className="app-page-copy">Canales internos para coordinar equipos, servicios y seguimiento pastoral.</p>
          </div>
        <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-md">
              <Plus className="w-4 h-4 mr-1" /> Nuevo canal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear canal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Nombre del canal</label>
                <Input
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="Ej. alabanza"
                  className="app-control mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Descripción (opcional)</label>
                <Textarea
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  placeholder="¿Para qué se usará este canal?"
                  className="mt-1 rounded-md"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setNewChannelOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateChannel} disabled={!newChannelName.trim() || creating}>
                  {creating ? "Creando..." : "Crear canal"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {!selectedChannel ? (
        <div className="grid gap-3">
          {channels.length === 0 && (
            <div className="app-empty-state">
              <MessageCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Todavía no hay canales. Crea uno para empezar.</p>
            </div>
          )}
          {channels.map((channel) => (
            <Card
              key={channel.id}
              className="app-list-card cursor-pointer"
              onClick={() => setSelectedChannel(channel)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="app-icon-tile">
                  <Hash className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{channel.name}</p>
                  {channel.description && (
                    <p className="truncate text-sm text-muted-foreground">{channel.description}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="app-list-card flex min-h-[520px] flex-col p-4 sm:h-[calc(100vh-260px)]">
          <div className="mb-4 flex items-center gap-2">
            <Button variant="ghost" size="sm" className="rounded-md" onClick={() => setSelectedChannel(null)}>
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
            <div className="app-icon-tile h-8 w-8">
              <Hash className="w-4 h-4" />
            </div>
            <span className="font-medium">{selectedChannel.name}</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 mb-4">
            {loadingMessages && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}
            {!loadingMessages && messages.length === 0 && (
              <div className="app-empty-state">
                <p className="text-sm text-muted-foreground">Todavía no hay mensajes. Inicia la conversación.</p>
              </div>
            )}
            {!loadingMessages && messages.map((msg) => (
              <div key={msg.id} className="flex gap-3">
                <div className="app-icon-tile h-8 w-8">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium text-sm">{msg.authorName || "Miembro"}</span>
                        <span className="text-xs text-muted-foreground">{formatMessageTime(msg.createdAt)}</span>
                      </div>
                      <p className="text-sm mt-0.5 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    {msg.isMine && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:bg-red-50 hover:text-red-500"
                        onClick={() => handleDeleteMessage(msg.id)}
                        aria-label="Eliminar mensaje"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Escribe un mensaje..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              className="app-control"
            />
            <Button size="icon" className="rounded-md" onClick={handleSendMessage}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
