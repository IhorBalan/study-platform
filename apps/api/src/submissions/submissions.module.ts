import { Module } from '@nestjs/common';
import { QueueService } from '../queue/queue.service.js';
import { SubmissionReviewController } from '../review/review.controller.js';
import { SubmissionReviewService } from '../review/review.service.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';

/** Task submissions and both ways of verifying them: automated checks and Claude review. */
@Module({
  imports: [SettingsModule],
  controllers: [SubmissionsController, SubmissionReviewController],
  providers: [QueueService, SubmissionsService, SubmissionReviewService],
})
export class SubmissionsModule {}
