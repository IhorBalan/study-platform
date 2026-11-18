import type pg from 'pg';
import type Stripe from 'stripe';
import { tx } from '../db.js';
import type { StripeApi } from '../stripe.js';

export interface Deps {
  pool: pg.Pool;
  stripe: StripeApi;
}

export type HandleResult = 'processed' | 'duplicate';

const CHECKOUT_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

type Effect = (db: pg.PoolClient) => Promise<void>;

/**
 * Applies one verified Stripe event exactly once.
 *
 * 1. A cheap check skips events we already processed without calling Stripe.
 * 2. The current state of the object is fetched from Stripe before any transaction opens, so no
 *    transaction waits on the network, and the order in which events arrive does not matter.
 * 3. The event id and the effects commit in one transaction. If anything throws, nothing is stored
 *    and Stripe's retry gets a clean second attempt.
 */
export async function handleStripeEvent({ pool, stripe }: Deps, event: Stripe.Event): Promise<HandleResult> {
  const seen = await pool.query('select 1 from stripe_events where id = $1', [event.id]);
  if (seen.rowCount) return 'duplicate';

  const effect = await planEffect(stripe, event);

  return tx(pool, async (db) => {
    // On a concurrent duplicate this insert waits for the other transaction, then inserts nothing.
    const claimed = await db.query(
      'insert into stripe_events (id, type) values ($1, $2) on conflict (id) do nothing',
      [event.id, event.type],
    );
    if (claimed.rowCount === 0) return 'duplicate';
    await effect?.(db);
    return 'processed';
  });
}

/** Reads what is needed from Stripe and returns the database work to run inside the transaction. */
async function planEffect(stripe: StripeApi, event: Stripe.Event): Promise<Effect | undefined> {
  if (CHECKOUT_EVENTS.has(event.type)) {
    const { id } = event.data.object as { id: string };
    const session = await stripe.checkout.sessions.retrieve(id);
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return undefined;
    const orderId = session.client_reference_id;
    if (!orderId) return undefined;
    return (db) => fulfilOrder(db, orderId, session.id);
  }

  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const { id } = event.data.object as { id: string };
    const subscription = await stripe.subscriptions.retrieve(id);
    return (db) => upsertSubscription(db, subscription);
  }

  return undefined; // an event type we do not act on: record it and acknowledge
}

/** pending -> paid succeeds for exactly one caller, so the order is fulfilled once per order, whatever the events. */
async function fulfilOrder(db: pg.PoolClient, orderId: string, sessionId: string): Promise<void> {
  const paid = await db.query(
    `update orders set status = 'paid', stripe_session_id = $2, paid_at = now()
      where id = $1 and status = 'pending'`,
    [orderId, sessionId],
  );
  if (paid.rowCount === 1) {
    await db.query('insert into fulfilments (order_id) values ($1)', [orderId]);
  }
}

async function upsertSubscription(db: pg.PoolClient, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  if (!item) throw new Error(`subscription ${sub.id} has no items`);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await db.query(
    `insert into subscriptions
       (stripe_subscription_id, stripe_customer_id, status, price_id, current_period_end, cancel_at_period_end, updated_at)
     values ($1, $2, $3, $4, to_timestamp($5), $6, now())
     on conflict (stripe_subscription_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       status = excluded.status,
       price_id = excluded.price_id,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = now()`,
    [sub.id, customerId, sub.status, item.price.id, item.current_period_end, sub.cancel_at_period_end],
  );
}
