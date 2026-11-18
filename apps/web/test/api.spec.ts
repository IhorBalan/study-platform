import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/api';

function respondWith(status: number, body: unknown, contentType = 'application/json') {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const text = body === undefined ? null : JSON.stringify(body);
    return new Response(text, { status, headers: text ? { 'content-type': contentType } : {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const settings = {
  reviewMode: 'copy_paste',
  newCardsPerDay: 10,
  reviewsPerDay: 100,
  desiredRetention: 0.9,
  labRepoPath: null,
};

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests under /api and returns the validated body', async () => {
    const fetchMock = respondWith(200, settings);
    await expect(api.settings()).resolves.toEqual(settings);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({ method: 'GET', body: undefined }),
    );
  });

  it('sends writes as JSON', async () => {
    const fetchMock = respondWith(200, { ...settings, newCardsPerDay: 5 });
    await api.updateSettings({ newCardsPerDay: 5 });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ newCardsPerDay: 5 }));
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('turns a problem document into an ApiError with field messages', async () => {
    respondWith(
      400,
      {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'The request is not valid.',
        errors: [
          { path: 'newCardsPerDay', message: 'Too big' },
          { path: '', message: 'Something else' },
        ],
      },
      'application/problem+json',
    );
    const error = await api.updateSettings({ newCardsPerDay: 9999 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.message).toBe('The request is not valid.');
    expect(apiError.errors).toEqual(['newCardsPerDay: Too big', 'Something else']);
  });

  it('still reports the status when a failure has no readable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<() => Promise<Response>>(
        async () => new Response('<html>Bad gateway</html>', { status: 502 }),
      ),
    );
    const error = (await api.plan().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.problem).toBeNull();
    expect(error.message).toBe('Request failed with status 502');
    expect(error.errors).toEqual([]);
  });

  it('accepts an empty 204 answer', async () => {
    respondWith(204, undefined);
    await expect(api.updateSession('some-id', 30)).resolves.toBeUndefined();
  });

  it('marks a request sent while the page closes as keepalive', async () => {
    const fetchMock = respondWith(204, undefined);
    await api.updateSession('some-id', 30, true);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.keepalive).toBe(true);
  });

  it('fails loudly when the API answers in a shape the app does not expect', async () => {
    respondWith(200, { ...settings, reviewMode: 'telepathy' });
    await expect(api.settings()).rejects.toThrow(/reviewMode/);
  });

  it('encodes the search text', async () => {
    const fetchMock = respondWith(200, { query: 'a&b c', results: [] });
    await api.search('a&b c');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/search?q=a%26b%20c');
  });
});
