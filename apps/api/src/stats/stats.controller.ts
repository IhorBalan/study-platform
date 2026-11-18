import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { StartSession, UpdateSession, type StatsResponse } from '@study/shared';
import { SessionsService } from './sessions.service.js';
import { StatsService } from './stats.service.js';
import { WeakSkillsService } from './weak-skills.service.js';

@Controller()
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly sessions: SessionsService,
    private readonly weakSkills: WeakSkillsService,
  ) {}

  @Get('stats')
  get(): Promise<StatsResponse> {
    return this.stats.get();
  }

  @Post('sessions')
  start(@Body({ schema: StartSession }) body: StartSession): Promise<{ id: string }> {
    return this.sessions.start(body);
  }

  @Patch('sessions/:id')
  @HttpCode(204)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: UpdateSession }) body: UpdateSession,
  ): Promise<void> {
    await this.sessions.update(id, body);
  }

  @Post('review-tasks/:id/dismiss')
  @HttpCode(204)
  async dismiss(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.weakSkills.dismiss(id))) {
      throw new NotFoundException(`Review task "${id}" is not open`);
    }
  }
}
