import { BadRequestException, Controller, Headers, HttpCode, Inject, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type pg from 'pg';
import Stripe from 'stripe';
import { PG_POOL } from '../db.js';
import { STRIPE } from '../stripe.js';
import { handleStripeEvent } from './stripe-events.js';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(STRIPE) private readonly stripe: Stripe,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    if (!req.rawBody || !signature) throw new BadRequestException('missing body or Stripe-Signature header');

    let event: Stripe.Event;
    try {
      // Verifies the HMAC over the raw bytes and rejects timestamps older than 5 minutes (the default tolerance).
      event = this.stripe.webhooks.constructEvent(req.rawBody, signature, secret);
    } catch {
      throw new BadRequestException('invalid signature');
    }

    // Errors propagate as 500, so Stripe retries; nothing was stored for this event.
    const result = await handleStripeEvent({ pool: this.pool, stripe: this.stripe }, event);
    return { received: true, result };
  }
}
