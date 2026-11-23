import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PaddleEnv } from '../_shared/paddle.ts';

export type VerifiedSubscriptionNotice = {
  event: 'subscription.created' | 'subscription.updated' | 'subscription.canceled';
  eventId: string;
  occurredAt: string;
  environment: PaddleEnv;
  subscriptionId: string;
  customerId?: string | null;
  userId?: string | null;
  productId?: string | null;
  priceId?: string | null;
  status: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
};

export async function deliverSubscriptionNotice(
  supabase: Pick<SupabaseClient, 'from'>,
  notification: VerifiedSubscriptionNotice,
  relay: (notice: VerifiedSubscriptionNotice) => Promise<void>,
) {
  await relay(notification);

  const occurredAt = Date.parse(notification.occurredAt);
  const { subscriptionId, customerId, environment } = notification;
  if (!subscriptionId || !customerId || !Number.isFinite(occurredAt)) return;

  const { data: binding, error: lookupError } = await supabase.from('subscriptions')
    .select('id,product_id,price_id,paddle_binding_verified_at')
    .eq('paddle_subscription_id', subscriptionId)
    .eq('paddle_customer_id', customerId)
    .eq('environment', environment)
    .not('paddle_binding_verified_at', 'is', null)
    .maybeSingle();

  if (lookupError) throw new Error('Could not read the verified subscription mirror binding');
  if (!binding) return;

  const eventTime = new Date(occurredAt).toISOString();
  const matchesPlan = binding.product_id === notification.productId && binding.price_id === notification.priceId;
  const planStatus = matchesPlan && typeof notification.status === 'string' ? notification.status : 'inactive';
  const status = notification.event === 'subscription.canceled' ? 'canceled' : planStatus;

  const { error: updateError } = await supabase.from('subscriptions').update({
    status,
    current_period_start: notification.currentPeriodStart,
    current_period_end: notification.currentPeriodEnd,
    cancel_at_period_end: notification.cancelAtPeriodEnd,
    paddle_last_event_at: eventTime,
    updated_at: new Date().toISOString(),
  })
    .eq('id', binding.id)
    .eq('paddle_subscription_id', subscriptionId)
    .eq('paddle_customer_id', customerId)
    .eq('environment', environment)
    .eq('paddle_binding_verified_at', binding.paddle_binding_verified_at)
    .eq('product_id', binding.product_id)
    .eq('price_id', binding.price_id)
    .or(`paddle_last_event_at.is.null,paddle_last_event_at.lt.${eventTime}`);

  if (updateError) throw new Error('Could not reconcile the verified subscription mirror');
}
