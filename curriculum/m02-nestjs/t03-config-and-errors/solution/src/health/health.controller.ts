import { Controller, Get, Inject } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  check(): { status: 'ok'; environment: string } {
    return { status: 'ok', environment: this.env.NODE_ENV };
  }
}
