import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { CardsService } from './cards.service.js';
import { ReviewService } from './review.service.js';
import { SrsController } from './srs.controller.js';
import { WeakSkillsService } from './weak-skills.service.js';

/** Spaced repetition: cards, the review queue, grading and weak skills. */
@Module({
  imports: [SettingsModule],
  controllers: [SrsController],
  providers: [CardsService, ReviewService, WeakSkillsService],
  exports: [CardsService, ReviewService, WeakSkillsService],
})
export class SrsModule {}
