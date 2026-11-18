import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  UpdateLessonProgress,
  type LessonDetail,
  type LessonProgressResponse,
} from '@study/shared';
import { LessonsService } from './lessons.service.js';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Get(':moduleId/:lessonSlug')
  get(
    @Param('moduleId') moduleId: string,
    @Param('lessonSlug') lessonSlug: string,
  ): Promise<LessonDetail> {
    return this.lessons.get(`${moduleId}/${lessonSlug}`);
  }

  @Put(':moduleId/:lessonSlug/progress')
  setProgress(
    @Param('moduleId') moduleId: string,
    @Param('lessonSlug') lessonSlug: string,
    @Body({ schema: UpdateLessonProgress }) body: UpdateLessonProgress,
  ): Promise<LessonProgressResponse> {
    return this.lessons.setProgress(`${moduleId}/${lessonSlug}`, body.status);
  }
}
