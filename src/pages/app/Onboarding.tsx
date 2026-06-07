import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Users, Plus, ArrowLeft } from "lucide-react";
import { TchurchLogo } from "@/components/TchurchLogo";
import { apiFetch, setChurchId } from "@/lib/api";
import { useAppAuth } from "@/hooks/useAppAuth";
import { isNativeMobileAuth } from "@/lib/mobileAuth";

type JoinChurchResponse = {
  status?: "APPROVED" | "PENDING";
  church?: {
    id: string;
    name?: string;
  };
  error?: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Onboarding() {
  const { user } = useAppAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"choose" | "join">(isNativeMobileAuth ? "join" : "choose");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const firstName = user?.firstName || "there";

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<JoinChurchResponse>(`/churches/join`, {
        method: "POST",
        body: JSON.stringify({ code: joinCode.trim().toUpperCase() }),
      });
      if (data.error) {
        setError(data.error);
      } else if (data.status === "PENDING") {
        setError("Tu solicitud quedó pendiente. Pide a un administrador que revise tu acceso.");
      } else {
        if (data.church?.id) {
          setChurchId(data.church.id);
        }
        navigate("/app", { replace: true });
        window.location.reload();
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to join church"));
    } finally {
      setLoading(false);
    }
  }

  // Create card → navigate to dedicated form
  function handleCreateNavigate() {
    if (isNativeMobileAuth) return;
    navigate("/create-church");
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-4 py-4">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-zinc-100">
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <TchurchLogo size="xs" wordPurple />
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">

          {/* Welcome */}
          <div className="text-center space-y-2">
            <TchurchLogo variant="mark" size="hero" className="mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-zinc-900">Welcome, {firstName}!</h1>
            <p className="text-sm text-zinc-500">
              {isNativeMobileAuth
                ? "Get started by joining the church that invited you."
                : "Get started by joining an existing church or creating a new one."}
            </p>
          </div>

          {mode === "choose" && !isNativeMobileAuth && (
            <div className="space-y-3">
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setMode("join")}>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-zinc-900">Join a Church</p>
                    <p className="text-xs text-zinc-500">Enter a church code to join</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={handleCreateNavigate}>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center shrink-0">
                    <Plus className="w-6 h-6 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-zinc-900">Create a Church</p>
                    <p className="text-xs text-zinc-500">Start a new church community</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {mode === "join" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Join a Church</CardTitle>
                  <CardDescription>
                    {isNativeMobileAuth
                      ? "Enter the 8-character code from your church. New churches can only be created on the web."
                      : "Enter the 8-character code shared by your church"}
                  </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleJoin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="join-code">Church Code</Label>
                    <Input
                      id="join-code"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                      placeholder="e.g. VB4AZPDL"
                      className="text-center text-lg font-mono tracking-widest uppercase placeholder:normal-case placeholder:text-zinc-300"
                      maxLength={8}
                      autoFocus
                    />
                  </div>
                  {error && <p className="text-sm text-red-500">{error}</p>}
                  <div className="flex gap-2">
                    {!isNativeMobileAuth && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { setMode("choose"); setError(""); }}
                        className="flex-1"
                      >
                        Back
                      </Button>
                    )}
                    <Button type="submit" disabled={loading || joinCode.length !== 8} className="flex-1">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join Church"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}
