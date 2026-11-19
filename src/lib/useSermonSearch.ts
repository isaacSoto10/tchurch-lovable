import { useEffect, useState } from "react";

type Page<T> = { items: T[]; nextOffset: number | null };

export function useSermonSearch<T extends { id: string }>(
  query: string, scope: string, request: (path: string, signal: AbortSignal) => Promise<Page<T>>,
) {
  const key = JSON.stringify([scope, query.trim()]);
  const [page, setPage] = useState<{ key: string; offset: number; attempt: number }>({ key: "", offset: 0, attempt: 0 });
  const [result, setResult] = useState<{ key: string; items: T[]; next: number | null } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const offset = page.key === key ? page.offset : 0;
  useEffect(() => {
    if (!query.trim()) return;
    setState("loading");
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query.trim(), offset: String(offset) });
        const response = await request("/service-media?" + params, abort.signal);
        if (abort.signal.aborted) return;
        if (!Array.isArray(response?.items)) throw new Error("Invalid search result");
        setResult(previous => {
          const items = offset && previous?.key === key ? [...previous.items, ...response.items] : response.items;
          return { key, items: Array.from(new Map(items.map(item => [item.id, item])).values()), next: response.nextOffset };
        });
        setState("ready");
      } catch {
        if (!abort.signal.aborted) setState("error");
      }
    }, offset ? 0 : 220);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [key, offset, page.attempt, query, request]);
  const current = result?.key === key ? result : null;
  return {
    items: current?.items,
    state,
    more: current?.next != null,
    loadMore: () => setPage({ key, offset: current?.next ?? offset, attempt: page.attempt + 1 }),
    retry: () => setPage({ key, offset, attempt: page.attempt + 1 }),
  };
}
