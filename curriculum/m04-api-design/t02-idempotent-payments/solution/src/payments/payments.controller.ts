import { BadRequestException, Body, Controller, Get, Headers, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { fingerprint, IdempotencyStore } from './idempotency.store.js';
import { CreatePaymentSchema, type CreatePaymentInput, type Payment } from './payment.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  // The body pipe has already run by the time we get here, so an invalid body
  // is rejected before the key is looked at and never reserves it.
  @Post()
  async create(
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: CreatePaymentSchema }) input: CreatePaymentInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Payment> {
    if (!key || key.length > 255) {
      throw new BadRequestException('An Idempotency-Key header of 1 to 255 characters is required');
    }
    const outcome = await this.idempotency.run(key, fingerprint(input), () => this.payments.create(input));
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return outcome.body;
  }

  @Get()
  list(): Payment[] {
    return this.payments.list();
  }
}
