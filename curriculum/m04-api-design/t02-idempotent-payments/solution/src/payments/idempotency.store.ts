import { createHash } from 'node:crypto';
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';

type Entry =
  | { state: 'in-flight'; fingerprint: string }
  | { state: 'done'; fingerprint: string; body: unknown; expiresAt: number };

export interface Outcome<T> {
  body: T;
  replayed: boolean;
}

const TTL_MS = 24 * 60 * 60 * 1000;

/** JSON with object keys sorted, so { a, b } and { b, a } give the same fingerprint. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(request: unknown): string {
  return createHash('sha256').update(canonical(request)).digest('hex');
}

/**
 * Remembers the outcome of each key. In memory, so it only works for one
 * instance; with several, the same logic moves to Postgres (a unique key
 * column) or Valkey (SET key value NX EX ttl) so the check-and-reserve is atomic
 * across processes.
 */
@Injectable()
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  async run<T>(key: string, requestFingerprint: string, work: () => Promise<T>): Promise<Outcome<T>> {
    const existing = this.entries.get(key);
    if (existing?.state === 'done' && existing.expiresAt < Date.now()) this.entries.delete(key);

    const entry = this.entries.get(key);
    if (entry && entry.fingerprint !== requestFingerprint) {
      throw new UnprocessableEntityException('This Idempotency-Key was already used with a different request body');
    }
    if (entry?.state === 'in-flight') {
      throw new ConflictException('A request with this Idempotency-Key is still being processed; retry later');
    }
    if (entry?.state === 'done') return { body: entry.body as T, replayed: true };

    // Check and reserve with no await in between: on one event loop nothing
    // else can run here, so two concurrent requests cannot both reserve.
    this.entries.set(key, { state: 'in-flight', fingerprint: requestFingerprint });
    try {
      const body = await work();
      this.entries.set(key, { state: 'done', fingerprint: requestFingerprint, body, expiresAt: Date.now() + TTL_MS });
      return { body, replayed: false };
    } catch (error) {
      // Nothing was stored for this key, so the client may retry with it.
      this.entries.delete(key);
      throw error;
    }
  }
}
