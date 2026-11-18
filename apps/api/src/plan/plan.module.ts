import { Module } from '@nestjs/common';
import { SrsModule } from '../srs/srs.module.js';
import { PlanController } from './plan.controller.js';
import { PlanService } from './plan.service.js';

/** The Plan page: modules with progress and what to do next. */
@Module({
  imports: [SrsModule],
  controllers: [PlanController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
