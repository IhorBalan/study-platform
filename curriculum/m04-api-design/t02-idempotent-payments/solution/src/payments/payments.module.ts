import { Module } from '@nestjs/common';
import { IdempotencyStore } from './idempotency.store.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentGateway, IdempotencyStore],
})
export class PaymentsModule {}
