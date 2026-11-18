import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ReviewService } from './review.service.js';

const ListQuery = z.object({ status: CardStatus.optional(), lessonId: z.string().optional() });
type ListQuery = z.infer<typeof ListQuery>;

@Controller()
export class SrsController {
  constructor(
    private readonly cards: CardsService,
    private readonly review: ReviewService,
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
  submit(
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body({ schema: SubmitReview }) body: SubmitReview,
  ): Promise<SubmitReviewResponse> {
    return this.review.submit(cardId, body);
  }
}
