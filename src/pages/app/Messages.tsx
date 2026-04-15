import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, Send, Hash, Plus } from "lucide-react";
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
  senderId: string;
  senderName?: string;
  createdAt: string;
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
      toast({ title: "Channel created" });
    } catch (e) {
      toast({ title: "Failed to create channel", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Messages</h1>
        <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" /> New Channel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Channel</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Channel Name</label>
                <Input
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="e.g., worship-team"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description (optional)</label>
                <Textarea
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  placeholder="What is this channel about?"
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setNewChannelOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateChannel} disabled={!newChannelName.trim() || creating}>
                  {creating ? "Creating..." : "Create Channel"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!selectedChannel ? (
        <div className="grid gap-3">
          {channels.length === 0 && (
            <p className="text-sm text-muted-foreground">No channels yet. Create one to start messaging!</p>
          )}
          {channels.map((channel) => (
            <Card
              key={channel.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedChannel(channel)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <Hash className="w-5 h-5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="font-medium">{channel.name}</p>
                  {channel.description && (
                    <p className="text-sm text-muted-foreground">{channel.description}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col h-[calc(100vh-220px)]">
          <div className="flex items-center gap-2 mb-4">
            <Button variant="ghost" size="sm" onClick={() => setSelectedChannel(null)}>
              ← Back
            </Button>
            <Hash className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{selectedChannel.name}</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 mb-4">
            {loadingMessages && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}
            {!loadingMessages && messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Start the conversation!</p>
            )}
            {!loadingMessages && messages.map((msg) => (
              <div key={msg.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-sm">{msg.senderName || "User"}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-sm mt-0.5">{msg.content}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Type a message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            />
            <Button size="icon" onClick={handleSendMessage}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
