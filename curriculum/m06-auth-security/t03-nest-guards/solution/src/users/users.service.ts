import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { AuthUser, Role } from './user.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
// Small parameters so the app starts fast. A real service uses N = 2^17 or argon2id.
const PARAMS = { N: 2 ** 14, r: 8, p: 1 };

interface StoredUser extends AuthUser {
  salt: Buffer;
  hash: Buffer;
}

/** Practice users. Their passwords are in the task brief. */
const SEED: Array<{ id: string; username: string; role: Role; password: string }> = [
  { id: 'u-alice', username: 'alice', role: 'member', password: 'alice-password' },
  { id: 'u-bob', username: 'bob', role: 'member', password: 'bob-password' },
  { id: 'u-carol', username: 'carol', role: 'admin', password: 'carol-password' },
];

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly users = new Map<string, StoredUser>();

  async onModuleInit(): Promise<void> {
    for (const { password, ...user } of SEED) {
      const salt = randomBytes(16);
      const hash = await scryptAsync(password, salt, 32, PARAMS);
      this.users.set(user.username, { ...user, salt, hash });
    }
  }

  /** Returns the user for a correct username and password, otherwise null. */
  async checkCredentials(username: unknown, password: unknown): Promise<AuthUser | null> {
    if (typeof username !== 'string' || typeof password !== 'string') return null;
    const user = this.users.get(username);
    // Hash even for an unknown user, so the response time does not reveal which usernames exist.
    const salt = user?.salt ?? randomBytes(16);
    const candidate = await scryptAsync(password, salt, 32, PARAMS);
    if (!user || !timingSafeEqual(candidate, user.hash)) return null;
    return this.toAuthUser(user);
  }

  findById(id: string): AuthUser | undefined {
    const user = [...this.users.values()].find((u) => u.id === id);
    return user && this.toAuthUser(user);
  }

  list(): AuthUser[] {
    return [...this.users.values()].map((u) => this.toAuthUser(u));
  }

  private toAuthUser({ id, username, role }: StoredUser): AuthUser {
    return { id, username, role };
  }
}
