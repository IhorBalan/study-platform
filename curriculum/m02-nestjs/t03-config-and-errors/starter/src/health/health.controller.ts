import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  // TODO: inject the typed config and read the environment name from it.
  // Nothing outside src/config/ should touch process.env.
  @Get()
  check(): { status: 'ok'; environment: string } {
    return { status: 'ok', environment: process.env.NODE_ENV ?? 'development' };
  }
}
