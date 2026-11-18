import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PaymentGateway } from './payment-gateway.js';
import type { CreatePaymentInput, Payment } from './payment.js';

@Injectable()
export class PaymentsService {
  private readonly payments: Payment[] = [];

  constructor(private readonly gateway: PaymentGateway) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    const { chargeId } = await this.gateway.charge(input.amount, input.currency);
    const payment: Payment = {
      id: `pay_${randomUUID()}`,
      amount: input.amount,
      currency: input.currency,
      description: input.description ?? null,
      status: 'succeeded',
      chargeId,
      createdAt: new Date().toISOString(),
    };
    this.payments.push(payment);
    return payment;
  }

  list(): Payment[] {
    return [...this.payments];
  }
}
