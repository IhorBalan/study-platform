import { Controller, Get, Param } from '@nestjs/common';
import type { TaskDetail } from '@study/shared';
import { CurriculumService } from './curriculum.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get(':moduleId/:taskSlug')
  get(@Param('moduleId') moduleId: string, @Param('taskSlug') taskSlug: string): TaskDetail {
    const task = this.curriculum.task(`${moduleId}/${taskSlug}`);
    return {
      id: task.id,
      moduleId: task.moduleId,
      moduleTitle: this.curriculum.module(task.moduleId).title,
      title: task.title,
      type: task.type,
      markdown: task.markdown,
      hints: task.hints,
      services: task.services,
      criteria: task.criteria,
      rubric: task.rubric.map((r) => ({ id: r.id, title: r.title, max: r.max })),
      labFolder: task.id,
      hasChecks: task.checksDir !== null,
    };
  }
}
