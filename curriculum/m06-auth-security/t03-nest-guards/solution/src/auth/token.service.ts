import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/**
 * HS256 tokens, as in the "Signed tokens by hand" task. Given, not part of this task.
 * A real project uses a maintained library such as `jose` and loads the key from config.
 */
@Injectable()
export class TokenService {
  // A fresh key per process: restarting the app logs everyone out, which is fine for practice.
  private readonly secret = randomBytes(32);
  private readonly header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

  issue(claims: { sub: string }, expiresInSeconds = 900): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + expiresInSeconds })).toString('base64url');
    const input = `${this.header}.${payload}`;
    return `${input}.${this.sign(input).toString('base64url')}`;
  }

  /** Returns the payload of a valid token, or null for anything else. Never throws. */
  verify(token: string): { sub: string; exp: number } | null {
    const [header, payload, signature, extra] = token.split('.');
    if (header !== this.header || !payload || signature === undefined || extra !== undefined) return null;
    const expected = this.sign(`${header}.${payload}`);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof claims.sub !== 'string' || !Number.isInteger(claims.exp)) return null;
      if (Math.floor(Date.now() / 1000) >= claims.exp) return null;
      return claims;
    } catch {
      return null;
    }
  }

  private sign(input: string): Buffer {
    return createHmac('sha256', this.secret).update(input).digest();
  }
}
