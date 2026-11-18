import { Global, Module } from '@nestjs/common';
import Stripe from 'stripe';

export const STRIPE = Symbol('STRIPE');

/** The two Stripe calls the webhook handler needs. A real Stripe client satisfies it, and so does a fake in tests. */
export interface StripeApi {
  checkout: { sessions: { retrieve(id: string): Promise<Stripe.Checkout.Session> } };
  subscriptions: { retrieve(id: string): Promise<Stripe.Subscription> };
}

/**
 * A Stripe client from the environment. STRIPE_API_BASE (for example http://127.0.0.1:12111) points it
 * at a local fake of the API, which is how the checks run without internet. Leave it unset in production.
 */
export function createStripeClient(): Stripe {
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : undefined;
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
    maxNetworkRetries: 1,
    timeout: 10_000,
    telemetry: false,
    ...(base && {
      host: base.hostname,
      port: base.port,
      protocol: base.protocol === 'http:' ? 'http' : 'https',
    }),
  });
}

@Global()
@Module({
  providers: [{ provide: STRIPE, useFactory: createStripeClient }],
  exports: [STRIPE],
})
export class StripeModule {}
