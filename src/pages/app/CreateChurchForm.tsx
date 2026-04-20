import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";

export default function CreateChurchForm() {
  const navigate = useNavigate();
  const [churchName, setChurchName] = useState("");
  const [churchDescription, setChurchDescription] = useState("");

  function handleContinue() {
    if (!churchName.trim()) return;
    navigate("/app/presets", {
      state: {
        churchName: churchName.trim(),
        churchDescription: churchDescription.trim(),
      },
    });
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-4 py-4">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-lg hover:bg-zinc-100"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-600" />
          </button>
          <span className="font-semibold text-zinc-900">Tchurch</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          {/* Title */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">⛪</span>
            </div>
            <h1 className="text-2xl font-bold text-zinc-900">Create Your Church</h1>
            <p className="text-sm text-zinc-500">Give your church a name</p>
          </div>

          {/* Form */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="church-name">Church Name</Label>
                <Input
                  id="church-name"
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
                  placeholder="e.g. Grace Community Church"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="church-description">Description (optional)</Label>
                <Textarea
                  id="church-description"
                  value={churchDescription}
                  onChange={(e) => setChurchDescription(e.target.value)}
                  placeholder="A brief description of your church..."
                  rows={3}
                />
              </div>

              <Button
                onClick={handleContinue}
                disabled={!churchName.trim()}
                className="w-full"
              >
                Continue
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}