import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { PlanController } from './plan/plan.controller.js';
import { PlanService } from './plan/plan.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController, PlanController],
  providers: [PlanService, { provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
