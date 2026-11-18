import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { SessionsService } from '../auth/sessions.service.js';
import type { AuthUser } from '../auth/user.js';
import { DbService } from '../db/db.service.js';

/** Verifying against this when the email is unknown keeps the response time the same. */
const DUMMY_HASH = await hashPassword('dummy password for unknown users');

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionsService,
  ) {}

  /** "Flexible": whatever fields the client sends become columns. */
  async signup(input: Record<string, unknown>): Promise<AuthUser> {
    const { password, ...fields } = input;
    const row: Record<string, unknown> = { ...fields, password_hash: await hashPassword(String(password)) };
    const columns = Object.keys(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    try {
      const [user] = await this.db.query<AuthUser>(
        `INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        Object.values(row),
      );
      return user;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('That email is already registered');
      throw error;
    }
  }

  async login(input: Record<string, unknown>): Promise<string> {
    const [row] = await this.db.query<{ id: number; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [input.email],
    );
    const ok = await verifyPassword(String(input.password), row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.sessions.create(row.id);
  }

  /** "Flexible" again: every key in the body is a column to update. */
  async updateMe(user: AuthUser, input: Record<string, unknown>): Promise<AuthUser> {
    const keys = Object.keys(input);
    const assignments = keys.map((key, i) => `${key} = $${i + 1}`);
    const [updated] = await this.db.query<AuthUser>(
      `UPDATE users SET ${assignments.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
      [...Object.values(input), user.id],
    );
    return updated;
  }
}
