import { Module } from '@nestjs/common';
import { DbModule } from './db.js';
import { StripeModule } from './stripe.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({ imports: [DbModule, StripeModule, WebhooksModule] })
export class AppModule {}
