import { describe, expect, it } from 'vitest';
import { exec, TailBuffer } from '../src/exec.js';

describe('TailBuffer', () => {
  it('keeps everything while under the limit', () => {
    const tail = new TailBuffer(10);
    tail.push(Buffer.from('abc'));
    tail.push(Buffer.from('def'));
    expect(tail.toString()).toBe('abcdef');
  });

  it('returns only the last bytes once over the limit', () => {
    const tail = new TailBuffer(4);
    for (const piece of ['ab', 'cd', 'ef', 'g']) tail.push(Buffer.from(piece));
    expect(tail.toString()).toBe('defg');
  });

  it('does not hold on to old chunks', () => {
    const tail = new TailBuffer(1024);
    const chunk = Buffer.alloc(1024, 'x');
    for (let i = 0; i < 10_000; i++) tail.push(chunk);
    // 10 MB went through; only the chunks that cover the limit are still referenced.
    const held = (tail as unknown as { chunks: Buffer[] }).chunks;
    expect(held.length).toBeLessThanOrEqual(2);
    expect(tail.toString()).toHaveLength(1024);
  });
});

describe('exec', () => {
  it('returns the tail of a program that prints far more than the limit', async () => {
    const script =
      "const line = 'y'.repeat(1023) + '\\n'; for (let i = 0; i < 20000; i++) process.stdout.write(line); process.stdout.write('END');";
    const result = await exec(process.execPath, ['-e', script], { maxOutputBytes: 2048 });

    expect(result.code).toBe(0);
    expect(result.stdout).toHaveLength(2048);
    expect(result.stdout.endsWith('END')).toBe(true);
  });
});
