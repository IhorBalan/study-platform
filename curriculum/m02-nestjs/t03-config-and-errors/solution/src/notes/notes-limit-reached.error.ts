import { DomainError } from '../common/domain-error.js';

export class NotesLimitReachedError extends DomainError {
  readonly kind = 'conflict';

  constructor(limit: number) {
    super(`The store already holds the maximum of ${limit} notes. Delete one first.`);
  }
}
