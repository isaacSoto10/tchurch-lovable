import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@clerk/clerk-react";

export default function JoinChurch() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || joinCode.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<any>("/churches/join", {
        method: "POST",
        body: JSON.stringify({ joinCode: joinCode.trim().toUpperCase() }),
      });
      if (data.error) {
        setError(data.error);
      } else if (data.status === "PENDING") {
        setSuccess(true);
      } else {
        navigate("/app", { replace: true });
        window.location.reload();
      }
    } catch (err: any) {
      setError(err.message || "Failed to join church");
    } finally {
      setLoading(false);
    }
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-6">
            <p className="text-muted-foreground mb-4">Please sign in first to join a church.</p>
            <Button onClick={() => navigate("/login")}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-6 space-y-4">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-zinc-900">Request Pending</h2>
            <p className="text-sm text-zinc-500">
              Your request to join this church is pending approval from an administrator. You'll be able to access the church once approved.
            </p>
            <Button onClick={() => navigate("/app")} className="w-full">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      <div className="bg-white border-b border-zinc-200 px-4 py-4">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-zinc-100">
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <span className="font-semibold text-zinc-900">Join Church</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-zinc-900">Join a Church</h1>
            <p className="text-sm text-zinc-500">Enter the code shared by your church administrator</p>
          </div>

          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="join-code" className="text-center block">Church Code</Label>
                  <Input
                    id="join-code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                    placeholder="XXXXXXXX"
                    className="text-center text-2xl font-mono tracking-[0.3em] uppercase placeholder:normal-case placeholder:text-zinc-300 h-14"
                    maxLength={8}
                    autoFocus
                  />
                  <p className="text-xs text-zinc-400 text-center">{joinCode.length}/8 characters</p>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-500 text-sm">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" disabled={loading || joinCode.length < 6} className="w-full h-11">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join Church"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
