import {
  BadRequestException,
  Inject,
  Module,
  StandardSchemaValidationPipe,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { BridgeController } from './bridge/bridge.controller.js';
import { hostGuard } from './common/host-guard.middleware.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { writeGuard } from './common/write-guard.middleware.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { CurriculumModule } from './curriculum/curriculum.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { NotesModule } from './notes/notes.module.js';
import { PlanModule } from './plan/plan.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SrsModule } from './srs/srs.module.js';
import { StatsModule } from './stats/stats.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';

@Module({
  imports: [
    // Global infrastructure, visible to every feature without an import.
    ConfigModule,
    DatabaseModule,
    CurriculumModule,
    // One module per feature. Each exports only what other features use.
    SettingsModule,
    SrsModule,
    PlanModule,
    StatsModule,
    NotesModule,
    SubmissionsModule,
  ],
  controllers: [HealthController, BridgeController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    {
      // Validates every parameter declared with a `schema` option, e.g.
      // `@Body({ schema: UpdateLessonProgress })`. Nest does not apply it by default.
      provide: APP_PIPE,
      useValue: new StandardSchemaValidationPipe({
        exceptionFactory: (issues) =>
          new BadRequestException({
            message: 'Request validation failed',
            errors: issues.map((issue) => ({
              path: (issue.path ?? [])
                .map((p) => String(typeof p === 'object' ? p.key : p))
                .join('.'),
              message: issue.message,
            })),
          }),
      }),
    },
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(ENV) private readonly env: Env) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(hostGuard(this.env.WEB_ORIGIN), writeGuard(this.env.WEB_ORIGIN))
      .forRoutes('*path');
  }
}
