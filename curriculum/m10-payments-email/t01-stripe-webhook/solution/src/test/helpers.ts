// Test helpers: a pool on DATABASE_URL, a schema reset, a fake Stripe API and event builders.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type Stripe from 'stripe';
import type { StripeApi } from '../stripe.js';

export function testPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL, for example postgres://lab:lab@localhost:55432/lab');
  return new pg.Pool({ connectionString, max: 10 });
}

/** Drops and recreates the tables from db/schema.sql. Run from the project root (npm test does). */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query(readFileSync('db/schema.sql', 'utf8'));
}

/** An in-memory Stripe API. Set the current state of sessions and subscriptions, and count the calls. */
export class FakeStripe implements StripeApi {
  readonly sessions = new Map<string, Partial<Stripe.Checkout.Session>>();
  readonly subs = new Map<string, Partial<Stripe.Subscription>>();
  calls = 0;
  failing = false;

  checkout = {
    sessions: {
      retrieve: async (id: string) => this.get(this.sessions, id) as Stripe.Checkout.Session,
    },
  };

  subscriptions = {
    retrieve: async (id: string) => this.get(this.subs, id) as Stripe.Subscription,
  };

  private get<T>(map: Map<string, T>, id: string): T {
    this.calls += 1;
    if (this.failing) throw new Error('Stripe API unavailable');
    const value = map.get(id);
    if (!value) throw new Error(`No such object: ${id}`);
    return value;
  }
}

let seq = 0;

/** A minimal event of the given type whose data.object is `object`. */
export function makeEvent(type: string, object: { id: string } & Record<string, unknown>, id = `evt_test_${++seq}`): Stripe.Event {
  return { id, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } } as unknown as Stripe.Event;
}

export function makeSubscription(id: string, status: Stripe.Subscription.Status, priceId = 'price_pro'): Partial<Stripe.Subscription> {
  return {
    id,
    object: 'subscription',
    customer: 'cus_test',
    status,
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [{ id: `si_${id}`, price: { id: priceId }, current_period_end: 1_800_000_000 }],
    },
  } as unknown as Partial<Stripe.Subscription>;
}
