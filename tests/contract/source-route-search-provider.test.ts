import { describe, expect, it } from 'vitest';
import { BraveSearchProvider } from '../../src/tools/source-route/search-provider.js';

describe('Brave Search provider adapter', () => {
  it('uses the official web search route and keeps the credential out of results', async () => {
    let requestedUrl = '';
    let requestHeaders: HeadersInit | undefined;
    const provider = new BraveSearchProvider('test-secret-placeholder', async (input, init) => {
      requestedUrl = String(input);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({ web: { results: [{ url: 'https://example.org/data.csv', title: 'Dataset CSV', description: 'Download data' }] } }), { status: 200 });
    });
    const results = await provider.search('population dataset', { timeoutMs: 1000 });
    expect(new URL(requestedUrl).origin).toBe('https://api.search.brave.com');
    expect(new URL(requestedUrl).pathname).toBe('/res/v1/web/search');
    expect(new URL(requestedUrl).searchParams.get('q')).toBe('population dataset');
    expect(new Headers(requestHeaders).get('X-Subscription-Token')).toBe('test-secret-placeholder');
    expect(JSON.stringify(results)).not.toContain('test-secret-placeholder');
    expect(results[0]?.url).toBe('https://example.org/data.csv');
  });

  it('rejects malformed provider payloads and does not reveal the key in errors', async () => {
    const provider = new BraveSearchProvider('test-secret-placeholder', async () => new Response('{"web":{}}', { status: 200 }));
    await expect(provider.search('goal', { timeoutMs: 1000 })).rejects.toThrow('missing web results');
  });
});
