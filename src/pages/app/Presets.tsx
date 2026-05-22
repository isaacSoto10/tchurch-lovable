import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Check } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAppAuth } from "@/hooks/useAppAuth";

const MINISTRIES = [
  { name: "Alabanza", color: "#b45309" },
  { name: "Jóvenes", color: "#be185d" },
  { name: "Niños", color: "#2563eb" },
  { name: "Mujeres", color: "#7c3aed" },
  { name: "Hombres", color: "#0f766e" },
  { name: "Ujieres", color: "#c2410c" },
  { name: "Media y tecnología", color: "#5c3f9b" },
  { name: "Hospitalidad", color: "#047857" },
  { name: "Oración", color: "#0369a1" },
  { name: "Alcance", color: "#b91c1c" },
  { name: "Estudio bíblico", color: "#4d7c0f" },
  { name: "Adultos mayores", color: "#6d28d9" },
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
  const { user } = useAppAuth();

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
      toast({ description: "El nombre de la iglesia es requerido", variant: "destructive" });
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
    } catch (err) {
      toast({ description: err instanceof Error ? err.message : "No se pudo crear la iglesia", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    navigate("/app", { replace: true });
    window.location.reload();
  }

  return (
    <div className="app-page flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button
            onClick={() => navigate("/create-church")}
            className="-ml-2 rounded-md p-2 hover:bg-secondary"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <span className="font-semibold text-foreground">Configurar ministerios</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-5">
          {/* Subtitle */}
          <div className="app-page-header p-4 text-center sm:p-5">
            <p className="app-page-kicker justify-center">Plantilla inicial</p>
            <h1 className="app-page-title">Elige tus ministerios</h1>
            <p className="app-page-copy mx-auto">
              Selecciona las áreas activas de tu iglesia y agrega correos de líderes si quieres invitarlos desde el inicio.
            </p>
          </div>

          {/* Ministry Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {MINISTRIES.map((ministry) => {
              const isSelected = selected.has(ministry.name);
              return (
                <Card
                  key={ministry.name}
                  className={`app-list-card cursor-pointer transition-all ${
                    isSelected ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => toggleMinistry(ministry.name)}
                >
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    {/* Ministry mark */}
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-md text-xs font-semibold text-white"
                      style={{ backgroundColor: ministry.color + "20" }}
                    >
                      <span className="text-foreground">{ministry.name.slice(0, 2).toUpperCase()}</span>
                    </div>
                    {/* Ministry name */}
                    <span className="text-center text-xs font-medium text-foreground">
                      {ministry.name}
                    </span>
                    {/* Checkbox indicator */}
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                        isSelected ? "border-primary bg-primary" : "border-zinc-300"
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {/* Leader email input */}
                    {isSelected && (
                      <div className="w-full mt-2">
                        <Input
                          type="email"
                          placeholder="Correo del líder (opcional)"
                          value={leaderEmails[ministry.name] || ""}
                          onChange={(e) => handleLeaderEmail(ministry.name, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-8 rounded-md text-xs"
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
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Omitir por ahora
            </button>
          </div>

          {/* Create church button */}
          <Button
            onClick={handleCreateChurch}
            disabled={loading}
            className="w-full rounded-md"
          >
            {loading ? "Creando..." : "Crear iglesia"}
          </Button>
        </div>
      </div>
    </div>
  );
}
