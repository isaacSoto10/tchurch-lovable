import { useCallback, useEffect, useRef, useState } from "react";

type Day = { id: string; day: number; title: string; readAt: string | null };
type Plan = { id: string; title: string; days: Day[] };
type Reading = { planId: string | null; id: string | null; title: string; body: string; bibleText: string | null; scriptureRef: string | null; readAt: string | null };
type Library = { plans: Plan[]; reader: Reading | null };
type RequestJson = <T>(path: string, init?: RequestInit) => Promise<T>;

export function ReadingPlans({ request, es, canManage, choices, open, onRead, revision }: {
  request: RequestJson; es: boolean; canManage: boolean;
  choices: { id: string; title: string; status: string; publishDate: string }[];
  open: { id: string } | null; onRead: () => void; revision: number;
}) {
  const [library, setLibrary] = useState<Library>({ plans: [], reader: null });
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    const data = await request<Library>("/devotionals/plans");
    if (epoch === generation.current) setLibrary(data);
  }, [request]);
  useEffect(() => {
    void load().catch(() => setError(es ? "No se pudieron cargar los planes." : "Could not load plans."));
    const refresh = () => { void load().catch(() => {}); };
    window.addEventListener("focus", refresh);
    return () => { generation.current++; window.removeEventListener("focus", refresh); };
  }, [load, es, revision]);

  const save = useCallback(async (method: string, body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      await request("/devotionals/plans", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); return false; }
    finally { setBusy(false); }
  }, [request, load]);
  const show = useCallback(async (id: string) => {
    if (await save("PATCH", { devotionalId: id })) {
      setReading(true);
      ref.current?.scrollIntoView({ block: "start" });
    }
  }, [save]);
  useEffect(() => { if (open) void show(open.id); }, [open, show]);
  const plan = library.plans.find(item => item.id === library.reader?.planId);
  const next = plan?.days.find(day => !day.readAt);
  const reader = library.reader;
  const buttonClass = "min-h-10 rounded-lg border px-3 py-2 text-sm font-semibold";
  return <section ref={ref} className="space-y-3 rounded-2xl border bg-white p-4">
    <h2 className="text-lg font-bold">{es ? "Planes de lectura" : "Reading plans"}</h2>
    {reader?.id && !reading && <button type="button" className={buttonClass} onClick={() => setReading(true)}>
      {es ? "Continuar leyendo" : "Continue reading"} · {reader.title}
    </button>}
    {library.plans.length > 0 && <label className="block text-sm">
      {es ? "Mi plan" : "My plan"}
      <select className="mt-1 block w-full rounded-lg border p-2" value={plan?.id || ""} disabled={busy}
        onChange={event => { setReading(false); void save("PATCH", { planId: event.target.value }); }}>
        <option value="" disabled>{es ? "Elegir plan" : "Choose a plan"}</option>
        {library.plans.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </label>}
    {plan && <div className="space-y-2">
      <p className="text-sm">{plan.days.filter(day => day.readAt).length}/{plan.days.length} {es ? "días completados" : "days completed"}</p>
      {next && <button type="button" disabled={busy} className={buttonClass} onClick={() => void show(next.id)}>
        {es ? "Leer día" : "Read day"} {next.day} · {next.title}
      </button>}
      <details><summary>{es ? "Ver todos los días" : "View all days"}</summary>
        <ol>{plan.days.map(day => <li key={day.id}><button type="button" disabled={busy} className="py-2 text-left" onClick={() => void show(day.id)}>
          {es ? "Día" : "Day"} {day.day} · {day.title} {day.readAt ? "✓" : ""}
        </button></li>)}</ol>
      </details>
    </div>}
    {reading && reader?.id && <article className="space-y-3 border-t pt-3">
      <h3 className="text-xl font-bold">{reader.title}</h3>
      {reader.scriptureRef && <strong>{reader.scriptureRef}</strong>}
      {reader.bibleText && <blockquote className="whitespace-pre-wrap border-l-2 pl-3">{reader.bibleText}</blockquote>}
      <p className="whitespace-pre-wrap">{reader.body}</p>
      {!reader.readAt && <button disabled={busy} className={buttonClass} type="button" onClick={async () => {
        setBusy(true); setError("");
        try { await request(`/devotionals/${reader.id}/read`, { method: "POST" }); await load(); onRead(); }
        catch (err) { setError(err instanceof Error ? err.message : "Error"); } finally { setBusy(false); }
      }}>{es ? "Marcar como leído" : "Mark as read"}</button>}
      <button type="button" className={buttonClass} onClick={() => setReading(false)}>{es ? "Cerrar lectura" : "Close reading"}</button>
    </article>}
    {canManage && <button type="button" className={buttonClass} aria-expanded={editing} onClick={() => setEditing(!editing)}>{es ? "Crear plan" : "Create plan"}</button>}
    {canManage && editing && <form className="grid gap-2" onSubmit={async event => {
      event.preventDefault();
      if (await save("POST", { title: name, days: days.map(day => day.id) })) { setEditing(false); setName(""); setDays([]); }
    }}>
      <label>{es ? "Nombre del plan" : "Plan name"}<input className="block w-full rounded-lg border p-2" required maxLength={150} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{es ? "Añadir lectura para el día" : "Add reading for day"} {days.length + 1}
        <select className="block w-full rounded-lg border p-2" value="" onChange={event => {
          const selected = choices.find(item => item.id === event.target.value);
          if (selected) setDays([...days, { id: selected.id, title: selected.title }]);
        }}><option value="">{es ? "Elegir lectura" : "Choose a reading"}</option>
          {choices.filter(item => item.status === "published" && item.publishDate.slice(0, 10) <= new Date().toISOString().slice(0, 10) && !days.some(day => day.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <ol>{days.map((day, index) => <li key={day.id}>{index + 1}. {day.title} <button type="button" onClick={() => setDays(days.filter(item => item.id !== day.id))}>{es ? "Quitar" : "Remove"}</button></li>)}</ol>
      <button disabled={busy || !days.length || !name.trim()} className={buttonClass}>{es ? "Publicar plan" : "Publish plan"}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
