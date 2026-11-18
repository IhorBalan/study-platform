import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { PaymentsModule } from './payments/payments.module.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

@Module({
  imports: [PaymentsModule],
  providers: [
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
