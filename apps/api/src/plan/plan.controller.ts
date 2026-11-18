import { Controller, Get } from '@nestjs/common';
import type { PlanResponse } from '@study/shared';
import { PlanService } from './plan.service.js';

@Controller('plan')
export class PlanController {
  constructor(private readonly plan: PlanService) {}

  @Get()
  getPlan(): Promise<PlanResponse> {
    return this.plan.getPlan();
  }
}
