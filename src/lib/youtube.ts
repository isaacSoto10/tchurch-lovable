export function getYoutubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (host.endsWith("youtube.com")) {
      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/").filter(Boolean)[1] || null;
      }

      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/").filter(Boolean)[1] || null;
      }

      return parsed.searchParams.get("v");
    }
  } catch {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i);
    return match?.[1] ?? null;
  }

  return null;
}

export function getYoutubeEmbedUrl(url: string | null | undefined): string | null {
  const videoId = getYoutubeVideoId(url);
  if (!videoId) return null;

  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "1",
  });

  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    params.set(
      "origin",
      origin.startsWith("http") ? origin : "https://www.tchurchapp.com"
    );
  }

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}
