import { deepEqual, equal, rejects } from 'node:assert/strict';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deliverSubscriptionNotice, type VerifiedSubscriptionNotice } from './subscription-mirror.ts';

const notice: VerifiedSubscriptionNotice = {
  event: 'subscription.created',
  eventId: 'fixture-event',
  occurredAt: '2026-11-23T02:46:30Z',
  environment: 'live',
  subscriptionId: 'fixture-subscription',
  customerId: 'fixture-customer',
  userId: 'untrusted-metadata-user',
  productId: 'fixture-product',
  priceId: 'fixture-price',
  status: 'active',
};

const trusted = {
  id: 'fixture-mirror-row',
  user_id: 'operator-bound-user',
  paddle_subscription_id: 'fixture-subscription',
  paddle_customer_id: 'fixture-customer',
  environment: 'live',
  product_id: 'fixture-product',
  price_id: 'fixture-price',
  paddle_binding_verified_at: '2026-11-23T02:45:00Z',
  paddle_last_event_at: null as string | null,
  status: 'inactive',
};

function fixture(row = { ...trusted }, updateFails = false) {
  const effects: string[] = [];
  const patches: { query: URLSearchParams; body: Record<string, unknown> }[] = [];
  const client = createClient('https://mirror-fixture.invalid', 'local-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const query = url.searchParams;
        const matchesTuple = query.get('paddle_subscription_id') === `eq.${row.paddle_subscription_id}` &&
          query.get('paddle_customer_id') === `eq.${row.paddle_customer_id}` &&
          query.get('environment') === `eq.${row.environment}`;
        if (init?.method === 'PATCH') {
          effects.push('update');
          const body = JSON.parse(String(init.body));
          patches.push({ query, body });
          if (updateFails) return Promise.resolve(Response.json({ message: 'fixture error' }, { status: 500 }));
          const time = Date.parse(body.paddle_last_event_at);
          const priorTime = row.paddle_last_event_at ? Date.parse(row.paddle_last_event_at) : -Infinity;
          if (matchesTuple && query.get('id') === `eq.${row.id}` && time > priorTime) {
            row.status = body.status;
            row.paddle_last_event_at = body.paddle_last_event_at;
          }
          return Promise.resolve(new Response(null, { status: 204 }));
        }

        effects.push('lookup');
        const matching = matchesTuple &&
          query.get('paddle_binding_verified_at') === 'not.is.null' &&
          Boolean(row.paddle_binding_verified_at);
        return Promise.resolve(Response.json(matching ? [row] : []));
      },
    },
  });
  const relay = (event: VerifiedSubscriptionNotice) => {
    effects.push('relay');
    equal(event.eventId, notice.eventId);
    return Promise.resolve();
  };
  return { row, effects, patches, client, relay };
}

Deno.test('relays first and applies a verified plan without adopting webhook user metadata', async () => {
  const test = fixture();
  await deliverSubscriptionNotice(test.client, notice, test.relay);

  deepEqual(test.effects, ['relay', 'lookup', 'update']);
  equal(test.row.status, 'active');
  equal(test.row.user_id, 'operator-bound-user');
  equal(test.patches[0].body.user_id, undefined);
  equal(test.patches[0].body.product_id, undefined);
  equal(test.patches[0].query.get('paddle_binding_verified_at'), `eq.${trusted.paddle_binding_verified_at}`);
  equal(test.patches[0].query.get('product_id'), `eq.${trusted.product_id}`);
  equal(test.patches[0].query.get('price_id'), `eq.${trusted.price_id}`);
});

Deno.test('relays unbound, cross-customer and sandbox events without writing mirror rows', async () => {
  for (const event of [
    { ...notice, subscriptionId: 'different-subscription' },
    { ...notice, customerId: 'different-customer' },
    { ...notice, environment: 'sandbox' as const },
  ]) {
    const test = fixture();
    await deliverSubscriptionNotice(test.client, event, test.relay);
    deepEqual(test.effects, ['relay', 'lookup']);
    equal(test.patches.length, 0);
  }

  const historical = fixture({ ...trusted, paddle_binding_verified_at: '' });
  await deliverSubscriptionNotice(historical.client, notice, historical.relay);
  deepEqual(historical.effects, ['relay', 'lookup']);
  equal(historical.patches.length, 0);
});

Deno.test('applies a voided subscription and prevents an older notice restoring access', async () => {
  const test = fixture();
  await deliverSubscriptionNotice(test.client, {
    ...notice,
    event: 'subscription.canceled',
    occurredAt: '2026-11-23T02:47:00Z',
    status: 'canceled',
    productId: null,
    priceId: null,
  }, test.relay);
  await deliverSubscriptionNotice(test.client, notice, test.relay);

  equal(test.row.status, 'canceled');
  equal(test.row.paddle_last_event_at, '2026-11-23T02:47:00.000Z');
  equal(test.patches[1].query.get('or'), '(paddle_last_event_at.is.null,paddle_last_event_at.lt.2026-11-23T02:46:30.000Z)');
});

Deno.test('an altered or unknown plan cannot grant the bound mirror entitlement', async () => {
  const test = fixture({ ...trusted, status: 'active' });
  await deliverSubscriptionNotice(test.client, {
    ...notice,
    event: 'subscription.updated',
    priceId: 'different-plan',
  }, test.relay);
  equal(test.row.status, 'inactive');
  equal(test.row.price_id, trusted.price_id);
});

Deno.test('propagates relay and mirror failures so Paddle can retry', async () => {
  const relayFailure = fixture();
  await rejects(deliverSubscriptionNotice(relayFailure.client, notice, () => Promise.reject(new Error('Relay failed'))), /Relay failed/);
  deepEqual(relayFailure.effects, []);

  const mirrorFailure = fixture({ ...trusted }, true);
  await rejects(deliverSubscriptionNotice(mirrorFailure.client, notice, mirrorFailure.relay), /Could not reconcile/);
  deepEqual(mirrorFailure.effects, ['relay', 'lookup', 'update']);
});
