import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env.js';

/**
 * Global, because configuration is needed everywhere and has no state of its
 * own. The factory runs while Nest builds the container, so an invalid
 * environment stops NestFactory.create() before the server listens.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
