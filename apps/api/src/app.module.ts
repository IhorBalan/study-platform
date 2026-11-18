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
import { CurriculumModule } from './curriculum/curriculum.module.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { PlanController } from './plan/plan.controller.js';
import { NotesController } from './notes/notes.controller.js';
import { NotesService } from './notes/notes.service.js';
import { PlanService } from './plan/plan.service.js';
import { QueueService } from './queue/queue.service.js';
import { SubmissionReviewController } from './review/review.controller.js';
import { SubmissionReviewService } from './review/review.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { SessionsService } from './stats/sessions.service.js';
import { StatsController } from './stats/stats.controller.js';
import { StatsService } from './stats/stats.service.js';
import { WeakSkillsService } from './stats/weak-skills.service.js';
import { SubmissionsController } from './submissions/submissions.controller.js';
import { SubmissionsService } from './submissions/submissions.service.js';
import { CardsService } from './srs/cards.service.js';
import { ReviewService } from './srs/review.service.js';
import { SrsController } from './srs/srs.controller.js';

@Module({
  imports: [ConfigModule, DatabaseModule, CurriculumModule],
  controllers: [
    HealthController,
    PlanController,
    SettingsController,
    SrsController,
    SubmissionsController,
    SubmissionReviewController,
    BridgeController,
    StatsController,
    NotesController,
  ],
  providers: [
    PlanService,
    SettingsService,
    CardsService,
    ReviewService,
    QueueService,
    SubmissionsService,
    SubmissionReviewService,
    StatsService,
    NotesService,
    SessionsService,
    WeakSkillsService,
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
