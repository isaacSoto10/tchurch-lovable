import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useAppAuth } from "@/hooks/useAppAuth";

export default function PersonalEventQr() {
  const { id } = useParams();
  const { fetchApi } = useApi();
  const { selectedChurch, loading: churchLoading } = useChurch();
  const { userId } = useAppAuth();
  const scope = `${selectedChurch?.id}:${userId}:${id}`;
  const [result, setResult] = useState<{ scope: string; image?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setResult(null);
    if (id && userId && selectedChurch?.id) {
      void (async () => {
        try {
          const qr = await fetchApi<{ canonicalUrl: string }>(`/events/${encodeURIComponent(id)}/my-qr`);
          if (!qr.canonicalUrl) throw new Error("QR unavailable");
          const image = await QRCode.toDataURL(qr.canonicalUrl, { width: 600, margin: 4 });
          if (active) setResult({ scope, image });
        } catch {
          if (active) setResult({ scope });
        }
      })();
    } else if (!churchLoading) {
      setResult({ scope });
    }
    return () => { active = false; };
  }, [attempt, churchLoading, fetchApi, id, scope, selectedChurch?.id, userId]);

  return (
    <main className="mx-auto max-w-md space-y-5 p-4">
      <Link className="inline-flex min-h-11 items-center font-semibold" to={`/app/events/${id}`}>Volver al evento</Link>
      <h1 className="text-2xl font-bold">Mi QR de entrada</h1>
      {result?.scope !== scope ? <p role="status">Cargando tu QR…</p> : result.image ? (
        <><img src={result.image} alt="Mi QR personal de entrada" className="aspect-square w-full rounded-xl bg-white" /><p>Presenta este código al llegar al evento.</p></>
      ) : <div role="status"><p>Tu QR no está disponible. Revisa tu confirmación de asistencia.</p><button className="min-h-11 font-bold" onClick={() => setAttempt(attempt + 1)}>Reintentar</button></div>}
    </main>
  );
}
