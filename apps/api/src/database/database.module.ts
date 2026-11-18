import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, runMigrations, type Database, type DatabaseHandle } from '@study/db';
import { ENV, type Env } from '../config/env.js';

export const DB = Symbol('DB');
const DB_HANDLE = Symbol('DB_HANDLE');

/** Shorthand for `@Inject(DB)`. */
export const InjectDb = (): ParameterDecorator => Inject(DB);
export type { Database };

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: async (env: Env): Promise<DatabaseHandle> => {
        const handle = createDatabase(env.DATABASE_URL);
        // One user, one instance: applying migrations at start-up is safe here
        // and means `pnpm dev` works on a fresh volume with no extra step.
        await runMigrations(handle.db);
        new Logger('Database').log('Migrations are up to date');
        return handle;
      },
    },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: DatabaseHandle) => h.db },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.pool.end();
  }
}
