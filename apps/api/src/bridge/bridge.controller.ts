import { Controller, Get, Inject } from '@nestjs/common';
import { BridgeHealth, type BridgeStatusResponse } from '@study/shared';
import { ENV, type Env } from '../config/env.js';

/** Lets the web app show whether automated checks can run right now. */
@Controller('bridge')
export class BridgeController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  async status(): Promise<BridgeStatusResponse> {
    const offline: BridgeStatusResponse = {
      reachable: false,
      docker: false,
      runners: [],
      claude: false,
      lastBackupAt: null,
    };
    if (!this.env.BRIDGE_SECRET) return offline;
    try {
      const res = await fetch(new URL('/health', this.env.BRIDGE_URL), {
        headers: { authorization: `Bearer ${this.env.BRIDGE_SECRET}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return offline;
      const health = BridgeHealth.parse(await res.json());
      return {
        reachable: true,
        docker: health.docker,
        runners: health.runners,
        claude: health.claude,
        lastBackupAt: health.lastBackupAt,
      };
    } catch {
      return offline;
    }
  }
}
