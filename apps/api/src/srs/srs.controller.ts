import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CardStatus,
  CreateCard,
  SubmitReview,
  UpdateCard,
  type CardDto,
  type CardListResponse,
  type ReviewQueueResponse,
  type SubmitReviewResponse,
} from '@study/shared';
import { z } from 'zod';
import { CardsService } from './cards.service.js';
import { WeakSkillsService } from '../stats/weak-skills.service.js';
import { ReviewService } from './review.service.js';

const ListQuery = z.object({ status: CardStatus.optional(), lessonId: z.string().optional() });
type ListQuery = z.infer<typeof ListQuery>;

@Controller()
export class SrsController {
  private readonly logger = new Logger(SrsController.name);

  constructor(
    private readonly cards: CardsService,
    private readonly review: ReviewService,
    private readonly weakSkills: WeakSkillsService,
  ) {}

  @Get('cards')
  async list(@Query({ schema: ListQuery }) query: ListQuery): Promise<CardListResponse> {
    return { cards: await this.cards.list(query) };
  }

  @Post('cards')
  create(@Body({ schema: CreateCard }) body: CreateCard): Promise<CardDto> {
    return this.cards.create(body);
  }

  @Patch('cards/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: UpdateCard }) body: UpdateCard,
  ): Promise<CardDto> {
    return this.cards.update(id, body);
  }

  @Delete('cards/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.cards.remove(id);
  }

  @Get('review/queue')
  queue(): Promise<ReviewQueueResponse> {
    return this.review.queue();
  }

  @Post('review/:cardId')
  @HttpCode(200)
  async submit(
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body({ schema: SubmitReview }) body: SubmitReview,
  ): Promise<SubmitReviewResponse> {
    const result = await this.review.submit(cardId, body);
    // A lapse can push a skill below the threshold, and a success can lift it back.
    // The grade is already saved, so a failure here must not fail the request:
    // a retry would be refused because the card is no longer due.
    try {
      await this.weakSkills.evaluate();
    } catch (error) {
      this.logger.error('Could not update the weak-skill refresh list', error);
    }
    return result;
  }

  @Post('review/:cardId/undo')
  @HttpCode(200)
  async undo(@Param('cardId', ParseUUIDPipe) cardId: string): Promise<SubmitReviewResponse> {
    const result = await this.review.undo(cardId);
    // The grade that is gone may have been what put a skill on the refresh list.
    try {
      await this.weakSkills.evaluate();
    } catch (error) {
      this.logger.error('Could not update the weak-skill refresh list', error);
    }
    return result;
  }
}
