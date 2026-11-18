import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreatePaymentSchema, type CreatePaymentInput, type Payment } from './payment.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // TODO: make this safe to retry with an Idempotency-Key header, as the brief describes.
  @Post()
  create(@Body({ schema: CreatePaymentSchema }) input: CreatePaymentInput): Promise<Payment> {
    return this.payments.create(input);
  }

  @Get()
  list(): Payment[] {
    return this.payments.list();
  }
}
