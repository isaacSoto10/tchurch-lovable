import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/hooks/useApi";
import { Loader2, Sparkles, X } from "lucide-react";

type Audience = "general" | "ministry";
type Locale = "en" | "es";

const COPY = {
  en: {
    label: "AI cover image",
    helper: "Generate a warm announcement image with ChatGPT/OpenAI image models. The prompt follows the language selected above.",
    generate: "Generate image",
    generating: "Generating...",
    regenerate: "Regenerate",
    remove: "Remove",
    restore: "Use suggested prompt",
    error: "Image generation failed. Try a clearer prompt.",
    preview: "Generated announcement image",
    noText: "Tip: images work best without embedded text. Add words in the announcement instead.",
    generalScope: "church-wide announcement",
    ministryScope: "ministry announcement",
  },
  es: {
    label: "Imagen con IA",
    helper: "Genera una imagen cálida para el anuncio con modelos de imagen de ChatGPT/OpenAI. El prompt sigue el idioma seleccionado arriba.",
    generate: "Generar imagen",
    generating: "Generando...",
    regenerate: "Regenerar",
    remove: "Quitar",
    restore: "Usar sugerencia",
    error: "No se pudo generar la imagen. Intenta con un prompt más claro.",
    preview: "Imagen generada para el anuncio",
    noText: "Tip: las imágenes funcionan mejor sin texto integrado. Agrega palabras en el anuncio.",
    generalScope: "anuncio general de la iglesia",
    ministryScope: "anuncio de ministerio",
  },
} as const;

function summarize(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 240) : fallback;
}

function buildDefaultPrompt(params: {
  locale: Locale;
  title: string;
  content: string;
  audience: Audience;
  ministryName?: string | null;
}) {
  const copy = COPY[params.locale];
  const scope = params.audience === "ministry"
    ? params.ministryName || copy.ministryScope
    : copy.generalScope;

  if (params.locale === "es") {
    return [
      `Crea una imagen horizontal, moderna y cálida para un ${scope}.`,
      `Tema principal: ${summarize(params.title, "un anuncio importante para la comunidad de la iglesia")}.`,
      `Contexto: ${summarize(params.content, "una actualización clara, esperanzadora y acogedora para la iglesia")}.`,
      "Estilo: fotografía editorial, luz natural, personas diversas y acogedoras, ambiente de iglesia contemporánea, composición limpia.",
      "Sin texto, sin palabras legibles, sin logos y sin tipografía dentro de la imagen.",
    ].join(" ");
  }

  return [
    `Create a warm, modern horizontal image for a ${scope}.`,
    `Main theme: ${summarize(params.title, "an important update for the church community")}.`,
    `Context: ${summarize(params.content, "a clear, hopeful, welcoming update for the church")}.`,
    "Style: editorial photography, natural light, diverse welcoming people, contemporary church atmosphere, clean composition.",
    "No text, no readable words, no logos, and no typography inside the image.",
  ].join(" ");
}

export function AnnouncementAiImageField({
  title,
  content,
  audience,
  ministryName,
  imageUrl,
  locale,
  onImageUrlChange,
}: {
  title: string;
  content: string;
  audience: Audience;
  ministryName?: string | null;
  imageUrl: string | null;
  locale: Locale;
  onImageUrlChange: (url: string | null) => void;
}) {
  const { fetchApi } = useApi();
  const copy = COPY[locale];
  const [prompt, setPrompt] = useState("");
  const [promptTouched, setPromptTouched] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedPrompt = useMemo(
    () => buildDefaultPrompt({ locale, title, content, audience, ministryName }),
    [audience, content, locale, ministryName, title]
  );

  useEffect(() => {
    if (!promptTouched) setPrompt(suggestedPrompt);
  }, [promptTouched, suggestedPrompt]);

  useEffect(() => {
    if (!title && !content && !imageUrl) setPromptTouched(false);
  }, [content, imageUrl, title]);

  async function handleGenerateImage() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setGenerating(true);
    setError(null);

    try {
      const data = await fetchApi<{ imageUrl?: string; error?: string }>("/generate-image", {
        method: "POST",
        body: JSON.stringify({
          prompt: trimmedPrompt,
          locale,
          title,
          content,
          scope: audience === "ministry" ? ministryName || copy.ministryScope : copy.generalScope,
        }),
      });

      if (!data.imageUrl) throw new Error(data.error || copy.error);
      onImageUrlChange(data.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {copy.label}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.helper}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setPrompt(suggestedPrompt);
            setPromptTouched(false);
          }}
        >
          {copy.restore}
        </Button>
      </div>

      <Textarea
        rows={4}
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value);
          setPromptTouched(true);
        }}
        className="resize-none text-sm leading-6"
      />
      <p className="text-xs leading-5 text-muted-foreground">{copy.noText}</p>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={handleGenerateImage} disabled={generating || !prompt.trim()}>
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          {generating ? copy.generating : imageUrl ? copy.regenerate : copy.generate}
        </Button>
        {imageUrl && (
          <Button type="button" variant="outline" size="sm" onClick={() => onImageUrlChange(null)}>
            <X className="h-4 w-4" />
            {copy.remove}
          </Button>
        )}
      </div>

      {imageUrl && (
        <div className="overflow-hidden rounded-2xl border bg-muted">
          <img src={imageUrl} alt={copy.preview} className="aspect-[3/2] w-full object-cover" />
        </div>
      )}
    </div>
  );
}
