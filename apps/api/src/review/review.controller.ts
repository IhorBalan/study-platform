import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { StartReview, SubmitReviewResult, type ReviewDto } from '@study/shared';
import { SubmissionReviewService } from './review.service.js';

@Controller()
export class SubmissionReviewController {
  constructor(private readonly reviews: SubmissionReviewService) {}

  @Post('submissions/:id/reviews')
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: StartReview }) body: StartReview,
  ): Promise<ReviewDto> {
    return this.reviews.start(id, body.mode);
  }

  @Get('reviews/:runId')
  get(@Param('runId', ParseUUIDPipe) runId: string): Promise<ReviewDto> {
    return this.reviews.get(runId);
  }

  @Post('reviews/:runId/result')
  @HttpCode(200)
  submit(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body({ schema: SubmitReviewResult }) body: SubmitReviewResult,
  ): Promise<ReviewDto> {
    return this.reviews.submitResult(runId, body.raw);
  }
}
