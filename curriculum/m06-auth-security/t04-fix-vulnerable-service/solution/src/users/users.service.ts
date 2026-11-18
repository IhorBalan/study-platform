import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { SessionsService } from '../auth/sessions.service.js';
import { type AuthUser, USER_COLUMNS } from '../auth/user.js';
import { DbService } from '../db/db.service.js';
import type { Login, Signup, UpdateMe } from './users.schemas.js';

/** Verifying against this when the email is unknown keeps the response time the same. */
const DUMMY_HASH = await hashPassword('dummy password for unknown users');

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionsService,
  ) {}

  async signup(input: Signup): Promise<AuthUser> {
    const passwordHash = await hashPassword(input.password);
    try {
      // Columns are fixed in the SQL text; every value is a parameter. role takes its default.
      const [user] = await this.db.query<AuthUser>(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
        [input.email, input.name, passwordHash],
      );
      return user;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('That email is already registered');
      throw error;
    }
  }

  async login(input: Login): Promise<string> {
    const [row] = await this.db.query<{ id: number; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [input.email],
    );
    const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.sessions.create(row.id);
  }

  async updateMe(user: AuthUser, input: UpdateMe): Promise<AuthUser> {
    const [updated] = await this.db.query<AuthUser>(
      `UPDATE users SET name = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
      [input.name, user.id],
    );
    return updated;
  }
}
