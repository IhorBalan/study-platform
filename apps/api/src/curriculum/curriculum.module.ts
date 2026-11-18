import { Global, Module } from '@nestjs/common';
import { CurriculumService } from './curriculum.service.js';
import { LessonsController } from './lessons.controller.js';
import { LessonsService } from './lessons.service.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { TasksController } from './tasks.controller.js';

@Global()
@Module({
  controllers: [LessonsController, TasksController, SearchController],
  providers: [CurriculumService, LessonsService, SearchService],
  exports: [CurriculumService],
})
export class CurriculumModule {}
