import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Agent } from 'supertest';

/**
 * What every group of end-to-end tests shares. The groups run in one process,
 * against one application and one database, in the order the spec file lists
 * them: later groups build on what earlier ones left behind.
 */
export interface E2eContext {
  /** The running application. Set in `beforeAll`, so read it inside tests only. */
  app: NestExpressApplication;
  /** Replies the stand-in bridge gives to review requests, first in first out. */
  readonly bridgeReplies: unknown[];
  /** How long the stand-in bridge takes to answer, to imitate a review in progress. */
  bridgeDelayMs: number;
  http(): Agent;
  /** Moves a card's due date into the past, as if its interval had elapsed. */
  makeDue(cardId: string): Promise<void>;
}
