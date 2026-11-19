import { useRef, useState } from "react";

export type Quote = { id: string; authorName: string; content: string };
type Bookmark = { id: string; offset: number };
const prefix = "tchurch-message-reading-v1/";

export function savedChannel(scope: string | null) {
  try { return scope ? localStorage.getItem(prefix + scope) : null; } catch { return null; }
}
export function rememberChannel(scope: string | null, channelId: string) {
  if (scope) try { localStorage.setItem(prefix + scope, channelId); } catch {}
}
function bookmarkKey(scope: string, channelId: string) { return prefix + scope + "/" + encodeURIComponent(channelId); }
export function savedPosition(scope: string | null, channelId: string): Bookmark | null {
  if (!scope) return null;
  try {
    const item = JSON.parse(localStorage.getItem(bookmarkKey(scope, channelId)) || "null");
    return typeof item?.id === "string" && Number.isFinite(item.offset) ? item : null;
  } catch { return null; }
}
export function rememberPosition(scope: string | null, channelId: string | null, scroller: HTMLElement) {
  if (!scope || !channelId) return;
  try {
    const key = bookmarkKey(scope, channelId);
    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 12) { localStorage.removeItem(key); return; }
    const top = scroller.getBoundingClientRect().top;
    const visible = [...scroller.querySelectorAll<HTMLElement>("[data-reading-id]")].find(el => el.getBoundingClientRect().bottom > top);
    if (visible) localStorage.setItem(key, JSON.stringify({ id: visible.dataset.readingId, offset: visible.getBoundingClientRect().top - top }));
  } catch {}
}
export function restorePosition(scroller: HTMLElement | null, bookmark: Bookmark | null) {
  if (!bookmark || !scroller) return false;
  const row = [...scroller.querySelectorAll<HTMLElement>("[data-reading-id]")].find(el => el.dataset.readingId === bookmark.id);
  if (!row) return false;
  scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - bookmark.offset;
  return true;
}
export function ThreadHistory({ channelId, request, onQuote, quote, onClear, canPost, es }: {
  channelId: string; request: <T>(path: string, options?: RequestInit) => Promise<T>;
  onQuote: (message: Quote) => void; quote: Quote | null; onClear: () => void; canPost: boolean; es: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Quote[]>([]);
  const [searched, setSearched] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  async function search(more: boolean) {
    const term = query.trim();
    if (!term) return;
    const epoch = ++generation.current;
    const params = new URLSearchParams({ q: term, limit: "20" });
    if (more && results.length) params.set("before", results[results.length - 1].id);
    setError(""); setBusy(true);
    try {
      const matches = await request<Quote[]>(`/channels/${encodeURIComponent(channelId)}/messages?${params}`);
      if (epoch !== generation.current) return;
      setHasMore(matches.length === 20); setSearched(term);
      setResults(current => [...(more ? current : []), ...matches.reverse()]);
    } catch (err) { if (epoch === generation.current) setError(err instanceof Error ? err.message : "Error"); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  return <div className="shrink-0 border-b px-3 py-2 text-sm">
    <details><summary className="cursor-pointer font-semibold">{es ? "Buscar en este canal" : "Search this channel"}</summary>
      <form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); void search(false); }}>
        <input maxLength={300} className="min-w-0 flex-1 rounded-lg border p-2" aria-label={es ? "Buscar mensaje" : "Search messages"} value={query}
          onChange={event => { generation.current++; setBusy(false); setQuery(event.target.value); setResults([]); setSearched(""); setHasMore(false); }} />
        <button className="rounded-lg border px-3" disabled={busy || !query.trim()}>{es ? "Buscar" : "Search"}</button>
      </form>
      <div className="max-h-48 overflow-y-auto" aria-live="polite">
        {results.map(result => <div key={result.id} className="border-b py-2">
          <strong>{result.authorName}</strong><p className="whitespace-pre-wrap break-words">{result.content}</p>
          {canPost && <button type="button" className="underline" onClick={() => onQuote(result)}>{es ? "Responder" : "Reply"}</button>}
        </div>)}
        {searched && !results.length && <p>{es ? "Sin resultados" : "No matches"}</p>}
        {hasMore && <button disabled={busy} onClick={() => void search(true)}>{es ? "Ver más resultados" : "More results"}</button>}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
    {quote && <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border-l-4 bg-zinc-50 p-2">
      <p className="min-w-0 truncate">{es ? "Respondiendo a" : "Replying to"} {quote.authorName} · {quote.content}</p>
      <button type="button" onClick={onClear}>{es ? "Cancelar" : "Cancel"}</button>
    </div>}
  </div>;
}
