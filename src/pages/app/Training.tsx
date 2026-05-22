import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BookOpen, CheckCircle } from "lucide-react";
import { useApi } from "@/hooks/useApi";

interface TrainingMaterial {
  id: string;
  title: string;
  description?: string;
  category?: string;
  completed: boolean;
  progress?: number;
}

interface Category {
  id: string;
  name: string;
  count: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  volunteer: "bg-secondary text-secondary-foreground",
  tech: "bg-secondary text-secondary-foreground",
  worship: "bg-accent text-accent-foreground",
  general: "bg-secondary text-secondary-foreground",
};

export default function Training() {
  const { fetchApi } = useApi();
  const [materials, setMaterials] = useState<TrainingMaterial[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchApi("/training/materials"),
      fetchApi("/training/categories"),
    ])
      .then(([materialsData, categoriesData]) => {
        setMaterials(Array.isArray(materialsData) ? materialsData : []);
        setCategories(Array.isArray(categoriesData) ? categoriesData : []);
      })
      .catch((e) => console.error("Failed to load training:", e))
      .finally(() => setLoading(false));
  }, [fetchApi]);

  const handleMarkComplete = async (id: string) => {
    try {
      await fetchApi(`/training/materials/${id}/complete`, { method: "POST" });
      setMaterials((prev) =>
        prev.map((m) => (m.id === id ? { ...m, completed: true, progress: 100 } : m))
      );
    } catch (e) {
      console.error("Failed to mark complete:", e);
    }
  };

  const completedCount = materials.filter((m) => m.completed).length;
  const overallProgress = materials.length > 0 ? (completedCount / materials.length) * 100 : 0;

  const filteredMaterials = selectedCategory === "all"
    ? materials
    : materials.filter((m) => m.category?.toLowerCase() === selectedCategory);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="app-page space-y-5">
      <div className="app-page-header p-4 sm:p-5">
        <p className="app-page-kicker">Formación</p>
        <h1 className="app-page-title">Capacitación</h1>
        <p className="app-page-copy">Materiales y progreso para preparar equipos con claridad.</p>
      </div>

      <Card className="app-list-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progreso general</span>
            <span className="text-sm text-muted-foreground">{completedCount} / {materials.length}</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </CardContent>
      </Card>

      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant={selectedCategory === "all" ? "default" : "outline"}
            className="rounded-md"
            onClick={() => setSelectedCategory("all")}
          >
            Todo
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              size="sm"
              variant={selectedCategory === cat.id ? "default" : "outline"}
              className="rounded-md"
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.name} ({cat.count})
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-3">
        {filteredMaterials.length === 0 && (
          <div className="app-empty-state">
            <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No hay materiales{selectedCategory !== "all" ? ` en ${selectedCategory}` : ""}.
            </p>
          </div>
        )}
        {filteredMaterials.map((material) => (
          <Card key={material.id} className={`app-list-card ${material.completed ? "opacity-65" : ""}`}>
            <CardContent className="p-4 flex items-start gap-4">
              <div className={`app-icon-tile ${material.completed ? "bg-emerald-100 text-emerald-700" : ""}`}>
                {material.completed ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <BookOpen className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium">{material.title}</h3>
                {material.description && (
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{material.description}</p>
                )}
                {material.category && (
                  <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs ${CATEGORY_COLORS[material.category.toLowerCase()] || "bg-secondary text-secondary-foreground"}`}>
                    {material.category}
                  </span>
                )}
                {!material.completed && material.progress !== undefined && (
                  <Progress value={material.progress} className="h-1 mt-2" />
                )}
              </div>
              {!material.completed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleMarkComplete(material.id)}
                  className="shrink-0 rounded-md"
                >
                  Completar
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
