import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const flowItems = [
  { type: "header", label: "Welcome / Call to Worship" },
  { type: "song", label: "Alabare a Mi Dios — G Major" },
  { type: "member", label: "Maria" },
  { type: "song", label: "Santo Espiritu — A Major" },
  { type: "member", label: "Carlos" },
  { type: "item", label: "Announcements" },
  { type: "song", label: "En tu Presencia — D Major" },
  { type: "header", label: "Message" },
  { type: "song", label: "Tu Fidelidad — G Major" },
  { type: "song", label: "Dios Eterno — C Major" },
];

const typeColors: Record<string, string> = {
  header: "bg-primary text-primary-foreground",
  song: "bg-accent text-accent-foreground",
  member: "bg-secondary text-secondary-foreground",
  item: "bg-muted text-muted-foreground",
};

const typeLabels: Record<string, string> = {
  header: "H",
  song: "S",
  member: "M",
  item: "I",
};

export default function Services() {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Sunday Worship Service</h1>
        <span className="text-sm text-muted-foreground">Apr 13, 2026 · 10:00 AM</span>
      </div>
      <p className="text-sm text-muted-foreground mb-6">Planned</p>
      <div className="flex gap-2 mb-6">
        <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-1" /> Song</Button>
        <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-1" /> Header</Button>
        <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-1" /> Item</Button>
      </div>
      <div className="space-y-2">
        {flowItems.map((item, i) => (
          <Card key={i} className="hover:shadow-sm transition-shadow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold ${typeColors[item.type]}`}>
                {typeLabels[item.type]}
              </div>
              <span className="text-sm font-medium">{item.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
