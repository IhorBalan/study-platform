import { describe, expect, it } from 'vitest';
import type { E2eContext } from './context.js';

export function writeProtectionTests(ctx: E2eContext): void {
  describe('write protection', () => {
    it('refuses writes from another origin and form-encoded bodies', async () => {
      const foreign = await ctx
        .http()
        .post('/api/cards')
        .set('Origin', 'https://evil.example')
        .send({ type: 'term', front: 'planted', back: 'x', skills: [] });
      expect(foreign.status).toBe(403);
      expect(foreign.headers['content-type']).toContain('application/problem+json');

      const form = await ctx
        .http()
        .post('/api/cards')
        .type('form')
        .send('type=term&front=planted&back=x');
      expect(form.status).toBe(415);

      const list = await ctx.http().get('/api/cards').expect(200);
      expect(list.body.cards.some((c: { front: string }) => c.front === 'planted')).toBe(false);
    });

    it('answers only requests addressed to this machine', async () => {
      // A page on a domain re-pointed at 127.0.0.1 would send its own name as Host.
      const res = await ctx
        .http()
        .get('/api/settings')
        .set('Host', 'evil.example:3000')
        .expect(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      for (const host of ['localhost:3000', '127.0.0.1:3000', 'localhost', '[::1]:3000']) {
        await ctx.http().get('/api/health').set('Host', host).expect(200);
      }
    });

    it('accepts JSON writes from the web app on localhost and 127.0.0.1', async () => {
      for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
        const res = await ctx.http().patch('/api/settings').set('Origin', origin).send({});
        expect(res.status).toBe(200);
      }
    });
  });
}
