import { Module } from '@nestjs/common';
import { PlanModule } from '../plan/plan.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SrsModule } from '../srs/srs.module.js';
import { SessionsService } from './sessions.service.js';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

/** Study time, streaks and retention. */
@Module({
  imports: [PlanModule, SettingsModule, SrsModule],
  controllers: [StatsController],
  providers: [SessionsService, StatsService],
})
export class StatsModule {}
