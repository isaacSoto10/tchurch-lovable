import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Check } from "lucide-react";
import { apiFetch } from "@/lib/api";

const MINISTRIES = [
  { name: "Worship Team", color: "#f59e0b", emoji: "🎵" },
  { name: "Youth", color: "#ec4899", emoji: "🧑‍🤝‍🧑" },
  { name: "Children's Ministry", color: "#3b82f6", emoji: "👧" },
  { name: "Women's Ministry", color: "#8b5cf6", emoji: "👩" },
  { name: "Men's Fellowship", color: "#14b8a6", emoji: "👨" },
  { name: "Ushers & Greeters", color: "#f97316", emoji: "🚪" },
  { name: "Media & Tech", color: "#6366f1", emoji: "📺" },
  { name: "Hospitality", color: "#10b981", emoji: "🤝" },
  { name: "Prayer Team", color: "#06b6d4", emoji: "🙏" },
  { name: "Outreach", color: "#ef4444", emoji: "🌍" },
  { name: "Bible Study", color: "#84cc16", emoji: "📖" },
  { name: "Senior Saints", color: "#a855f7", emoji: "👴" },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function Presets() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const { churchName = "", churchDescription = "" } = (location.state || {}) as {
    churchName: string;
    churchDescription: string;
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leaderEmails, setLeaderEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function toggleMinistry(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function handleLeaderEmail(name: string, email: string) {
    setLeaderEmails((prev) => ({ ...prev, [name]: email }));
  }

  async function handleCreateChurch() {
    if (!churchName) {
      toast({ description: "Church name is required", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      const ministries = Array.from(selected).map((name) => {
        const ministry = MINISTRIES.find((m) => m.name === name)!;
        return {
          name,
          leaderEmail: leaderEmails[name] || null,
          color: ministry.color,
        };
      });

      const data = await apiFetch<{ id?: string; error?: string }>("/churches", {
        method: "POST",
        body: JSON.stringify({
          name: churchName,
          slug: slugify(churchName),
          description: churchDescription,
          ministries,
        }),
      });

      if (data.error) {
        toast({ description: data.error, variant: "destructive" });
      } else {
        navigate("/app", { replace: true });
        window.location.reload();
      }
    } catch (err: any) {
      toast({ description: err.message || "Failed to create church", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    navigate("/app", { replace: true });
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-4 py-4">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate("/create-church")}
            className="p-2 -ml-2 rounded-lg hover:bg-zinc-100"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <span className="font-semibold text-zinc-900">Pick Your Ministries</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          {/* Subtitle */}
          <div className="text-center space-y-1">
            <p className="text-sm text-zinc-500">
              Select the ministries at your church. Add a leader's email to invite them.
            </p>
          </div>

          {/* Ministry Grid */}
          <div className="grid grid-cols-2 gap-3">
            {MINISTRIES.map((ministry) => {
              const isSelected = selected.has(ministry.name);
              return (
                <Card
                  key={ministry.name}
                  className={`cursor-pointer transition-all ${
                    isSelected ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => toggleMinistry(ministry.name)}
                >
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    {/* Colored circle with emoji */}
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                      style={{ backgroundColor: ministry.color + "20" }}
                    >
                      {ministry.emoji}
                    </div>
                    {/* Ministry name */}
                    <span className="text-xs font-medium text-zinc-700 text-center">
                      {ministry.name}
                    </span>
                    {/* Checkbox indicator */}
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isSelected ? "border-primary bg-primary" : "border-zinc-300"
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {/* Leader email input (shown when selected) */}
                    {isSelected && (
                      <div className="w-full mt-2">
                        <Input
                          type="email"
                          placeholder="Leader email (optional)"
                          value={leaderEmails[ministry.name] || ""}
                          onChange={(e) => handleLeaderEmail(ministry.name, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs h-8"
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Skip link */}
          <div className="text-center">
            <button
              onClick={handleSkip}
              className="text-sm text-zinc-500 hover:text-zinc-700 underline"
            >
              Skip for now
            </button>
          </div>

          {/* Create Church button */}
          <Button
            onClick={handleCreateChurch}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Creating..." : "Create Church"}
          </Button>
        </div>
      </div>
    </div>
  );
}