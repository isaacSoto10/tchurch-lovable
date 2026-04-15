import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";

const songs = [
  { title: "Alabare a Mi Dios", bpm: 120, key: "G" },
  { title: "Cuan Grande es el", bpm: 90, key: "D" },
  { title: "Dios Eterno", bpm: 100, key: "E" },
  { title: "En tu Presencia", bpm: 110, key: "A" },
  { title: "Santo Espiritu", bpm: 95, key: "G" },
  { title: "Tu Fidelidad", bpm: 105, key: "C" },
];

export default function Songs() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Songs</h1>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Song</Button>
      </div>
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search songs..." className="pl-9" />
      </div>
      <div className="grid gap-3">
        {songs.map((s) => (
          <Card key={s.title} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center text-sm font-bold text-primary">
                  {s.key}
                </div>
                <span className="font-medium">{s.title}</span>
              </div>
              <span className="text-sm text-muted-foreground">{s.bpm} BPM</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
