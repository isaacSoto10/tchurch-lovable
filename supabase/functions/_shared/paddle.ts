import { Environment, Paddle, EventName } from 'npm:@paddle/paddle-node-sdk';

export { EventName };

export type PaddleEnv = 'sandbox' | 'live';

const GATEWAY_BASE_URL = 'https://connector-gateway.lovable.dev/paddle';

export function parsePaddleEnvironment(value: unknown): PaddleEnv | null {
  return value === 'sandbox' || value === 'live' ? value : null;
}

export function getConnectionApiKey(env: PaddleEnv): string {
  const key = Deno.env.get(env === 'sandbox' ? 'PADDLE_SANDBOX_API_KEY' : 'PADDLE_LIVE_API_KEY');
  if (!key) throw new Error('Paddle API key is not configured');
  return key;
}

export function getPaddleClient(env: PaddleEnv): Paddle {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

  return new Paddle(connectionApiKey, {
    environment: GATEWAY_BASE_URL as unknown as Environment,
    customHeaders: {
      'X-Connection-Api-Key': connectionApiKey,
      'Lovable-API-Key': lovableApiKey,
    },
  });
}

export async function gatewayFetch(env: PaddleEnv, path: string, init?: RequestInit): Promise<Response> {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  return fetch(`${GATEWAY_BASE_URL}${path}`, {
    ...init,
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'X-Connection-Api-Key': connectionApiKey,
      'Lovable-API-Key': lovableApiKey,
      ...init?.headers,
    },
  });
}

export function getWebhookSecret(env: PaddleEnv): string {
  const secret = Deno.env.get(
    env === 'sandbox' ? 'PAYMENTS_SANDBOX_WEBHOOK_SECRET' : 'PAYMENTS_LIVE_WEBHOOK_SECRET',
  );
  if (!secret) throw new Error('Paddle webhook secret is not configured');
  return secret;
}

export async function verifyWebhook(req: Request, env: PaddleEnv) {
  const signature = req.headers.get('paddle-signature');
  const body = await req.text();
  const secret = getWebhookSecret(env);

  if (!signature || !body) {
    throw new Error('Missing signature or body');
  }

  const paddle = getPaddleClient(env);
  return await paddle.webhooks.unmarshal(body, secret, signature);
}
