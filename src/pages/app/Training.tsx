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
  volunteer: "bg-purple-100 text-purple-800",
  tech: "bg-blue-100 text-blue-800",
  worship: "bg-amber-100 text-amber-800",
  general: "bg-gray-100 text-gray-800",
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Training</h1>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-muted-foreground">{completedCount} / {materials.length}</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </CardContent>
      </Card>

      {categories.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <Button
            size="sm"
            variant={selectedCategory === "all" ? "default" : "outline"}
            onClick={() => setSelectedCategory("all")}
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              size="sm"
              variant={selectedCategory === cat.id ? "default" : "outline"}
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.name} ({cat.count})
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-3">
        {filteredMaterials.length === 0 && (
          <p className="text-sm text-muted-foreground">No training materials{selectedCategory !== "all" ? ` in ${selectedCategory}` : ""}.</p>
        )}
        {filteredMaterials.map((material) => (
          <Card key={material.id} className={material.completed ? "opacity-60" : ""}>
            <CardContent className="p-4 flex items-start gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${material.completed ? "bg-green-100" : "bg-primary/10"}`}>
                {material.completed ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <BookOpen className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium">{material.title}</h3>
                {material.description && (
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{material.description}</p>
                )}
                {material.category && (
                  <span className={`text-xs px-2 py-0.5 rounded mt-1 inline-block ${CATEGORY_COLORS[material.category.toLowerCase()] || "bg-gray-100 text-gray-800"}`}>
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
                  className="shrink-0"
                >
                  Mark Complete
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
