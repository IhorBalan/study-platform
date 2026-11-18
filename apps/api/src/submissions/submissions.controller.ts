import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateSubmission, type SubmissionDto, type SubmissionListResponse } from '@study/shared';
import { SubmissionsService } from './submissions.service.js';

@Controller('tasks/:moduleId/:taskSlug/submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  async list(
    @Param('moduleId') moduleId: string,
    @Param('taskSlug') taskSlug: string,
  ): Promise<SubmissionListResponse> {
    return { submissions: await this.submissions.list(`${moduleId}/${taskSlug}`) };
  }

  @Post()
  create(
    @Param('moduleId') moduleId: string,
    @Param('taskSlug') taskSlug: string,
    @Body({ schema: CreateSubmission }) body: CreateSubmission,
  ): Promise<SubmissionDto> {
    return this.submissions.create(`${moduleId}/${taskSlug}`, body);
  }
}
