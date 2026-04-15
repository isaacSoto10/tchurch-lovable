import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Heart } from "lucide-react";
import { useApi } from "@/hooks/useApi";

interface PrayerRequest {
  id: string;
  title: string;
  content: string;
  requesterName?: string;
  status: "active" | "answered";
  prayCount?: number;
  createdAt: string;
}

export default function Prayer() {
  const { fetchApi } = useApi();
  const [prayerRequests, setPrayerRequests] = useState<PrayerRequest[]>([]);
  const [filter, setFilter] = useState<"active" | "answered">("active");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newRequest, setNewRequest] = useState({ title: "", content: "" });

  useEffect(() => {
    loadPrayerRequests();
  }, [filter, fetchApi]);

  const loadPrayerRequests = () => {
    setLoading(true);
    fetchApi(`/prayer-requests?status=${filter}`)
      .then((data) => setPrayerRequests(Array.isArray(data) ? data : []))
      .catch((e) => console.error("Failed to load prayer requests:", e))
      .finally(() => setLoading(false));
  };

  const handlePray = async (id: string) => {
    try {
      await fetchApi(`/prayer-requests/${id}/pray`, { method: "POST" });
      loadPrayerRequests();
    } catch (e) {
      console.error("Failed to pray:", e);
    }
  };

  const handleSubmitRequest = async () => {
    if (!newRequest.title.trim() || !newRequest.content.trim()) return;

    try {
      await fetchApi("/prayer-requests", {
        method: "POST",
        body: JSON.stringify(newRequest),
      });
      setNewRequest({ title: "", content: "" });
      setShowForm(false);
      loadPrayerRequests();
    } catch (e) {
      console.error("Failed to submit prayer request:", e);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Prayer Wall</h1>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 mr-1" /> New Request
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <Input
              placeholder="Prayer request title"
              value={newRequest.title}
              onChange={(e) => setNewRequest({ ...newRequest, title: e.target.value })}
            />
            <Textarea
              placeholder="Describe your prayer request..."
              value={newRequest.content}
              onChange={(e) => setNewRequest({ ...newRequest, content: e.target.value })}
            />
            <div className="flex gap-2">
              <Button onClick={handleSubmitRequest}>Submit</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="active" onValueChange={(v) => setFilter(v as "active" | "answered")} className="mb-6">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="answered">Answered</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {!loading && prayerRequests.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No {filter} prayer requests.
          </p>
        )}
        {!loading && prayerRequests.map((pr) => (
          <Card key={pr.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h3 className="font-medium">{pr.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{pr.content}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">
                      {pr.requesterName || "Anonymous"}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(pr.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </div>
                {filter === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePray(pr.id)}
                    className="shrink-0"
                  >
                    <Heart className="w-4 h-4 mr-1" />
                    {pr.prayCount || 0}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
