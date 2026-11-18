import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * A stand-in for a card processor. Do not change this file.
 * Every call to charge() moves money, so calling it twice for one payment
 * charges the customer twice. It takes a while, like a real network call.
 */
@Injectable()
export class PaymentGateway {
  private charges = 0;

  async charge(amount: number, currency: string): Promise<{ chargeId: string }> {
    await sleep(150);
    this.charges += 1;
    return { chargeId: `ch_${randomUUID()}` };
  }

  get chargeCount(): number {
    return this.charges;
  }
}
