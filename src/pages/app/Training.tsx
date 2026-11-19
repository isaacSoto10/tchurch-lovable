import { useCallback, useEffect, useRef, useState } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BookOpen, CheckCircle, ExternalLink } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { getChurchId } from "@/lib/api";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "@/lib/sessionSnapshots";

interface TrainingMaterial {
  id: string;
  title: string;
  description?: string;
  category?: string;
  url?: string | null;
  completed: boolean;
  progress?: number;
}

interface Category {
  id: string;
  name: string;
  count: number;
}

type TrainingSnapshot = {
  materials: TrainingMaterial[];
  categories: Category[];
};

const TRAINING_SNAPSHOT_PREFIX = "tchurch_ios_training_snapshot_v1";

function isTrainingSnapshot(data: unknown): data is TrainingSnapshot {
  if (!data || typeof data !== "object") return false;
  const snapshot = data as Partial<TrainingSnapshot>;
  return Array.isArray(snapshot.materials) && Array.isArray(snapshot.categories);
}

const CATEGORY_COLORS: Record<string, string> = {
  volunteer: "bg-purple-100 text-purple-800",
  tech: "bg-blue-100 text-blue-800",
  worship: "bg-amber-100 text-amber-800",
  general: "bg-gray-100 text-gray-800",
};

function trainingMaterialUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

async function openTrainingMaterial(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
  if (!Capacitor.isNativePlatform()) return;
  event.preventDefault();
  try {
    await Browser.open({ url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function Training() {
  const { fetchApi } = useApi();
  const [materials, setMaterials] = useState<TrainingMaterial[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const loadedOnceRef = useRef(false);
  const snapshotKey = sessionSnapshotKey(TRAINING_SNAPSHOT_PREFIX, getChurchId());

  const loadTraining = useCallback(() => {
    const snapshot = readSessionSnapshot<TrainingSnapshot>(snapshotKey, { validate: isTrainingSnapshot });
    if (snapshot) {
      setMaterials(snapshot.data.materials);
      setCategories(snapshot.data.categories);
      loadedOnceRef.current = true;
      setLoading(false);
    } else if (!loadedOnceRef.current) {
      setLoading(true);
    }

    Promise.all([
      fetchApi<TrainingMaterial[]>("/training/materials"),
      fetchApi<Category[]>("/training/categories"),
    ])
      .then(([materialsData, categoriesData]) => {
        const nextSnapshot = {
          materials: Array.isArray(materialsData) ? materialsData : [],
          categories: Array.isArray(categoriesData) ? categoriesData : [],
        };
        setMaterials(nextSnapshot.materials);
        setCategories(nextSnapshot.categories);
        loadedOnceRef.current = true;
        writeSessionSnapshot(snapshotKey, nextSnapshot);
      })
      .catch((e) => console.error("Failed to load training:", e))
      .finally(() => setLoading(false));
  }, [fetchApi, snapshotKey]);

  useEffect(() => {
    loadTraining();
  }, [loadTraining]);

  const handleMarkComplete = async (id: string) => {
    try {
      await fetchApi(`/training/materials/${id}/complete`, { method: "POST" });
      setMaterials((prev) => {
        const nextMaterials = prev.map((m) => (m.id === id ? { ...m, completed: true, progress: 100 } : m));
        writeSessionSnapshot(snapshotKey, { materials: nextMaterials, categories });
        return nextMaterials;
      });
    } catch (e) {
      console.error("Failed to mark complete:", e);
    }
  };

  const completedCount = materials.filter((m) => m.completed).length;
  const overallProgress = materials.length > 0 ? (completedCount / materials.length) * 100 : 0;

  const filteredMaterials = selectedCategory === "all"
    ? materials
    : materials.filter((m) => m.category?.toLowerCase() === selectedCategory);

  if (loading && materials.length === 0) {
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
        {filteredMaterials.map((material) => {
          const materialUrl = trainingMaterialUrl(material.url);
          return (
            <Card key={material.id}>
              <CardContent className="flex flex-wrap items-start gap-3 p-4 sm:gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${material.completed ? "bg-green-100" : "bg-primary/10"}`}>
                  {material.completed ? (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  ) : (
                    <BookOpen className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-0">
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
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-col">
                  {materialUrl && (
                    <Button variant="outline" size="sm" className="min-h-11" asChild>
                      <a
                        href={materialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => void openTrainingMaterial(event, materialUrl)}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Abrir material
                      </a>
                    </Button>
                  )}
                  {!material.completed && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkComplete(material.id)}
                      className="min-h-11 shrink-0"
                    >
                      Mark Complete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
