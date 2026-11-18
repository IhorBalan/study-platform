import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { CHECKS_QUEUE, type ChecksJob } from '@study/shared';
import { PgBoss } from 'pg-boss';
import { ENV, type Env } from '../config/env.js';

/**
 * Puts jobs on the queue that lives in the platform database. The worker
 * process takes them off; the API never runs a check itself.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly boss: PgBoss;

  constructor(@Inject(ENV) env: Env) {
    this.boss = new PgBoss(env.DATABASE_URL);
    this.boss.on('error', (error) => this.logger.warn(`Queue error: ${error.message}`));
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(CHECKS_QUEUE);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: false });
  }

  async enqueueChecks(job: ChecksJob): Promise<void> {
    // The run row is the record of truth, so a retry by the queue would only
    // repeat work. The worker reports its own failures on the run.
    await this.boss.send(CHECKS_QUEUE, job, { retryLimit: 0 });
  }
}
