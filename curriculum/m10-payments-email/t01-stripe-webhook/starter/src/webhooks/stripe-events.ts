import type pg from 'pg';
import type Stripe from 'stripe';
import type { StripeApi } from '../stripe.js';

export interface Deps {
  pool: pg.Pool;
  stripe: StripeApi;
}

export type HandleResult = 'processed' | 'duplicate';

/**
 * Applies one verified Stripe event exactly once and returns 'processed', or 'duplicate' when this
 * event id was processed before.
 *
 * TODO:
 * - checkout.session.completed and checkout.session.async_payment_succeeded: fetch the session with
 *   stripe.checkout.sessions.retrieve(); if it is paid, mark the order (client_reference_id) paid and
 *   insert one fulfilments row. Never fulfil an order twice.
 * - customer.subscription.created / .updated / .deleted: fetch the subscription with
 *   stripe.subscriptions.retrieve() and upsert it into subscriptions.
 * - any other type: nothing to do, but still acknowledge it.
 * - store event.id in stripe_events in the same transaction as the effects. If anything fails, throw.
 *
 * tx() in ../db.ts runs a function inside a transaction.
 */
export async function handleStripeEvent(deps: Deps, event: Stripe.Event): Promise<HandleResult> {
  void deps;
  void event;
  throw new Error('handleStripeEvent is not implemented yet');
}
