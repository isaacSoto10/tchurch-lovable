import { gatewayFetch, parsePaddleEnvironment } from '../_shared/paddle.ts';

const responseHeaders = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  },
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { ...responseHeaders, status });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, responseHeaders);
  }

  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => null);
  const priceId = body?.priceId;
  const environment = parsePaddleEnvironment(body?.environment);
  if (typeof priceId !== "string" || !priceId.trim() || priceId.length > 200 || !environment) {
    return reply({ error: "Valid priceId and environment required" }, 400);
  }

  try {
    const response = await gatewayFetch(environment, `/prices?external_id=${encodeURIComponent(priceId)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return reply({ error: "Price lookup unavailable" }, 502);
    const data = await response.json();
    const paddleId = data?.data?.[0]?.id;
    return typeof paddleId === "string" ? reply({ paddleId }) : reply({ error: "Price not found" }, 404);
  } catch {
    return reply({ error: "Price lookup unavailable" }, 502);
  }
});
