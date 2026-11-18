import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { type AuthUser, USER_COLUMNS } from './user.js';

const SESSION_HOURS = 8;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Opaque session tokens. The client gets 32 random bytes; the database stores
 * only their SHA-256, so a leaked sessions table cannot be replayed. A fast hash
 * is fine here because the token is random, unlike a password.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly db: DbService) {}

  async create(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))',
      [sha256(token), userId, SESSION_HOURS],
    );
    return token;
  }

  async userFor(token: string): Promise<AuthUser | undefined> {
    const [user] = await this.db.query<AuthUser>(
      `SELECT ${USER_COLUMNS} FROM users
        WHERE id = (SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now())`,
      [sha256(token)],
    );
    return user;
  }
}
