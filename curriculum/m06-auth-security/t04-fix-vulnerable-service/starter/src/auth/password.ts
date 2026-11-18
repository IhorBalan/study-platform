import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
// Small parameters keep the practice app fast. Production uses N = 2^17 or argon2id.
const N = 2 ** 14;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, { N, r: 8, p: 1 });
  return `$scrypt$n=${N},r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(stored);
  if (!match) return false;
  const [n, r, p] = match.slice(1, 4).map(Number);
  const key = Buffer.from(match[5], 'base64url');
  const candidate = await scryptAsync(password, Buffer.from(match[4], 'base64url'), key.length, { N: n, r, p });
  return timingSafeEqual(candidate, key);
}
