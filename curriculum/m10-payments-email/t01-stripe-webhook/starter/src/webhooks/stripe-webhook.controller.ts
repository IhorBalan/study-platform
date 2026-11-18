import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import type pg from 'pg';
import Stripe from 'stripe';
import { PG_POOL } from '../db.js';
import { STRIPE } from '../stripe.js';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(STRIPE) private readonly stripe: Stripe,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  async receive() {
    // TODO: verify the Stripe-Signature header against STRIPE_WEBHOOK_SECRET (400 when it fails),
    // then pass the event to handleStripeEvent({ pool: this.pool, stripe: this.stripe }, event).
    return { received: true };
  }
}
