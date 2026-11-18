/**
 * Base class for failures the business rules expect. Services throw these and
 * stay unaware of HTTP; the exception filter translates `kind` into a status.
 * The message is written for the client, so it must never contain internals.
 */
export abstract class DomainError extends Error {
  abstract readonly kind: 'conflict' | 'not-found';

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
