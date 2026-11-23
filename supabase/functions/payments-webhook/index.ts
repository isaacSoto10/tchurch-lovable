import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhook, EventName, parsePaddleEnvironment, type PaddleEnv } from '../_shared/paddle.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const TCHURCH_WEBHOOK_URL = 'https://www.tchurchapp.com/api/webhooks/paddle';
type PaddleRelay = (data: Record<string, unknown>) => Promise<void>;

function getSubscriptionPlan(items: unknown) {
  const item = Array.isArray(items) && items.length === 1 ? items[0] : null;
  const priceId = item?.price?.importMeta?.externalId || item?.price?.id;
  const productId = item?.product?.importMeta?.externalId || item?.product?.id;
  return {
    priceId: typeof priceId === 'string' && priceId ? priceId : null,
    productId: typeof productId === 'string' && productId ? productId : null,
  };
}

async function forwardToTchurch(relaySecret: string, data: Record<string, unknown>) {
  const response = await fetch(TCHURCH_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${relaySecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    redirect: 'error',
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Paddle relay returned ${response.status}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const env = parsePaddleEnvironment(url.searchParams.get('env') ?? 'sandbox');
  if (!env) return new Response('Invalid environment', { status: 400 });

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(req, env);
  } catch {
    return new Response('Invalid webhook', { status: 400 });
  }

  const relaySecret = Deno.env.get('PADDLE_WEBHOOK_RELAY_SECRET');
  if (!relaySecret || relaySecret.length < 32) return new Response('Webhook unavailable', { status: 503 });
  const relay: PaddleRelay = (data) => forwardToTchurch(relaySecret, {
    ...data,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
  });

  try {
    switch (event.eventType) {
      case EventName.SubscriptionCreated:
        await handleSubscriptionCreated(event.data, env, relay);
        break;
      case EventName.SubscriptionUpdated:
        await handleSubscriptionUpdated(event.data, env, relay);
        break;
      case EventName.SubscriptionCanceled:
        await handleSubscriptionCanceled(event.data, env, relay);
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    console.error('Paddle webhook processing failed', { eventType: event.eventType, environment: env });
    return new Response('Webhook unavailable', { status: 503 });
  }
});

async function handleSubscriptionCreated(data: any, env: PaddleEnv, relay: PaddleRelay) {
  const { id, customerId, items, status, currentBillingPeriod, customData } = data;

  const userId = typeof customData?.userId === 'string' && customData.userId.trim() ? customData.userId : null;
  const plan = getSubscriptionPlan(items);

  // The legacy mirror requires both plan identifiers and the optional user metadata.
  if (userId && plan.productId && plan.priceId) {
    const { error } = await supabase.from('subscriptions').upsert({
      user_id: userId,
      paddle_subscription_id: id,
      paddle_customer_id: customerId,
      product_id: plan.productId,
      price_id: plan.priceId,
      status: status,
      current_period_start: currentBillingPeriod?.startsAt,
      current_period_end: currentBillingPeriod?.endsAt,
      environment: env,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,environment',
    });
    if (error) throw new Error('Could not save Paddle subscription');
  }

  await relay({
    event: 'subscription.created',
    userId,
    subscriptionId: id,
    customerId,
    ...plan,
    status,
    currentPeriodStart: currentBillingPeriod?.startsAt,
    currentPeriodEnd: currentBillingPeriod?.endsAt,
    environment: env,
  });
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv, relay: PaddleRelay) {
  const { id, customerId, items, status, currentBillingPeriod, scheduledChange, customData } = data;

  const { error } = await supabase.from('subscriptions')
    .update({
      status: status,
      current_period_start: currentBillingPeriod?.startsAt,
      current_period_end: currentBillingPeriod?.endsAt,
      cancel_at_period_end: scheduledChange?.action === 'cancel',
      updated_at: new Date().toISOString(),
    })
    .eq('paddle_subscription_id', id)
    .eq('environment', env);
  if (error) throw new Error('Could not update Paddle subscription');

  await relay({
    event: 'subscription.updated',
    userId: customData?.userId,
    subscriptionId: id,
    customerId,
    ...getSubscriptionPlan(items),
    status,
    cancelAtPeriodEnd: scheduledChange?.action === 'cancel',
    currentPeriodStart: currentBillingPeriod?.startsAt,
    currentPeriodEnd: currentBillingPeriod?.endsAt,
    environment: env,
  });
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv, relay: PaddleRelay) {
  const { error } = await supabase.from('subscriptions')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('paddle_subscription_id', data.id)
    .eq('environment', env);
  if (error) throw new Error('Could not cancel Paddle subscription');

  await relay({
    event: 'subscription.canceled',
    userId: data.customData?.userId,
    subscriptionId: data.id,
    status: 'canceled',
    environment: env,
  });
}
