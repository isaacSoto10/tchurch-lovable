import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const announcements = [
  { title: "Special Prayer Night", desc: "Join us this Friday for a special evening of prayer and worship." },
  { title: "Youth Camp 2026", desc: "Registration now open for summer youth camp. Limited spots available!" },
  { title: "Volunteers Needed", desc: "We need help with the upcoming community outreach event." },
  { title: "New Bible Study", desc: "Starting next Wednesday — a deep dive into the book of Romans." },
];

export default function Announcements() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Announcements</h1>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New</Button>
      </div>
      <div className="grid gap-3">
        {announcements.map((a) => (
          <Card key={a.title} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-1">{a.title}</h3>
              <p className="text-sm text-muted-foreground">{a.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
