import { Inject, Injectable } from '@nestjs/common';
import { ResolveCommitResponse } from '@study/shared';
import { ENV, type Env } from '../config/env.js';
import { SettingsService } from '../settings/settings.service.js';

/** A submission must not wait on this: the checks themselves report a missing commit. */
const TIMEOUT_MS = 3_000;

/**
 * Pins a code submission to one commit at the moment it is made.
 *
 * "Latest commit" used to be looked up when the checks started. A run that
 * waited in the queue then checked whatever was committed later, so an attempt
 * made before the solution existed could be recorded as passed.
 */
@Injectable()
export class CommitResolver {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The full id of the submitted commit, or of the latest one when none was
   * given. Null when it cannot be told now: no lab path, the bridge is not
   * running, or the commit does not exist. The check run explains those cases.
   */
  async resolve(commitSha: string | undefined): Promise<string | null> {
    if (!this.env.BRIDGE_SECRET) return null;
    try {
      const { labRepoPath } = await this.settings.get();
      if (!labRepoPath) return null;
      const res = await fetch(new URL('/commits/resolve', this.env.BRIDGE_URL), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.env.BRIDGE_SECRET}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ repoPath: labRepoPath, ...(commitSha ? { commitSha } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return ResolveCommitResponse.parse(await res.json()).commitSha;
    } catch {
      return null;
    }
  }
}
